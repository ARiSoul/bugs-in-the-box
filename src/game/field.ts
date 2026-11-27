/**
 * The part of the terrain that gameplay is allowed to see. `Terrain` satisfies it; tests can
 * satisfy it with any hand-made field. Gameplay never touches meshes.
 */
export interface TerrainField {
  readonly W: number;
  readonly H: number;
  readonly D: number;
  sample(x: number, y: number, z: number): number;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number;
  /** Remove a sphere of terrain (explosions, digging); `rough`: a blast's uneven crater (see `terrain/crater.ts`). */
  carve(x: number, y: number, z: number, r: number, rough?: boolean): void;
  /** Add what a bug builds (pieces, see `build.ts`). Optional: where it is missing, nothing can be built. */
  deposit?(pieces: readonly number[]): void;
  /** Take pieces away again, or what of them is inside a sphere (x, y, z, radius). Optional, as `deposit` is. */
  erase?(pieces: readonly number[], sphere?: readonly number[] | null): void;
  /** Turn a turntable a quarter turn (+x to +z) about the sample (cx, cz): rows j0..j1, radius r. Optional. */
  rotateQuarter?(cx: number, cz: number, j0: number, j1: number, r: number): void;
}

/** Central-difference step for the gradient. Half a cell: smooths the per-cell trilinear kinks. */
const GRAD_STEP = 0.5;
/** Below this gradient length the field is flat (clamped far from any surface): treat as "far away". */
const MIN_GRAD = 0.05;

/**
 * Estimated distance from (x,y,z) to the nearest surface, and the outward normal written into `out`.
 *
 * The density is only an approximate signed distance (ground is generated as a vertical distance,
 * which overestimates on slopes, where |grad| > 1). Dividing by the gradient length corrects that to
 * first order: for a plane, `sample / |grad|` is the exact distance. It only divides when |grad| > 1:
 * in concave corners the central difference averages two normals (|grad| < 1), and dividing there
 * would make walls look farther than they are.
 *
 * Uses only + - * / and Math.sqrt so results are bit-identical across devices.
 */
export function surfaceDistance(field: TerrainField, x: number, y: number, z: number, out: Float64Array): number {
  const d = field.sample(x, y, z);
  const inv = 1 / (2 * GRAD_STEP);
  const gx = (field.sample(x + GRAD_STEP, y, z) - field.sample(x - GRAD_STEP, y, z)) * inv;
  const gy = (field.sample(x, y + GRAD_STEP, z) - field.sample(x, y - GRAD_STEP, z)) * inv;
  const gz = (field.sample(x, y, z + GRAD_STEP) - field.sample(x, y, z - GRAD_STEP)) * inv;
  const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
  if (len < MIN_GRAD) {
    out[0] = 0;
    out[1] = 1;
    out[2] = 0;
    return d;
  }
  out[0] = gx / len;
  out[1] = gy / len;
  out[2] = gz / len;
  return len > 1 ? d / len : d;
}
