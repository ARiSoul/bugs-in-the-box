import { DENSITY_CLAMP } from '../../src/terrain/constants';
import { Terrain } from '../../src/terrain/Terrain';

/** Terrain from an analytic density function, with the usual air shell around the box. */
export function world(cx: number, cy: number, cz: number, f: (i: number, j: number, k: number) => number): Terrain {
  const t = new Terrain(cx, cy, cz);
  for (let k = 0; k < t.sz; k++)
    for (let j = 0; j < t.sy; j++)
      for (let i = 0; i < t.sx; i++) {
        let d = f(i, j, k);
        const edge = Math.min(i, j, k, t.W - i, t.H - j, t.D - k);
        if (edge < 2) d = Math.max(d, 2 - edge);
        t.dens[t.idx(i, j, k)] = Math.max(-DENSITY_CLAMP, Math.min(DENSITY_CLAMP, d));
      }
  t.commitGeneration();
  return t;
}

/** Flat ground at height `y` over a 64×32×64 world. */
export const flat = (y: number): Terrain => world(2, 1, 2, (_i, j) => j - y);
