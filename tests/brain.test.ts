import { describe, expect, it } from 'vitest';
import { Brain, SKILLS, type Skill } from '../src/game/brain';
import { Match, NO_INPUT } from '../src/game/match';
import { ANT, COCKROACH, SPIDER, type BugSpecies } from '../src/game/species';
import { flat, world } from './helpers/worlds';
import { WEAPONS } from '../src/game/weapons';
import { pcCase } from '../src/terrain/generators/pcCase';
import { createLayout } from '../src/terrain/generators/types';
import { Terrain } from '../src/terrain/Terrain';

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

describe('burst and bridges', () => {
  it('gets somewhere with a burst and lays bridges, the same on every client', () => {
    const t = new Terrain(5, 3, 5);
    const play = (): string => {
      pcCase(t, 1, createLayout());
      const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 3 }, { name: 'B', species: SPIDER, color: 0, size: 3 }], 31, { strictBounds: true });
      const brains = [new Brain(skill('normal'), 2), new Brain(skill('normal'), 3)];
      let bursts = 0;
      let bridges = 0;
      for (let n = 0; n < 60 * 60 * 12 && m.phase !== 'over'; n++) {
        m.step(brains[m.activeUnit.team].next(m));
        for (const e of m.events)
          if (e.type === 'burst') bursts++;
          else if (e.type === 'built' && WEAPONS.find((w) => w.id === e.weapon)?.kind === 'bridge') bridges++;
      }
      expect(bursts).toBeGreaterThan(0);
      expect(bridges).toBeGreaterThan(0);
      return m.units.map((u) => [u.bug.x, u.bug.y, u.bug.z, u.bug.health].join()).join('|');
    };
    expect(play()).toBe(play());
  });
});

describe('burrows', () => {
  /** An ant and a spider on level ground (at 10), maybe a tall wall between them; one turn of the ant, the computer's. */
  const turn = (wall: boolean): { m: Match; kinds: string[] } => {
    const t = world(4, 2, 2, (i, j) => Math.min(j - 10, wall && i >= 40 && i <= 46 ? Math.max(j - 40, 40 - i, i - 46) : 99));
    const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 1 }, { name: 'S', species: SPIDER, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0, turnSeconds: 30 });
    m.units[0].bug.drop(t, 24, 32);
    m.units[1].bug.drop(t, 64, 32);
    const b = new Brain(SKILLS[1], 5);
    const kinds: string[] = [];
    for (let n = 0; n < 60 * 35 && m.turnNumber <= 1; n++) {
      m.step(m.activeUnit.team === 0 ? b.next(m) : NO_INPUT);
      for (const e of m.events) kinds.push(e.type);
    }
    return { m, kinds };
  };

  it('with a wall in the way, the computer ant digs under it, comes out beyond it, and shoots from there', () => {
    const { m, kinds } = turn(true);
    expect(m.tunnels.length).toBe(1);
    const p = m.tunnels[0].path;
    // (in under the wall, out beyond it)
    expect(p[0]).toBeLessThan(40);
    expect(p[9]).toBeGreaterThan(46);
    expect(kinds.indexOf('emerge')).toBeGreaterThan(kinds.indexOf('burrow'));
    expect(kinds.lastIndexOf('fire')).toBeGreaterThan(kinds.indexOf('emerge'));
    expect(m.units[1].bug.health).toBeLessThan(100);
  });

  it('with nothing in the way, it just shoots', () => {
    const { m, kinds } = turn(false);
    expect(m.tunnels.length).toBe(0);
    expect(kinds).toContain('fire');
  });
});
