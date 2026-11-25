import { describe, expect, it } from 'vitest';
import { Match, NO_INPUT, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, BEE, COCKROACH, SPIDER, type BugSpecies } from '../src/game/species';
import { ANTHILL, LIVING_BRIDGE, RAMPART, SILK_CURTAIN, SOLDER_BLOB, WAX_NEST, WEAPONS, WORKS, type Weapon } from '../src/game/weapons';
import { COLLIDER } from '../src/terrain/materials';
import type { Terrain } from '../src/terrain/Terrain';
import { world } from './helpers/worlds';
import { BUILD_MODELS, buildModel } from '../src/render/gpu/buildModels';
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
  it('a wall stands before the bug, once a turn, and the turn goes on with the weapon it had', () => {
    const t = plain();
    const m = setup(t);
    run(m, 1, { weapon: 1 });
    expect(t.sample(24, 12, 32)).toBeGreaterThan(0);
    expect(use(m, RAMPART).some((e) => e.type === 'built')).toBe(true);
    expect(t.sample(24, 12, 32)).toBeLessThan(0);
    expect(t.sample(24, 13.5, 35)).toBeLessThan(0);
    expect(t.material[t.idx(24, 12, 32)]).toBe(COLLIDER);
    expect(m.phase).toBe('aim');
    expect(m.weapon).toBe(1);
    expect(m.stock[0][at(RAMPART)]).toBe(1);
    run(m, 2);
    expect(use(m, RAMPART).some((e) => e.type === 'noRoom')).toBe(true);
    expect(m.stock[0][at(RAMPART)]).toBe(1);
  });

  it('is the same for the same seed, stays watertight, and is blown away like anything', () => {
    const a = plain();
    const b = plain();
    for (const t of [a, b]) use(setup(t), RAMPART);
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
    use(m, RAMPART);
    expect(t.sample(e.x, e.y, e.z)).toBeGreaterThan(0.8);
    const g = gap();
    const n = setup(g);
    n.units[0].bug.drop(g, 23, 32);
    run(n, 60, { faceX: 1 });
    expect(use(n, RAMPART).some((q) => q.type === 'noRoom')).toBe(true);
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
    expect(use(m, LIVING_BRIDGE).some((e) => e.type === 'built')).toBe(true);
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
    for (const w of [RAMPART, RAMPART, RAMPART, LIVING_BRIDGE, ANTHILL, ANTHILL]) {
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
    expect(m.stock[0][at(RAMPART)]).toBe(0);
    expect(m.stock[0][at(LIVING_BRIDGE)]).toBe(1);
    expect(m.has(m.units[0], at(LIVING_BRIDGE))).toBe(false);
    expect(m.works[1]).toBe(WORKS);
  });
});

describe('hiding', () => {
  it('keeps off part of every blow until it breaks or its turn comes, and it is not thrown', () => {
    for (const [s, w] of [[ANT, ANTHILL], [BEE, WAX_NEST]] as const) {
      const m = setup(plain(), s);
      const u = m.units[0];
      expect(use(m, w).some((e) => e.type === 'hide')).toBe(true);
      expect(u.cover).toBe(w);
      m.explode(u.bug.x + 1, u.bug.y, u.bug.z, { ...SOLDER_BLOB, blastRadius: 3 });
      expect(100 - u.bug.health).toBe(m.units[0].bug.health < 100 ? 42 - Math.floor(42 * (w.cover as number)) : -1);
      expect(Math.abs(u.bug.vy)).toBe(0);
    }
    const m = setup(plain());
    use(m, ANTHILL);
    pass(m);
    expect(m.units[0].cover).not.toBeNull();
    pass(m);
    expect(m.activeUnit.team).toBe(0);
    expect(m.units[0].cover).toBeNull();
  });

  it('each species has its own', () => {
    for (const s of [ANT, BEE, COCKROACH, SPIDER]) {
      const m = setup(plain(), s);
      expect(WEAPONS.filter((w, i) => w.start !== undefined && m.has(m.units[0], i)).map((w) => w.kind)).toEqual(['wall', 'bridge', 'shelter']);
    }
  });

  it('a curtain of silk catches two shots of the others, then it is a wall like any other', () => {
    const m = setup(plain(), SPIDER);
    expect(use(m, SILK_CURTAIN).some((e) => e.type === 'built')).toBe(true);
    expect(m.curtains.length).toBe(1);
    pass(m);
    const shoot = (): MatchEvent[] => {
      run(m, 1, { weapon: 0, faceX: -1 });
      const u = m.activeUnit;
      u.aimH = 0.98;
      u.aimV = 0.199;
      const charging = run(m, 89, { fire: true });
      return [...charging, ...run(m, 90)];
    };
    for (const left of [1, 0]) {
      const e = shoot();
      expect(e.filter((q) => q.type === 'caught').length).toBe(1);
      expect(e.some((q) => q.type === 'explosion')).toBe(false);
      expect(m.curtains[0]?.left ?? 0).toBe(left);
      pass(m);
      pass(m);
    }
    expect(m.curtains.length).toBe(0);
    expect(shoot().some((q) => q.type === 'explosion')).toBe(true);
  });
});

