import { describe, expect, it } from 'vitest';
import { Brain, SKILLS } from '../src/game/brain';
import { galeDirection, GALE_RISE, GALE_SPEED, Match, NO_INPUT, SKILL_FULL, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, COCKROACH, type BugSpecies } from '../src/game/species';
import { TUNING, weaponSetting } from '../src/game/tuning';
import { BLACKOUT_SWARM, SPECIAL_AT, specialsAt, WEAPONS, WING_STORM } from '../src/game/weapons';
import { world } from './helpers/worlds';
import { even } from './helpers/even';

const AT = WEAPONS.indexOf(WING_STORM);

/** A cockroach at (30, 32) with Wing Storm loaded, facing +x; bugs of the other team (and maybe a friend) where given. */
function setup(foes: [number, number][], friend: [number, number] | null = null, changed: Record<string, number> = {}, wall = false, wind = 0): Match {
  const t = world(4, 2, 2, (i, j) => Math.min(j - 10, wall && i >= 37 && i <= 39 ? Math.max(j - 20, 37 - i, i - 39) : 99));
  const m = new Match(
    t,
    [
      { name: 'R', species: COCKROACH, color: 0, size: friend ? 2 : 1, special: 'wing-storm' },
      { name: 'A', species: ANT, color: 0, size: foes.length },
    ],
    1,
    { placeBugs: false, wind, tuning: TUNING.make(changed) },
  );
  even(m);
  const roaches = m.units.filter((u) => u.team === 0);
  const ants = m.units.filter((u) => u.team === 1);
  roaches[0].bug.drop(t, 30, 32);
  if (friend) roaches[1].bug.drop(t, ...friend);
  foes.forEach((p, i) => ants[i].bug.drop(t, ...p));
  run(m, 60, { faceX: 1, faceZ: 0 });
  m.skill.fill(SKILL_FULL);
  return m;
}
function run(m: Match, ticks: number, input: Partial<MatchInput> = {}): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let n = 0; n < ticks; n++) {
    m.step({ ...NO_INPUT, ...input });
    out.push(...m.events);
  }
  return out;
}
/** Into its stance, the aim brought down near level, and the gale. */
function storm(m: Match): MatchEvent[] {
  run(m, 1, { weapon: AT });
  run(m, WING_STORM.sceneTicks + 2);
  expect(m.stance).toBe(true);
  run(m, 90, { aim: -1 });
  return run(m, 2, { fire: true });
}

