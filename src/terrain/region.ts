import { CHUNK } from './constants';
import type { Terrain } from './Terrain';

import { AO_REACH } from './mesher';

/**
 * The samples the mesher reads for one chunk: the chunk's cells plus one on the negative side, widened
 * by the ambient-occlusion reach (the mesher samples the field up to AO_REACH away from each vertex),
 * clamped to the grid. Copying just this box is enough to mesh the chunk elsewhere (a Worker), so the
 * full grid never has to cross threads.
 */
const PAD = Math.ceil(AO_REACH) + 2;
export const REGION_SIDE = CHUNK + 2 * PAD;
export const REGION_SAMPLES = REGION_SIDE * REGION_SIDE * REGION_SIDE;
/** Bytes of one packed region: densities (float32), then scorch (uint8), then material (uint8). */
export const REGION_BYTES = REGION_SAMPLES * 6;

/** Views of the three packed arrays inside one region buffer. */
export interface RegionArrays {
  dens: Float32Array;
  scorch: Uint8Array;
  material: Uint8Array;
}

export function regionArrays(buffer: ArrayBuffer): RegionArrays {
  return {
    dens: new Float32Array(buffer, 0, REGION_SAMPLES),
    scorch: new Uint8Array(buffer, REGION_SAMPLES * 4, REGION_SAMPLES),
    material: new Uint8Array(buffer, REGION_SAMPLES * 5, REGION_SAMPLES),
  };
}

/** Inclusive sample box (i0, j0, k0, i1, j1, k1) of chunk `id`, written into `out`. */
export function regionBox(t: Terrain, id: number, out: Int32Array): Int32Array {
  const cx = id % t.cx;
  const cy = Math.floor(id / t.cx) % t.cy;
  const cz = Math.floor(id / (t.cx * t.cy));
  out[0] = Math.max(0, cx * CHUNK - PAD);
  out[1] = Math.max(0, cy * CHUNK - PAD);
  out[2] = Math.max(0, cz * CHUNK - PAD);
  out[3] = Math.min(t.sx - 1, (cx + 1) * CHUNK + PAD - 1);
  out[4] = Math.min(t.sy - 1, (cy + 1) * CHUNK + PAD - 1);
  out[5] = Math.min(t.sz - 1, (cz + 1) * CHUNK + PAD - 1);
  return out;
}

/** Copy the box out of `t` into packed arrays (row by row: no per-sample work). */
export function readRegion(t: Terrain, box: Int32Array, r: RegionArrays): void {
  copy(t, box, r, true);
}

/** Write packed arrays (from `readRegion`) back into the same box of `t`. */
export function writeRegion(t: Terrain, box: Int32Array, r: RegionArrays): void {
  copy(t, box, r, false);
}

function copy(t: Terrain, box: Int32Array, r: RegionArrays, out: boolean): void {
  const { dens, scorch, material } = r;
  const { sx, sy } = t;
  const nx = box[3] - box[0] + 1;
  let o = 0;
  for (let k = box[2]; k <= box[5]; k++) {
    for (let j = box[1]; j <= box[4]; j++) {
      const s = box[0] + sx * (j + sy * k);
      if (out) {
        dens.set(t.dens.subarray(s, s + nx), o);
        scorch.set(t.scorch.subarray(s, s + nx), o);
        material.set(t.material.subarray(s, s + nx), o);
      } else {
        t.dens.set(dens.subarray(o, o + nx), s);
        t.scorch.set(scorch.subarray(o, o + nx), s);
        t.material.set(material.subarray(o, o + nx), s);
      }
      o += nx;
    }
  }
}
