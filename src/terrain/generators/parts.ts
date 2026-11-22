import { FAN } from '../materials';
import { add, box, capsule, cut, cylinder, rotatedBox, type Axis } from '../sdf';
import type { Terrain } from '../Terrain';

/**
 * Parts shared by the scenario generators (fans, cables, ribbons, placement), built from SDF stamps.
 * Deterministic: only + - * / and Math.sqrt/min/max/abs, no sin/cos (angles are exact (cos, sin) pairs).
 */

const SQRT3_2 = 0.8660254037844386;
/** Six blade directions, 60° apart, as exact (cos, sin) pairs. */
const BLADES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, SQRT3_2],
  [-0.5, SQRT3_2],
  [-1, 0],
  [-0.5, -SQRT3_2],
  [0.5, -SQRT3_2],
];

export type Vec3 = [number, number, number];
type Rect = [number, number, number, number];

/**
 * Footprint bookkeeping on the board plane (x, z): `free` says whether a rectangle is inside the
 * margins and clear of everything claimed so far; `claim` reserves it.
 */
export function createPlacement(W: number, D: number, margin: number) {
  const used: Rect[] = [];
  return {
    free(x0: number, z0: number, x1: number, z1: number): boolean {
      if (x0 < margin || z0 < margin || x1 > W - margin || z1 > D - margin) return false;
      for (const r of used) if (x0 < r[2] && x1 > r[0] && z0 < r[3] && z1 > r[1]) return false;
      return true;
    },
    claim(x0: number, z0: number, x1: number, z1: number): void {
      used.push([x0, z0, x1, z1]);
    },
  };
}

/**
 * A fan: square frame with a round opening (if `framed`), hub and six blades, facing along `axis`.
 * `half` is the frame's half size, `radius` the opening.
 */
export function fan(t: Terrain, x: number, y: number, z: number, axis: Axis, half: number, radius: number, framed: boolean): void {
  if (framed) {
    const frame = axis === 0 ? box(x, y, z, 2, half, half, 0.6) : axis === 1 ? box(x, y, z, half, 2, half, 0.6) : box(x, y, z, half, half, 2, 0.6);
    add(t, frame, FAN);
    cut(t, cylinder(x, y, z, radius, 2.2, axis, 0.8));
  } else {
    cut(t, cylinder(x, y, z, radius, 2.5, axis, 0.8));
  }
  fanRotor(t, x, y, axis === 2 && !framed ? z + 1 : z, axis, 0, radius - 0.8);
}

/** Hub and six blades of a fan rotor centred at (x, y, z), spinning about `axis`. */
export function fanRotor(t: Terrain, x: number, y: number, z: number, axis: Axis, hubRadius: number, reach: number): void {
  const hub = hubRadius > 0 ? hubRadius : reach * 0.32;
  add(t, cylinder(x, y, z, hub, 1.3, axis, 1), FAN);
  const len = (reach - hub) / 2;
  const mid = hub + len - 0.3;
  for (const [c, s] of BLADES) {
    const w = Math.max(1.1, reach * 0.2);
    if (axis === 1) add(t, rotatedBox(x + c * mid, y, z + s * mid, len, 1, w, 1, c, s, 0.4), FAN);
    else if (axis === 2) add(t, rotatedBox(x + c * mid, y + s * mid, z, len, w, 1, 2, c, s, 0.4), FAN);
    else add(t, rotatedBox(x, y + c * mid, z + s * mid, 1, len, w, 0, c, s, 0.4), FAN);
  }
}

/**
 * Point `u` (0..1) of the cubic arc used by `cable` and `ribbon`: it leaves `a` and arrives at `b`
 * vertically, and peaks about `lift` above the higher end. Written into `out`.
 */
