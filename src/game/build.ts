import type { Bug } from './bug';
import type { TerrainField } from './field';

/**
 * What bugs build of solder: beads, laid one on another like a weld. Pure: where they go depends on the field, the
 * bug and its aim only (the render shows them before they are laid).
 */

/** Numbers per bead: its place, its radius. */
export const BEAD = 4;

/** A wall: how far before the bug, columns to each side of its middle, how far apart, rows, how high each, a bead's radius. */
const AHEAD = 4.2;
const SIDE = 3;
const APART = 1.6;
const ROWS = 4;
const ROW = 1.3;
const THICK = 1.2;
/** It bends round the bug a little. */
const BEND = 0.12;
/** Fewer columns than this: there is no place for one. */
const LEAST = 4;

/** A bridge: its length, the way from bead to bead, how far its two lanes are off its middle, a bead's radius. */
const LONG = 14;
const STEP = 1.15;
const LANE = 0.85;
const PLANK = 1.1;
/** It rises (or falls) no steeper than this (a sine). */
const STEEP = 0.72;
/** Beads a bridge has at least. */
const SPANS = 6;

const dir = new Float64Array(3);

/** The beads of a wall before the bug, standing on what is there. None: no place for it. */
export function wallBeads(field: TerrainField, b: Bug, out: number[]): number[] {
  out.length = 0;
  b.direction(1, 0, dir);
  const [fx, fy, fz] = dir;
  const { nx, ny, nz } = b;
  // (to its side)
  const sx = ny * fz - nz * fy;
  const sy = nz * fx - nx * fz;
  const sz = nx * fy - ny * fx;
  let columns = 0;
  for (let i = -SIDE; i <= SIDE; i++) {
    const on = AHEAD - BEND * i * i;
    const x = b.x + fx * on + sx * i * APART;
    const y = b.y + fy * on + sy * i * APART;
    const z = b.z + fz * on + sz * i * APART;
    if (field.sample(x + nx * 2, y + ny * 2, z + nz * 2) < 0) continue;
    const t = field.raycast(x + nx * 2, y + ny * 2, z + nz * 2, -nx, -ny, -nz, 5.5);
    if (t <= 0) continue;
    columns++;
    for (let j = 0; j < ROWS; j++) {
      // (a row over the gaps of the one under it; the last one in is a bead short)
      const off = j % 2 ? APART * 0.5 : 0;
      if (off > 0 && i === SIDE) continue;
      const h = 2 - t + 0.5 + j * ROW;
      out.push(x + nx * h + sx * off, y + ny * h + sy * off, z + nz * h + sz * off, THICK);
    }
  }
  if (columns < LEAST) out.length = 0;
  return out;
}

/** The beads of a bridge from the bug's feet along (dx, dy, dz) (unit), as far as it goes or until it meets something. */
export function bridgeBeads(field: TerrainField, b: Bug, dx: number, dy: number, dz: number, out: number[]): number[] {
  out.length = 0;
  const { nx, ny, nz } = b;
  // (no steeper than a bug walks at ease)
  const up = dx * nx + dy * ny + dz * nz;
  const most = up > STEEP ? STEEP : up < -STEEP ? -STEEP : up;
  let tx = dx - nx * up;
  let ty = dy - ny * up;
  let tz = dz - nz * up;
  const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (l < 1e-3) return out;
  const flat = Math.sqrt(1 - most * most);
  tx /= l;
  ty /= l;
  tz /= l;
  const sx = ny * tz - nz * ty;
  const sy = nz * tx - nx * tz;
  const sz = nx * ty - ny * tx;
  const low = b.species.radius + PLANK * 0.92;
  let n = 0;
  for (let s = 1.1; s <= LONG; s += STEP) {
    const x = b.x + tx * flat * s + nx * (most * s - low);
    const y = b.y + ty * flat * s + ny * (most * s - low);
    const z = b.z + tz * flat * s + nz * (most * s - low);
    n++;
    out.push(x + sx * LANE, y + sy * LANE, z + sz * LANE, PLANK, x - sx * LANE, y - sy * LANE, z - sz * LANE, PLANK);
    // (it has got to something)
    if (s > 6 && field.sample(x, y, z) < -0.9) break;
  }
  if (n < SPANS) out.length = 0;
  return out;
}

/** How solid a place is already: a bridge all of whose beads are in the ground is none. */
export function laid(field: TerrainField, beads: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < beads.length; i += BEAD) if (field.sample(beads[i], beads[i + 1], beads[i + 2]) > 0) n++;
  return n;
}
