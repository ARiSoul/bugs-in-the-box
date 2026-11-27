import { hash3 } from './noise';

/**
 * The shape of a blast's crater: not a sphere, but one with low lobes and dents, its own for each place (so every
 * client carves the same, and the render cuts what is drawn over the terrain the same way). Its reach in a direction
 * is the radius times `craterReach`: a polynomial of the direction's components (only + and *, so a shader computes
 * exactly what the simulation does), with weights drawn from a hash of the place.
 */

/** How far the reach strays from the radius, at most about this much either way (a fraction of it). */
export const CRATER_ROUGH = 0.16;
/** How strong the lobes round its rim are, against the broad lumps. */
const RIM = 0.6;
/** The farthest a crater reaches, as a multiple of its radius (to bound the cells a carve visits). */
export const CRATER_MAX = 1 + CRATER_ROUGH * 5;
/** How many weights shape a crater. */
export const CRATER_WEIGHTS = 12;

/** The weights (each -1..1) of the crater blown at (x, y, z), written into `out`. */
export function craterShape(x: number, y: number, z: number, out: Float64Array | number[]): Float64Array | number[] {
  const ix = Math.round(x * 4);
  const iy = Math.round(y * 4);
  const iz = Math.round(z * 4);
  for (let k = 0; k < CRATER_WEIGHTS; k++) out[k] = hash3(ix, iy, iz, 9101 + k * 37) * 2 - 1;
  return out;
}

/** The reach of a crater of weights `c` in the direction (ux, uy, uz) (a unit vector), as a multiple of its radius. */
export function craterReach(ux: number, uy: number, uz: number, c: Float64Array | readonly number[]): number {
  const xx = ux * ux;
  const yy = uy * uy;
  const zz = uz * uz;
  const s =
    c[0] * ux * uy +
    c[1] * uy * uz +
    c[2] * uz * ux +
    c[3] * (xx - zz) +
    c[4] * (yy - 0.5 * (xx + zz)) +
    c[5] * 2.6 * ux * uy * uz +
    c[6] * ux * (xx - 3 * zz) * 0.5 +
    c[7] * uz * (3 * xx - zz) * 0.5 +
    // (its rim: notches round the level, four and five a turn, folded sharp: a broken edge, not petals)
    RIM *
      (c[8] * (1 - 2 * Math.abs(xx * xx - 6 * xx * zz + zz * zz)) +
        c[9] * (1 - 2 * Math.abs(4 * (xx * ux * uz - ux * zz * uz))) +
        c[10] * (1 - 2 * Math.abs(ux * (xx * xx - 10 * xx * zz + 5 * zz * zz))) +
        c[11] * (1 - 2 * Math.abs(uz * (5 * xx * xx - 10 * xx * zz + zz * zz))));
  return 1 + CRATER_ROUGH * s;
}
