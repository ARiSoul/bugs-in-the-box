import { DENSITY_CLAMP } from './constants';
import type { Terrain } from './Terrain';

/**
 * Signed-distance primitives and CSG "stamps" for building scenarios out of shapes.
 *
 * A stamp writes one shape into the density grid, visiting only the shape's bounding box padded by
 * STAMP_PAD (not the whole grid), so a scenario of hundreds of parts stays cheap. Order matters, like
 * a sculptor's: union adds material, subtract cuts it away. Beyond STAMP_PAD the grid keeps whatever it
 * had (at most DENSITY_CLAMP); `raycast` steps 0.6 × the sample, so 0.6 × 6 = 3.6 < STAMP_PAD and it
 * cannot jump over a shape.
 *
 * Deterministic: only + - * / and Math.sqrt/min/max/abs/floor/ceil. Rotations take (cos, sin) pairs
 * that the caller builds from exact values (e.g. √3/2), never Math.sin/cos.
 */

export const Kind = { Sphere: 0, Box: 1, Cylinder: 2, Capsule: 3, Torus: 4, Cone: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** Axis of a cylinder, a torus, or a box rotation: 0 = x, 1 = y, 2 = z. */
export type Axis = 0 | 1 | 2;

export interface Shape {
  kind: Kind;
  /** Centre (for a capsule: the first end). */
  x: number;
  y: number;
  z: number;
  /**
   * Box: half sizes. Cylinder: radius, half height, (unused). Capsule: second end. Torus: ring radius, tube radius.
   * Sphere: radius. Cone: half height, bottom radius, top radius.
   */
  a: number;
  b: number;
  c: number;
  /** Box: corner rounding. Capsule: radius. */
  r: number;
  axis: Axis;
  /** Box rotation about `axis` (cos, sin). (1, 0) = not rotated. */
  rc: number;
  rs: number;
}

const shape = (kind: Kind, x: number, y: number, z: number, a: number, b: number, c: number, r = 0, axis: Axis = 1): Shape => ({
  kind,
  x,
  y,
  z,
  a,
  b,
  c,
  r,
  axis,
  rc: 1,
  rs: 0,
});

export const sphere = (x: number, y: number, z: number, radius: number): Shape => shape(Kind.Sphere, x, y, z, radius, 0, 0);

/** Box by centre and half sizes, optionally with rounded edges. */
export const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, round = 0): Shape =>
  shape(Kind.Box, x, y, z, hx, hy, hz, round);

/** Box from min and max corners. */
export const boxMinMax = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, round = 0): Shape =>
  box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, round);

/** Box rotated about `axis` through its centre by the angle whose cosine and sine are (rc, rs). */
export const rotatedBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number, axis: Axis, rc: number, rs: number, round = 0): Shape => {
  const s = shape(Kind.Box, x, y, z, hx, hy, hz, round, axis);
  s.rc = rc;
  s.rs = rs;
  return s;
};

/**
 * Capped cylinder along `axis`, optionally with rounded rims. Round rims of at least ~1 cell mesh
 * cleanly; a sharp round rim shows the grid as small steps.
 */
export const cylinder = (x: number, y: number, z: number, radius: number, halfHeight: number, axis: Axis = 1, round = 0): Shape =>
  shape(Kind.Cylinder, x, y, z, radius, halfHeight, 0, round, axis);

/** Segment from (x0,y0,z0) to (x1,y1,z1) with round ends. */
export const capsule = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number): Shape =>
  shape(Kind.Capsule, x0, y0, z0, x1, y1, z1, radius);

/** Ring around `axis`. */
export const torus = (x: number, y: number, z: number, ring: number, tube: number, axis: Axis = 1): Shape =>
  shape(Kind.Torus, x, y, z, ring, tube, 0, 0, axis);

/**
 * Capped cone along y, from `radiusBottom` at `yBottom` to `radiusTop` at `yTop` (either may be the wider;
 * a radius of 0 makes a point). A loudspeaker cone, a funnel, a lamp shade.
 */
export const cone = (x: number, yBottom: number, z: number, radiusBottom: number, yTop: number, radiusTop: number): Shape =>
  shape(Kind.Cone, x, (yBottom + yTop) / 2, z, (yTop - yBottom) / 2, radiusBottom, radiusTop);

