import { describe, expect, it } from 'vitest';
import { BROOD_LIGHT, LINGER_TICKS, Match, NO_INPUT, type MatchEvent, type MatchInput, SKILL_FULL } from '../src/game/match';
import { ANT, COCKROACH } from '../src/game/species';
import { BLACKOUT_SWARM, SOLDER_BLOB, WEAPONS } from '../src/game/weapons';
import { flat } from './helpers/worlds';
import { even } from './helpers/even';

const BROOD = WEAPONS.indexOf(BLACKOUT_SWARM);

function setup(roaches: [number, number][], ants: [number, number][]): Match {
  const t = flat(10);
  const m = new Match(
    t,
    [
      { name: 'R', species: COCKROACH, color: 0, size: roaches.length },
      { name: 'A', species: ANT, color: 0, size: ants.length },
    ],
    1,
    { placeBugs: false },
  );
  for (const [team, list] of [roaches, ants].entries()) {
    const units = m.units.filter((u) => u.team === team);
    list.forEach((p, i) => units[i].bug.drop(t, ...p));
  }
  run(m, 60);
  // (the rules, whatever health a species starts with)
  for (const u of m.units) u.bug.health = 100;
  even(m);
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

/** Pick it, mark the spot, call. */
function call(m: Match, mark: [number, number, number]): void {
  run(m, BLACKOUT_SWARM.sceneTicks + 1, { weapon: BROOD });
  expect(m.stance).toBe(true);
  run(m, 2, { mark });
  run(m, 1, { fire: true });
}

describe('Blackout Swarm', () => {
  it('only cockroaches have it', () => {
    const m = setup([[20, 32]], [[40, 32]]);
    expect(m.canUse(m.units[0], BROOD)).toBe(true);
    expect(m.canUse(m.units[1], BROOD)).toBe(false);
  });

  it('covers every enemy near the mark, the nearer the worse, and no friend; the ground stays', () => {
    const m = setup([[20, 32], [41, 30]], [[40, 32], [40, 37], [40, 50]]);
    const ground = m.field.sample(40, 9.5, 32);
    call(m, [40, 10, 32]);
    expect(m.brood).not.toBe(null);
    const events = run(m, BROOD_LIGHT + 1);
    const ants = m.units.filter((u) => u.team === 1);
    expect(ants[0].bug.health).toBe(100 - BLACKOUT_SWARM.damage);
    expect(ants[1].bug.health).toBeGreaterThan(ants[0].bug.health);
    expect(ants[1].bug.health).toBeLessThan(100);
    expect(ants[2].bug.health).toBe(100);
    for (const u of m.units) if (u.team === 0) expect(u.bug.health).toBe(100);
    expect(m.field.sample(40, 9.5, 32)).toBe(ground);
    expect(events.some((e) => e.type === 'explosion')).toBe(false);
    const lights = events.find((e) => e.type === 'lights');
    expect(lights && lights.type === 'lights' && lights.units.length).toBe(2);
    expect(m.lingerTicks).toBeGreaterThan(LINGER_TICKS - 5);
  });

  it('is marked only on a surface, and within reach', () => {
    const m = setup([[5, 32]], [[50, 32]]);
    run(m, BLACKOUT_SWARM.sceneTicks + 1, { weapon: BROOD });
    run(m, 1, { fire: true });
    expect(m.brood).toBe(null);
    expect(m.charging).toBe(false);
    run(m, 1, { mark: [60, 10, 32] });
    expect(m.mark).toBe(null);
    run(m, 1, { mark: [20, 25, 32] });
    expect(m.mark).toBe(null);
    run(m, 1, { mark: [20, 10.3, 32] });
    expect(m.mark?.y).toBeCloseTo(10, 1);
    run(m, 1, { fire: true });
    expect(m.brood).not.toBe(null);
  });

  it('plays the same on every client', () => {
    const state = (): string => {
      const m = setup([[20, 32]], [[40, 32], [43, 35]]);
      call(m, [41.5, 10, 33.25]);
      run(m, 900);
      return m.units.map((u) => [u.bug.x, u.bug.y, u.bug.z, u.bug.health].join()).join('|');
    };
    expect(state()).toBe(state());
  });

  it('ends: the turn goes to the other team', () => {
    const m = setup([[20, 32]], [[40, 32]]);
    call(m, [30, 10, 50]);
    const events = run(m, 1200);
    expect(events.some((e) => e.type === 'turn' && m.units[e.unit].team === 1)).toBe(true);
    expect(m.brood).toBe(null);
  });
});

describe('Hard Shell', () => {
  it('takes the first blow that would kill, and the rest of that turn; then it is gone', () => {
    const m = setup([[20, 32]], [[50, 32]]);
    const u = m.units[0];
    u.bug.health = 20;
    const blast = (): void => {
      m.explode(u.bug.x, u.bug.y, u.bug.z, SOLDER_BLOB);
    };
    blast();
    expect(u.bug.health).toBe(1);
    expect(u.shell).toBe(false);
    blast();
    expect(u.bug.health).toBe(1);
    m.turnNumber++;
    blast();
    expect(u.bug.health).toBe(0);
  });

  it('an ant has none', () => {
    const m = setup([[20, 32]], [[50, 32]]);
    const u = m.units[1];
    u.bug.health = 20;
    m.explode(u.bug.x, u.bug.y, u.bug.z, SOLDER_BLOB);
    expect(u.bug.health).toBe(0);
  });
});

describe('skill loader', () => {
  it('a special attack must be loaded, and using it empties it; calling it off does not', () => {
    const m = setup([[20, 32]], [[40, 32]]);
    m.skill[0] = SKILL_FULL - 1;
    expect(m.has(m.units[0], BROOD)).toBe(true);
    expect(m.canUse(m.units[0], BROOD)).toBe(false);
    run(m, 2, { weapon: BROOD });
    expect(m.phase).toBe('aim');
    expect(m.weapon).not.toBe(BROOD);
    m.skill[0] = SKILL_FULL;
    run(m, 5, { weapon: BROOD });
    expect(m.phase).toBe('special');
    run(m, 2, { weapon: 0 });
    expect(m.skill[0]).toBe(SKILL_FULL);
    call(m, [40, 10, 32]);
    expect(m.skill[0]).toBe(0);
    // (what the special itself does loads only the other team)
    run(m, BROOD_LIGHT + 1);
    expect(m.skill[0]).toBe(0);
  });

  it('loads at every turn, and with the damage done and taken', () => {
    const m = setup([[20, 32]], [[40, 32]]);
    m.skill.fill(0);
    const ant = m.units[1];
    m.explode(ant.bug.x, ant.bug.y, ant.bug.z, SOLDER_BLOB);
    expect(m.skill[0]).toBeCloseTo(SOLDER_BLOB.damage * 2.5, 6);
    expect(m.skill[1]).toBeCloseTo(SOLDER_BLOB.damage * 1.8, 6);
    const before = m.skill[1];
    const events = run(m, 60 * 45);
    expect(events.some((e) => e.type === 'turn' && m.units[e.unit].team === 1)).toBe(true);
    expect(m.skill[1]).toBeGreaterThanOrEqual(before + 200);
  });

  it('is told once, when it is full', () => {
    const m = setup([[20, 32]], [[40, 32]]);
    m.skill.fill(0);
    m.skill[0] = SKILL_FULL - 5;
    const ant = m.units[1];
    m.events.length = 0;
    m.explode(ant.bug.x, ant.bug.y, ant.bug.z, SOLDER_BLOB);
    expect(m.events.filter((e) => e.type === 'skill')).toEqual([{ type: 'skill', team: 0 }]);
    expect(m.skill[0]).toBe(SKILL_FULL);
  });
});
