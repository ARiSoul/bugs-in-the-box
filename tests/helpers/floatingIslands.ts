import { DENSITY_CLAMP } from '../../src/terrain/constants';
import { createRng, fbm3 } from '../../src/terrain/noise';
import type { TerrainGenerator } from '../../src/terrain/generators/types';

interface Island {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** Smallest radius: scales the ellipsoid field into roughly world-unit distances. */
  m: number;
}

/** A natural terrain for tests and the benchmark (not a map of the game): rolling slab with interior cave pockets plus floating islands. */
export const floatingIslands: TerrainGenerator = (terrain, seed) => {
  terrain.beginGeneration();
  const { W, H, D, sx, sy, sz, dens } = terrain;
  const rand = createRng(seed * 7919 + 13);

  const islands: Island[] = [];
  // 5–8 islands on the reference 96×96 floor, more on larger maps (same density).
  const count = Math.round(((5 + Math.floor(rand() * 4)) * (W * D)) / (96 * 96));
  for (let i = 0; i < count; i++) {
    const rx = 6 + rand() * 9;
    const ry = 3 + rand() * 4;
    const rz = 6 + rand() * 9;
    islands.push({
      x: rx + rand() * (W - 2 * rx),
      y: H * 0.45 + rand() * H * 0.4,
      z: rz + rand() * (D - 2 * rz),
      rx,
      ry,
      rz,
      m: Math.min(rx, ry, rz),
    });
  }

  const groundBase = H * 0.22;
  const groundAmp = H * 0.18;
  // Ground height only depends on (i,k): compute once per column.
  const hcol = new Float32Array(sx * sz);
  for (let k = 0; k < sz; k++)
    for (let i = 0; i < sx; i++) hcol[i + sx * k] = groundBase + (fbm3(i * 0.035, 0, k * 0.035, seed, 4) - 0.5) * 2 * groundAmp;

  for (let k = 0; k < sz; k++) {
    for (let j = 0; j < sy; j++) {
      for (let i = 0; i < sx; i++) {
        let d = j - hcol[i + sx * k];

        // Caves only deep inside the solid (>= 3 cells below the surface): hidden pockets until blown open.
        if (d < -3) {
          const c = fbm3(i * 0.07, j * 0.09, k * 0.07, seed + 77, 3);
          d = Math.max(d, (c - 0.62) * 14);
        }

        // Floating islands: union of rough ellipsoids. Noise only evaluated near the surface.
        for (let q = 0; q < islands.length; q++) {
          const s = islands[q];
          const dx = (i - s.x) / s.rx;
          const dy = (j - s.y) / s.ry;
          const dz = (k - s.z) / s.rz;
          let e = (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * s.m;
          if (e > 8) continue;
          e += (fbm3(i * 0.12, j * 0.12, k * 0.12, seed + 5, 2) - 0.5) * 5;
          if (e < d) d = e;
        }

        // Close the box: the outer shell is air so every surface is a closed mesh.
        const edge = Math.min(i, j, k, W - i, H - j, D - k);
        if (edge < 2) d = Math.max(d, 2 - edge);

        dens[i + sx * (j + sy * k)] = Math.max(-DENSITY_CLAMP, Math.min(DENSITY_CLAMP, d));
      }
    }
  }
  terrain.commitGeneration();
};
