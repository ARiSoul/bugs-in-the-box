import { describe, expect, it } from 'vitest';
import { Match, NO_INPUT, SKILL_FULL, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, BEE, COCKROACH, SPIDER, type BugSpecies } from '../src/game/species';
import { ANT_COLUMN, TITAN_LIFT, BURROW, BURST, ANTHILL, LIVING_BRIDGE, RAMPART, SILK_CURTAIN, SOLDER_BLOB, WAX_NEST, WEAPONS, WORKS, type Weapon } from '../src/game/weapons';
import { BUILT, STEEL } from '../src/terrain/materials';
import type { Terrain } from '../src/terrain/Terrain';
import { world } from './helpers/worlds';
import { BUILD_MODELS, buildModel, hasModel } from '../src/render/gpu/buildModels';
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
    expect(t.material[t.idx(24, 12, 32)]).toBe(BUILT);
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
      // (a blast that does not burn: fire would burn a wax nest at once, see reactions.test)
      m.explode(u.bug.x + 1, u.bug.y, u.bug.z, { ...SOLDER_BLOB, id: 'capacitor', blastRadius: 3 });
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
      expect(WEAPONS.filter((w, i) => w.start !== undefined && !w.alone && m.has(m.units[0], i)).map((w) => w.kind)).toEqual(['wall', 'bridge', 'shelter']);
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
    expect([...BUILD_MODELS].sort()).toEqual(WEAPONS.filter((w) => w.start !== undefined && !w.alone).map((w) => w.id).sort());
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

  it('a weapon with stock but no model (the burrow) is not asked for, and asking says why', () => {
    expect(hasModel('burrow')).toBe(false);
    expect(hasModel('toString')).toBe(false);
    expect(hasModel('rampart')).toBe(true);
    expect(() => buildModel('burrow')).toThrow('no build model for burrow');
  });
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

describe('burst', () => {
  it('throws the bug far along its aim, lands softly, twice a match, once a turn, apart from the works', () => {
    const m = setup(plain());
    const u = m.units[0];
    const b = u.bug;
    u.aimH = 0.8;
    u.aimV = 0.6;
    const x = b.x;
    const h = b.health;
    use(m, BURST);
    expect(b.floating).toBeGreaterThan(0);
    expect(m.phase).toBe('aim');
    run(m, 240);
    expect(b.x - x).toBeGreaterThan(18);
    expect(b.grounded).toBe(true);
    expect(b.health).toBe(h);
    const again = use(m, BURST);
    expect(again.some((e) => e.type === 'noRoom'), JSON.stringify([m.phase, again.map((e) => e.type)])).toBe(true);
    expect(m.works[0]).toBe(WORKS);
    expect(m.usesLeft(0, at(BURST))).toBe(1);
  });
});

describe('burrow', () => {
  it('an ant charges it, goes down under the ground, along, and comes up further on: under a wall, out on its far side', () => {
    // (a wall 4 thick across the way, at x 24..28, on ground at y 10)
    const t = world(4, 2, 2, (i, j) => Math.min(j - 10, Math.abs(i - 26) - 2));
    const m = setup(t, ANT, SPIDER);
    const u = m.units[0];
    const b = u.bug;
    // (its aim up in the air does not matter: it goes the way it faces)
    u.aimH = 0.7;
    u.aimV = 0.7;
    const h = b.health;
    run(m, 1, { weapon: at(BURROW) });
    const path = m.burrowPath(u, 0.5, []);
    expect(path.length).toBe(12);
    // (down, along under the ground, up again beyond the wall)
    expect(path[4]).toBeLessThan(10);
    expect(path[7]).toBeLessThan(10);
    expect(path[9]).toBeGreaterThan(29);
    expect(path[10]).toBeGreaterThan(10);
    const events: MatchEvent[] = [];
    for (let k = 0; k < 200 && m.power < 0.5; k++) events.push(...run(m, 1, { fire: true }));
    events.push(...run(m, 1));
    expect(events.some((e) => e.type === 'burrow')).toBe(true);
    expect(events.some((e) => e.type === 'dig')).toBe(false);
    expect(m.phase).toBe('aim');
    // (under the wall, open; the wall over it stands)
    expect(t.sample(26, 7.2, 32)).toBeGreaterThan(0);
    expect(t.sample(26, 12, 32)).toBeLessThan(0);
    const later = run(m, 240);
    expect(later.some((e) => e.type === 'emerge')).toBe(true);
    expect(b.x).toBeGreaterThan(28.5);
    expect(b.grounded).toBe(true);
    expect(b.health).toBe(h);
    // (again in the same turn: no)
    run(m, 1, { weapon: at(BURROW) });
    const again = [...run(m, 3, { fire: true }), ...run(m, 2)];
    expect(again.some((e) => e.type === 'noRoom')).toBe(true);
    expect(m.usesLeft(0, at(BURROW))).toBe(2);
    expect(m.works[0]).toBe(WORKS);
    // (a spider has none)
    expect(m.usesLeft(1, at(BURROW))).toBe(0);
  });
});

