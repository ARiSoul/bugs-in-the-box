import { COLLIDER } from '../materials';
import type { Terrain } from '../Terrain';
import type { Feature } from './types';

/** Samples nearer than this to a surface keep what they have: no floor is lifted, no wall is thickened. */
const CLEAR = 1.2;
/** Half the least thickness a body may have: thinner, and the grid (one sample per unit) loses it. */
const THIN = 1.05;
/** Parts smaller than this all round stay without a body. */
const SMALL = 1.6;
/** How far round a shape its distance is written. */
const PAD = 3;
/** How near a body's surface a sample becomes hidden. */
const BAND = 1.5;
const ZERO_GAP = 0.01;

/**
 * Give a hidden body (COLLIDER) to every drawn `part`, `wire` and `rod` where it has none: whatever sticks out
 * into clear air. `features`: everything the generator drew, whether or not there is a layout to draw it in (the
 * grid must not depend on that). See-through parts are left alone (drawers and jars are hollow).
 */
export function giveBodies(t: Terrain, features: readonly Feature[]): void {
  // (measured against the grid as it was: one body must not count as a surface for the next)
  const base = t.dens.slice();
  for (const f of features) {
    if (f.kind === 'part') {
      if ((f.opacity ?? 1) < 1) continue;
      partBody(t, base, f);
    } else if (f.kind === 'wire') {
      const p = f.path;
      const r = Math.max(THIN, p[0]);
      for (let i = 1; i + 5 < p.length; i += 3) segment(t, base, p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], r);
    } else if (f.kind === 'rod') {
      const p = f.path;
      segment(t, base, p[0], p[1], p[2], p[3], p[4], p[5], Math.max(THIN, f.radius));
    }
  }
}

function write(t: Terrain, base: Float32Array, id: number, d: number): void {
  if (base[id] <= CLEAR || d >= t.dens[id]) return;
  if (d < BAND) t.material[id] = COLLIDER;
  t.dens[id] = d < ZERO_GAP && d > -ZERO_GAP ? (d < 0 ? -ZERO_GAP : ZERO_GAP) : d;
}

/** How far from any surface the grid's nearest sample is. */
function clearAt(t: Terrain, base: Float32Array, x: number, y: number, z: number): number {
  const i = Math.min(t.sx - 1, Math.max(0, Math.round(x)));
  const j = Math.min(t.sy - 1, Math.max(0, Math.round(y)));
  const k = Math.min(t.sz - 1, Math.max(0, Math.round(z)));
  return base[i + t.sx * (j + t.sy * k)];
}

function segment(t: Terrain, base: Float32Array, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
  // (lying on a surface: the feet rest on what is drawn there, see DrawnGround)
  if (clearAt(t, base, ax, ay, az) <= CLEAR && clearAt(t, base, bx, by, bz) <= CLEAR) return;
  const { sx, sy, sz } = t;
  const pad = r + PAD;
  const i0 = Math.max(2, Math.floor(Math.min(ax, bx) - pad));
  const j0 = Math.max(2, Math.floor(Math.min(ay, by) - pad));
  const k0 = Math.max(2, Math.floor(Math.min(az, bz) - pad));
  const i1 = Math.min(sx - 3, Math.ceil(Math.max(ax, bx) + pad));
  const j1 = Math.min(sy - 3, Math.ceil(Math.max(ay, by) + pad));
  const k1 = Math.min(sz - 3, Math.ceil(Math.max(az, bz) + pad));
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const l2 = ux * ux + uy * uy + uz * uz || 1;
  for (let k = k0; k <= k1; k++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const h = Math.min(1, Math.max(0, ((i - ax) * ux + (j - ay) * uy + (k - az) * uz) / l2));
        const dx = i - ax - ux * h;
        const dy = j - ay - uy * h;
        const dz = k - az - uz * h;
        write(t, base, i + sx * (j + sy * k), Math.sqrt(dx * dx + dy * dy + dz * dz) - r);
      }
}

