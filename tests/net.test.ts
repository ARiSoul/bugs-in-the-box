import { describe, expect, it } from 'vitest';
import { Brain, SKILLS } from '../src/game/brain';
import { NO_INPUT } from '../src/game/match';
import { computerGrowth } from '../src/game/progress';
import { RULE, TUNING } from '../src/game/tuning';
import { PauseReserve } from '../src/ui/pause';
import { Lockstep } from '../src/net/lockstep';
import { isCode, PROTOCOL, readToServer, type ToClient, type ToServer } from '../src/net/protocol';
import { EVERY, setUp, type MatchSetup } from '../src/sim';
import { Lobby, type Peer } from '../server/room';

const SETUP: MatchSetup = {
  scenario: 'pc-case',
  size: [3, 2, 3],
  seed: 9,
  teams: [
    { name: 'Red', species: 'ant', color: 0, size: 2, growth: computerGrowth('ant', 3) },
    { name: 'Blue', species: 'bee', color: 0, size: 2, growth: computerGrowth('bee', 1) },
  ],
  rules: { turnSeconds: 12, wind: 1 },
  tuning: { version: 0, changed: {}, hash: TUNING.defaults().hash },
  fresh: true,
};

/** A client as the game is one: its own match, stepped in lockstep; its own ticks played by the computer. */
class Client {
  readonly inbox: ToClient[] = [];
  seat = -1;
  token = '';
  code = '';
  lock: Lockstep | null = null;
  brain: Brain | null = null;
  refused: string[] = [];
  desync = -1;
  private sentChecks = 0;
  readonly peer: Peer = { send: (m) => this.inbox.push(JSON.parse(JSON.stringify(m)) as ToClient) };

  constructor(
    private readonly lobby: Lobby,
    readonly name: string,
  ) {}

  say(m: ToServer): void {
    this.lobby.hear(this.peer, JSON.stringify(m));
  }

  /** Read what came. */
  read(): void {
    for (const m of this.inbox.splice(0)) {
      if (m.t === 'seat') [this.seat, this.token, this.code] = [m.seat, m.token, m.code];
      else if (m.t === 'start') {
        const { match } = setUp(m.setup);
        this.lock = new Lockstep(match, this.seat);
        this.brain = new Brain(SKILLS[1], 100 + this.seat);
        if (m.known > 0) this.lock.take({ t: 'inputs', from: 0, upTo: m.known, changes: m.inputs });
      } else if (m.t === 'inputs') expect(this.lock?.take(m)).toBe(true);
      else if (m.t === 'refused') this.refused.push(m.why);
      else if (m.t === 'desync' && this.desync < 0) this.desync = m.tick;
    }
  }

  /** Up to `n` ticks, as far as it can; then send what is due. */
  play(n: number): void {
    const l = this.lock;
    if (!l) return;
    for (let k = 0; k < n && l.ready; k++) l.step(l.tick < l.knownUpTo || !l.own ? NO_INPUT : (this.brain as Brain).next(l.match));
    // (at the end of the test's ticks, what is left goes too: the game sends it when its turn ends)
    const b = l.batch(n === 0);
    if (b) this.say(b);
    for (; this.sentChecks < l.digests.length; this.sentChecks++) this.say({ t: 'check', tick: (this.sentChecks + 1) * EVERY, digest: l.digests[this.sentChecks] });
  }
}

/** Two clients in a room, playing until both reach `ticks`. */
function playOut(lobby: Lobby, a: Client, b: Client, ticks: number, each = (_n: number): void => {}): void {
  for (let n = 0; n < ticks * 4 && ((a.lock?.tick ?? 0) < ticks || (b.lock?.tick ?? 0) < ticks); n++) {
    a.read();
    b.read();
    a.play(Math.max(0, Math.min(8, ticks - (a.lock?.tick ?? 0))));
    b.play(Math.max(0, Math.min(8, ticks - (b.lock?.tick ?? 0))));
    each(n);
  }
  a.read();
  b.read();
}

