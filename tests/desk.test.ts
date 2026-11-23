import { describe, expect, it } from 'vitest';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { desk, deskPlan } from '../src/terrain/generators/desk';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
import { scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SIZES: [string, number, number, number][] = [
  ['its own 10x3x5', 10, 3, 5],
  ['large 5x3x5', 5, 3, 5],
  ['small 3x2x3', 3, 2, 3],
];

const make = (seed: number, cx = 10, cy = 3, cz = 5): { t: Terrain; layout: SceneLayout } => {
  const t = new Terrain(cx, cy, cz);
  const layout = createLayout();
  desk(t, seed, layout);
  return { t, layout };
};

const surfaceUnder = (t: Terrain, x: number, fromY: number, z: number): number => {
  const d = t.raycast(x, fromY, z, 0, -1, 0);
  return d < 0 ? -1 : fromY - d;
};

describe('Desk (desk)', () => {
  it('is registered on the WebGPU path, on its own larger map, and spawns on any level', () => {
    const sc = scenarioById('desk');
    expect(sc.id).toBe('desk');
    expect(sc.mapSize).toEqual([10, 3, 5]);
    // (on its own map, twice the scale of the other maps: a bug keeps its size next to a keyboard)
    expect(deskPlan(320, 96, 160).scale).toBe(2);
    expect(sc.render).toBe('webgpu');
    expect(sc.spawnLevels).toBe(true);
  });

  it('is deterministic for a given seed (grid, materials and layout), and the seed changes it', () => {
    const a = make(42);
    const b = make(42);
    const c = make(43);
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(b.t.dens.buffer))).toBe(true);
    expect(Buffer.from(a.t.material.buffer).equals(Buffer.from(b.t.material.buffer))).toBe(true);
    expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout));
    expect(JSON.stringify(a.layout)).not.toBe(JSON.stringify(c.layout));
  });

  for (const [name, cx, cy, cz] of SIZES) {
    describe(name, () => {
      it('meshes watertight, outward-facing and non-degenerate, also after explosions', () => {
        const { t } = make(1234, cx, cy, cz);
        const p = deskPlan(t.W, t.H, t.D);
        const top = p.top;
        for (const [x, z] of [[(p.main[0] + p.main[2]) / 2, (p.main[1] + p.main[3]) / 2], [p.wing[0], p.wing[1]], [p.main[2] - 6, p.main[3] - 4]]) {
          t.carve(x + 0.37, top + 0.21, z + 0.43, 6);
        }
        const r = analyze(meshAll(t));
        expect(r.faces).toBeGreaterThan(5_000);
        expect(r.openEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.orientedOutward).toBeGreaterThan(0.99);
      });

      it('has its tops where the plan says: the main top, the wing, the speaker shelf; nothing under the desk', () => {
        const { t } = make(7, cx, cy, cz);
        const p = deskPlan(t.W, t.H, t.D);
        const top = p.top;
        // the main top, in front of the mat's left edge (clear of the things on it)
        const [mx0, mz0, , mz1] = p.main;
        expect(surfaceUnder(t, mx0 + 3 * p.scale, top + 6, mz1 - 2 * p.scale)).toBeCloseTo(top, 0);
        // the white table (the wing), at a clear spot towards its front left corner
        expect(surfaceUnder(t, p.wing[0] - 7 * p.scale, top + 2.5, p.wing[1] + 21 * p.scale)).toBeCloseTo(top, 0);
        // the shelf, at its front corner
        expect(surfaceUnder(t, p.shelf[2] - 1.5 * p.scale, t.H - 3, p.shelf[3] - 1 * p.scale)).toBeCloseTo(p.shelf[4], 0);
        // in front of the desk, the void all the way down
        expect(surfaceUnder(t, (mx0 + p.main[2]) / 2, top + 4, mz1 + 6)).toBe(-1);
        void mz0;
      });
    });
  }

  it('is solid where things stand: keyboards, laptops, the monitor arm base, a cable lying on the desk', () => {
    const { t, layout } = make(9);
    const p = deskPlan(t.W, t.H, t.D);
    const mid = (b: number[]): [number, number, number, number] => [(b[0] + b[3]) / 2, (b[2] + b[5]) / 2, b[1], b[4]];
    // (a ray from above stops on each thing, near its top, not on the desk under it)
    for (const f of layout.features.filter((g) => g.kind === 'keyboard')) {
      const [x, z, , y1] = mid(f.box);
      expect(surfaceUnder(t, x, y1 + 4, z)).toBeGreaterThan(y1 - 1);
    }
    const base = layout.features.find((g) => g.kind === 'part' && g.color === 0x0e0e10 && g.shape === 'soft');
    expect(base).toBeDefined();
    if (base) {
      const [x, z, , y1] = mid(base.box);
      expect(surfaceUnder(t, x, y1 + 4, z)).toBeGreaterThan(p.top + 1.5);
    }
    // (a cable lying on the main top, away from everything else: the hit is the cable's top, over the desk)
    const [mx0, mz0, mx1, mz1] = p.main;
    const on: [number, number][] = [];
    for (const g of layout.features.filter((f) => f.kind === 'wire')) {
      for (let i = 1; i + 2 < g.path.length; i += 3) {
        const [x, y, z] = [g.path[i], g.path[i + 1], g.path[i + 2]];
        if (Math.abs(y - (p.top + 0.3)) < 0.05 && x > mx0 + 4 && x < mx1 - 4 && z > mz0 + 4 && z < mz1 - 4) on.push([x, z]);
      }
    }
    expect(on.length).toBeGreaterThan(0);
    const [cx, cz] = on[Math.floor(on.length / 2)];
    expect(surfaceUnder(t, cx, p.top + 4, cz)).toBeGreaterThan(p.top + 0.3);
  });

  it('spawns every bug alive on some level', () => {
    const { t } = make(5);
    const TEAMS: TeamSpec[] = [
      { name: 'Red', species: ANT, color: 0xff0000, size: 4 },
      { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 4 },
    ];
    const m = new Match(t, TEAMS, 3, { strictBounds: true, spawnLevels: true });
    for (const u of m.units) expect(u.bug.alive, `${u.bug.x.toFixed(1)} ${u.bug.y.toFixed(1)} ${u.bug.z.toFixed(1)}`).toBe(true);
  });
});
