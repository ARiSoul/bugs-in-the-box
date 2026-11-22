import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/bug';
import { AIM_TICKS, DEATH_HOLD_TICKS, Match, NO_INPUT, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { CAPACITOR, SHORT_CIRCUIT, SOLDER_BLOB, WEAPONS } from '../src/game/weapons';
import { floatingIslands } from '../src/terrain/generators/floatingIslands';
import { createRng } from '../src/terrain/noise';
import { Terrain } from '../src/terrain/Terrain';
import { flat, world } from './helpers/worlds';

const teams = (size: number) => [
  { name: 'Red', species: ANT, color: 0xff0000, size },
  { name: 'Blue', species: SPIDER, color: 0x0000ff, size },
];

/** Match on `t` with bugs dropped at the given (x, z), in unit order (red, blue, red, blue...). */
function setup(t: Terrain, at: [number, number][]): Match {
  const m = new Match(t, teams(Math.ceil(at.length / 2)), 1, { placeBugs: false });
  at.forEach(([x, z], i) => expect(m.units[i].bug.drop(t, x, z)).toBe(true));
  // an odd count leaves one unplaced bug: take it out of the game
  for (const u of m.units.slice(at.length)) {
    u.bug.alive = false;
    u.dead = true;
  }
  for (let n = 0; n < TICK_RATE * 2; n++) m.step(NO_INPUT);
  for (const u of m.units.slice(0, at.length)) expect(u.bug.grounded).toBe(true);
  return m;
}

/** Step and collect every event, until `done` or `max` ticks. */
function runUntil(m: Match, done: (m: Match) => boolean, max: number, input: Readonly<MatchInput> = NO_INPUT): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let n = 0; n < max && !done(m); n++) {
    m.step(input);
    events.push(...m.events);
  }
  return events;
}

const press = (m: Match, input: Partial<MatchInput>, ticks = 1): MatchEvent[] => {
  const events: MatchEvent[] = [];
  for (let n = 0; n < ticks; n++) {
    m.step({ ...NO_INPUT, ...input });
    events.push(...m.events);
  }
  return events;
};

describe('explosions', () => {
  it('hurt by distance, throw bugs away from the centre and carve a crater', () => {
    const t = flat(10);
    const m = setup(t, [
      [20, 32],
      [24, 32],
      [50, 32],
    ]);
    const [a, b, far] = m.units;
    m.explode(22, 10.5, 32, SOLDER_BLOB);
    expect(a.bug.health).toBeLessThan(70);
    expect(b.bug.health).toBeLessThan(70);
    expect(far.bug.health).toBe(100);
    expect(a.bug.vx).toBeLessThan(0);
    expect(b.bug.vx).toBeGreaterThan(0);
    expect(a.bug.grounded).toBe(false);
    expect(t.sample(22, 10, 32)).toBeGreaterThan(0);
  });

  it('a Short Circuit arc jumps to the nearest bugs, up to its limit', () => {
    const t = flat(10);
    const m = setup(t, [
      [20, 32],
      [30, 32],
      [40, 32],
    ]);
    m.explode(14, 11, 32, SHORT_CIRCUIT);
    const arcs = m.events.filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(SHORT_CIRCUIT.arcs);
    expect(m.units[0].bug.health).toBe(100 - SHORT_CIRCUIT.arcDamage);
    expect(m.units[1].bug.health).toBe(100 - SHORT_CIRCUIT.arcDamage);
    expect(m.units[2].bug.health).toBe(100);
  });

  it('a long fall hurts, a short one does not', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    const [red, blue] = m.units;
    red.bug.y += 2; // ~2 units: harmless
    red.bug.grounded = false;
    blue.bug.y = 30; // ~19 units
    blue.bug.grounded = false;
    runUntil(m, () => red.bug.grounded && blue.bug.grounded, TICK_RATE * 3);
    expect(red.bug.health).toBe(100);
    expect(blue.bug.health).toBeLessThan(75);
    expect(blue.bug.health).toBeGreaterThan(40);
  });
});

