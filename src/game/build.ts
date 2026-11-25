import type { Bug } from './bug';
import type { TerrainField } from './field';

/**
 * What bugs build: thick flat pieces with round edges, edge to edge, so a wall is one slab and a bridge one smooth deck.
 * Every species builds the same shapes; only what is drawn over them differs. Pure: where the pieces go depends on the
 * field, the bug and its aim only (the render shows them before they are laid).
 */

/** Numbers per piece: its middle, its half axes u and v (square to each other), how thick it is round them, its slot. */
export const PIECE = 11;

/** A wall: how far before the bug, columns, how far apart, how high over the ground and how deep in it, how thick (a half). */
const AHEAD = 4.4;
export const COLUMNS = 7;
export const APART = 1.6;
export const WALL_HIGH = 4.9;
export const WALL_DEEP = 0.5;
export const WALL_THICK = 0.85;
/** Its outermost piece is this much shorter at its outer end (it ends round, where what is drawn does). */
const END = 0.45;
/** It bends round the bug a little. */
const BEND = 0.12;
/** Fewer columns than this: there is no place for one. */
const LEAST = 4;

/** A bridge: its pieces, the way from one to the next, half its width, how thick (a half). */
export const SPANS = 12;
export const SPAN = 1.2;
export const DECK_WIDE = 1.6;
export const DECK_THICK = 0.7;
/** The body's top is this far under the deck that is drawn over it. */
export const DECK_UNDER = 0.08;
/** It rises (or falls) no steeper than this (a sine). */
const STEEP = 0.72;
/** Pieces a bridge has at least. */
const LEAST_SPANS = 4;

const dir = new Float64Array(3);

/** How far the middle of piece `slot` of `n` is from the middle of its place, along them. */
export function shifted(slot: number, n: number): number {
  return slot === 0 ? END : slot === n - 1 ? -END : 0;
}

/** The pieces of a wall before the bug, standing on what is there (u up, v to its side). None: no place for it. */
export function wallPieces(field: TerrainField, b: Bug, out: number[]): number[] {
  out.length = 0;
  b.direction(1, 0, dir);
  const [fx, fy, fz] = dir;
  const { nx, ny, nz } = b;
  // (to its side)
  const sx = ny * fz - nz * fy;
  const sy = nz * fx - nx * fz;
  const sz = nx * fy - ny * fx;
  const half = (WALL_HIGH + WALL_DEEP) / 2;
  const u = half - WALL_THICK;
  for (let c = 0; c < COLUMNS; c++) {
    const i = c - (COLUMNS - 1) / 2;
    const on = AHEAD - BEND * i * i;
    const x = b.x + fx * on + sx * i * APART;
    const y = b.y + fy * on + sy * i * APART;
    const z = b.z + fz * on + sz * i * APART;
    if (field.sample(x + nx * 2, y + ny * 2, z + nz * 2) < 0) continue;
    const t = field.raycast(x + nx * 2, y + ny * 2, z + nz * 2, -nx, -ny, -nz, 5.5);
    if (t <= 0) continue;
    const end = shifted(c, COLUMNS);
    const v = APART * 0.5 + 0.1 - (end < 0 ? -end : end);
    // (its middle over the ground, which is 2 - t over the bug's own middle)
    const h = 2 - t + half - WALL_DEEP;
    out.push(x + nx * h + sx * end, y + ny * h + sy * end, z + nz * h + sz * end, nx * u, ny * u, nz * u, sx * v, sy * v, sz * v, WALL_THICK, c);
  }
  if (out.length < LEAST * PIECE) out.length = 0;
  return out;
}

/** The pieces of a bridge from the bug's feet along (dx, dy, dz) (unit), as far as it goes or until it meets something (u along it, v across). */
export function bridgePieces(field: TerrainField, b: Bug, dx: number, dy: number, dz: number, out: number[]): number[] {
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
  // along it, across it, and out of its deck
  const ax = tx * flat + nx * most;
  const ay = ty * flat + ny * most;
  const az = tz * flat + nz * most;
  const sx = ny * tz - nz * ty;
  const sy = nz * tx - nx * tz;
  const sz = nx * ty - ny * tx;
  const ox = nx * flat - tx * most;
  const oy = ny * flat - ty * most;
  const oz = nz * flat - tz * most;
  // (its deck is level with the bug's feet where it begins)
  const low = b.species.radius;
  let n = 0;
  for (let c = 0; c < SPANS; c++) {
    const end = shifted(c, SPANS);
    const u = SPAN * 0.5 + 0.12 - (end < 0 ? -end : end);
    const s = 0.95 + c * SPAN + (most > 0 ? most * 0.6 : 0) + end;
    const x = b.x - nx * low + ax * s - ox * (DECK_THICK + DECK_UNDER);
    const y = b.y - ny * low + ay * s - oy * (DECK_THICK + DECK_UNDER);
    const z = b.z - nz * low + az * s - oz * (DECK_THICK + DECK_UNDER);
    n++;
    out.push(x, y, z, ax * u, ay * u, az * u, sx * DECK_WIDE, sy * DECK_WIDE, sz * DECK_WIDE, DECK_THICK, c);
    // (it has got to something)
    if (s > 6 && field.sample(x, y, z) < -0.9) break;
  }
  if (n < LEAST_SPANS) out.length = 0;
  return out;
}

/** How many of the pieces are not in the ground already. */
export function laid(field: TerrainField, pieces: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < pieces.length; i += PIECE) {
    // (a wall stands in the ground: its upper part counts)
    const up = 0.5;
    if (field.sample(pieces[i] + pieces[i + 3] * up, pieces[i + 1] + pieces[i + 4] * up, pieces[i + 2] + pieces[i + 5] * up) > 0) n++;
  }
  return n;
}

/** The point of piece `i`'s middle sheet nearest to (x, y, z), into `out`; returns the distance to the piece. */
export function toPiece(p: readonly number[], i: number, x: number, y: number, z: number, out: Float64Array): number {
  const ux = p[i + 3];
  const uy = p[i + 4];
  const uz = p[i + 5];
  const vx = p[i + 6];
  const vy = p[i + 7];
  const vz = p[i + 8];
  let a = ((x - p[i]) * ux + (y - p[i + 1]) * uy + (z - p[i + 2]) * uz) / (ux * ux + uy * uy + uz * uz);
  let b = ((x - p[i]) * vx + (y - p[i + 1]) * vy + (z - p[i + 2]) * vz) / (vx * vx + vy * vy + vz * vz);
  a = a > 1 ? 1 : a < -1 ? -1 : a;
  b = b > 1 ? 1 : b < -1 ? -1 : b;
  out[0] = p[i] + ux * a + vx * b;
  out[1] = p[i + 1] + uy * a + vy * b;
  out[2] = p[i + 2] + uz * a + vz * b;
  const dx = x - out[0];
  const dy = y - out[1];
  const dz = z - out[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - p[i + 9];
}
