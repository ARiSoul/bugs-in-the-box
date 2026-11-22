import { describe, expect, it } from 'vitest';
import { KILL_Y } from '../src/game/bug';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { BOARD_TOP, pcCase } from '../src/terrain/generators/pcCase';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
import { ALUMINIUM, BLACK_PLASTIC, DUST, FAN, GOLD, PCB, RGB_LIGHT, STEEL } from '../src/terrain/materials';
import { SCENARIOS, scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SIZES: [string, number, number, number][] = [
  ['large 5x3x5', 5, 3, 5],
  ['small 3x2x3', 3, 2, 3],
];

const make = (seed: number, cx = 5, cy = 3, cz = 5): { t: Terrain; layout: SceneLayout } => {
  const t = new Terrain(cx, cy, cz);
  const layout = createLayout();
  pcCase(t, seed, layout);
  return { t, layout };
};

const count = (layout: SceneLayout, kind: string): number => layout.features.filter((f) => f.kind === kind).length;

describe('Tower Case (pc-case)', () => {
  it('is registered next to pc and islands, and pc stays the default', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(expect.arrayContaining(['pc', 'pc-case', 'islands']));
    expect(scenarioById(null).id).toBe('pc');
    const sc = scenarioById('pc-case');
    expect(sc.sharpEdges).toBe(true);
    expect(sc.render).toBe('webgpu');
    expect(sc.strictBounds).toBe(true);
    expect(sc.sky.fog).toBe(0x0b1016);
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
        for (const [fx, fz] of [[0.4, 0.4], [0.45, 0.35], [0.6, 0.6], [0.25, 0.75]]) {
          const x = t.W * fx;
          const z = t.D * fz;
          const hit = t.raycast(x, t.H - 3, z, 0, -1, 0);
          if (hit >= 0) t.carve(x, t.H - 3 - hit, z, 6);
        }
        const r = analyze(meshAll(t));
        expect(r.faces).toBeGreaterThan(20_000);
        expect(r.openEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.orientedOutward).toBeGreaterThan(0.99);
      });

      it('has steel walls inside the outer air shell, a glass height, and the shared materials', () => {
        const { t, layout } = make(7, cx, cy, cz);
        expect(layout.glassY).toBe(t.H - 6);
        const used = new Set(t.material);
        for (const m of [PCB, STEEL, ALUMINIUM, BLACK_PLASTIC, FAN, GOLD, RGB_LIGHT, DUST]) expect(used.has(m)).toBe(true);
        // walls: solid steel 3 cells thick near the top on all four sides, air in the two outer layers
        const y = t.H - 9; // above the rear vent grid, below the glass
        const mid = Math.round(t.W / 2);
        for (const [x, z] of [[3.5, mid], [t.W - 3.5, mid], [mid, 3.5], [mid, t.D - 3.5]]) {
          expect(t.sample(x, y, z)).toBeLessThan(0);
          expect(t.material[t.idx(Math.round(x), y, Math.round(z))]).toBe(STEEL);
        }
        expect(t.dens[t.idx(1, y, mid)]).toBeGreaterThan(0);
        expect(t.dens[t.idx(mid, y, t.D - 1)]).toBeGreaterThan(0);
        // the glass is render-only: nothing solid just under the top
        expect(t.raycast(mid, t.H - 2, mid, 0, 1, 0)).toBe(-1);
        // the board top is solid near its middle
        expect(t.sample(t.W * 0.55, BOARD_TOP - 1, t.D * 0.5)).toBeLessThan(0);
      });

      it('has all four set pieces and the render features', () => {
        const { t, layout } = make(1234, cx, cy, cz);
        const fans = layout.features.filter((f) => f.kind === 'fan');
        expect(fans.filter((f) => f.axis === 2).length).toBe(2); // radiator fans on the front wall
        expect(fans.filter((f) => f.axis === 0).length).toBeGreaterThanOrEqual(2); // vertical GPU
        expect(count(layout, 'pump')).toBe(1);
        expect(count(layout, 'lightBar')).toBeGreaterThanOrEqual(cx >= 5 ? 4 : 2);
        expect(count(layout, 'led')).toBe(3);
        expect(count(layout, 'heat')).toBe(2);
        // every fan ring and light bar really is RGB light in the grid
        for (const f of layout.features) {
          if (f.kind !== 'lightBar') continue;
          const [x0, , z0, x1, y1, z1] = f.box;
          expect(t.material[t.idx(Math.round((x0 + x1) / 2), Math.round(y1 - 1), Math.round((z0 + z1) / 2))]).toBe(RGB_LIGHT);
        }
        // PSU shroud plateau: steel, 12 above the board
        expect(t.sample(6.5, BOARD_TOP + 11, t.D / 2)).toBeLessThan(0);
        expect(t.sample(9, BOARD_TOP + 13, t.D * 0.4)).toBeGreaterThan(0);
      });

      it('has cable cutouts that fall out of the map, and tube bridges over the board', () => {
        const { t, layout } = make(1234, cx, cy, cz);
        // a column with nothing solid all the way down, inside the case
        let holes = 0;
        for (let z = 6; z < t.D - 6; z++) for (let x = 6; x < t.W - 6; x++) if (t.raycast(x + 0.5, t.H - 8, z + 0.5, 0, -1, 0) < 0) holes++;
        expect(holes).toBeGreaterThan(80);
        // tubes: solid black plastic high above the board between the pump and the front wall
        const pump = layout.features.find((f) => f.kind === 'pump')!;
        let tube = false;
        for (let z = 8; z < pump.z && !tube; z++) {
          for (let y = BOARD_TOP + 8; y < t.H - 8 && !tube; y++) {
            for (let x = 6; x < t.W - 6 && !tube; x++) {
              const i = t.idx(x, y, z);
              if (t.dens[i] < 0 && t.material[i] === BLACK_PLASTIC && y > pump.y + 4) tube = true;
            }
          }
        }
        expect(tube).toBe(true);
        expect(KILL_Y).toBe(-4);
      });

      it('a match places every bug on it, alive and standing', () => {
        const { t } = make(1234, cx, cy, cz);
        const teams: TeamSpec[] = [
          { name: 'A', species: ANT, color: 0, size: 3 },
          { name: 'B', species: SPIDER, color: 0, size: 3 },
        ];
        const m = new Match(t, teams, 1234, { strictBounds: true });
        for (const u of m.units) {
          expect(u.bug.alive).toBe(true);
          expect(u.bug.grounded).toBe(true);
          expect(u.bug.y).toBeGreaterThan(BOARD_TOP - 4);
          expect(u.bug.y).toBeLessThan(t.H - 6);
        }
      });
    });
  }
});
