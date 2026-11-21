import { describe, expect, it } from 'vitest';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { insidePC } from '../src/terrain/generators/insidePC';
import { COPPER, FAN, PCB } from '../src/terrain/materials';
import { SCENARIOS, scenarioById } from '../src/terrain/scenarios';
import { ChunkMesher } from '../src/terrain/mesher';
import { add, box, boxMinMax, capsule, cut, cylinder, distance, rotatedBox, sphere, torus } from '../src/terrain/sdf';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

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

describe('Inside a PC', () => {
  const make = (seed: number, cx = 5, cy = 3, cz = 5): Terrain => {
    const t = new Terrain(cx, cy, cz);
    insidePC(t, seed);
    return t;
  };

  it('is deterministic for a given seed, and the seed changes it', () => {
    const a = make(42);
    const b = make(42);
    const c = make(43);
    expect(Buffer.from(a.dens.buffer).equals(Buffer.from(b.dens.buffer))).toBe(true);
    expect(Buffer.from(a.material.buffer).equals(Buffer.from(b.material.buffer))).toBe(true);
    expect(Buffer.from(a.dens.buffer).equals(Buffer.from(c.dens.buffer))).toBe(false);
  });

  it('meshes watertight, outward-facing and non-degenerate, also after explosions', () => {
    const t = make(1234);
    for (const [x, z] of [[64, 64], [70, 60], [96, 96], [40, 120]]) {
      const hit = t.raycast(x, t.H - 3, z, 0, -1, 0);
      if (hit >= 0) t.carve(x, t.H - 3 - hit, z, 6);
    }
    const r = analyze(meshAll(t));
    expect(r.faces).toBeGreaterThan(50_000);
    expect(r.openEdges).toBe(0);
    expect(r.degenerate).toBe(0);
    expect(r.orientedOutward).toBeGreaterThan(0.99);
  });

  it('has a board to stand on, real parts on it, and works on the small map too', () => {
    for (const t of [make(7), make(7, 3, 2, 3)]) {
      const used = new Set(t.material);
      expect(used.has(PCB)).toBe(true);
      expect(used.has(COPPER)).toBe(true);
      expect(used.has(FAN)).toBe(true);
      // the board top is solid near its middle edge, and there is nothing under the board
      expect(t.sample(t.W / 2, 15, 12)).toBeLessThan(0);
      expect(t.raycast(3, 10, 3, 0, 1, 0, 3)).toBe(-1);
    }
  });

  it('a match places every bug on it, alive and standing', () => {
    const t = make(1234);
    const teams: TeamSpec[] = [
      { name: 'A', species: ANT, color: 0, size: 3 },
      { name: 'B', species: SPIDER, color: 0, size: 3 },
    ];
    const m = new Match(t, teams, 1234);
    for (const u of m.units) {
      expect(u.bug.alive).toBe(true);
      expect(u.bug.grounded).toBe(true);
    }
  });
});

describe('scenario list', () => {
  it('has unique ids and falls back to the first one', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(scenarioById('nope')).toBe(SCENARIOS[0]);
    expect(scenarioById('islands').id).toBe('islands');
  });
});