export function arcPoint(a: Vec3, b: Vec3, lift: number, u: number, out: Vec3): Vec3 {
  // Control points straight above the ends; at u = 0.5 the curve is 0.75 of the way up to them.
  const top = Math.max(a[1], b[1]) + lift;
  const c1y = a[1] + (top - (a[1] + b[1]) / 2) / 0.75;
  const c2y = b[1] + (top - (a[1] + b[1]) / 2) / 0.75;
  const v = 1 - u;
  const w0 = v * v * v;
  const w1 = 3 * v * v * u;
  const w2 = 3 * v * u * u;
  const w3 = u * u * u;
  out[0] = (w0 + w1) * a[0] + (w2 + w3) * b[0];
  out[1] = w0 * a[1] + w1 * c1y + w2 * c2y + w3 * b[1];
  out[2] = (w0 + w1) * a[2] + (w2 + w3) * b[2];
  return out;
}

/**
 * A thick cable or tube from `a` to `b` along the arc of `arcPoint`. Wide enough to walk on: a bridge.
 * Hard union of capsules: a smooth one would bulge at the joints.
 */
export function cable(t: Terrain, a: Vec3, b: Vec3, lift: number, material: number, radius = 1.8, segments = 24): void {
  const p: Vec3 = [a[0], a[1], a[2]];
  let lx = a[0];
  let ly = a[1];
  let lz = a[2];
  for (let i = 1; i <= segments; i++) {
    arcPoint(a, b, lift, i / segments, p);
    add(t, capsule(lx, ly, lz, p[0], p[1], p[2], radius), material);
    lx = p[0];
    ly = p[1];
    lz = p[2];
  }
}

/**
 * A soft cable through control points `ctrl` (x, y, z triples): a uniform Catmull-Rom curve, `perSegment`
 * samples per span, returned as a polyline (x, y, z triples, first and last control points included).
 * Arithmetic only (deterministic); the renderer draws the same polyline.
 */
export function wirePath(ctrl: readonly number[], perSegment: number): number[] {
  const n = ctrl.length / 3;
  const out: number[] = [ctrl[0], ctrl[1], ctrl[2]];
  for (let s = 0; s < n - 1; s++) {
    const i0 = Math.max(0, s - 1) * 3;
    const i1 = s * 3;
    const i2 = (s + 1) * 3;
    const i3 = Math.min(n - 1, s + 2) * 3;
    for (let k = 1; k <= perSegment; k++) {
      const t = k / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      for (let c = 0; c < 3; c++) {
        const p0 = ctrl[i0 + c];
        const p1 = ctrl[i1 + c];
        const p2 = ctrl[i2 + c];
        const p3 = ctrl[i3 + c];
        out.push(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3));
      }
    }
  }
  return out;
}

/** Solid cable along a polyline (x, y, z triples): capsules of `radius` between its points. */
export function wire(t: Terrain, points: readonly number[], radius: number, material: number): void {
  for (let i = 3; i + 2 < points.length; i += 3) {
    add(t, capsule(points[i - 3], points[i - 2], points[i - 1], points[i], points[i + 1], points[i + 2], radius), material);
  }
}

/**
 * A flat ribbon cable from `a` to `b` (same arc as `cable`), running along z, `halfWidth` wide in x and
 * `halfThick` thick: boxes along the arc, each turned about x to follow the slope.
 */
export function ribbon(t: Terrain, a: Vec3, b: Vec3, lift: number, material: number, halfWidth: number, halfThick: number, segments = 16): void {
  const p: Vec3 = [0, 0, 0];
  const q: Vec3 = [0, 0, 0];
  for (let i = 0; i < segments; i++) {
    arcPoint(a, b, lift, i / segments, p);
    arcPoint(a, b, lift, (i + 1) / segments, q);
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const len = Math.sqrt(dy * dy + dz * dz) || 1;
    // rotation about x that turns the box's z axis onto the segment: (cos, sin) = (dz, -dy) / len
    add(
      t,
      rotatedBox((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, halfWidth, halfThick, len / 2 + 0.6, 0, dz / len, -dy / len, 0.4),
      material,
    );
  }
}
