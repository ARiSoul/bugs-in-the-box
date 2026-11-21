import { CHUNK } from './constants';
import type { Terrain } from './Terrain';

/**
 * The samples the mesher reads for one chunk: [start - 1, start + CHUNK] on each axis, clamped to the
 * grid. Copying just this box is enough to mesh the chunk elsewhere (a Worker), so the full grid never
 * has to cross threads.
 */
export const REGION_SIDE = CHUNK + 2;
export const REGION_SAMPLES = REGION_SIDE * REGION_SIDE * REGION_SIDE;
/** Bytes of one packed region: densities (float32) then scorch (uint8). */
export const REGION_BYTES = REGION_SAMPLES * 5;

/** Inclusive sample box (i0, j0, k0, i1, j1, k1) of chunk `id`, written into `out`. */
export function regionBox(t: Terrain, id: number, out: Int32Array): Int32Array {
  const cx = id % t.cx;
  const cy = Math.floor(id / t.cx) % t.cy;
  const cz = Math.floor(id / (t.cx * t.cy));
  out[0] = Math.max(0, cx * CHUNK - 1);
  out[1] = Math.max(0, cy * CHUNK - 1);
  out[2] = Math.max(0, cz * CHUNK - 1);
  out[3] = Math.min(t.sx - 1, (cx + 1) * CHUNK);
  out[4] = Math.min(t.sy - 1, (cy + 1) * CHUNK);
  out[5] = Math.min(t.sz - 1, (cz + 1) * CHUNK);
  return out;
}

/** Copy the box out of `t` into packed arrays (row by row: no per-sample work). */
export function readRegion(t: Terrain, box: Int32Array, dens: Float32Array, scorch: Uint8Array): void {
  copy(t, box, dens, scorch, true);
}

/** Write packed arrays (from `readRegion`) back into the same box of `t`. */
export function writeRegion(t: Terrain, box: Int32Array, dens: Float32Array, scorch: Uint8Array): void {
  copy(t, box, dens, scorch, false);
}

function copy(t: Terrain, box: Int32Array, dens: Float32Array, scorch: Uint8Array, out: boolean): void {
  const { sx, sy } = t;
  const nx = box[3] - box[0] + 1;
  let o = 0;
  for (let k = box[2]; k <= box[5]; k++) {
    for (let j = box[1]; j <= box[4]; j++) {
      const s = box[0] + sx * (j + sy * k);
      if (out) {
        dens.set(t.dens.subarray(s, s + nx), o);
        scorch.set(t.scorch.subarray(s, s + nx), o);
      } else {
        t.dens.set(dens.subarray(o, o + nx), s);
        t.scorch.set(scorch.subarray(o, o + nx), s);
      }
      o += nx;
    }
  }
}