/** Signed distance from (px, py, pz) to the shape: negative inside. */
export function distance(s: Shape, px: number, py: number, pz: number): number {
  let dx = px - s.x;
  let dy = py - s.y;
  let dz = pz - s.z;
  switch (s.kind) {
    case Kind.Sphere:
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - s.a;
    case Kind.Box: {
      if (s.rs !== 0) {
        // into the box's frame: rotate by -angle about the axis
        if (s.axis === 1) {
          const u = dx * s.rc + dz * s.rs;
          dz = -dx * s.rs + dz * s.rc;
          dx = u;
        } else if (s.axis === 2) {
          const u = dx * s.rc + dy * s.rs;
          dy = -dx * s.rs + dy * s.rc;
          dx = u;
        } else {
          const u = dy * s.rc + dz * s.rs;
          dz = -dy * s.rs + dz * s.rc;
          dy = u;
        }
      }
      const qx = Math.abs(dx) - s.a + s.r;
      const qy = Math.abs(dy) - s.b + s.r;
      const qz = Math.abs(dz) - s.c + s.r;
      const ox = qx > 0 ? qx : 0;
      const oy = qy > 0 ? qy : 0;
      const oz = qz > 0 ? qz : 0;
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - s.r;
    }
    case Kind.Cylinder: {
      const axial = s.axis === 1 ? dy : s.axis === 0 ? dx : dz;
      const r2 = dx * dx + dy * dy + dz * dz - axial * axial;
      const qr = Math.sqrt(r2 > 0 ? r2 : 0) - s.a + s.r;
      const qa = Math.abs(axial) - s.b + s.r;
      const or = qr > 0 ? qr : 0;
      const oa = qa > 0 ? qa : 0;
      return Math.sqrt(or * or + oa * oa) + Math.min(Math.max(qr, qa), 0) - s.r;
    }
    case Kind.Capsule: {
      const bx = s.a - s.x;
      const by = s.b - s.y;
      const bz = s.c - s.z;
      const bb = bx * bx + by * by + bz * bz;
      let h = bb > 0 ? (dx * bx + dy * by + dz * bz) / bb : 0;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      dx -= bx * h;
      dy -= by * h;
      dz -= bz * h;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - s.r;
    }
    case Kind.Torus: {
      const axial = s.axis === 1 ? dy : s.axis === 0 ? dx : dz;
      const r2 = dx * dx + dy * dy + dz * dz - axial * axial;
      const qr = Math.sqrt(r2 > 0 ? r2 : 0) - s.a;
      return Math.sqrt(qr * qr + axial * axial) - s.b;
    }
    case Kind.Cone: {
      // exact capped cone (Inigo Quilez): q = (distance from the axis, height from the middle)
      const h = s.a;
      const r1 = s.b;
      const r2 = s.c;
      const qx = Math.sqrt(dx * dx + dz * dz);
      const qy = dy;
      const cax = qx - Math.min(qx, qy < 0 ? r1 : r2);
      const cay = Math.abs(qy) - h;
      const k2x = r2 - r1;
      const k2y = 2 * h;
      const kk = k2x * k2x + k2y * k2y;
      let u = kk > 0 ? ((r2 - qx) * k2x + (h - qy) * k2y) / kk : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const cbx = qx - r2 + k2x * u;
      const cby = qy - h + k2y * u;
      const sign = cbx < 0 && cay < 0 ? -1 : 1;
      return sign * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
    }
  }
}

/** How far around a shape a stamp writes. Must stay above 0.6 × DENSITY_CLAMP (see the header). */
export const STAMP_PAD = 4;

const bounds = new Float64Array(6);

/** Axis-aligned bounds of the shape (without padding), into `bounds`. */
function shapeBounds(s: Shape): void {
  let ex = 0;
  let ey = 0;
  let ez = 0;
  switch (s.kind) {
    case Kind.Sphere:
      ex = ey = ez = s.a;
      break;
    case Kind.Box:
      if (s.rs !== 0) ex = ey = ez = Math.sqrt(s.a * s.a + s.b * s.b + s.c * s.c);
      else {
        ex = s.a;
        ey = s.b;
        ez = s.c;
      }
      break;
    case Kind.Cylinder:
    case Kind.Torus: {
      const radial = s.kind === Kind.Torus ? s.a + s.b : s.a;
      const along = s.b;
      ex = s.axis === 0 ? along : radial;
      ey = s.axis === 1 ? along : radial;
      ez = s.axis === 2 ? along : radial;
      break;
    }
    case Kind.Cone:
      ex = ez = Math.max(s.b, s.c);
      ey = s.a;
      break;
    case Kind.Capsule:
      bounds[0] = Math.min(s.x, s.a) - s.r;
      bounds[1] = Math.min(s.y, s.b) - s.r;
      bounds[2] = Math.min(s.z, s.c) - s.r;
      bounds[3] = Math.max(s.x, s.a) + s.r;
      bounds[4] = Math.max(s.y, s.b) + s.r;
      bounds[5] = Math.max(s.z, s.c) + s.r;
      return;
  }
  bounds[0] = s.x - ex;
  bounds[1] = s.y - ey;
  bounds[2] = s.z - ez;
  bounds[3] = s.x + ex;
  bounds[4] = s.y + ey;
  bounds[5] = s.z + ez;
}