const room = (): { lobby: Lobby; a: Client; b: Client } => {
  const lobby = new Lobby();
  const a = new Client(lobby, 'Ana');
  const b = new Client(lobby, 'Rui');
  a.say({ t: 'create', protocol: PROTOCOL, name: a.name, setup: SETUP });
  a.read();
  expect(isCode(a.code)).toBe(true);
  b.say({ t: 'join', protocol: PROTOCOL, code: a.code, name: b.name, growths: { bee: computerGrowth('bee', 2), ant: computerGrowth('ant', 9) } });
  a.read();
  b.read();
  return { lobby, a, b };
};

describe('the protocol', () => {
  it('takes only what is well formed', () => {
    expect(readToServer('nonsense')).toBe(null);
    expect(readToServer(JSON.stringify({ t: 'join', protocol: PROTOCOL, code: 'ab' }))).toBe(null);
    expect(readToServer(JSON.stringify({ t: 'join', protocol: 0, code: 'K7QF' }))).toBe(null);
    expect(readToServer(JSON.stringify({ t: 'inputs', from: 5, upTo: 3, changes: [] }))).toBe(null);
    expect(readToServer(JSON.stringify({ t: 'inputs', from: 0, upTo: 9, changes: [[4, {}], [2, {}]] }))).toBe(null);
    expect(readToServer(JSON.stringify({ t: 'inputs', from: 0, upTo: 9, changes: [[2, { move: 1 }]] }))).toEqual({ t: 'inputs', from: 0, upTo: 9, changes: [[2, { move: 1 }]] });
  });
});

describe('a room', () => {
  it('two clients play the same match as the server, tick for tick, each giving its own turns', () => {
    const { lobby, a, b } = room();
    expect([a.seat, b.seat]).toEqual([0, 1]);
    // (the second team plays with what its player brought)
    expect(lobby.rooms.get(a.code)?.lock?.match.teams[1].growth?.level).toBe(2);
    playOut(lobby, a, b, 2400);
    const server = lobby.rooms.get(a.code)?.lock as Lockstep;
    expect([a.lock?.tick, b.lock?.tick]).toEqual([2400, 2400]);
    expect(a.lock?.digests).toEqual(server.digests.slice(0, 40));
    expect(b.lock?.digests).toEqual(a.lock?.digests);
    // (both turns were played: more than one team gave inputs)
    expect(a.lock?.match.turnNumber).toBeGreaterThan(2);
    expect([a.desync, b.desync, a.refused, b.refused]).toEqual([-1, -1, [], []]);
  });

  it('a batch for ticks that are not the sender\'s turn is refused, and not passed on', () => {
    const { lobby, a, b } = room();
    // (the first turn is the first team's: the second sends ticks of its own)
    b.say({ t: 'inputs', from: 0, upTo: 30, changes: [[0, { move: 1 }]] });
    b.read();
    a.read();
    expect(b.refused.length).toBe(1);
    expect(lobby.rooms.get(a.code)?.lock?.tick).toBe(0);
    expect(a.lock?.knownUpTo).toBe(0);
  });

  it('one that comes back with its token takes its seat again, gets every input so far, and plays on the same', () => {
    const { lobby, a, b } = room();
    playOut(lobby, a, b, 900);
    lobby.gone(b.peer);
    const back = new Client(lobby, 'Rui');
    back.say({ t: 'join', protocol: PROTOCOL, code: a.code, name: 'Rui', token: b.token });
    back.read();
    expect(back.seat).toBe(1);
    // (it catches up with every input the server has, then plays on)
    playOut(lobby, a, back, 1800);
    expect(back.lock?.digests).toEqual(a.lock?.digests);
    expect(back.desync).toBe(-1);
    // (a stranger with no token finds the room full)
    const c = new Client(lobby, 'Eva');
    c.say({ t: 'join', protocol: PROTOCOL, code: a.code, name: 'Eva' });
    expect(c.inbox.some((m) => m.t === 'error' && /full/.test(m.message))).toBe(true);
  });

  it('a client whose match goes another way is told, at its checkpoint', () => {
    const { lobby, a, b } = room();
    let pushed = false;
    playOut(lobby, a, b, 1200, () => {
      // (something only this client's match has: a bug moved by hand)
      if (!pushed && (b.lock?.tick ?? 0) > 300) {
        const bug = b.lock?.match.units[0].bug;
        if (bug) bug.x += 0.5;
        pushed = true;
      }
    });
    expect(b.desync).toBeGreaterThan(300);
    expect(b.desync % EVERY).toBe(0);
    expect(lobby.rooms.get(a.code)?.desync).toBe(b.desync);
  });

  it('rooms nobody is in are cleared', () => {
    const { lobby, a, b } = room();
    lobby.gone(a.peer);
    lobby.sweep(0);
    expect(lobby.rooms.size).toBe(1);
    lobby.gone(b.peer);
    lobby.sweep(1000, Date.now() + 2000);
    expect(lobby.rooms.size).toBe(0);
  });
});