function partBody(t: Terrain, base: Float32Array, f: Feature): void {
  const [x0, y0, z0, x1, y1, z1] = f.box;
  if (Math.max(x1 - x0, y1 - y0, z1 - z0) < SMALL) return;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = Math.max(THIN, (x1 - x0) / 2);
  const hy = Math.max(THIN, (y1 - y0) / 2);
  const hz = Math.max(THIN, (z1 - z0) / 2);
  const [yc, ys] = f.yaw ?? [1, 0];
  const [tc, ts] = f.path.length === 2 ? f.path : [1, 0];
  const shape = f.shape ?? 'box';
  // (flat on a surface, or inside a body: nothing to do)
  let clear = false;
  for (let n = 0; n < 27 && !clear; n++) {
    const u = ((n % 3) - 1) * 0.9 * ((x1 - x0) / 2);
    const v = ((Math.floor(n / 3) % 3) - 1) * 0.9 * ((y1 - y0) / 2);
    const w = (Math.floor(n / 9) - 1) * 0.9 * ((z1 - z0) / 2);
    const y = v * tc - w * ts;
    const q = v * ts + w * tc;
    clear = clearAt(t, base, cx + u * yc - q * ys, cy + y, cz + u * ys + q * yc) > CLEAR;
  }
  if (!clear) return;
  const { sx, sy, sz } = t;
  // (the turned box's bounds)
  const ey = hy * Math.abs(tc) + hz * Math.abs(ts);
  const ez = hy * Math.abs(ts) + hz * Math.abs(tc);
  const wx = hx * Math.abs(yc) + ez * Math.abs(ys) + PAD;
  const wz = hx * Math.abs(ys) + ez * Math.abs(yc) + PAD;
  const i0 = Math.max(2, Math.floor(cx - wx));
  const i1 = Math.min(sx - 3, Math.ceil(cx + wx));
  const j0 = Math.max(2, Math.floor(cy - ey - PAD));
  const j1 = Math.min(sy - 3, Math.ceil(cy + ey + PAD));
  const k0 = Math.max(2, Math.floor(cz - wz));
  const k1 = Math.min(sz - 3, Math.ceil(cz + wz));
  for (let k = k0; k <= k1; k++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        // into the part's frame: back by its yaw, then by its tilt about x
        const px = i - cx;
        const py = j - cy;
        const pz = k - cz;
        const x = px * yc + pz * ys;
        const q = -px * ys + pz * yc;
        const y = py * tc + q * ts;
        const z = -py * ts + q * tc;
        let d: number;
        if (shape === 'cylX') d = cylinder(x, hx, y, z, Math.min(hy, hz));
        else if (shape === 'cylY') d = cylinder(y, hy, x, z, Math.min(hx, hz));
        else if (shape === 'cylZ') d = cylinder(z, hz, x, y, Math.min(hx, hy));
        else if (shape === 'ball') d = ball(x, y, z, hx, hy, hz);
        else if (shape === 'dome') d = Math.max(ball(x, y + hy, z, hx, 2 * hy, hz), -y - hy);
        else {
          const r = shape === 'soft' ? Math.min(hx, hy, hz) * 0.5 : 0;
          const ox = Math.abs(x) - hx + r;
          const oy = Math.abs(y) - hy + r;
          const oz = Math.abs(z) - hz + r;
          const ax = Math.max(ox, 0);
          const ay = Math.max(oy, 0);
          const az = Math.max(oz, 0);
          d = Math.sqrt(ax * ax + ay * ay + az * az) + Math.min(Math.max(ox, oy, oz), 0) - r;
        }
        write(t, base, i + sx * (j + sy * k), d);
      }
}

/** A capped cylinder: `a` along its axis (half length `h`), (u, v) across it. */
function cylinder(a: number, h: number, u: number, v: number, r: number): number {
  const s = Math.sqrt(u * u + v * v) - r;
  const e = Math.abs(a) - h;
  const ms = Math.max(s, 0);
  const me = Math.max(e, 0);
  return Math.sqrt(ms * ms + me * me) + Math.min(Math.max(s, e), 0);
}

/** An ellipsoid (near enough at its surface). */
function ball(x: number, y: number, z: number, a: number, b: number, c: number): number {
  return (Math.sqrt((x * x) / (a * a) + (y * y) / (b * b) + (z * z) / (c * c)) - 1) * Math.min(a, b, c);
}
