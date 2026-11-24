import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/bug';
import { LINGER_TICKS, Match, NO_INPUT, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { ANT_COLUMN, WEAPONS } from '../src/game/weapons';
import type { Terrain } from '../src/terrain/Terrain';
import { flat, world } from './helpers/worlds';

/** Level ground at 10 on a larger map. */
const plain = (cx: number, cy: number, cz: number): Terrain => world(cx, cy, cz, (_i, j) => j - 10);
const COLUMN = WEAPONS.indexOf(ANT_COLUMN);

function setup(t: Terrain, ant: [number, number], spider: [number, number], more: [number, number][] = []): Match {
  const m = new Match(
    t,
    [
      { name: 'A', species: ANT, color: 0, size: 1 + more.length },
      { name: 'S', species: SPIDER, color: 0, size: 1 },
    ],
    1,
    { placeBugs: false },
  );
  m.units[0].bug.drop(t, ...ant);
  m.units[1].bug.drop(t, ...spider);
  more.forEach((p, i) => m.units[2 + i].bug.drop(t, ...p));
  run(m, 60);
  return m;
}

function run(m: Match, ticks: number, input: Partial<MatchInput> = {}): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let n = 0; n < ticks; n++) {
    m.step({ ...NO_INPUT, ...input });
    events.push(...m.events);
  }
  return events;
}

/** Pick it, face (x, z), charge and let go. */
function call(m: Match, x: number, z: number, charge = 80): MatchEvent[] {
  run(m, ANT_COLUMN.sceneTicks + 1, { weapon: COLUMN });
  expect(m.stance).toBe(true);
  run(m, 1, { faceX: x, faceZ: z });
  return [...run(m, charge, { fire: true }), ...run(m, 1)];
}

const until = (m: Match, done: (e: MatchEvent) => boolean, max: number, input: Partial<MatchInput> = {}): MatchEvent[] => {
  const events: MatchEvent[] = [];
  for (let n = 0; n < max; n++) {
    events.push(...run(m, 1, input));
    if (events.some(done)) break;
  }
  return events;
};

describe('Ant Column', () => {
  it('only ants have it', () => {
    const m = setup(flat(10), [20, 32], [40, 32]);
    expect(m.canUse(m.units[0], COLUMN)).toBe(true);
    expect(m.canUse(m.units[1], COLUMN)).toBe(false);
  });

  it('swarms the enemy it meets, bites it, and digs the ground away under it', () => {
    const t = flat(10);
    const m = setup(t, [16, 32], [40, 32]);
    call(m, 1, 0);
    expect(m.column).not.toBe(null);
    const a = until(m, (e) => e.type === 'swarm', 400);
    expect(a.some((e) => e.type === 'swarm' && e.unit === 1)).toBe(true);
    const b = until(m, (e) => e.type === 'collapse', 400);
    expect(b.filter((e) => e.type === 'damage' && e.unit === 1).length).toBeGreaterThan(4);
    expect(t.sample(40, 9, 32)).toBeGreaterThan(0);
    const hurt = 100 - m.units[1].bug.health;
    expect(hurt).toBeGreaterThan(30);
    expect(hurt).toBeLessThan(60);
    expect(m.units[0].bug.health).toBe(100);
    let n = 0;
    for (; n < 2000 && m.active === 0; n++) run(m, 1);
    expect(n).toBeGreaterThan(LINGER_TICKS);
  });

  it('is steered by the turn keys', () => {
    const m = setup(plain(3, 2, 3), [20, 48], [20, 80]);
    call(m, 1, 0);
    run(m, 60, { turn: 1 });
    const right = m.column!.head.z;
    const k = setup(plain(3, 2, 3), [20, 48], [20, 80]);
    call(k, 1, 0);
    run(k, 60, { turn: -1 });
    expect(Math.abs(right - k.column!.head.z)).toBeGreaterThan(4);
    expect((right - 48) * (k.column!.head.z - 48)).toBeLessThan(0);
  });

  it('goes as far as it was charged, then under, and hurts nobody far away', () => {
    const far = (charge: number): number => {
      const m = setup(plain(4, 2, 2), [16, 32], [16, 52]);
      call(m, 1, 0, charge);
      const e = until(m, (q) => q.type === 'collapse', 600).find((q) => q.type === 'collapse');
      expect(m.units[1].bug.health).toBe(100);
      return e && e.type === 'collapse' ? e.x : 0;
    };
    const short = far(25);
    const long = far(80);
    expect(short).toBeGreaterThan(25);
    expect(long).toBeGreaterThan(short + 20);
  });

  it('climbs a wall', () => {
    const t = world(2, 2, 2, (i, j) => Math.min(j - 8, Math.max(40 - i, j - 40)));
    const m = setup(t, [28, 32], [12, 52]);
    call(m, 1, 0);
    let top = 0;
    for (let n = 0; n < 300 && m.column; n++) {
      run(m, 1);
      if (m.column) top = Math.max(top, m.column.head.y);
    }
    expect(top).toBeGreaterThan(20);
  });

  it('passes its own team by', () => {
    const m = setup(flat(10), [12, 32], [44, 32], [[26, 32]]);
    call(m, 1, 0);
    const e = until(m, (q) => q.type === 'swarm', 400);
    expect(e.some((q) => q.type === 'swarm' && q.unit === 1)).toBe(true);
    expect(m.units[2].bug.health).toBe(100);
  });

  it('the same inputs give the same march', () => {
    const play = (): number[] => {
      const m = setup(plain(3, 2, 3), [20, 48], [20, 80]);
      call(m, 1, 0.3);
      const path: number[] = [];
      for (let n = 0; n < TICK_RATE * 3 && m.column; n++) {
        run(m, 1, { turn: n % 50 < 20 ? 1 : n % 50 < 30 ? -1 : 0 });
        if (m.column) path.push(...m.column.path.slice(-9));
      }
      return path;
    };
    expect(play()).toEqual(play());
  });
});
