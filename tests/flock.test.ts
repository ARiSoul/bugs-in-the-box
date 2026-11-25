import { describe, expect, it } from 'vitest';
import { Brain, SKILLS } from '../src/game/brain';
import { RINGS } from '../src/game/flock';
import { Match, NO_INPUT, type MatchEvent, type MatchInput, SKILL_FULL } from '../src/game/match';
import { ANT, BEE } from '../src/game/species';
import { QUEENS_FLIGHT, RING_DAMAGE, WEAPONS } from '../src/game/weapons';
import type { Terrain } from '../src/terrain/Terrain';
import { world } from './helpers/worlds';

const INDEX = WEAPONS.indexOf(QUEENS_FLIGHT);
const plain = (): Terrain => world(4, 2, 2, (_i, j) => j - 10);
const wall = (): Terrain => world(4, 2, 2, (i, j) => Math.min(j - 10, Math.max(Math.abs(i - 55) - 3, j - 26)));

function setup(t: Terrain, ant: [number, number] = [90, 32]): Match {
  const m = new Match(t, [{ name: 'B', species: BEE, color: 0, size: 1 }, { name: 'A', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false });
  m.units[0].bug.drop(t, 20, 32);
  m.units[1].bug.drop(t, ...ant);
  run(m, 60);
  for (const u of m.units) u.bug.health = 100;
  m.skill.fill(SKILL_FULL);
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
function call(m: Match, x: number, z: number): MatchEvent[] {
  run(m, QUEENS_FLIGHT.sceneTicks + 1, { weapon: INDEX });
  expect(m.stance).toBe(true);
  run(m, 1, { faceX: x, faceZ: z });
  return run(m, 1, { fire: true });
}
const until = (m: Match, type: MatchEvent['type'], max: number, input: (m: Match) => Partial<MatchInput> = () => ({})): MatchEvent[] => {
  const out: MatchEvent[] = [];
  for (let n = 0; n < max; n++) {
    m.step({ ...NO_INPUT, ...input(m) });
    out.push(...m.events);
    if (m.events.some((e) => e.type === type)) break;
  }
  return out;
};

describe("Queen's Flight", () => {
  it('lays its rings in free air as the scene starts, the same for the same seed, and empties the loader', () => {
    const m = setup(plain());
    run(m, 5, { weapon: INDEX });
    expect(m.rings.length).toBe(RINGS);
    for (const r of m.rings) expect(m.field.sample(r.x, r.y, r.z)).toBeGreaterThan(2);
    const again = setup(plain());
    run(again, 5, { weapon: INDEX });
    expect(again.rings).toEqual(m.rings);
    const b = setup(plain());
    expect(call(b, 1, 0).some((e) => e.type === 'fire')).toBe(true);
    expect(b.flock).not.toBeNull();
    expect(b.skill[0]).toBe(0);
  });

  it('a team starts its turn with the weapon it last picked itself, whatever the other one or a special attack did', () => {
    const m = setup(plain());
    const pass = (): void => {
      const n = m.turnNumber;
      for (let k = 0; k < 4000 && m.turnNumber === n; k++) m.step(NO_INPUT);
    };
    run(m, 2, { weapon: 1 });
    pass();
    expect([m.activeUnit.team, m.weapon]).toEqual([1, 0]);
    run(m, 2, { weapon: 2 });
    pass();
    expect([m.activeUnit.team, m.weapon]).toEqual([0, 1]);
    // (a special attack called off)
    run(m, QUEENS_FLIGHT.sceneTicks + 1, { weapon: INDEX });
    run(m, 2, { weapon: 1 });
    run(m, QUEENS_FLIGHT.sceneTicks + 1, { weapon: INDEX });
    pass();
    expect([m.activeUnit.team, m.weapon]).toEqual([1, 2]);
    pass();
    expect([m.activeUnit.team, m.weapon]).toEqual([0, 1]);
  });

  it('the player flies it: to the right, up and down', () => {
    const m = setup(plain());
    call(m, 1, 0);
    const z = m.flock!.z;
    run(m, 40, { turn: 1 });
    // (facing +x, the right is +z)
    expect(m.flock!.z).toBeGreaterThan(z + 2);
    const y = m.flock!.y;
    run(m, 40, { aim: 1 });
    expect(m.flock!.y).toBeGreaterThan(y);
    run(m, 60, { move: -1 });
    expect(m.flock === null || m.flock.v < 0).toBe(true);
  });

  it('bursts on an enemy; every ring makes it hurt more', () => {
    for (const taken of [0, 3]) {
      const m = setup(plain());
      call(m, 1, 0);
      const f = m.flock!;
      f.rings.length = 0;
      f.taken = taken;
      f.x = 80;
      f.y = m.units[1].bug.y;
      f.z = 32;
      f.aim(1, 0, 0);
      const events = until(m, 'sting', 300);
      const s = events.find((e): e is Extract<MatchEvent, { type: 'sting' }> => e.type === 'sting');
      expect(s?.unit).toBe(1);
      expect(100 - m.units[1].bug.health).toBeGreaterThanOrEqual(QUEENS_FLIGHT.damage + RING_DAMAGE * taken);
      expect(m.flock).toBeNull();
    }
  });

  it('takes a ring it flies through', () => {
    const m = setup(plain());
    call(m, 1, 0);
    const f = m.flock!;
    const r = f.rings[0];
    f.x = r.x - 3;
    f.y = r.y;
    f.z = r.z;
    f.aim(1, 0, 0);
    expect(until(m, 'ring', 60).some((e) => e.type === 'ring')).toBe(true);
    expect(f.taken).toBe(1);
  });

  it('ends on a wall, or when its time is up, and the turn goes on', () => {
    const m = setup(wall());
    call(m, 1, 0);
    m.flock!.y = 14;
    m.flock!.aim(1, 0, 0);
    expect(until(m, 'sting', 500).some((e) => e.type === 'sting' && e.unit === -1)).toBe(true);
    const turn = m.turnNumber;
    for (let n = 0; n < 60 * 30 && m.turnNumber === turn; n++) m.step(NO_INPUT);
    expect(m.turnNumber).toBe(turn + 1);
  });

  it('the computer flies it over a wall into the enemy, through rings', () => {
    const m = setup(wall(), [88, 32]);
    const brain = new Brain({ ...SKILLS[2], special: 1 }, 3);
    let rings = 0;
    let hit = false;
    for (let n = 0; n < 60 * 40 && !hit && m.turnNumber <= 2; n++) {
      m.step(m.activeUnit.team === 0 ? brain.next(m) : NO_INPUT);
      for (const e of m.events) {
        if (e.type === 'ring') rings++;
        if (e.type === 'sting') hit = e.unit === 1;
      }
    }
    expect(hit).toBe(true);
    expect(rings).toBeGreaterThan(0);
  });
});
