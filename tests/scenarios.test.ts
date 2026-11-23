import { describe, expect, it } from 'vitest';
import { giveBodies } from '../src/terrain/generators/bodies';
import { createLayout, feature } from '../src/terrain/generators/types';
import { COPPER, PCB } from '../src/terrain/materials';
import { SCENARIOS, scenarioById } from '../src/terrain/scenarios';
import { ChunkMesher } from '../src/terrain/mesher';
import { add, box, boxMinMax, capsule, cut, cylinder, distance, rotatedBox, sphere, torus } from '../src/terrain/sdf';
import { Terrain } from '../src/terrain/Terrain';
import { analyze } from './helpers/meshIntegrity';

const S = Math.SQRT1_2;

describe('SDF primitives', () => {
  it('give exact distances at known points', () => {
    expect(distance(sphere(0, 0, 0, 2), 5, 0, 0)).toBeCloseTo(3, 9);
    expect(distance(sphere(0, 0, 0, 2), 0, 0, 0)).toBeCloseTo(-2, 9);
    const b = box(0, 0, 0, 2, 1, 3);
    expect(distance(b, 4, 0, 0)).toBeCloseTo(2, 9);
    expect(distance(b, 0, 0, 0)).toBeCloseTo(-1, 9); // nearest face is y
    expect(distance(b, 3, 2, 0)).toBeCloseTo(Math.SQRT2, 9); // past an edge
    const cy = cylinder(0, 0, 0, 2, 5, 1);
    expect(distance(cy, 3, 0, 0)).toBeCloseTo(1, 9);
    expect(distance(cy, 0, 7, 0)).toBeCloseTo(2, 9);
    const cz = cylinder(0, 0, 0, 2, 5, 2);
    expect(distance(cz, 0, 0, 6)).toBeCloseTo(1, 9);
    const c = capsule(0, 0, 0, 10, 0, 0, 1);
    expect(distance(c, 5, 3, 0)).toBeCloseTo(2, 9);
    expect(distance(c, -3, 0, 0)).toBeCloseTo(2, 9);
    expect(distance(torus(0, 0, 0, 5, 1), 5, 0, 0)).toBeCloseTo(-1, 9);
    expect(distance(torus(0, 0, 0, 5, 1), 0, 0, 0)).toBeCloseTo(4, 9);
  });

  it('rotated boxes turn about their axis', () => {
    // a long thin box along x, turned 45° about y, reaches along the diagonal
    const b = rotatedBox(0, 0, 0, 5, 1, 1, 1, S, S);
    expect(distance(b, 4 * S, 0, 4 * S)).toBeLessThan(0);
    expect(distance(b, 4, 0, 0)).toBeGreaterThan(0);
  });

  it('add and cut write only near the shape, keep the outer shell as air and set materials', () => {
    const t = new Terrain(2, 1, 2);
    t.beginGeneration();
    add(t, box(30, 10, 30, 8, 3, 8), PCB);
    cut(t, cylinder(30, 10, 30, 3, 5));
    expect(t.sample(36, 10, 30)).toBeLessThan(0);
    expect(t.sample(30, 10, 30)).toBeGreaterThan(0); // the hole
    expect(t.material[t.idx(36, 10, 30)]).toBe(PCB);
    expect(t.sample(60, 10, 60)).toBe(6); // far away: untouched air
    add(t, box(32, 16, 32, 40, 40, 40), COPPER); // bigger than the world
    expect(t.dens[t.idx(0, 16, 32)]).toBeGreaterThan(0);
    expect(t.dens[t.idx(1, 16, 32)]).toBeGreaterThan(0);
    expect(t.dens[t.idx(t.W, 16, 32)]).toBeGreaterThan(0);
  });
});

describe('mesher modes', () => {
  /** Distance from `p` to the nearest mesh vertex. */
  const nearest = (positions: Float32Array, p: number[]): number => {
    let best = Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const dx = positions[i] - p[0];
      const dy = positions[i + 1] - p[1];
      const dz = positions[i + 2] - p[2];
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    return best;
  };

  it('Dual Contouring keeps box corners and edges sharp; Surface Nets rounds them', () => {
    const t = new Terrain(1, 1, 1);
    t.beginGeneration();
    add(t, boxMinMax(8.3, 6.3, 8.3, 20.7, 18.7, 20.7), PCB); // corners off the grid on purpose
    const corner = [8.3, 18.7, 8.3];
    const edge = [14.5, 18.7, 8.3];
    const sharp = new ChunkMesher(true).mesh(t, 0, 0, 0);
    const smooth = new ChunkMesher(false).mesh(t, 0, 0, 0);
    expect(nearest(sharp.positions, corner)).toBeLessThan(0.1);
    expect(nearest(sharp.positions, edge)).toBeLessThan(0.1);
    expect(nearest(smooth.positions, corner)).toBeGreaterThan(0.3);
    for (const m of [sharp, smooth]) {
      const r = analyze([m]);
      expect(r.openEdges).toBe(0);
      expect(r.degenerate).toBe(0);
      expect(r.orientedOutward).toBeGreaterThan(0.99);
    }
  });
});

describe('scenario list', () => {
  it('has unique ids and falls back to the first one', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(scenarioById('nope')).toBe(SCENARIOS[0]);
    expect(scenarioById(null).id).toBe('pc-case');
    expect(scenarioById('car').id).toBe('car');
  });
});

describe('bodies for drawn parts', () => {
  it('a wire in the air is solid; a thin plate on a floor changes nothing; the grid does not depend on a layout', () => {
    const t = new Terrain(1, 1, 1);
    t.beginGeneration();
    add(t, boxMinMax(2, 2, 2, 30, 8, 30), PCB);
    const before = t.dens.slice();
    giveBodies(t, [feature('part', 16, 8, 16, { box: [10, 8, 10, 22, 8.1, 22] })]);
    expect(Buffer.from(t.dens.buffer).equals(Buffer.from(before.buffer))).toBe(true);
    giveBodies(t, [feature('wire', 10, 20, 16, { path: [0.3, 10, 20, 16, 22, 20, 16] })]);
    expect(t.sample(16, 20, 16)).toBeLessThan(0);
    expect(t.sample(16, 8, 5)).toBeCloseTo(0, 0);
    const make = (layout: boolean): Terrain => {
      const m = new Terrain(5, 3, 5);
      scenarioById('microwave').generate(m, 3, layout ? createLayout() : undefined);
      return m;
    };
    expect(Buffer.from(make(true).dens.buffer).equals(Buffer.from(make(false).dens.buffer))).toBe(true);
  });
});