describe('burrow and the ground', () => {
  /** Charge the Burrow to half and let it go; the events of it. */
  const dig = (m: Match): MatchEvent[] => {
    run(m, 1, { weapon: at(BURROW) });
    const events: MatchEvent[] = [];
    for (let k = 0; k < 200 && m.power < 0.5; k++) events.push(...run(m, 1, { fire: true }));
    events.push(...run(m, 1));
    return events;
  };

  it('never digs out into the air under a thin floor: on a thin slab it cannot, and it ends short where the ground thins', () => {
    // (a slab from y 7 to 10: too thin for a tunnel under it)
    const thin = world(4, 2, 2, (_i, j) => Math.max(j - 10, 7 - j));
    const m = setup(thin);
    expect(m.burrowPath(m.units[0], 0.5, []).length).toBe(0);
    expect(dig(m).some((e) => e.type === 'noRoom')).toBe(true);
    expect(m.usesLeft(0, at(BURROW))).toBe(3);
    // (thick ground up to x 30, a thin slab past it: it comes up before the slab)
    const t = world(4, 2, 2, (i, j) => Math.max(j - 10, (i < 30 ? 0 : 7) - j));
    const n = setup(t);
    const path = n.burrowPath(n.units[0], 1, []);
    expect(path.length).toBe(12);
    expect(path[9]).toBeLessThan(31);
    expect(path[9]).toBeGreaterThan(24);
  });

  it('stops short of what is hard (metal, stone): blasts still break it', () => {
    const t = world(4, 2, 2, (_i, j) => j - 10);
    // (a steel plate standing down into the ground at x 35..36)
    for (let k = 0; k < t.sz; k++) for (let j = 0; j < 10; j++) for (let i = 35; i <= 36; i++) t.material[t.idx(i, j, k)] = STEEL;
    const m = setup(t);
    const path = m.burrowPath(m.units[0], 1, []);
    expect(path.length).toBe(12);
    expect(path[9]).toBeLessThan(35);
    expect(t.hard(35, 8, 32)).toBe(true);
    expect(t.hard(26, 8, 32)).toBe(false);
  });

  it('a tunnel stays, a part of the ground: a bug walks into it by its own physics, through it under the ground (on, back, or it stops), and up out of its far mouth', () => {
    const t = world(4, 2, 2, (_i, j) => j - 10);
    const m = setup(t, ANT, SPIDER);
    const b = m.units[0].bug;
    expect(dig(m).some((e) => e.type === 'burrow')).toBe(true);
    expect(run(m, 300).some((e) => e.type === 'emerge')).toBe(true);
    expect(m.tunnels.length).toBe(1);
    const p = m.tunnels[0].path;
    // (on, a little past the hole it came up by)
    run(m, 30, { move: 1, faceX: 1 });
    expect(m.inTunnel).toBe(null);
    // (back: into its mouth, down its way, under the ground)
    let inside = false;
    let low = 99;
    for (let k = 0; k < 400 && !inside; k++) {
      run(m, 1, { move: 1, faceX: -1 });
      inside = m.inTunnel !== null;
      low = Math.min(low, b.y);
    }
    expect(inside, JSON.stringify([b.x, b.y, p])).toBe(true);
    run(m, 40, { move: 1, faceX: -1 });
    expect(b.y).toBeLessThan(10);
    expect(m.inTunnel).not.toBe(null);
    // (it stops when it is not told to go on)
    run(m, 10);
    const x = b.x;
    run(m, 30);
    expect(Math.abs(b.x - x)).toBeLessThan(0.05);
    // (it backs up)
    run(m, 20, { move: -1 });
    expect(b.x).toBeGreaterThan(x + 0.3);
    // (turning in it does not turn it into its walls: it faces along it, and goes on)
    const before = b.x;
    run(m, 40, { move: 1, turn: 1 });
    expect(m.inTunnel).not.toBe(null);
    expect(b.x).toBeLessThan(before - 1);
    expect(Math.abs(b.hz)).toBeLessThan(0.2);
    // (on, along it and up out of the mouth the ant first went in by)
    let out = false;
    for (let k = 0; k < 900 && !out; k++) {
      run(m, 1, { move: 1, faceX: -1 });
      out = b.x < p[0] - 1 && b.y > 10;
    }
    expect(out, JSON.stringify([b.x, b.y, p[0]])).toBe(true);
    expect(m.inTunnel).toBe(null);
    expect(b.alive).toBe(true);
  });
});

