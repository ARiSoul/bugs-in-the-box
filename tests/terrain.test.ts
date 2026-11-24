import { describe, expect, it } from 'vitest';
import { floatingIslands } from './helpers/floatingIslands';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SEED = 1234;
const make = (seed = SEED): Terrain => {
  const t = new Terrain(3, 2, 3);
  floatingIslands(t, seed);
  return t;
};

describe('generation', () => {
  it('is deterministic for a given seed', () => {
    const a = make(42);
    const b = make(42);
    expect(Buffer.from(a.dens.buffer).equals(Buffer.from(b.dens.buffer))).toBe(true);
  });

  it('differs between seeds', () => {
    const a = make(1);
    const b = make(2);
    expect(Buffer.from(a.dens.buffer).equals(Buffer.from(b.dens.buffer))).toBe(false);
  });

  it('marks every chunk dirty and leaves the outer shell as air', () => {
    const t = make();
    expect(t.dirty.size).toBe(t.chunkCount);
    for (const [i, j, k] of [[0, 10, 10], [t.W, 10, 10], [10, 0, 10], [10, t.H, 10], [10, 10, 0], [10, 10, t.D]]) {
      expect(t.dens[t.idx(i, j, k)]).toBeGreaterThan(0);
    }
  });
});

describe('surface mesh', () => {
  it('is watertight across chunk seams, outward-facing and non-degenerate', () => {
    const r = analyze(meshAll(make()));
    expect(r.faces).toBeGreaterThan(50_000);
    expect(r.openEdges).toBe(0);
    expect(r.degenerate).toBe(0);
    expect(r.orientedOutward).toBeGreaterThan(0.99);
  });

  it('stays watertight after many explosions, including ones on chunk borders', () => {
    const t = make();
    // chunk borders sit at multiples of 32: aim straight at them
    for (const [x, z] of [[32, 32], [64, 32], [32, 64], [64, 64], [31.5, 47], [47, 63.5]]) {
      const hit = t.raycast(x, t.H - 3, z, 0, -1, 0);
      if (hit >= 0) t.carve(x, t.H - 3 - hit, z, 7);
    }
    const r = analyze(meshAll(t));
    expect(r.openEdges).toBe(0);
    expect(r.degenerate).toBe(0);
    expect(r.orientedOutward).toBeGreaterThan(0.99);
  });
});

describe('terrain queries', () => {
  it('raycast from above hits the ground, and misses when pointing away', () => {
    const t = make();
    expect(t.raycast(48, t.H - 3, 48, 0, -1, 0)).toBeGreaterThan(0);
    expect(t.raycast(48, t.H - 3, 48, 0, 1, 0, 100)).toBe(-1);
  });

  it('raycast from inside solid returns 0', () => {
    const t = make();
    expect(t.sample(48, 5, 48)).toBeLessThan(0);
    expect(t.raycast(48, 5, 48, 0, 1, 0)).toBe(0);
  });

  it('carve turns the impact point into air and only dirties nearby chunks', () => {
    const t = make();
    t.dirty.clear();
    const hit = t.raycast(20, t.H - 3, 20, 0, -1, 0);
    const y = t.H - 3 - hit;
    t.carve(20, y, 20, 6);
    expect(t.sample(20, y, 20)).toBeGreaterThan(0);
    expect(t.dirty.size).toBeGreaterThan(0);
    expect(t.dirty.size).toBeLessThan(t.chunkCount);
    expect(t.dirty.has(t.chunkId(0, 0, 0))).toBe(true);
  });

  it('carve never opens the outer shell', () => {
    const t = make();
    t.carve(0, 10, 10, 8);
    // the shell is air already; carving must not push boundary samples to solid or leave NaN
    for (let j = 0; j < t.sy; j++) expect(Number.isFinite(t.dens[t.idx(0, j, 10)])).toBe(true);
    expect(analyze(meshAll(t)).openEdges).toBe(0);
  });
});

describe('resize', () => {
  it('a terrain made larger and back is the terrain it was', () => {
    const t = new Terrain(3, 2, 3);
    t.resize(4, 2, 3);
    expect([t.W, t.H, t.D]).toEqual([128, 64, 96]);
    floatingIslands(t, SEED);
    t.resize(3, 2, 3);
    floatingIslands(t, SEED);
    expect(t.dens).toEqual(make().dens);
  });
});