describe('shooting', () => {
  it('a charged shell flies, explodes on the ground and the turn passes to the other team', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    const red = m.units[0];
    expect(m.active).toBe(0);
    red.bug.fx = 1;
    red.bug.fz = 0;
    const wind = [m.windX, m.windZ];
    press(m, { fire: true }, 40);
    expect(m.charging).toBe(true);
    const events = press(m, {});
    expect(events.some((e) => e.type === 'fire')).toBe(true);
    expect(m.phase).toBe('flight');
    expect(m.projectiles).toHaveLength(1);

    events.push(...runUntil(m, (mm) => mm.phase === 'aim', TICK_RATE * 20));
    const boom = events.find((e) => e.type === 'explosion');
    expect(boom).toBeDefined();
    if (boom?.type === 'explosion') expect(boom.x).toBeGreaterThan(20);
    expect(m.active).toBe(1);
    expect(m.turnNumber).toBe(2);
    expect([m.windX, m.windZ]).not.toEqual(wind);
  });

  it('cannot fire again during the retreat, but can walk', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    const red = m.units[0].bug;
    red.fx = 1;
    red.fz = 0;
    press(m, { fire: true }, 10);
    press(m, {});
    const x0 = red.x;
    const events = press(m, { fire: true, move: -1 }, 20);
    expect(events.filter((e) => e.type === 'fire')).toHaveLength(0);
    expect(red.x).toBeLessThan(x0 - 0.5);
  });

  it('a Capacitor bounces and goes off when its fuse runs out', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [56, 32],
    ]);
    const red = m.units[0];
    red.bug.fx = 1;
    red.bug.fz = 0;
    press(m, { weapon: WEAPONS.indexOf(CAPACITOR) });
    expect(m.currentWeapon).toBe(CAPACITOR);
    press(m, { fire: true }, 20);
    const fireTick = m.tick + 1;
    press(m, {});
    let boomTick = -1;
    runUntil(
      m,
      (mm) => {
        if (mm.events.some((e) => e.type === 'explosion')) boomTick = mm.tick;
        return boomTick > 0;
      },
      TICK_RATE * 10,
    );
    expect(boomTick - fireTick).toBeGreaterThanOrEqual(CAPACITOR.fuseTicks - 1);
    expect(boomTick - fireTick).toBeLessThanOrEqual(CAPACITOR.fuseTicks + 1);
  });

  it('the Soldering Iron digs a tunnel along the aim', () => {
    const t = world(2, 1, 2, (i, j) => Math.min(j - 10, Math.max(30 - i, i - 42)));
    const m = setup(t, [
      [24, 32],
      [50, 20],
    ]);
    const red = m.units[0];
    red.bug.fx = 1;
    red.bug.fz = 0;
    red.aimH = 1;
    red.aimV = 0;
    expect(t.sample(33, red.bug.y, 32)).toBeLessThan(0);
    const events = press(m, { weapon: 3, fire: true });
    expect(events.some((e) => e.type === 'dig')).toBe(true);
    expect(t.sample(33, red.bug.y, 32)).toBeGreaterThan(0);
    expect(t.sample(36, red.bug.y, 32)).toBeGreaterThan(0);
  });

  it('aims up and down within limits, and previews the shot', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    const u = m.units[0];
    press(m, { aim: 1 }, TICK_RATE * 3);
    expect(u.aimV).toBeGreaterThan(0.99);
    expect(u.aimV).toBeLessThanOrEqual(0.995);
    press(m, { aim: -1 }, TICK_RATE * 4);
    expect(u.aimV).toBeGreaterThanOrEqual(-0.8);
    expect(u.aimV).toBeLessThan(-0.75);
    expect(Math.hypot(u.aimH, u.aimV)).toBeCloseTo(1, 9);
  });
});

describe('turns', () => {
  it('the turn passes when the timer runs out', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    expect(m.active).toBe(0);
    runUntil(m, (mm) => mm.active === 1, AIM_TICKS + TICK_RATE * 2);
    expect(m.active).toBe(1);
    expect(m.phase).toBe('aim');
  });

  it('alternates teams, rotates bugs inside a team and skips the dead', () => {
    const t = flat(10);
    const m = setup(t, [
      [10, 10],
      [30, 10],
      [50, 10],
      [10, 50],
    ]);
    m.units[2].bug.alive = false; // red's second bug
    const order: number[] = [];
    runUntil(
      m,
      (mm) => {
        for (const e of mm.events) if (e.type === 'turn') order.push(e.unit);
        return order.length >= 5;
      },
      (AIM_TICKS + TICK_RATE) * 6,
    );
    expect(order).toEqual([1, 0, 3, 0, 1]);
  });

  it('getting hurt on your own turn ends it', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    m.explode(16, 10.5, 32, SOLDER_BLOB);
    expect(m.phase).toBe('flight');
  });

  it('ends when only one team has bugs left', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
    ]);
    const blue = m.units[1].bug;
    blue.health = 10;
    m.explode(blue.x, blue.y - 1, blue.z, SOLDER_BLOB);
    expect(blue.health).toBe(0);
    const events = runUntil(m, (mm) => mm.phase === 'over', AIM_TICKS + TICK_RATE * 15);
    expect(m.phase).toBe('over');
    expect(m.winner).toBe(0);
    expect(events.some((e) => e.type === 'death' && e.unit === 1)).toBe(true);
    expect(blue.alive).toBe(false);
    expect(m.teamAlive(0)).toBe(1);
    expect(m.teamAlive(1)).toBe(0);
    // the death plays on screen before the match ends
    const death = events.findIndex((e) => e.type === 'death');
    const over = events.findIndex((e) => e.type === 'over');
    expect(over).toBeGreaterThan(death);
  });

  it('waits for the deaths on screen before the next turn', () => {
    const t = flat(10);
    const m = setup(t, [
      [16, 32],
      [48, 32],
      [16, 52],
      [48, 52],
    ]);
    const blue = m.units[1].bug;
    blue.health = 5;
    m.explode(blue.x, blue.y - 1, blue.z, SOLDER_BLOB);
    let deathTick = -1;
    let turnTick = -1;
    for (let n = 0; n < AIM_TICKS + TICK_RATE * 15 && turnTick < 0; n++) {
      m.step(NO_INPUT);
      for (const e of m.events) {
        if (e.type === 'death') deathTick = m.tick;
        if (e.type === 'turn' && deathTick >= 0) turnTick = m.tick;
      }
    }
    expect(deathTick).toBeGreaterThan(0);
    expect(turnTick - deathTick).toBeGreaterThanOrEqual(DEATH_HOLD_TICKS);
    expect(m.teamAlive(1)).toBe(1);
  });
});