describe('holding the match', () => {
  it('a hold is read only as one: reading, paused, or none, with a time left', () => {
    expect(readToServer(JSON.stringify({ t: 'hold', why: 'reading', left: 12.5 }))).toEqual({ t: 'hold', why: 'reading', left: 12.5 });
    expect(readToServer(JSON.stringify({ t: 'hold', why: null, left: 0 }))).toEqual({ t: 'hold', why: null, left: 0 });
    expect(readToServer(JSON.stringify({ t: 'hold', why: 'sleeping', left: 3 }))).toBe(null);
    expect(readToServer(JSON.stringify({ t: 'hold', why: 'paused', left: 1e9 }))).toEqual({ t: 'hold', why: 'paused', left: 3600 });
  });

  it('the seat whose turn it is tells the other why it waits; the other seat may not hold the match', () => {
    const { a, b } = room();
    // (the first turn is the first seat's)
    a.say({ t: 'hold', why: 'reading', left: 15 });
    b.say({ t: 'hold', why: 'paused', left: 60 });
    const toB = b.inbox.filter((m) => m.t === 'held');
    const toA = a.inbox.filter((m) => m.t === 'held');
    expect(toB).toEqual([{ t: 'held', seat: 0, why: 'reading', left: 15 }]);
    expect(toA).toEqual([]);
    expect(b.inbox.some((m) => m.t === 'refused')).toBe(true);
    // (and that it no longer holds it)
    a.say({ t: 'hold', why: null, left: 0 });
    expect(b.inbox.filter((m) => m.t === 'held').at(-1)).toEqual({ t: 'held', seat: 0, why: null, left: 0 });
  });

  it('holds change nothing of the match: both play the same, with holds between their batches', () => {
    const { lobby, a, b } = room();
    let n = 0;
    playOut(lobby, a, b, 1500, () => {
      if (n++ % 7 === 0) (a.lock?.own ? a : b).say({ t: 'hold', why: n % 2 ? 'reading' : null, left: 5 });
    });
    expect(b.lock?.digests).toEqual(a.lock?.digests);
    expect([a.desync, b.desync]).toEqual([-1, -1]);
  });
});

describe('the pause online', () => {
  it('holds the match only on its own turn, from its reserve; spent, the match goes on under it', () => {
    const r = new PauseReserve(1);
    // (the other's turn: it holds nothing, and spends nothing)
    expect(r.hold(false, 0.5)).toBe(false);
    expect(r.left).toBe(1);
    expect(r.hold(true, 0.4)).toBe(true);
    expect(r.hold(true, 0.4)).toBe(true);
    expect(r.hold(true, 0.4)).toBe(false);
    expect(r.left).toBe(0);
    expect(r.hold(true, 0.1)).toBe(false);
  });

  it('its limits, and reading\'s, are settings, as shipped: 20 s a turn and 90 a match to read, 60 to pause', () => {
    expect([TUNING.get(RULE.readTurn).value, TUNING.get(RULE.readMatch).value, TUNING.get(RULE.pauseMatch).value]).toEqual([20, 90, 60]);
  });
});
