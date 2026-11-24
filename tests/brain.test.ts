import { describe, expect, it } from 'vitest';
import { Brain, SKILLS, type Skill } from '../src/game/brain';
import { Match, NO_INPUT } from '../src/game/match';
import { ANT, COCKROACH, SPIDER, type BugSpecies } from '../src/game/species';
import { flat } from './helpers/worlds';

const skill = (id: string): Skill => SKILLS.find((s) => s.id === id) as Skill;

function setup(a: BugSpecies, b: BugSpecies, seed = 1): Match {
  const t = flat(10);
  const m = new Match(
    t,
    [
      { name: 'A', species: a, color: 0, size: 2 },
      { name: 'B', species: b, color: 0, size: 2 },
    ],
    seed,
    { placeBugs: false },
  );
  ([[14, 20], [44, 24], [16, 44], [48, 46]] as const).forEach(([x, z], i) => m.units[i].bug.drop(t, x, z));
  for (let n = 0; n < 60; n++) m.step(NO_INPUT);
  return m;
}

/** Play with these two; every team's shots and the damage it did to the other. */
function play(m: Match, brains: readonly Brain[], ticks: number): { shots: number[]; harm: number[]; own: number } {
  const out = { shots: [0, 0], harm: [0, 0], own: 0 };
  for (let n = 0; n < ticks && m.phase !== 'over'; n++) {
    const team = m.activeUnit.team;
    m.step(brains[team].next(m));
    for (const e of m.events) {
      if (e.type === 'fire') out.shots[team]++;
      else if (e.type === 'damage') {
        if (m.units[e.unit].team === team) out.own += e.amount;
        else out.harm[team] += e.amount;
      }
    }
  }
  return out;
}

describe('computer opponent', () => {
  it('finds a target, shoots and hits; it does not hurt its own', () => {
    for (const s of [ANT, SPIDER, COCKROACH]) {
      const m = setup(s, ANT);
      const r = play(m, [new Brain(skill('hard'), 1), new Brain(skill('hard'), 2)], 60 * 60 * 2);
      expect(r.shots[0]).toBeGreaterThan(1);
      expect(r.harm[0]).toBeGreaterThan(40);
      expect(r.own).toBeLessThan(40);
    }
  });

  it('plays the same on every client', () => {
    const state = (): string => {
      const m = setup(COCKROACH, SPIDER, 5);
      play(m, [new Brain(skill('normal'), 3), new Brain(skill('easy'), 4)], 60 * 60);
      return m.units.map((u) => [u.bug.x, u.bug.y, u.bug.z, u.bug.health].join()).join('|');
    };
    expect(state()).toBe(state());
  });

  it('is better the harder it is set', () => {
    let hard = 0;
    let easy = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = play(setup(ANT, ANT, seed), [new Brain(skill('hard'), seed), new Brain(skill('easy'), seed + 9)], 60 * 60 * 3);
      hard += r.harm[0] / Math.max(1, r.shots[0]);
      easy += r.harm[1] / Math.max(1, r.shots[1]);
    }
    expect(hard).toBeGreaterThan(easy * 1.2);
  });

  it('only gives input: it never changes the match itself', () => {
    const m = setup(ANT, SPIDER);
    const brain = new Brain(skill('normal'), 1);
    for (let n = 0; n < 400; n++) {
      const before = JSON.stringify(m.units.map((u) => [u.bug.x, u.bug.fx, u.aimH, u.bug.health, m.phase, m.weapon]));
      const input = { ...brain.next(m) };
      expect(JSON.stringify(m.units.map((u) => [u.bug.x, u.bug.fx, u.aimH, u.bug.health, m.phase, m.weapon]))).toBe(before);
      m.step(input);
    }
  });
});

describe('turns', () => {
  it('when the one whose turn it was died, the next one still gets its turn', () => {
    const m = setup(ANT, SPIDER);
    const first = m.activeUnit;
    first.bug.y = -50;
    let turn = false;
    for (let n = 0; n < 400; n++) {
      m.step(NO_INPUT);
      if (m.events.some((e) => e.type === 'turn')) {
        turn = true;
        break;
      }
    }
    expect(turn).toBe(true);
    expect(m.phase).toBe('aim');
    expect(m.activeUnit.team).toBe(1);
    m.step(NO_INPUT);
    expect(m.phase).toBe('aim');
  });
});
