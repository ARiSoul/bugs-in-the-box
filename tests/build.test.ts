import { describe, expect, it } from 'vitest';
import { Match, NO_INPUT, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, BEE, COCKROACH, SPIDER, type BugSpecies } from '../src/game/species';
import { BURROW, SILK_SCREEN, SOLDER_BLOB, SOLDER_BRIDGE, SOLDER_WALL, WAX_CELL, WEAPONS, WORKS, type Weapon } from '../src/game/weapons';
import { SOLDER } from '../src/terrain/materials';
import type { Terrain } from '../src/terrain/Terrain';
import { world } from './helpers/worlds';
import { analyze, meshAll } from './helpers/meshIntegrity';

const at = (w: Weapon): number => WEAPONS.indexOf(w);
const plain = (): Terrain => world(4, 2, 2, (_i, j) => j - 10);
const gap = (): Terrain => world(4, 2, 2, (i, j) => Math.max(j - 20, 4 - Math.abs(i - 28)));

function setup(t: Terrain, a: BugSpecies = ANT, b: BugSpecies = ANT): Match {
  const m = new Match(t, [{ name: 'A', species: a, color: 0, size: 1 }, { name: 'B', species: b, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
  m.units[0].bug.drop(t, 20, 32);
  m.units[1].bug.drop(t, 44, 32);
  run(m, 60, { faceX: 1 });
  for (const u of m.units) u.bug.health = 100;
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
function use(m: Match, w: Weapon): MatchEvent[] {
  run(m, 1, { weapon: at(w) });
  return run(m, 1, { fire: true });
}
function pass(m: Match): void {
  const n = m.turnNumber;
  for (let k = 0; k < 5000 && m.turnNumber === n && m.phase !== 'over'; k++) m.step(NO_INPUT);
}

describe('building', () => {
  it('a wall of solder stands before the bug, once a turn, and the turn goes on with the weapon it had', () => {
    const t = plain();
    const m = setup(t);
    run(m, 1, { weapon: 1 });
    expect(t.sample(24, 12, 32)).toBeGreaterThan(0);
    expect(use(m, SOLDER_WALL).some((e) => e.type === 'built')).toBe(true);
    expect(t.sample(24, 12, 32)).toBeLessThan(0);
    expect(t.sample(24, 13.5, 35)).toBeLessThan(0);
    expect(t.material[t.idx(24, 12, 32)]).toBe(SOLDER);
    expect(m.phase).toBe('aim');
    expect(m.weapon).toBe(1);
    expect(m.stock[0][at(SOLDER_WALL)]).toBe(1);
    run(m, 2);
    expect(use(m, SOLDER_WALL).some((e) => e.type === 'noRoom')).toBe(true);
    expect(m.stock[0][at(SOLDER_WALL)]).toBe(1);
  });

  it('is the same for the same seed, stays watertight, and is blown away like anything', () => {
    const a = plain();
    const b = plain();
    for (const t of [a, b]) use(setup(t), SOLDER_WALL);
    expect(b.dens).toEqual(a.dens);
    expect(analyze(meshAll(a)).openEdges).toBe(0);
    a.carve(24, 12, 32, 5);
    expect(a.sample(24, 12, 32)).toBeGreaterThan(0);
    expect(analyze(meshAll(a)).openEdges).toBe(0);
  });

  it('buries nobody, and is not put where there is no ground', () => {
    const t = plain();
    const m = setup(t);
    const e = m.units[1].bug;
    e.drop(t, 24, 32);
    run(m, 30);
    use(m, SOLDER_WALL);
    expect(t.sample(e.x, e.y, e.z)).toBeGreaterThan(0.8);
    const g = gap();
    const n = setup(g);
    n.units[0].bug.drop(g, 23, 32);
    run(n, 60, { faceX: 1 });
    expect(use(n, SOLDER_WALL).some((q) => q.type === 'noRoom')).toBe(true);
  });

  it('a bridge carries a bug over a gap it would fall into', () => {
    const t = gap();
    const m = setup(t);
    const b = m.units[0].bug;
    b.drop(t, 22, 32);
    run(m, 30, { faceX: 1 });
    const u = m.units[0];
    u.aimH = 1;
    u.aimV = 0;
    expect(use(m, SOLDER_BRIDGE).some((e) => e.type === 'built')).toBe(true);
    const y = b.y;
    let low = 99;
    for (let k = 0; k < 200; k++) {
      m.step({ ...NO_INPUT, move: 1, faceX: 1 });
      low = Math.min(low, b.y);
    }
    expect(b.x).toBeGreaterThan(33);
    expect(low).toBeGreaterThan(y - 1.2);
  });
});

describe('limits', () => {
  it('each kind has its own, and all of them a total, for the whole match', () => {
    const m = setup(plain());
    let n = 0;
    for (const w of [SOLDER_WALL, SOLDER_WALL, SOLDER_WALL, SOLDER_BRIDGE, BURROW, BURROW]) {
      if (!m.canUse(m.activeUnit, at(w))) continue;
      m.units[0].bug.drop(m.field, 20, 8 + n * 9);
      run(m, 40, { faceX: 1 });
      const e = use(m, w);
      if (e.some((q) => q.type === 'built' || q.type === 'hide')) n++;
      pass(m);
      if (m.activeUnit.team === 1) pass(m);
    }
    expect(m.works[0]).toBe(0);
    expect(n).toBe(WORKS);
    expect(m.stock[0][at(SOLDER_WALL)]).toBe(0);
    expect(m.stock[0][at(SOLDER_BRIDGE)]).toBe(1);
    expect(m.has(m.units[0], at(SOLDER_BRIDGE))).toBe(false);
    expect(m.works[1]).toBe(WORKS);
  });
});

describe('hiding', () => {
  it('keeps off part of every blow until it breaks or its turn comes, and it is not thrown', () => {
    for (const [s, w] of [[ANT, BURROW], [BEE, WAX_CELL]] as const) {
      const m = setup(plain(), s);
      const u = m.units[0];
      expect(use(m, w).some((e) => e.type === 'hide')).toBe(true);
      expect(u.cover).toBe(w);
      m.explode(u.bug.x + 1, u.bug.y, u.bug.z, { ...SOLDER_BLOB, blastRadius: 3 });
      expect(100 - u.bug.health).toBe(m.units[0].bug.health < 100 ? 42 - Math.floor(42 * (w.cover as number)) : -1);
      expect(Math.abs(u.bug.vy)).toBe(0);
    }
    const m = setup(plain());
    use(m, BURROW);
    pass(m);
    expect(m.units[0].cover).not.toBeNull();
    pass(m);
    expect(m.activeUnit.team).toBe(0);
    expect(m.units[0].cover).toBeNull();
  });

  it('each species has its own', () => {
    for (const s of [ANT, BEE, COCKROACH, SPIDER]) {
      const m = setup(plain(), s);
      expect(WEAPONS.filter((w, i) => (w.kind === 'shelter' || w.kind === 'screen') && m.has(m.units[0], i)).length).toBe(1);
    }
  });

  it('a screen of silk catches two shots of the others, lets its own through, and holds who walks into it', () => {
    const m = setup(plain(), SPIDER);
    use(m, SILK_SCREEN);
    expect(m.webs.length).toBe(1);
    pass(m);
    const shoot = (): MatchEvent[] => {
      run(m, 1, { weapon: 0, faceX: -1 });
      const u = m.activeUnit;
      u.aimH = 0.98;
      u.aimV = 0.199;
      const charging = run(m, 89, { fire: true });
      return [...charging, ...run(m, 90)];

    };
    const one = shoot();
    expect(one.filter((e) => e.type === 'caught').length).toBe(1);
    expect(one.some((e) => e.type === 'explosion')).toBe(false);
    expect(m.webs.length).toBe(1);
    pass(m);
    pass(m);
    expect(shoot().some((e) => e.type === 'webGone')).toBe(true);
    expect(m.webs.length).toBe(0);
  });
});