describe('fine control', () => {
  it('the view turns the active bug: it faces the given direction', () => {
    const m = setup(flat(10), [
      [16, 32],
      [48, 32],
    ]);
    press(m, { faceX: -3, faceZ: 3 });
    const b = m.units[0].bug;
    expect(b.fx).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(b.fz).toBeCloseTo(Math.SQRT1_2, 9);
    // the other team's bug does not turn
    const other = m.units[1].bug;
    const [ofx, ofz] = [other.fx, other.fz];
    press(m, { faceX: 1, faceZ: 0 });
    expect([other.fx, other.fz]).toEqual([ofx, ofz]);
  });

  it('a facing from the view wins over the turn keys (the view already turned with them)', () => {
    const m = setup(flat(10), [
      [16, 32],
      [48, 32],
    ]);
    press(m, { faceX: 0, faceZ: 1, turn: 1 });
    expect(m.units[0].bug.fx).toBeCloseTo(0, 12);
    expect(m.units[0].bug.fz).toBeCloseTo(1, 12);
  });

  it('a tap aims and turns a fraction of what a held key does per tick', () => {
    const m = setup(flat(10), [
      [16, 32],
      [48, 32],
    ]);
    const u = m.units[0];
    const pitch = (): number => Math.atan2(u.aimV, u.aimH);
    const yaw = (): number => Math.atan2(u.bug.fx, u.bug.fz);
    let p0 = pitch();
    let y0 = yaw();
    press(m, { aim: -1, turn: 1 });
    const tapAim = Math.abs(pitch() - p0);
    const tapTurn = Math.abs(yaw() - y0);
    press(m, { aim: -1, turn: 1 }, TICK_RATE);
    p0 = pitch();
    y0 = yaw();
    press(m, { aim: -1, turn: 1 });
    const fullAim = Math.abs(pitch() - p0);
    const fullTurn = Math.abs(yaw() - y0);
    expect(tapAim).toBeGreaterThan(0);
    expect(tapAim).toBeLessThan(fullAim * 0.25);
    expect(tapTurn).toBeGreaterThan(0);
    expect(tapTurn).toBeLessThan(fullTurn * 0.25);
    // under half a degree per tick at first
    expect(tapAim).toBeLessThan(0.5 * (Math.PI / 180));
  });
});

describe('determinism', () => {
  /** A whole scripted match on a generated map. Returns every bug's state each tick, plus the final map. */
  function play(): { trace: Float64Array; dens: Float32Array; turns: number } {
    const t = new Terrain(3, 2, 3);
    floatingIslands(t, 99);
    const m = new Match(t, teams(3), 5);
    const rnd = createRng(11);
    const input: MatchInput = { ...NO_INPUT };
    const trace: number[] = [];
    for (let n = 0; n < TICK_RATE * 120 && m.phase !== 'over'; n++) {
      if (n % 15 === 0) {
        input.move = rnd() < 0.5 ? 1 : 0;
        input.turn = rnd() < 0.3 ? 1 : rnd() < 0.3 ? -1 : 0;
        input.aim = rnd() < 0.3 ? 1 : rnd() < 0.3 ? -1 : 0;
        input.weapon = rnd() < 0.2 ? Math.floor(rnd() * WEAPONS.length) : -1;
      }
      // hold fire for a while now and then
      input.fire = n % 300 > 200 && n % 300 < 200 + 10 + (n % 7) * 6;
      input.jump = rnd() < 0.01;
      m.step(input);
      for (const u of m.units) trace.push(u.bug.x, u.bug.y, u.bug.z, u.bug.health);
    }
    return { trace: new Float64Array(trace), dens: t.dens, turns: m.turnNumber };
  }

  it('the same seeds and inputs give a bit-identical match', () => {
    const a = play();
    const b = play();
    expect(a.turns).toBeGreaterThan(3);
    // shots were actually fired: the map is no longer the generated one
    const fresh = new Terrain(3, 2, 3);
    floatingIslands(fresh, 99);
    expect(Buffer.from(a.dens.buffer).equals(Buffer.from(fresh.dens.buffer))).toBe(false);
    expect(Buffer.from(a.trace.buffer).equals(Buffer.from(b.trace.buffer))).toBe(true);
    expect(Buffer.from(a.dens.buffer).equals(Buffer.from(b.dens.buffer))).toBe(true);
  });
});