/** A surface sample takes the material of the shape that owns the surface within this distance. */
const MATERIAL_BAND = 1.5;
/** A hidden solid only marks samples at least this far from any surface (see `addHidden`). */
const HIDDEN_CLEAR = 1.2;
/** Smallest |density| a stamp writes (see `stamp`). */
const ZERO_GAP = 0.01;

/**
 * Add the shape (union). Where the shape is the nearest surface, the samples take `material`.
 * `smooth` > 0 blends it into what is already there (fillet of about that size).
 */
export function add(t: Terrain, s: Shape, material: number, smooth = 0): void {
  stamp(t, s, material, smooth, false, false);
}

/**
 * Add a hidden solid (a COLLIDER): a union like `add`, but it only takes over samples that were clear
 * air (more than `HIDDEN_CLEAR` from any surface), so the surfaces already there keep their material
 * where it touches them. (A sample next to a floor is part of the floor's surface: marked hidden, it
 * would cut a hole round the foot of everything standing there. Near the contact the collider keeps
 * the floor's material instead, inside the part drawn over it.)
 */
export function addHidden(t: Terrain, s: Shape, material: number): void {
  stamp(t, s, material, 0, false, true);
}

/** Cut the shape away (subtraction). Materials are kept: the cut shows what was there. */
export function cut(t: Terrain, s: Shape): void {
  stamp(t, s, -1, 0, true, false);
}

/**
 * Give every sample inside the shape (and up to half a cell outside) `material`, without changing the
 * density: the colour of a surface already there (the raw inside of a box built from another material).
 */
export function paint(t: Terrain, s: Shape, material: number): void {
  shapeBounds(s);
  const { sx, sy } = t;
  const mat = t.material;
  const i0 = Math.max(0, Math.floor(bounds[0] - 1));
  const j0 = Math.max(0, Math.floor(bounds[1] - 1));
  const k0 = Math.max(0, Math.floor(bounds[2] - 1));
  const i1 = Math.min(sx - 1, Math.ceil(bounds[3] + 1));
  const j1 = Math.min(sy - 1, Math.ceil(bounds[4] + 1));
  const k1 = Math.min(t.sz - 1, Math.ceil(bounds[5] + 1));
  for (let k = k0; k <= k1; k++) {
    for (let j = j0; j <= j1; j++) {
      let id = i0 + sx * (j + sy * k);
      for (let i = i0; i <= i1; i++, id++) if (distance(s, i, j, k) < 0.5) mat[id] = material;
    }
  }
}

function stamp(t: Terrain, s: Shape, material: number, smooth: number, subtract: boolean, airOnly: boolean): void {
  shapeBounds(s);
  const { sx, sy, sz, dens } = t;
  const mat = t.material;
  // The outer two layers of samples stay air, so every surface closes inside the world.
  const i0 = Math.max(2, Math.floor(bounds[0] - STAMP_PAD));
  const j0 = Math.max(2, Math.floor(bounds[1] - STAMP_PAD));
  const k0 = Math.max(2, Math.floor(bounds[2] - STAMP_PAD));
  const i1 = Math.min(sx - 3, Math.ceil(bounds[3] + STAMP_PAD));
  const j1 = Math.min(sy - 3, Math.ceil(bounds[4] + STAMP_PAD));
  const k1 = Math.min(sz - 3, Math.ceil(bounds[5] + STAMP_PAD));
  for (let k = k0; k <= k1; k++) {
    for (let j = j0; j <= j1; j++) {
      let id = i0 + sx * (j + sy * k);
      for (let i = i0; i <= i1; i++, id++) {
        const d = distance(s, i, j, k);
        const old = dens[id];
        let nd: number;
        if (subtract) {
          nd = -d > old ? -d : old;
        } else {
          if (smooth > 0) {
            const h = Math.max(smooth - Math.abs(old - d), 0) / smooth;
            nd = (d < old ? d : old) - h * h * smooth * 0.25;
          } else {
            nd = d < old ? d : old;
          }
          if (d < old && d < MATERIAL_BAND && (!airOnly || old > HIDDEN_CLEAR)) mat[id] = material;
        }
        // A surface exactly on a sample (a box face at a whole coordinate) would put several mesh
        // vertices on the same point and make degenerate triangles: keep samples off zero.
        if (nd < ZERO_GAP && nd > -ZERO_GAP) nd = nd < 0 ? -ZERO_GAP : ZERO_GAP;
        dens[id] = nd < -DENSITY_CLAMP ? -DENSITY_CLAMP : nd > DENSITY_CLAMP ? DENSITY_CLAMP : nd;
      }
    }
  }
}
