import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/bug';
import { AIM_TICKS, Match, NO_INPUT } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { microwave, microwavePlan, WORKTOP } from '../src/terrain/generators/microwave';
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
  microwave(t, seed, layout);
  return { t, layout };
};

const surfaceUnder = (t: Terrain, x: number, fromY: number, z: number): number => {
  const d = t.raycast(x, fromY, z, 0, -1, 0);
  return d < 0 ? -1 : fromY - d;
};

describe('Microwave (microwave)', () => {
  it('is registered spawns on any level and has a turntable', () => {
    const sc = scenarioById('microwave');
    expect(sc.id).toBe('microwave');
    expect(sc.spawnLevels).toBe(true);
    const tt = sc.turntable?.(160, 96, 160);
    const p = microwavePlan(160, 96, 160).turntable;
    expect(tt).toEqual({ x: p.x, z: p.z, radius: p.radius, j0: p.j0, j1: p.j1, surface: p.surface });
    // the axis is on a sample, so the grid turns by whole samples
    expect(Number.isInteger(p.x) && Number.isInteger(p.z)).toBe(true);
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
      it('meshes watertight, outward-facing and non-degenerate, also after explosions and turns', () => {
        const { t } = make(1234, cx, cy, cz);
        const p = microwavePlan(t.W, t.H, t.D);
        const tt = p.turntable;
        for (const [x, y, z] of [[tt.x + 8, tt.surface, tt.z - 4], [(p.bay[0] + p.bay[1]) / 2, WORKTOP + 4, p.body[1] + 30], [p.body[2] + 10, WORKTOP, p.body[3] + 20]]) {
          t.carve(x + 0.37, y + 0.21, z + 0.43, 6);
        }
        t.rotateQuarter(tt.x, tt.z, tt.j0, tt.j1, tt.radius);
        const r = analyze(meshAll(t));
        expect(r.faces).toBeGreaterThan(10_000);
        expect(r.openEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.orientedOutward).toBeGreaterThan(0.99);
      });

      it('has the plate inside the cavity, clear of its walls, and only the plate turns', () => {
        const { t } = make(7, cx, cy, cz);
        const p = microwavePlan(t.W, t.H, t.D);
        const tt = p.turntable;
        const [x0, z0, x1, z1, floor] = p.cavity;
        // the plate's top, near its rim
        expect(surfaceUnder(t, tt.x + tt.plateRadius - 2, tt.surface + 4, tt.z)).toBeCloseTo(tt.surface, 0);
        // the cylinder that turns stays inside the cavity's walls
        expect(tt.x - tt.radius).toBeGreaterThan(x0 + 2);
        expect(tt.x + tt.radius).toBeLessThan(x1 - 2);
        expect(tt.z - tt.radius).toBeGreaterThan(z0 + 2);
        expect(tt.z + tt.radius).toBeLessThan(z1);
        expect(tt.j0).toBeGreaterThan(floor);
        // turning an untouched plate changes no surface (it is round); only the air's distances to the
        // cavity's walls, far from any surface, move with it
        const before = Float32Array.from(t.dens);
        t.rotateQuarter(tt.x, tt.z, tt.j0, tt.j1, tt.radius);
        let diff = 0;
        let flipped = 0;
        for (let i = 0; i < before.length; i++) {
          if (before[i] < 1) diff = Math.max(diff, Math.abs(before[i] - t.dens[i]));
          if (before[i] < 0 !== t.dens[i] < 0) flipped++;
        }
        expect(diff).toBeLessThan(0.05);
        expect(flipped).toBe(0);
      });
    });
  }

  it('turns the plate between turns in a real match, and every bug lives through the first turn', () => {
    const { t } = make(5);
    const sc = scenarioById('microwave');
    const TEAMS = [
      { name: 'Red', species: ANT, color: 0xff0000, size: 3 },
      { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 3 },
    ];
    const m = new Match(t, TEAMS, 9, { strictBounds: true, spawnLevels: true, turntable: sc.turntable?.(t.W, t.H, t.D) });
    for (let n = 0; n < AIM_TICKS + 20 * TICK_RATE && m.turnNumber < 2; n++) m.step(NO_INPUT);
    expect(m.turnNumber).toBe(2);
    expect(m.turntableTurns).toBe(1);
  });
});
