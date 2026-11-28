import { randomBytes, randomUUID } from 'node:crypto';
import { Lockstep } from '../src/net/lockstep';
import { CODE_CHARS, PROTOCOL, readToServer, type Inputs, type ToClient, type ToServer } from '../src/net/protocol';
import { EVERY, type MatchSetup } from '../src/sim/record';
import { setUp } from '../src/sim/replay';
import type { Growth } from '../src/game/progress';

/** One end of a connection, as a room sees it. */
export interface Peer {
  send(m: ToClient): void;
}

interface Seat {
  readonly token: string;
  name: string;
  peer: Peer | null;
  growths?: Readonly<Record<string, Growth>>;
}

/**
 * A room: two seats, a match set up by who made it, and the match itself, simulated here too. The server takes each
 * batch of inputs only from the seat whose turn those ticks are, steps its own match with it, and passes it on; it
 * compares the clients' checkpoints with its own, and tells both when one went another way. One that comes back (with
 * its token) gets every input so far.
 */
export class Room {
  readonly seats: (Seat | null)[] = [null, null];
  lock: Lockstep | null = null;
  /** Checkpoints a client sent before the server got there: by tick, by seat. */
  private readonly early = new Map<number, Map<number, string>>();
  /** The first desync seen (as a tick), -1: none. */
  desync = -1;
  /** When someone was last here (ms), to clear rooms nobody is in. */
  seen = Date.now();

  constructor(
    readonly code: string,
    private setup: MatchSetup,
  ) {}

  get started(): boolean {
    return this.lock !== null;
  }

  /** Take a seat (the first free), or come back to one's own with its token. Null: the room is full. */
  sit(peer: Peer, name: string, token?: string, growths?: Readonly<Record<string, Growth>>): number | null {
    this.seen = Date.now();
    let seat = token ? this.seats.findIndex((s) => s?.token === token) : -1;
    if (seat < 0) {
      seat = this.seats.findIndex((s) => s === null);
      if (seat < 0) return null;
      this.seats[seat] = { token: randomUUID(), name: name || `Player ${seat + 1}`, peer: null, growths };
    }
    const s = this.seats[seat] as Seat;
    s.peer = peer;
    if (name) s.name = name;
    peer.send({ t: 'seat', code: this.code, seat, token: s.token });
    if (!this.started && this.seats.every((q) => q !== null)) this.start();
    else if (this.started) peer.send(this.startMessage());
    this.presence();
    return seat;
  }

  /** A seat's connection went. */
  gone(peer: Peer): void {
    for (const s of this.seats) if (s?.peer === peer) s.peer = null;
    this.seen = Date.now();
    this.presence();
  }

  get empty(): boolean {
    return this.seats.every((s) => !s?.peer);
  }

  /** What a seat sent. */
  hear(seat: number, m: ToServer): void {
    this.seen = Date.now();
    const peer = this.seats[seat]?.peer;
    if (m.t === 'inputs') this.inputs(seat, m);
    else if (m.t === 'check') this.check(seat, m.tick, m.digest);
    else if (m.t === 'leave') this.gone(peer as Peer);
  }

  private start(): void {
    // (the second team plays with the growth its player brought with its species, unless the match has no levels)
    const teams = this.setup.teams.map((t, i) => (i === 1 && t.growth !== undefined ? { ...t, growth: this.seats[1]?.growths?.[t.species] ?? { level: 1, passives: [], items: {} } } : t));
    this.setup = { ...this.setup, teams };
    const { match } = setUp(this.setup);
    this.lock = new Lockstep(match, -1);
    for (const s of this.seats) s?.peer?.send(this.startMessage());
  }

  private startMessage(): ToClient {
    const l = this.lock as Lockstep;
    return { t: 'start', setup: this.setup, inputs: [...l.history], known: l.tick };
  }

  private inputs(seat: number, b: Inputs): void {
    const l = this.lock;
    const peer = this.seats[seat]?.peer;
    if (!l) return peer?.send({ t: 'refused', why: 'the match has not started' });
    const { taken, why } = l.feed(seat, b);
    if (why) peer?.send({ t: 'refused', why });
    if (taken) this.seats[1 - seat]?.peer?.send(taken);
    // (checkpoints that came before the server got there)
    for (const [tick, by] of this.early)
      if (tick <= l.tick) {
        this.early.delete(tick);
        for (const [s, d] of by) this.check(s, tick, d);
      }
  }

  private check(seat: number, tick: number, digest: string): void {
    const l = this.lock;
    if (!l || tick % EVERY !== 0 || tick === 0) return;
    const ours = l.digests[tick / EVERY - 1];
    if (ours === undefined) {
      const by = this.early.get(tick) ?? new Map<number, string>();
      by.set(seat, digest);
      this.early.set(tick, by);
      return;
    }
    if (ours === digest) return;
    if (this.desync < 0) this.desync = tick;
    for (const s of this.seats) s?.peer?.send({ t: 'desync', tick, seat });
  }

  private presence(): void {
    const here = this.seats.map((s) => !!s?.peer);
    const names = this.seats.map((s) => s?.name ?? '');
    for (const s of this.seats) s?.peer?.send({ t: 'presence', here, names });
  }
}

/** Every room, by code; what comes in, to the room it is for. */
export class Lobby {
  readonly rooms = new Map<string, Room>();
  /** Where each connection sits. */
  private readonly at = new Map<Peer, { room: Room; seat: number }>();

  /** A message from a connection. */
  hear(peer: Peer, raw: string): void {
    const m = readToServer(raw);
    if (!m) return peer.send({ t: 'error', message: `not understood (protocol ${PROTOCOL})` });
    const where = this.at.get(peer);
    if (m.t === 'create') {
      if (where) return peer.send({ t: 'error', message: 'already in a room' });
      const room = new Room(this.newCode(), m.setup);
      this.rooms.set(room.code, room);
      this.seat(peer, room, m.name);
    } else if (m.t === 'join') {
      if (where) return peer.send({ t: 'error', message: 'already in a room' });
      const room = this.rooms.get(m.code);
      if (!room) return peer.send({ t: 'error', message: `no room ${m.code}` });
      this.seat(peer, room, m.name, m.token, m.growths);
    } else if (where) where.room.hear(where.seat, m);
    else peer.send({ t: 'error', message: 'not in a room' });
  }

  /** A connection closed. */
  gone(peer: Peer): void {
    const where = this.at.get(peer);
    this.at.delete(peer);
    where?.room.gone(peer);
  }

  /** Rooms nobody has been in for `ms`, cleared. */
  sweep(ms: number, now = Date.now()): void {
    for (const [code, r] of this.rooms) if (r.empty && now - r.seen > ms) this.rooms.delete(code);
  }

  private seat(peer: Peer, room: Room, name: string, token?: string, growths?: Readonly<Record<string, Growth>>): void {
    const seat = room.sit(peer, name, token, growths);
    if (seat === null) return peer.send({ t: 'error', message: `room ${room.code} is full` });
    this.at.set(peer, { room, seat });
  }

  private newCode(): string {
    for (;;) {
      const b = randomBytes(4);
      const code = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }
}