describe('a deck is smooth', () => {
  const rough = (): Terrain => world(5, 3, 2, (i, j, k) => j - 10 - Math.sin(i * 0.5 + k * 0.2) * 0.8 - Math.cos(k * 0.45) * 0.7);
  it('every species walks up its bridge without a stop, over rough ground too, on it or off its middle', () => {
    for (const s of [ANT, BEE, SPIDER, COCKROACH])
      for (const t of [plain(), rough()])
        for (const v of [-0.1, 0.25, 0.55])
          for (const off of [0, 0.8]) {
            const m = setup(t, s);
            const u = m.units[0];
            u.aimV = v;
            u.aimH = Math.sqrt(1 - v * v);
            const w = WEAPONS.find((q) => q.kind === 'bridge' && q.species === s.id) as Weapon;
            const built = use(m, w).some((e) => e.type === 'built');
            if (v < 0 || !built) continue;
            const b = u.bug;
            b.z += off;
            const x0 = b.x;
            let last = b.x;
            for (let k = 0; k < 5; k++) {
              run(m, 24, { move: 1, faceX: 1 });
              expect(b.x - last, `${s.id} ${v} ${off} ${k} ${b.x - x0}`).toBeGreaterThan(0.5);
              last = b.x;
              if (b.x - x0 > 8) break;
            }
          }
  });
});

describe('models', () => {
  it('every weapon that builds or hides has one, whole and lit', () => {
    expect([...BUILD_MODELS].sort()).toEqual(WEAPONS.filter((w) => w.start !== undefined).map((w) => w.id).sort());
    for (const id of BUILD_MODELS) {
      const m = buildModel(id);
      const n = m.position.length / 3;
      expect(m.index.length, id).toBeGreaterThan(3000);
      expect(m.index.length / 3, id).toBeLessThan(260000);
      expect(Math.max(...m.index.subarray(0, 9999)), id).toBeLessThan(n);
      for (const a of [m.position, m.color, m.look]) expect(a.every(Number.isFinite), id).toBe(true);
      // (a normal of no length makes a black screen: the bloom spreads it)
      for (let k = 0; k < n; k++) expect(Math.hypot(m.normal[k * 3], m.normal[k * 3 + 1], m.normal[k * 3 + 2]) > 0.5 || id).toBe(true);
    }
  }, 30000);
});

describe('putting things down with the pointer', () => {
  const put = (m: Match, w: Weapon, p: readonly number[]): MatchEvent[] => {
    run(m, 1, { weapon: at(w) });
    return run(m, 1, { place: p as never });
  };
  it('a wall where it is pointed at, within reach, once a turn', () => {
    const t = plain();
    const m = setup(t);
    expect(put(m, RAMPART, [38, 10, 32, 1, 0, 0]).some((e) => e.type === 'noRoom')).toBe(true);
    expect(put(m, RAMPART, [20, 10, 42, 0, 0, 1]).some((e) => e.type === 'built')).toBe(true);
    expect(t.sample(20, 12, 42)).toBeLessThan(0);
    expect(t.sample(24, 12, 42)).toBeLessThan(0);
    expect(m.weapon).toBe(0);
    const out: number[] = [];
    expect(m.tryPlace(m.units[0], RAMPART, [20, 10, 24, 0, 0, 1], out)).toBe('once a turn');
  });
  it('a bridge from one end to the other', () => {
    const t = gap();
    const m = setup(t);
    m.units[0].bug.drop(t, 18, 32);
    run(m, 60, { faceX: 1 });
    const out: number[] = [];
    expect(m.tryPlace(m.units[0], LIVING_BRIDGE, [22, 20, 32, 2, 0, 0], out)).toBe('too short');
    expect(put(m, LIVING_BRIDGE, [22, 20, 32, 12, 0, 0]).some((e) => e.type === 'built')).toBe(true);
    const b = m.units[0].bug;
    for (let k = 0; k < 220; k++) m.step({ ...NO_INPUT, move: 1, faceX: 1 });
    expect(b.x).toBeGreaterThan(33);
    expect(b.y).toBeGreaterThan(20);
  });
  it('a shelter: the bug runs there and hides; not where it cannot get to', () => {
    const m = setup(gap());
    m.units[0].bug.drop(m.field, 18, 32);
    run(m, 60, { faceX: 1 });
    const out: number[] = [];
    expect(m.tryPlace(m.units[0], ANTHILL, [26, 10, 32, 0, 0, 0], out)).not.toBe('');
    put(m, ANTHILL, [16, 20, 38, 0, 0, 0]);
    expect(m.going).not.toBeNull();
    const e = run(m, 240);
    expect(e.some((q) => q.type === 'hide')).toBe(true);
    const b = m.units[0].bug;
    expect(Math.hypot(b.x - 16, b.z - 38)).toBeLessThan(1.5);
  });
});
