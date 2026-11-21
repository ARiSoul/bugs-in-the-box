import { describe, expect, it } from 'vitest';
import { floatingIslands } from '../src/terrain/generators/floatingIslands';
import { SurfaceNetsMesher } from '../src/terrain/mesher';
import { REGION_BYTES, REGION_SAMPLES, readRegion, regionArrays, regionBox, writeRegion } from '../src/terrain/region';
import { Terrain } from '../src/terrain/Terrain';

const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

describe('chunk regions (what the mesh workers receive)', () => {
  it('meshing a mirror that only has the region gives the exact same mesh, for every chunk', () => {
    const t = new Terrain(3, 2, 3);
    floatingIslands(t, 77);
    t.carve(40, 30, 40, 6); // scorch too
    const mirror = new Terrain(3, 2, 3);
    const a = new SurfaceNetsMesher();
    const b = new SurfaceNetsMesher();
    const box = new Int32Array(6);
    const arrays = regionArrays(new ArrayBuffer(REGION_BYTES));
    const c: [number, number, number] = [0, 0, 0];
    let triangles = 0;
    for (let id = 0; id < t.chunkCount; id++) {
      regionBox(t, id, box);
      readRegion(t, box, arrays);
      writeRegion(mirror, box, arrays);
      t.chunkCoords(id, c);
      const ma = a.mesh(t, c[0], c[1], c[2]);
      const mb = b.mesh(mirror, c[0], c[1], c[2]);
      triangles += ma.indices.length / 3;
      expect(same(ma.positions, mb.positions)).toBe(true);
      expect(same(ma.normals, mb.normals)).toBe(true);
      expect(same(ma.colors, mb.colors)).toBe(true);
      expect(same(ma.pbr, mb.pbr)).toBe(true);
      expect(same(ma.indices, mb.indices)).toBe(true);
    }
    expect(triangles).toBeGreaterThan(50_000);
  });

  it('a region fits the packed buffer, on inner and edge chunks', () => {
    const t = new Terrain(3, 2, 3);
    const box = new Int32Array(6);
    for (let id = 0; id < t.chunkCount; id++) {
      regionBox(t, id, box);
      const n = (box[3] - box[0] + 1) * (box[4] - box[1] + 1) * (box[5] - box[2] + 1);
      expect(n).toBeLessThanOrEqual(REGION_SAMPLES);
      expect(box[0]).toBeGreaterThanOrEqual(0);
      expect(box[3]).toBeLessThanOrEqual(t.sx - 1);
    }
  });
});