describe('Wing Storm', () => {
  it("is the cockroach's second special, played to at its level", () => {
    expect(specialsAt('cockroach', 1)).toEqual([BLACKOUT_SWARM]);
    expect(specialsAt('cockroach', SPECIAL_AT[1])).toEqual([BLACKOUT_SWARM, WING_STORM]);
  });

  it('throws every bug in its cone away along the aim, and hurts it a little; what is to the side, or too far, stays', () => {
    const m = setup([[42, 32], [30, 50], [62, 32]]);
    const [near, aside, far] = m.units.filter((u) => u.team === 1).map((u) => u.bug);
    const x0 = [near.x, aside.x, far.x];
    const e = storm(m);
    const g = e.find((q): q is Extract<MatchEvent, { type: 'gale' }> => q.type === 'gale');
    expect(g?.hit).toEqual([m.units.find((u) => u.bug === near)?.id]);
    run(m, 120);
    expect(near.x - x0[0]).toBeGreaterThan(8);
    // (its harm, and maybe a hard landing on top)
    expect(near.health).toBeLessThanOrEqual(100 - WING_STORM.damage);
    expect([aside.x, aside.health]).toEqual([x0[1], 100]);
    expect([far.x, far.health]).toEqual([x0[2], 100]);
  });

  it('its front goes out at GALE_SPEED: a bug is thrown when the front gets to it, not before', () => {
    const m = setup([[42, 32]]);
    const ant = m.units.find((u) => u.team === 1) as (typeof m.units)[number];
    const x = ant.bug.x;
    const e = storm(m);
    expect(e.some((q) => q.type === 'gale')).toBe(true);
    // (12 units away: about 12 / GALE_SPEED of a second, then the hit)
    const d = Math.abs(ant.bug.x - m.units[0].bug.x);
    const ticks = Math.ceil((d * 60) / GALE_SPEED);
    const before = run(m, ticks - 4);
    expect(before.some((q) => q.type === 'galeHit')).toBe(false);
    expect([ant.bug.x, ant.bug.health]).toEqual([x, 100]);
    const after = run(m, 10);
    expect(after.some((q) => q.type === 'galeHit' && q.unit === ant.id)).toBe(true);
    expect(ant.bug.health).toBeLessThan(100);
  });

  it('reaches a friend in its cone too, but not through a wall', () => {
    const m = setup([[60, 32]], [42, 32]);
    const friend = m.units.find((u) => u.team === 0 && u !== m.activeUnit) as (typeof m.units)[number];
    const x = friend.bug.x;
    storm(m);
    run(m, 120);
    expect(friend.bug.x - x).toBeGreaterThan(8);
    const w = setup([[42, 32]], null, {}, true);
    const ant = w.units.find((u) => u.team === 1) as (typeof w.units)[number];
    const ax = ant.bug.x;
    storm(w);
    run(w, 120);
    expect([ant.bug.x, ant.bug.health]).toEqual([ax, 100]);
  });

  it('pushes harder, and reaches further, as its settings say', () => {
    const thrown = (changed: Record<string, number>, at: number): number => {
      const m = setup([[at, 32]], null, changed);
      const b = m.units.find((u) => u.team === 1)?.bug;
      const x = b?.x ?? 0;
      storm(m);
      run(m, 120);
      return (b?.x ?? 0) - x;
    };
    expect(thrown({ [weaponSetting(WING_STORM, 'push')]: 50 }, 42)).toBeGreaterThan(thrown({}, 42) + 4);
    expect(thrown({}, 60)).toBe(0);
    expect(thrown({ [weaponSetting(WING_STORM, 'reach')]: 40 }, 60)).toBeGreaterThan(2);
  });

  it('goes along the ground before the bug, whatever its aim: as every turn starts, aimed high, it still sweeps', () => {
    const m = setup([[42, 32]]);
    const ant = m.units.find((u) => u.team === 1)?.bug;
    const x = ant?.x ?? 0;
    run(m, 1, { weapon: AT });
    run(m, WING_STORM.sceneTicks + 2);
    // (no aiming at all: the aim it had, 45 degrees up)
    expect(m.activeUnit.aimV).toBeGreaterThan(0.6);
    run(m, 2, { fire: true });
    run(m, 120);
    expect((ant?.x ?? 0) - x).toBeGreaterThan(8);
    // (its way is raised by the aim, but no more than GALE_RISE)
    const d = galeDirection(m.activeUnit.bug, 0, 1, new Float64Array(3));
    expect(d[1]).toBeCloseTo(GALE_RISE, 6);
  });

  it('the wind of the next turn blows its way, as hard as the wind may', () => {
    const m = setup([[42, 32]], null, {}, false, 1);
    storm(m);
    for (let n = 0; n < 60 * 20 && m.turnNumber < 2; n++) m.step(NO_INPUT);
    expect(m.turnNumber).toBe(2);
    // (the cockroach faces +x: the wind blows +x, at the strongest the match allows)
    expect(m.windX).toBeGreaterThan(0);
    expect(Math.abs(m.windZ)).toBeLessThan(m.windX * 0.2);
    // (and the turn after, the wind is drawn again)
    for (let n = 0; n < 60 * 40 && m.turnNumber < 3; n++) m.step(NO_INPUT);
    expect(m.turnNumber).toBe(3);
  });

  it('the computer uses it to throw an enemy that stands by the edge off the map', () => {
    const play = (seed: number, species: BugSpecies = ANT): Match => {
      const t = world(4, 2, 2, (_i, j) => j - 10);
      const m = new Match(t, [{ name: 'R', species: COCKROACH, color: 0, size: 1, special: 'wing-storm' }, { name: 'A', species, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0, turnSeconds: 30 });
      m.units[0].bug.drop(t, 100, 32);
      m.units[1].bug.drop(t, 120, 32);
      run(m, 30);
      m.skill.fill(SKILL_FULL);
      const b = new Brain({ ...SKILLS[1], special: 1 }, seed);
      for (let n = 0; n < 60 * 35 && m.turnNumber <= 1; n++) m.step(m.activeUnit.team === 0 ? b.next(m) : NO_INPUT);
      return m;
    };
    const m = play(1);
    expect(m.units[1].bug.alive).toBe(false);
  });
});
