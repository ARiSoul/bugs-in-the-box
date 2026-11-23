import { describe, expect, it } from 'vitest';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { FLOOR, fridge, fridgePlan } from '../src/terrain/generators/fridge';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
import { scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SIZES: [string, number, number, number][] = [
  ['large 5x3x5', 5, 3, 5],
  ['small 3x2x3', 3, 2, 3],
];

const make = (seed: number, cx = 5, cy = 3, cz = 5): { t: Terrain; layout: SceneLayout } => {
  const t = new Terrain(cx, cy, cz);
  const layout = createLayout();
  fridge(t, seed, layout);
  return { t, layout };
};

/** Height of the first surface under (x, fromY, z), or -1. */
const surfaceUnder = (t: Terrain, x: number, fromY: number, z: number): number => {
  const d = t.raycast(x, fromY, z, 0, -1, 0);
  return d < 0 ? -1 : fromY - d;
};

describe('Mini Fridge (fridge)', () => {
  it('is registered with strict bounds and spawns on any level', () => {
    const sc = scenarioById('fridge');
    expect(sc.id).toBe('fridge');
    expect(sc.strictBounds).toBe(true);
    expect(sc.spawnLevels).toBe(true);
  });

  it('is deterministic for a given seed (grid, materials and layout), and the seed changes it', () => {
    const a = make(42);
    const b = make(42);
    const c = make(43);
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(b.t.dens.buffer))).toBe(true);
    expect(Buffer.from(a.t.material.buffer).equals(Buffer.from(b.t.material.buffer))).toBe(true);
    expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout));
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(c.t.dens.buffer))).toBe(false);
  });

  for (const [name, cx, cy, cz] of SIZES) {
    describe(name, () => {
      it('meshes watertight, outward-facing and non-degenerate, also after explosions', () => {
        const { t } = make(1234, cx, cy, cz);
        const p = fridgePlan(t.W, t.H, t.D);
        const [x0, z0, x1, z1] = p.inside;
        for (const [x, y, z] of [[(x0 + x1) / 2, p.glassTop, (z0 + z1) / 2], [x0 + 4, p.rackTop, z1 - 6], [(x0 + x1) / 2, p.iceTop, z0 + 6], [t.W * 0.7, FLOOR, t.D * 0.7]]) {
          // (off the grid, as real explosions are: a centre on whole numbers puts a sample exactly on the surface)
          t.carve(x + 0.37, y + 0.21, z + 0.43, 6);
        }
        const r = analyze(meshAll(t));
        expect(r.faces).toBeGreaterThan(10_000);
        expect(r.openEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.orientedOutward).toBeGreaterThan(0.99);
      });

      it('has its levels where the plan says: the glass, the rack, the ice box floor, the top', () => {
        const { t } = make(7, cx, cy, cz);
        const p = fridgePlan(t.W, t.H, t.D);
        const [x0, z0, x1, z1] = p.inside;
        // a column inside on the left, behind the open flap: under the rack's top lies the glass
        const x = x0 + 3;
        const z = z0 + 18 * (t.W / 160 < 1 ? 0.6 : 1);
        expect(surfaceUnder(t, x, p.rackTop + 4, z)).toBeCloseTo(p.rackTop, 0);
        expect(surfaceUnder(t, x, p.rackTop - 4, z)).toBeCloseTo(p.glassTop, 0);
        // on the right (no rack), in front of the flap's edge: down to the glass
        expect(surfaceUnder(t, x1 - 2.5, p.rackTop + 4, z1 - 1)).toBeCloseTo(p.glassTop, 0);
        // the ice box floor, in front of the ice cube tray and the bag of peas
        const sc = (p.body[2] - p.body[0]) / 64;
        expect(surfaceUnder(t, (x0 + x1) / 2, p.iceTop + 2.5, z0 + 30 * sc)).toBeCloseTo(p.iceTop, 0);
        // the fridge's top
        const [bx0, bz0, bx1, , top] = p.body;
        expect(surfaceUnder(t, (bx0 + bx1) / 2 + 6, t.H - 3, bz0 + 25 * (bx1 - bx0) / 64)).toBeCloseTo(top, 0);
      });
    });
  }

  it('spawns bugs on several levels, all alive', () => {
    const { t } = make(5);
    const TEAMS: TeamSpec[] = [
      { name: 'Red', species: ANT, color: 0xff0000, size: 6 },
      { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 6 },
    ];
    const heights = new Set<number>();
    for (const seed of [1, 2, 3, 4]) {
      const m = new Match(t, TEAMS, seed, { strictBounds: true, spawnLevels: true });
      for (const u of m.units) {
        expect(u.bug.alive).toBe(true);
        heights.add(Math.round(u.bug.y / 8));
      }
    }
    expect(heights.size).toBeGreaterThanOrEqual(3);
  });
});