describe('over a tunnel', () => {
  it('a bug walking on the roof over a tunnel is not drawn to its middle: it walks across it', () => {
    // (ground 6 thick, as on a keyboard: the roof over the tunnel is thin)
    const t = world(4, 2, 2, (_i, j) => Math.max(j - 10, 4 - j));
    const m = setup(t);
    run(m, 1, { weapon: at(BURROW) });
    for (let k = 0; k < 200 && m.power < 0.5; k++) run(m, 1, { fire: true });
    expect(run(m, 400).some((e) => e.type === 'emerge')).toBe(true);
    const p = m.tunnels[0].path;
    const b = m.units[0].bug;
    b.x = b.px = (p[3] + p[6]) / 2;
    b.z = b.pz = 26;
    b.y = b.py = 11.5;
    b.vx = b.vy = b.vz = 0;
    run(m, 30);
    expect(b.y).toBeGreaterThan(10);
    run(m, 120, { move: 1, faceX: 0, faceZ: 1 });
    expect(b.z).toBeGreaterThan(p[5] + 3);
    expect(m.inTunnel).toBe(null);
  });
});

describe('titan lift', () => {
  it('only a team that took it has it; it tears a block out before the ant, throws it from over its head, and crushes where it lands', () => {
    const t = plain();
    const m = new Match(t, [{ name: 'A', species: ANT, special: 'titan-lift', color: 0, size: 1 }, { name: 'B', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    m.units[0].bug.drop(t, 20, 32);
    m.units[1].bug.drop(t, 40, 32);
    run(m, 60, { faceX: 1 });
    for (const u of m.units) u.bug.health = 100;
    expect(m.special(0)).toBe(at(TITAN_LIFT));
    expect(m.special(1)).toBe(at(ANT_COLUMN));
    expect(m.has(m.units[0], at(ANT_COLUMN))).toBe(false);
    expect(m.has(m.units[1], at(TITAN_LIFT))).toBe(false);
    const u = m.units[0];
    const b = u.bug;
    m.skill[0] = SKILL_FULL;
    // (before it, a little down: solid ground)
    const fx = b.x + b.hx * 2.5;
    expect(t.sample(fx, b.y - 1.2, b.z)).toBeLessThan(0);
    run(m, 1, { weapon: at(TITAN_LIFT) });
    run(m, TITAN_LIFT.sceneTicks + 4);
    u.aimH = 0.75;
    u.aimV = 0.66;
    // (charged a while, then let go)
    const events = [...run(m, 30, { fire: true }), ...run(m, 2)];
    expect(events.some((e) => e.type === 'dig')).toBe(true);
    expect(t.sample(fx, b.y - 1.2, b.z)).toBeGreaterThan(0);
    const h = m.units[1].bug.health;
    const later = run(m, 400);
    expect(later.some((e) => e.type === 'explosion')).toBe(true);
    // (used: the card emptied, and filled again only by what the blow did)
    expect(m.skill[0]).toBeLessThan(SKILL_FULL / 2);
    expect(m.units[1].bug.health).toBeLessThanOrEqual(h);
  });
});
