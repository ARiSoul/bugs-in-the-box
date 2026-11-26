/**
 * What each species builds and hides in, as meshes. Pure arrays, no three.js: a worker makes them
 * (`workers/build.worker.ts`), once per species of a match.
 *
 * Frames: a wall along x (the columns of `game/build.ts`), y up from the ground, its outer side +z. A bridge along x from
 * 0, its deck y = 0, z across. A shelter for a bug of radius 1 that stands on y = 0 and looks along +z.
 */
import { DECK_THICK, DECK_WIDE, SPAN, SPANS, WALL_HIGH } from '../../game/build';

export interface Model {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Per vertex: how rough it is, how much light comes through at its rim, when it comes as it grows (0..1). */
  look: Float32Array;
  index: Uint32Array;
}

type Field = (x: number, y: number, z: number) => number;
type Paint = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => readonly [number, number, number];
type V = readonly [number, number, number];

const LONG = SPANS * SPAN;
/** A deck's half width over all. */
const DECK = DECK_WIDE + DECK_THICK + 0.08;

const rnd = (i: number): number => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const hash = (x: number, y: number, z: number): number => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 873305521);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
function noise(x: number, y: number, z: number): number {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const Z = Math.floor(z);
  const a = x - X;
  const b = y - Y;
  const c = z - Z;
  const u = a * a * (3 - 2 * a);
  const v = b * b * (3 - 2 * b);
  const w = c * c * (3 - 2 * c);
  let r = 0;
  for (let i = 0; i < 8; i++) {
    const p = i & 1;
    const q = (i >> 1) & 1;
    const s = i >> 2;
    r += hash(X + p, Y + q, Z + s) * (p ? u : 1 - u) * (q ? v : 1 - v) * (s ? w : 1 - w);
  }
  return r * 2 - 1;
}
const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const ss = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smin = (a: number, b: number, k: number): number => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
};
const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);
function capsule(x: number, y: number, z: number, a: V, b: V, ra: number, rb: number): number {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const qx = x - a[0];
  const qy = y - a[1];
  const qz = z - a[2];
  const t = clamp((qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz));
  return Math.hypot(qx - bx * t, qy - by * t, qz - bz * t) - (ra + (rb - ra) * t);
}
/** Where the nearest of scattered points is (one in each cell of a grid): [distance, second distance, its number]. */
const cells = new Float64Array(3);
function cellular(x: number, y: number, z: number): Float64Array {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const Z = Math.floor(z);
  let a = 9;
  let b = 9;
  let id = 0;
  for (let i = -1; i < 2; i++)
    for (let j = -1; j < 2; j++)
      for (let k = -1; k < 2; k++) {
        const h = hash(X + i, Y + j, Z + k);
        const dx = X + i + 0.15 + 0.7 * h - x;
        const dy = Y + j + 0.15 + 0.7 * ((h * 7.13) % 1) - y;
        const dz = Z + k + 0.15 + 0.7 * ((h * 31.7) % 1) - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < a) {
          b = a;
          a = d;
          id = h;
        } else if (d < b) b = d;
      }
  cells[0] = Math.sqrt(a);
  cells[1] = Math.sqrt(b);
  cells[2] = id;
  return cells;
}
/** The hexagon (pointed up, circumradius s) at (x, y): its middle, and how far from its middle to its side (0..0.866 s). */
const hx = new Float64Array(3);
export function hexAt(x: number, y: number, s: number): Float64Array {
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / s;
  const r = ((2 / 3) * y) / s;
  let X = Math.round(q);
  let Z = Math.round(r);
  const Y = Math.round(-q - r);
  const dx = Math.abs(X - q);
  const dz = Math.abs(Z - r);
  const dy = Math.abs(Y + q + r);
  if (dx > dy && dx > dz) X = -Y - Z;
  else if (dz > dy) Z = -X - Y;
  hx[0] = s * Math.sqrt(3) * (X + Z / 2);
  hx[1] = s * 1.5 * Z;
  const px = Math.abs(x - hx[0]);
  const py = Math.abs(y - hx[1]);
  hx[2] = Math.max(px, px * 0.5 + py * 0.866);
  return hx;
}
const inHex = (x: number, y: number): number => Math.max(Math.abs(x), Math.abs(x) * 0.5 + Math.abs(y) * 0.866);

/** Collects a model. */
class Soup {
  readonly p: number[] = [];
  readonly n: number[] = [];
  readonly c: number[] = [];
  readonly l: number[] = [];
  readonly i: number[] = [];
  rough = 0.6;
  glow = 0;

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: V): void {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(c[0], c[1], c[2]);
    this.l.push(this.rough, this.glow);
  }

  /** The surface of a field (negative inside) within a box, in cells of `h`. The field is no steeper than 1 (about). */
  field(f: Field, lo: V, hi: V, h: number, paint: Paint): this {
    const N = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / h) + 1);
    const sy = N[0];
    const sz = N[0] * N[1];
    const d = new Float32Array(N[0] * N[1] * N[2]);
    // (blocks of cells well away from the surface are not looked into)
    const B = 4;
    for (let k = 0; k < N[2]; k += B)
      for (let j = 0; j < N[1]; j += B)
        for (let i = 0; i < N[0]; i += B) {
          const m = f(lo[0] + (i + B / 2) * h, lo[1] + (j + B / 2) * h, lo[2] + (k + B / 2) * h);
          const far = Math.abs(m) > B * h * 1.9 + 0.14;
          for (let c = k; c < Math.min(k + B, N[2]); c++)
            for (let b = j; b < Math.min(j + B, N[1]); b++)
              for (let a = i; a < Math.min(i + B, N[0]); a++) d[a + b * sy + c * sz] = far ? m : f(lo[0] + a * h, lo[1] + b * h, lo[2] + c * h);
        }
    const id = new Int32Array(d.length).fill(-1);
    const e = h * 0.5;
    for (let k = 0; k < N[2] - 1; k++)
      for (let j = 0; j < N[1] - 1; j++)
        for (let i = 0; i < N[0] - 1; i++) {
          const o = i + j * sy + k * sz;
          let n = 0;
          let x = 0;
          let y = 0;
          let z = 0;
          const first = d[o] < 0;
          let mixed = false;
          for (let a = 1; a < 8 && !mixed; a++) mixed = d[o + (a & 1) + ((a >> 1) & 1) * sy + (a >> 2) * sz] < 0 !== first;
          if (!mixed) continue;
          for (let a = 0; a < 8; a++)
            for (let b = 0; b < 3; b++) {
              if (a & (1 << b)) continue;
              const q = a | (1 << b);
              const A = d[o + (a & 1) + ((a >> 1) & 1) * sy + (a >> 2) * sz];
              const C = d[o + (q & 1) + ((q >> 1) & 1) * sy + (q >> 2) * sz];
              if (A < 0 === C < 0) continue;
              const t = A / (A - C);
              n++;
              x += (a & 1) + (b === 0 ? t : 0);
              y += ((a >> 1) & 1) + (b === 1 ? t : 0);
              z += (a >> 2) + (b === 2 ? t : 0);
            }
          const X = lo[0] + (i + x / n) * h;
          const Y = lo[1] + (j + y / n) * h;
          const Z = lo[2] + (k + z / n) * h;
          let nx = f(X + e, Y, Z) - f(X - e, Y, Z);
          let ny = f(X, Y + e, Z) - f(X, Y - e, Z);
          let nz = f(X, Y, Z + e) - f(X, Y, Z - e);
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          id[o] = this.p.length / 3;
          this.vertex(X, Y, Z, nx, ny, nz, paint(X, Y, Z, nx, ny, nz));
        }
    const st = [1, sy, sz];
    for (let k = 1; k < N[2] - 1; k++)
      for (let j = 1; j < N[1] - 1; j++)
        for (let i = 1; i < N[0] - 1; i++) {
          const o = i + j * sy + k * sz;
          for (let a = 0; a < 3; a++) {
            if (d[o] < 0 === d[o + st[a]] < 0) continue;
            const u = st[(a + 1) % 3];
            const v = st[(a + 2) % 3];
            const A = id[o];
            const C = id[o - u];
            const D = id[o - u - v];
            const E = id[o - v];
            if (A < 0 || C < 0 || D < 0 || E < 0) continue;
            if (d[o] < 0) this.i.push(A, C, D, A, D, E);
            else this.i.push(A, D, C, A, E, D);
          }
        }
    return this;
  }

  /** A round rod, thinner at its end by `taper`. */
  rod(a: V, b: V, r: number, c: V, sides = 5, taper = 1): void {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return;
    dx /= l;
    dy /= l;
    dz /= l;
    // two directions square to it
    const up = Math.abs(dy) < 0.9;
    let ux = up ? -dz : 1;
    let uy = up ? 0 : 0;
    let uz = up ? dx : 0;
    if (!up) {
      const k = dx;
      ux = 1 - dx * k;
      uy = -dy * k;
      uz = -dz * k;
    }
    const m = Math.hypot(ux, uy, uz);
    ux /= m;
    uy /= m;
    uz /= m;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const from = this.p.length / 3;
    for (let k = 0; k < sides; k++) {
      const t = (k / sides) * Math.PI * 2;
      const nx = ux * Math.cos(t) + vx * Math.sin(t);
      const ny = uy * Math.cos(t) + vy * Math.sin(t);
      const nz = uz * Math.cos(t) + vz * Math.sin(t);
      this.vertex(a[0] + nx * r, a[1] + ny * r, a[2] + nz * r, nx, ny, nz, c);
      this.vertex(b[0] + nx * r * taper, b[1] + ny * r * taper, b[2] + nz * r * taper, nx, ny, nz, c);
    }
    for (let k = 0; k < sides; k++) {
      const p = from + k * 2;
      const q = from + ((k + 1) % sides) * 2;
      this.i.push(p, q, p + 1, q, q + 1, p + 1);
    }
  }
  line(pts: readonly V[], r: number, c: V, sides = 4): void {
    for (let k = 0; k + 1 < pts.length; k++) this.rod(pts[k], pts[k + 1], r, c, sides);
  }

  /** A ball (an ellipsoid along the axes), turned about by `turn`. */
  ball(x: number, y: number, z: number, rx: number, ry: number, rz: number, c: V, w = 10, h = 7): void {
    const from = this.p.length / 3;
    for (let j = 0; j <= h; j++)
      for (let i = 0; i <= w; i++) {
        const a = (i / w) * Math.PI * 2;
        const b = (j / h) * Math.PI;
        const nx = Math.cos(a) * Math.sin(b);
        const ny = Math.cos(b);
        const nz = Math.sin(a) * Math.sin(b);
        const qx = nx / rx;
        const qy = ny / ry;
        const qz = nz / rz;
        const l = Math.hypot(qx, qy, qz) || 1;
        this.vertex(x + nx * rx, y + ny * ry, z + nz * rz, qx / l, qy / l, qz / l, c);
      }
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const a = from + i + j * (w + 1);
        this.i.push(a, a + 1, a + w + 1, a + 1, a + w + 2, a + w + 1);
      }
  }

  /** A lump: a small stone. */
  lump(x: number, y: number, z: number, r: number, c: V, seed: number): void {
    const from = this.p.length / 3;
    this.ball(x, y, z, r * (0.8 + 0.4 * rnd(seed)), r * (0.7 + 0.3 * rnd(seed + 1)), r * (0.8 + 0.4 * rnd(seed + 2)), c, 6, 4);
    for (let k = from; k < this.p.length / 3; k++) {
      const q = 1 + 0.22 * noise(this.n[k * 3] * 1.6 + seed, this.n[k * 3 + 1] * 1.6, this.n[k * 3 + 2] * 1.6);
      this.p[k * 3] = x + (this.p[k * 3] - x) * q;
      this.p[k * 3 + 1] = y + (this.p[k * 3 + 1] - y) * q;
      this.p[k * 3 + 2] = z + (this.p[k * 3 + 2] - z) * q;
    }
  }

  /** A sheet: points by (u, v) in 0..1, with normals from its neighbours. */
  sheet(at: (u: number, v: number) => V, nu: number, nv: number, c: (u: number, v: number) => V): void {
    const from = this.p.length / 3;
    const e = 1e-3;
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const v = j / nv;
        const p = at(u, v);
        const a = at(Math.min(1, u + e), v);
        const b = at(Math.max(0, u - e), v);
        const g = at(u, Math.min(1, v + e));
        const f = at(u, Math.max(0, v - e));
        const ux = a[0] - b[0];
        const uy = a[1] - b[1];
        const uz = a[2] - b[2];
        const vx = g[0] - f[0];
        const vy = g[1] - f[1];
        const vz = g[2] - f[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        // (a point where the sheet comes together: any normal but none)
        if (l < 1e-9) this.vertex(p[0], p[1], p[2], 0, 0, 1, c(u, v));
        else this.vertex(p[0], p[1], p[2], nx / l, ny / l, nz / l, c(u, v));
      }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = from + i + j * (nu + 1);
        this.i.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
  }

  /** Put a copy of another one in, through `m` (the rows of a turn and scale, and where to), times a colour. */
  put(o: Soup, m: readonly number[], tint = 1): void {
    const from = this.p.length / 3;
    for (let k = 0; k < o.p.length; k += 3) {
      const x = o.p[k];
      const y = o.p[k + 1];
      const z = o.p[k + 2];
      const a = o.n[k];
      const b = o.n[k + 1];
      const c = o.n[k + 2];
      this.p.push(m[0] * x + m[1] * y + m[2] * z + m[9], m[3] * x + m[4] * y + m[5] * z + m[10], m[6] * x + m[7] * y + m[8] * z + m[11]);
      const nx = m[0] * a + m[1] * b + m[2] * c;
      const ny = m[3] * a + m[4] * b + m[5] * c;
      const nz = m[6] * a + m[7] * b + m[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.n.push(nx / l, ny / l, nz / l);
      this.c.push(o.c[k] * tint, o.c[k + 1] * tint, o.c[k + 2] * tint);
    }
    for (const q of o.l) this.l.push(q);
    for (const q of o.i) this.i.push(q + from);
  }

  done(): Model {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), color: new Float32Array(this.c), look: new Float32Array(this.l), index: new Uint32Array(this.i) };
  }
}

/** A dark floor in a shelter. */
function floor(s: Soup, z: number, r: number, c: V): void {
  s.rough = 0.95;
  s.glow = 0;
  s.sheet((u, v) => [Math.cos(u * 6.2832) * r * v, 0.09, z - Math.sin(u * 6.2832) * r * v], 28, 3, () => c);
}

/** Turned by (rx, ry, rz) about the axes (x first), scaled by (sx, sy, sz), put at (x, y, z). */
function pose(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): number[] {
  const [a, b] = [Math.cos(rx), Math.sin(rx)];
  const [c, d] = [Math.cos(ry), Math.sin(ry)];
  const [e, f] = [Math.cos(rz), Math.sin(rz)];
  // (Rz Ry Rx)
  return [e * c * sx, (e * d * b - f * a) * sy, (e * d * a + f * b) * sz, f * c * sx, (f * d * b + e * a) * sy, (f * d * a - e * b) * sz, -d * sx, c * b * sy, c * a * sz, x, y, z];
}
/** With its z along (dx, dy, dz) and its y as near up as can be, scaled, rolled. */
function along(x: number, y: number, z: number, dx: number, dy: number, dz: number, s: number, roll = 0): number[] {
  const l = Math.hypot(dx, dy, dz);
  const fx = dx / l;
  const fy = dy / l;
  const fz = dz / l;
  let ax = fz;
  let az = -fx;
  const m = Math.hypot(ax, az);
  if (m < 0.1) {
    ax = 1;
    az = 0;
  } else {
    ax /= m;
    az /= m;
  }
  const bx = fy * az;
  const by = fz * ax - fx * az;
  const bz = -fy * ax;
  const c = Math.cos(roll);
  const q = Math.sin(roll);
  const X = [ax * c + bx * q, by * q, az * c + bz * q];
  const Y = [bx * c - ax * q, by * c, bz * c - az * q];
  return [X[0] * s, Y[0] * s, fx * s, X[1] * s, Y[1] * s, fy * s, X[2] * s, Y[2] * s, fz * s, x, y, z];
}
const sag = (a: V, b: V, s: number, n = 8): V[] => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n - s * 4 * (i / n) * (1 - i / n), a[2] + ((b[2] - a[2]) * i) / n] as const);
const path = (n: number, a: number, b: number, f: (x: number) => V): V[] => Array.from({ length: n + 1 }, (_, i) => f(a + ((b - a) * i) / n));
const dim = (c: V, k: number): V => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------- ants

const EARTH: readonly V[] = [[0.15, 0.075, 0.03], [0.21, 0.11, 0.045], [0.1, 0.05, 0.02], [0.26, 0.15, 0.07], [0.075, 0.04, 0.018], [0.32, 0.22, 0.12]];
const WOOD: readonly V[] = [[0.42, 0.26, 0.11], [0.31, 0.17, 0.065], [0.5, 0.34, 0.17], [0.2, 0.105, 0.04], [0.36, 0.21, 0.085]];
/** Grains of soil all over a field: each its own colour, a dark seam between them. */
const soil = (f: Field, g: number, deep: number): Field => (x, y, z) => {
  const d = f(x, y, z);
  if (Math.abs(d) > 0.5) return d;
  const c = cellular(x * g, y * g, z * g);
  return d - deep * Math.sqrt(Math.max(0, 1 - c[0] * c[0] * 1.35));
};
const soilPaint = (g: number, k: (x: number, y: number, z: number) => number = () => 1): Paint => (x, y, z) => {
  const c = cellular(x * g, y * g, z * g);
  const t = EARTH[Math.floor(c[2] * EARTH.length)];
  const s = (0.45 + 0.55 * ss(0, 0.28, c[1] - c[0])) * (0.88 + 0.24 * ((c[2] * 13.7) % 1)) * k(x, y, z);
  return [t[0] * s, t[1] * s, t[2] * s];
};

function rampart(): Model {
  const s = new Soup();
  s.rough = 0.92;
  const H = (x: number): number => (2.3 + 0.25 * Math.sin(x * 1.3)) * 1;
  const bank: Field = (x, y, z) => (y + 0.1 - (H(x) + 0.25) * Math.exp(-(z * z + 3 * Math.max(0, Math.abs(x) - 5.0) ** 2) / 1.9)) * 0.6;
  // (dark where the stakes go in, paler and drier to its rim)
  s.field(soil(bank, 2.6, 0.17), [-6.5, -0.5, -3.1], [6.5, 3.1, 3.1], 0.085, soilPaint(2.6, (x, y, z) => (1 - 0.45 * Math.exp(-((Math.abs(z) - 0.42) ** 2) / 0.12) * ss(1.3, 2.1, y)) * (1 + 0.22 * ss(0.5, 0.05, y))));
  for (let i = 0; i < 230; i++) {
    const a = rnd(i + 0.1) * 2 - 1;
    const e = rnd(i + 0.2) < 0.5 ? 1 : -1;
    const r = 2.05 + 0.75 * rnd(i + 0.3) ** 2;
    const k = 0.07 + 0.1 * rnd(i + 0.8) ** 2;
    const end = Math.abs(a) > 0.86;
    const t = (rnd(i + 0.5) - 0.5) * 3.1;
    s.lump(end ? Math.sign(a) * (5 + 1.15 * Math.cos(t) + 0.4 * (r - 2.05)) : a * 6, k * 0.4, end ? Math.sin(t) * r : e * r, k, dim(EARTH[(Math.floor((a + 1) * 2.5) + (rnd(i + 4) < 0.3 ? 1 : 0)) % 4], 0.9 + 0.25 * rnd(i + 3)), i);
  }
  // (and loose past its edge)
  for (let i = 0; i < 140; i++) {
    const a = rnd(i + 0.13) * 2 - 1;
    const e = rnd(i + 0.27) < 0.5 ? 1 : -1;
    const r = 2.7 + 1.1 * rnd(i + 0.37) ** 1.5;
    const k = 0.04 + 0.07 * rnd(i + 0.83) ** 2;
    s.lump(a * 6.2, k * 0.35, e * r, k, dim(EARTH[i % 6], 0.75 + 0.3 * rnd(i + 5)), i + 500);
  }
  // splinters of wood in two rows, edge to edge: none quite like the next, leaning out, a few gone
  for (let i = 0; i < 46; i++) {
    const row = i % 2;
    if (i === 9 || i === 24 || i === 37) continue;
    const x = -5.35 + (i / 45) * 10.7 + (rnd(i) - 0.5) * 0.1;
    const len = ((row ? 5.35 : 4.75) - 0.012 * x * x) * (0.62 + 0.62 * rnd(i + 3) ** 0.8);
    const z0 = row ? -0.42 : 0.42;
    const tilt = (rnd(i + 7) - 0.5) * 0.3;
    const lean = (row ? -1 : 1) * (0.07 + 0.26 * rnd(i + 11));
    const t = WOOD[(i * 3 + row) % 5];
    const n = 14;
    const rows = 9;
    const from = s.p.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let k = 0; k <= n; k++) {
        const v = j / rows;
        const a = (k / n) * Math.PI * 2;
        const w = (0.4 - 0.25 * v ** 3) * (1 + 0.2 * noise(Math.cos(a) * 2 + i * 9, v * 1.4, Math.sin(a) * 2));
        const h = v * len + (j === rows ? 0.16 * Math.cos(a + i) + 0.08 * Math.cos(a * 3) : 0) - 0.3;
        // (the split face, pale; its end, dark)
        const face = 1 + 0.35 * clamp(Math.sin(a + i) * 2);
        const c = (0.72 + 0.3 * noise(Math.cos(a) * 3.5 + i * 5, v * 0.9, Math.sin(a) * 3.5) + 0.22 * noise(a * 7 + i * 3, v * 1.6, 3)) * face * (1 - 0.5 * ss(0.72, 1, v));
        s.p.push(x + Math.cos(a) * w * (j === rows ? 0.5 : 1) + tilt * v * len, h, z0 + Math.sin(a) * w * (j === rows ? 0.5 : 1) + lean * v * v * len);
        s.n.push(Math.cos(a), 0.06, Math.sin(a));
        s.c.push(t[0] * c, t[1] * c, t[2] * c);
        s.l.push(0.62, 0.04);
      }
    for (let j = 0; j < rows; j++)
      for (let k = 0; k < n; k++) {
        const a = from + k + j * (n + 1);
        s.i.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    // (its torn end)
    const top = from + rows * (n + 1);
    for (let k = 1; k + 1 < n; k++) s.i.push(top, top + k + 1, top + k);
  }
  // bits of leaf, cut round, pressed on both sides
  const green: readonly V[] = [[0.05, 0.1, 0.02], [0.08, 0.12, 0.024], [0.12, 0.11, 0.022], [0.06, 0.085, 0.03]];
  s.rough = 0.55;
  s.glow = 0.12;
  for (let i = 0; i < 24; i++) {
    const side = i % 2 ? 1 : -1;
    const x = -4.7 + (Math.floor(i / 2) / 11) * 9.4 + (rnd(i) - 0.5) * 0.7;
    // (low, between the stakes, a few higher)
    const y = 0.95 + 1.9 * rnd(i + 3) ** 2.2;
    const q = new Soup();
    q.rough = 0.55;
    q.glow = 0.12;
    const t = green[i % 4];
    q.sheet(
      (u, v) => {
        const a = 0.4 + u * 4.5;
        const r = v * 0.72 * (1 + 0.04 * Math.sin(a * 9));
        const X = Math.cos(a) * r;
        const Y = Math.sin(a) * r;
        // (folded along its middle, bent back along it)
        return [X * 1.1, Y, 0.28 * X * X + 0.22 * Math.abs(X) + 0.12 * Y * Y - 0.04 * Math.abs(Math.sin(Y * 6))];
      },
      16,
      4,
      (u, v) => dim(t, 0.75 + 0.35 * v + 0.2 * noise(u * 20, v * 3, i)),
    );
    s.put(q, pose(x, y, side * (1.3 - 0.06 * (y - 1.9)), -0.1 + 0.3 * (rnd(i + 2) - 0.5), (side > 0 ? 0 : Math.PI) + 0.6 * (rnd(i + 4) - 0.5), rnd(i + 9) * 6.28, 0.85 + 0.45 * rnd(i + 6)));
  }
  return s.done();
}

/** A small ant, a few hundred triangles. */
function smallAnt(body: V = [0.13, 0.03, 0.012]): Soup {
  const s = new Soup();
  s.rough = 0.34;
  s.glow = 0.12;
  const leg: V = [0.075, 0.024, 0.012];
  s.ball(0, 0.04, -0.82, 0.4, 0.36, 0.56, body, 8, 6);
  s.ball(0, 0.02, 0, 0.23, 0.22, 0.38, dim(body, 1.2), 7, 5);
  s.ball(0, 0.06, 0.62, 0.32, 0.28, 0.32, body, 8, 6);
  s.ball(0.2, 0.18, 0.78, 0.085, 0.085, 0.085, [0.005, 0.004, 0.004], 6, 4);
  s.ball(-0.2, 0.18, 0.78, 0.085, 0.085, 0.085, [0.005, 0.004, 0.004], 6, 4);
  for (const k of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = 0.25 - i * 0.26;
      const a: V = [k * 0.15, 0, z];
      const b: V = [k * 0.6, 0.28, z + (1 - i) * 0.28];
      const c: V = [k * 0.88, -0.28, z + (1 - i) * 0.5];
      const d: V = [k * 1.0, -0.55, z + (1 - i) * 0.58];
      s.rod(a, b, 0.065, leg, 4, 0.8);
      s.rod(b, c, 0.052, leg, 4, 0.75);
      s.rod(c, d, 0.04, leg, 4, 0.6);
    }
    s.rod([k * 0.1, 0.25, 0.82], [k * 0.34, 0.46, 1.02], 0.035, leg, 4);
    s.rod([k * 0.34, 0.46, 1.02], [k * 0.46, 0.34, 1.34], 0.028, leg, 4, 0.6);
    s.rod([k * 0.13, -0.02, 0.88], [k * 0.05, -0.06, 1.12], 0.05, leg, 4, 0.5);
  }
  return s;
}

function livingBridge(): Model {
  const s = new Soup();
  // (not all alike: red brown, near black, a few redder)
  const ants = [smallAnt(), smallAnt([0.035, 0.012, 0.008]), smallAnt([0.27, 0.06, 0.016]), smallAnt([0.1, 0.035, 0.018])];
  const pick = (k: number): Soup => { const r = rnd(k + 0.77); return ants[r < 0.32 ? 1 : r < 0.5 ? 2 : r < 0.68 ? 3 : 0]; };
  /** A few are bigger: soldiers among them. */
  const big = (k: number): number => (rnd(k + 0.19) < 0.09 ? 1.3 : 1);
  // those it is walked on: rows of them along the span, head to tail, their backs the deck
  for (let l = 0; l < 5; l++)
    for (let i = -1; i < 16; i++) {
      const x = 0.2 + (i + (l % 2) * 0.5) * 0.98 + 0.12 * (rnd(i * 5 + l + 9) - 0.5);
      const z = (l - 2) * 0.96 + 0.12 * (rnd(i + l * 5 + 9) - 0.5);
      if (x < 0.5 || (x > LONG - 0.2 && rnd(i * 3 + l + 4) < 0.5)) continue;
      // (along the span, near enough: a deck, not a heap)
      const turn = 0.3 * (rnd(x * 7 + l) - 0.5);
      s.put(pick(i * 7 + l * 3), along(x, -0.3 - 0.1 * Math.sin(Math.PI * clamp(x / LONG)) - 0.03 * rnd(i * 3 + l + 5) - 0.5 * Math.max(0, Math.max(-x, x - LONG)), z, 1, 0, turn, 0.82 * (0.8 + 0.36 * rnd(i * 11 + l)) * big(i * 7 + l * 3) * (l === 0 || l === 4 ? 1.15 : 1), (l - 2) * -0.1), (0.88 + 0.4 * rnd(i * 2 + l * 9 + 3)) * (l === 0 || l === 4 ? 1.08 : 1));
    }
  // those that hang on them: chains, down to an arch that is deep at its ends
  const arch = (x: number): number => { const t = Math.abs((x / LONG) * 2 - 1); return -0.75 - 1.75 * t ** 2.2; };
  for (let i = 0; i < 150; i++) {
    const x = 0.35 + rnd(i) * (LONG - 0.7);
    const down = i < 70 ? 0.82 + 0.18 * rnd(i + 0.4) : rnd(i + 0.4);
    const y = -0.62 + down * (arch(x) + 0.62);
    const edge = rnd(i + 0.95) < 0.45;
    const z = edge ? (rnd(i + 0.8) < 0.5 ? -1 : 1) * (DECK - 0.75) * (1 - 0.2 * down) : (rnd(i + 0.8) - 0.5) * 2 * (DECK - 0.6);
    s.put(pick(i * 13 + 1), along(x, y, z, rnd(i + 2) - 0.5, (rnd(i + 3) - 0.5) * 1.1, (rnd(i + 5) - 0.5) * 0.9, 0.74 * (0.88 + 0.24 * rnd(i + 9)), Math.PI * (0.65 + 0.7 * rnd(i + 6))), 0.42 + 0.3 * rnd(i + 8));
  }
  // (what is between them)
  s.rough = 0.8;
  s.glow = 0;
  s.field((x, y, z) => smax(smax(Math.max(y + 0.36, Math.min(arch(x) + 0.5, -1.0) - y), Math.abs(z) - DECK + 0.5, 0.3), Math.abs(x - LONG / 2) - LONG / 2 + 0.9, 0.4) + 0.12 * noise(x * 2, y * 2, z * 2), [-0.1, -2.8, -2.4], [LONG + 0.1, 0, 2.4], 0.16, () => [0.02, 0.006, 0.003]);
  return s.done();
}

function anthill(): Model {
  const s = new Soup();
  s.rough = 0.93;
  const mouth: Field = (x, y, z) => capsule(x, y, z, [0, 0.45, -1.2], [0, 1.15, 2.2], 1.02, 1.1);
  const hill: Field = (x, y, z) => {
    const r = Math.hypot(x, z * 0.95);
    let d = (y + 0.3 - 2.95 * Math.exp(-((r / 2.15) ** 2.4))) * 0.58;
    const q = Math.hypot(Math.hypot(x, y - 1.15) - 1.3, (z - 1.2 + 0.25 * (1.15 - y)) * 0.85);
    d = smin(d, Math.max(q - 0.44 - (y > 1.5 ? 0.12 : 0), 0.05 - y), 0.5);
    // (a crater on top, its rim raised, a hole down it)
    d = smin(d, Math.hypot(Math.hypot(x, z) - 0.55, y - 2.55) - 0.2, 0.3);
    d = smax(d, -Math.max(Math.hypot(x, z) - 0.27, 1.9 - y), 0.12);
    return d + 0.1 * noise(x * 1.6, y * 1.6, z * 1.6);
  };
  const grains = soil(hill, 5.5, 0.06);
  s.field((x, y, z) => smax(grains(x, y, z), -mouth(x, y, z) * 0.9, 0.12), [-3.7, -0.1, -3.7], [3.7, 3.4, 3.7], 0.068, soilPaint(5.5, (x, y, z) => (mouth(x, y, z) < 0.12 ? 0.1 + 0.5 * ss(0.4, 2.0, z) : 1) * (y > 2.0 ? 0.15 + 0.85 * ss(0.3, 0.6, Math.hypot(x, z)) : 1)));
  for (let i = 0; i < 150; i++) {
    const a = rnd(i) * 6.28;
    const r = 2.9 + 1.3 * rnd(i + 0.4) ** 2;
    const k = 0.07 + 0.11 * rnd(i + 0.8) ** 2;
    s.lump(Math.cos(a) * r, k * 0.4, Math.sin(a) * r, k, dim(EARTH[i % 6], 0.7 + 0.5 * rnd(i + 3)), i);
  }
  // (fine crumbs heaped round its crater)
  for (let i = 0; i < 46; i++) {
    const a = rnd(i + 0.61) * 6.28;
    const r = 0.45 + 0.45 * rnd(i + 0.71);
    const k = 0.035 + 0.04 * rnd(i + 0.81);
    s.lump(Math.cos(a) * r, 2.62 - 0.35 * (r - 0.45) + k * 0.3, Math.sin(a) * r, k, dim(EARTH[i % 6], 0.9 + 0.3 * rnd(i + 2)), i + 300);
  }
  floor(s, 0.95, 1.9, [0.13, 0.07, 0.032]);
  s.rough = 0.93;
  for (let i = 0; i < 90; i++) {
    const a = rnd(i + 0.15) * 6.28;
    const r = 1.2 * Math.sqrt(rnd(i + 0.35));
    const k = 0.05 + 0.08 * rnd(i + 0.8) ** 2;
    s.lump(Math.sin(a) * r * 0.8, 0.1, 0.8 + Math.cos(a) * r * 1.2, k, dim(EARTH[i % 6], 0.6), i);
  }
  // needles in it
  for (let i = 0; i < 20; i++) {
    const a = rnd(i + 0.2) * 6.28;
    const r = 1.3 + 1.6 * rnd(i + 0.6);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > 0.6 && Math.abs(x) < 1.9) continue;
    const y = 2.7 * Math.exp(-((r / 2.15) ** 2.4));
    const b = a + (rnd(i + 2) - 0.5) * 1.6;
    const t = dim(WOOD[i % 5], 0.7);
    s.rod([x - Math.cos(b) * 0.45, y + 0.08, z - Math.sin(b) * 0.45], [x, y + 0.1, z], 0.028, t, 5);
    s.rod([x, y + 0.1, z], [x + Math.cos(b) * 0.5, y - 0.3, z + Math.sin(b) * 0.5], 0.028, t, 5, 0.4);
  }
  return s.done();
}

// ---------------------------------------------------------------- spiders

const SILK: V = [0.52, 0.505, 0.465];
/** The colour of a felted sheet of silk: fine threads two ways. */
const felt = (u: number, v: number, w: number): V => {
  const s = 0.78 + 0.07 * Math.sin(u * 7 + 3 * noise(u, v, w)) * Math.sin(v * 11) + 0.1 * noise(u * 5, v * 1.2, w) + 0.07 * noise(u * 1.1, v * 6, w + 4);
  return dim([0.5, 0.487, 0.45], s);
};

function silkCurtain(): Model {
  const s = new Soup();
  s.rough = 0.42;
  s.glow = 0.1;
  const posts: readonly V[] = [-5.2, -2.6, 0, 2.6, 5.2].map((x, k) => [x, [4.9, 5.5, 5.15, 5.6, 4.9][k], 0] as const);
  const top = (x: number): number => {
    const u = Math.max(0, Math.min(3.999, (x + 5.2) / 2.6));
    const i = Math.floor(u);
    const t = u - i;
    return posts[i][1] + (posts[i + 1][1] - posts[i][1]) * t - 0.1 - 2 * t * (1 - t);
  };
  // a lid between the two sheets, sagging between the posts
  s.sheet((u, v) => { const x = -5.35 + u * 10.7; const t = ((x + 5.2) / 2.6) % 1; const w = 0.62 * (0.84 + 0.24 * Math.sin(Math.PI * Math.abs(t)) ** 2); return [x, top(x) - 0.02 - 0.12 * Math.sin(Math.PI * v), (1 - 2 * v) * w]; }, 120, 8, (u, v) => felt(u * 26, v * 2, 5));
  for (let k = 0; k < 60; k++) { const x = -5.2 + (k / 59) * 10.4; s.line(path(6, -0.6, 0.6, (z) => [x + 0.2 * z * (rnd(k) - 0.5) * 4, top(x) - 0.1 * Math.cos(z * 2.6), z] as const), 0.02, dim(SILK, 1.1)); }
  // two sheets, drawn in at the posts
  for (const side of [-1, 1]) {
    const at = (u: number, v: number): V => {
      const x = -5.35 + u * 10.7;
      const y = -0.5 + v * (top(x) + 0.5);
      const t = ((x + 5.2) / 2.6) % 1;
      const belly = Math.sin(Math.PI * Math.abs(t)) ** 2;
      const z = side * ((0.84 + 0.24 * belly) * (1 - 0.4 * v ** 8) + 0.32 * Math.exp(-Math.max(0, y) * 3));
      const e = Math.min(1, Math.min(u, 1 - u) * 30);
      return [x, y, z * (0.25 + 0.75 * Math.sqrt(e)) + 0.05 * noise(x * 1.2, y * 0.6, side)];
    };
    // (greyer where it meets the ground: dust in it)
    s.sheet((u, v) => at(side > 0 ? u : 1 - u, v), 120, 34, (u, v) => {
      // (greyer in its folds, by the posts)
      const t = ((-5.35 + (side > 0 ? u : 1 - u) * 10.7 + 5.2) / 2.6) % 1;
      const fold = 0.8 + 0.2 * Math.sin(Math.PI * Math.abs(t)) ** 2;
      return dim(felt(u * 26, v * 12, side), (0.72 + 0.28 * ss(0.02, 0.16, v)) * fold);
    });
    for (let k = 0; k <= 120; k++) {
      const lean = (rnd(k + side * 7) - 0.5) * 0.16;
      s.line(path(9, 0, 1, (v) => { const p = at(clamp(k / 120 + lean * (1 - v) * v * 2), v); return [p[0], p[1], p[2] + side * 0.025] as const; }), 0.014 + 0.016 * rnd(k), dim(SILK, 0.8 + 0.5 * rnd(k + 4)));
    }
    s.line(path(80, 0, 1, (u) => { const p = at(u, 0.035); return [p[0], p[1], p[2] + side * 0.035] as const; }), 0.035, dim(SILK, 1.18));
    for (let k = 1; k <= 17; k++) s.line(path(64, 0, 1, (u) => { const p = at(u, Math.min(1, k / 17 + 0.02 * Math.sin(u * 40 + k * 3))); return [p[0], p[1], p[2] + side * 0.03] as const; }), 0.016, dim(SILK, 1.05));
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) s.line(path(12, i / 4, (i + 1) / 4, (u) => { const p = at(u, 1 - 0.03 * k); return [p[0], p[1], p[2] + side * 0.03] as const; }), 0.045 - 0.008 * k, SILK);
  }
  // the posts: wound round and round
  s.field(
    (x, y, z) => {
      let d = 9;
      for (const [a, h] of posts) d = Math.min(d, smax(Math.hypot(x - a - 0.08 * Math.sin(y * 1.4 + a), z) - (0.2 - 0.08 * Math.exp(-Math.max(0, y) * 3) + 0.08 * Math.exp(-(((y - h + 0.3) / 0.35) ** 2))) + 0.018 * Math.sin(y * 21 + 2 * Math.atan2(z, x - a)) + 0.012 * noise(x * 3, y * 2, z * 3), y - h, 0.2));
      return d * 0.8;
    },
    [-6.2, -0.5, -1],
    [6.2, 5.9, 1],
    0.075,
    (x, y, z) => dim(SILK, 0.72 + 0.2 * Math.sin(y * 34 + x * 6 + 4 * noise(x * 2, y * 2, z))),
  );
  // guys, each on a pad
  // (its hem: threads loose along the ground)
  for (const side of [-1, 1])
    for (let k = 0; k < 70; k++) {
      const x = -5.2 + (k / 69) * 10.4 + 0.1 * (rnd(k + side) - 0.5);
      const z = side * (1.05 + 0.1 * rnd(k * 3 + side));
      const l = 0.15 + 0.35 * rnd(k + side * 9);
      const t = (rnd(k * 7 + side) - 0.5) * 1.2;
      s.line([[x, 0.12, z], [x + Math.sin(t) * l * 0.5, 0.03, z + side * l * 0.5], [x + Math.sin(t) * l, 0.012, z + side * l * Math.cos(t)]], 0.01 + 0.008 * rnd(k + 0.4), dim(SILK, 0.75 + 0.3 * rnd(k + 2)), 4);
    }
  for (const [a, h] of posts)
    for (const [dx, dz] of a === 0 ? [[0.5, -2.6]] : [[Math.sign(a) * 0.9, 2.3], [Math.sign(a) * 0.5, -2.5]]) {
      s.line(sag([a, h - 0.25, 0], [a + dx, 0.02, dz], 0.1), 0.028, SILK);
      // (made fast with a knot and threads fanned out over the ground)
      s.ball(a + dx, 0.04, dz, 0.1, 0.06, 0.1, dim(SILK, 0.9), 8, 4);
      for (let f = 0; f < 6; f++) {
        const t = f * 1.047 + rnd(a + dz + f) * 0.8;
        const l = 0.18 + 0.22 * rnd(a * 3 + f + dz);
        s.line([[a + dx, 0.03, dz], [a + dx + Math.cos(t) * l * 0.5, 0.025, dz + Math.sin(t) * l * 0.5 + 0.03], [a + dx + Math.cos(t) * l, 0.015, dz + Math.sin(t) * l]], 0.012, dim(SILK, 0.95), 4);
      }
    }
  return s.done();
}

function silkSpan(): Model {
  const s = new Soup();
  s.rough = 0.4;
  s.glow = 0.2;
  // a felted deck, flat where it is walked on; its edges turn up a little, its belly hangs
  const edge = DECK + 0.1;
  const deck = (x: number, v: number): V => [x, 0.4 * Math.abs(v) ** 9 + 0.012, v * edge];
  const belly = (x: number, v: number): V => [x, 0.4 * Math.abs(v) ** 9 - 0.08 - (1 - v ** 4) * (0.22 + 0.14 * Math.sin((x / LONG) * Math.PI) + 0.04 * Math.sin(x * 2.1 + v * 3)), v * edge];
  s.sheet((u, v) => deck(u * LONG, 1 - 2 * v), 100, 26, (u, v) => dim(felt(u * 30, v * 9, 1), 0.72 * (0.88 + 0.12 * Math.sin(u * 7.3 + 1) + 0.06 * Math.sin(u * 17.1)) * (1 - 0.14 * Math.exp(-(((v - 0.5) / 0.18) ** 2)))));
  // (its belly is a net of threads: the light comes through it)
  for (let k = 0; k <= 12; k++) {
    const v = -1 + k / 6;
    s.line(path(48, 0, LONG, (x) => belly(x, Math.max(-1, Math.min(1, v + 0.05 * Math.sin(x * 1.3 + k))))), 0.014 + 0.008 * rnd(k + 0.3), dim(SILK, 0.85 + 0.25 * rnd(k)), 4);
  }
  for (let k = 0; k <= 30; k++) {
    const x0 = (k / 30) * LONG;
    const lean = (rnd(k + 0.7) - 0.5) * 0.5;
    s.line(path(14, -1, 1, (v) => belly(Math.max(0, Math.min(LONG, x0 + lean * v)), v)), 0.011 + 0.008 * rnd(k + 0.1), dim(SILK, 0.8 + 0.3 * rnd(k + 2)), 4);
  }
  for (const u of [0, 1]) s.sheet((a, b) => { const p = deck(u * LONG, 2 * a - 1); const q = belly(u * LONG, 2 * a - 1); return [p[0], p[1] + (q[1] - p[1]) * (u ? 1 - b : b), p[2]]; }, 20, 2, (a, b) => felt(a * 9, b, 3));
  const on = (x: number, v: number): V => { const p = deck(x, v); return [p[0], p[1] + 0.022, p[2]]; };
  for (let k = 0; k <= 6; k++) s.line(path(34, 0, LONG, (x) => on(x, Math.max(-1, Math.min(1, -1 + k / 3 + 0.06 * Math.sin(x * 0.9 + k * 2))))), 0.028, dim(SILK, 1.2));
  for (let k = 0; k < 46; k++) {
    const x = rnd(k) * LONG;
    const d = (rnd(k + 0.4) - 0.5) * 4;
    s.line(path(10, -1, 1, (v) => on(Math.max(0, Math.min(LONG, x + d * v)), v)), 0.013 + 0.012 * rnd(k + 7), dim(SILK, 1.05));
  }
  for (let k = 0; k <= 22; k++) for (let j = 0; j < 10; j++) s.line(path(4, -1 + j / 5, -0.8 + j / 5, (v) => on(Math.max(0, Math.min(LONG, (k / 22) * LONG + 0.16 * (1 - (v * 10 + 9 - j * 2) ** 2) + 0.12 * (rnd(k * 10 + j) - 0.5))), v)), 0.024 + 0.012 * rnd(k + j * 23), dim(SILK, 1.15));
  // threads hanging under it, a few loose
  for (let k = 0; k < 22; k++) {
    const x = 0.4 + rnd(k + 0.21) * (LONG - 0.8);
    const v = (rnd(k + 0.33) - 0.5) * 1.7;
    const p = belly(x, v);
    const l = 0.15 + 0.8 * rnd(k + 0.47) ** 2;
    // (curling as it hangs, thinner to its end)
    const c = (rnd(k + 0.6) - 0.5) * 0.4;
    s.line([p, [p[0] + c * 0.4, p[1] - l * 0.3, p[2] + 0.04], [p[0] + c, p[1] - l * 0.65, p[2] - c * 0.3], [p[0] + c * 0.5, p[1] - l, p[2] + c * 0.6]], 0.009 + 0.006 * rnd(k + 0.9), dim(SILK, 1.1), 4);
  }
  for (const e of [-1, 1]) {
    for (let j = 0; j < 3; j++) s.line(path(110, 0, LONG, (x) => { const p = deck(x, e); return [x, p[1] + 0.065 * Math.sin(x * 5 + j * 2.094), p[2] + 0.065 * Math.cos(x * 5 + j * 2.094)] as const; }), 0.06, dim(SILK, 0.95 + 0.12 * j), 5);
    // a rail of cable along each side, hung from its edge by threads
    const rail = (x: number): V => { const p = deck(x, e); return [x, p[1] + 0.06 + (0.44 - 0.12 * Math.sin((x / LONG) * Math.PI)) * ss(0, 1.4, Math.min(x, LONG - x)) + 0.05 * Math.sin(x * 1.7 + e), p[2] * 1.04]; };
    s.line(path(90, 0.15, LONG - 0.15, (x) => rail(x)), 0.045, dim(SILK, 1.1), 6);
    for (let k = 0; k < 19; k++) {
      if (rnd(k * 5 + e + 0.5) < 0.5) continue;
      const x = 0.4 + (k / 18) * (LONG - 0.8) + 0.45 * (rnd(k * 3 + e) - 0.5);
      const p = deck(x, e * 0.97);
      const q = rail(x + 0.25 * (rnd(k + e * 5) - 0.5));
      s.line([[p[0], p[1] + 0.03, p[2]], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 + e * 0.03], q], 0.006 + 0.008 * rnd(k + e * 2.5) * (0.4 + 0.6 * Math.abs((x / LONG) * 2 - 1)), dim(SILK, 1.1), 4);
    }
    // it is made fast at both ends
    for (let k = 0; k <= 8; k++) {
      const x = e > 0 ? LONG : 0;
      if (e > 0) {
        // (its far end may hang in the air: threads that curl under)
        const p = on(x, -0.95 + k * 0.2375);
        const l = 0.35 + 0.5 * rnd(k + 3);
        s.line([p, [p[0] + 0.22, p[1] - 0.06, p[2]], [p[0] + 0.3, p[1] - 0.2 - l * 0.4, p[2] + 0.1 * (rnd(k) - 0.5)], [p[0] + 0.16, p[1] - 0.25 - l, p[2] + 0.2 * (rnd(k + 9) - 0.5)]], 0.03, SILK, 5);
        continue;
      }
      const p = on(x, -0.95 + k * 0.2375);
      const q: V = [x + e * (0.5 + 0.35 * rnd(k + e + 2)) * (k === 0 || k === 8 ? 1.6 : 1), p[1] - (e > 0 ? 0.35 : 0.04), p[2] * (k === 0 || k === 8 ? 1.6 : 1.15)];
      s.line(sag(p, q, 0.04, 4), 0.03, SILK, 5);
      s.ball(q[0], q[1], q[2], 0.08, 0.05, 0.08, dim(SILK, 0.9), 8, 4);
      for (let f = 0; f < 5; f++) {
        const t = f * 1.256 + rnd(k + f + e) * 0.9;
        const l = 0.15 + 0.25 * rnd(k * 3 + f + e);
        s.line([q, [q[0] + Math.cos(t) * l * 0.5, q[1] - 0.01, q[2] + Math.sin(t) * l * 0.5], [q[0] + Math.cos(t) * l, q[1] - 0.025, q[2] + Math.sin(t) * l]], 0.012, dim(SILK, 0.95), 4);
      }
    }
  }
  // dew on its threads
  s.rough = 0.06;
  s.glow = 0.6;
  for (let k = 0; k < 34; k++) {
    const p = on(0.3 + rnd(k + 0.71) * (LONG - 0.6), (rnd(k + 0.83) - 0.5) * 1.9);
    const r = 0.025 + 0.035 * rnd(k + 0.91) ** 2;
    s.ball(p[0], p[1] + r * 0.6, p[2], r, r * 0.85, r, [0.62, 0.66, 0.7], 8, 5);
  }
  return s.done();
}

function silkFunnel(): Model {
  const s = new Soup();
  s.rough = 0.3;
  s.glow = 0.16;
  const MY = 1.02;
  const MR = 1.42;
  const MZ = 1.55;
  const f: Field = (x, y, z) => {
    let d = (Math.hypot(x / 2.5, y / 2.55, (z + 0.55) / 2.75) - 1) * 2.3;
    for (const [px, pz, h] of [[-1.4, -0.4, 2.65], [1.45, -0.5, 2.45], [0, -1.8, 2.8], [0, 0.6, 2.85]]) d = smin(d, Math.hypot(x - px, z - pz) - 0.015 - 0.2 * Math.max(0, h + 0.25 - y) + Math.max(0, y - h + 0.05) * 3, 0.4);
    const q = Math.hypot(x, y - MY) - MR;
    d = smin(d, Math.hypot(q, z - MZ) - 0.2, 0.75);
    d = smin(d, y + 0.28 - 0.6 * Math.exp(-Math.max(0, Math.hypot(x, z) - 2.2) * 1.6), 0.5);
    const a = Math.atan2(x, z);
    d += 0.016 * noise(a * 16 + y * 3, y * 2.5, 3) + 0.016 * noise(a * 3, y * 13 + a * 4, 8) + 0.05 * noise(x * 1.5, y * 1.5, z * 1.5);
    // (it sags between the posts that hold it up)
    let near = 9;
    for (const [px, pz] of [[-1.4, -0.4], [1.45, -0.5], [0, -1.8], [0, 0.6]]) near = Math.min(near, Math.hypot(x - px, z - pz));
    d += 0.2 * ss(0.5, 1.5, near) * ss(1.2, 2.3, y);
    return smax(smax(d, -smax(q + 0.17, -(z + 1.1), 0.2), 0.1), -0.1 - y, 0.05) * 0.75;
  };
  s.field(f, [-3.6, -0.12, -3.8], [3.6, 3.2, 3.2], 0.07, (x, y, z, _a, ny) => {
    const a = Math.atan2(x, z);
    const inside = Math.hypot(x, y - MY) < MR && z < MZ + 0.1 && (z > 0.9 || Math.hypot(x / 2.5, y / 2.55, (z + 0.55) / 2.75) < 0.95) ? Math.max(0.05, 0.5 - (MZ - z) * 0.42) : 1;
    return dim(SILK, (0.62 + 0.2 * noise(a * 16 + y * 3, y * 2.5, 3) + 0.22 * noise(a * 3, y * 13 + a * 4, 8) + 0.1 * noise(x * 4, y * 4, z * 4)) * inside * (0.85 + 0.15 * ny));
  });
  floor(s, 0.3, 1.75, [0.1, 0.095, 0.085]);
  // threads wound round it: from a point inside, out to its skin
  const skin = (a: number, b: number): V | null => {
    const dx = Math.sin(a) * Math.cos(b);
    const dy = Math.sin(b);
    const dz = Math.cos(a) * Math.cos(b);
    let lo = 0.2;
    let hi = 4.5;
    const at = (t: number): number => f(dx * t, 0.5 + dy * t, -0.5 + dz * t);
    if (dz > 0.45 && dy < 0.75) return null;
    // (the first place from outside in)
    while (hi > lo && at(hi) > 0) hi -= 0.05;
    const t = hi + 0.035;
    return [dx * t, 0.5 + dy * t, -0.5 + dz * t];
  };
  for (let k = 0; k < 60; k++) {
    const a0 = rnd(k + 0.1) * 6.28;
    const b0 = -0.1 + rnd(k + 0.2) * 1.2;
    const da = (rnd(k + 0.3) - 0.5) * 3.4;
    const db = (rnd(k + 0.4) - 0.5) * 1.1;
    let last: V | null = null;
    for (let i = 0; i <= 26; i++) {
      const p = skin(a0 + (da * i) / 26, Math.min(1.4, Math.max(-0.12, b0 + (db * i) / 26)));
      if (p && last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.9) s.rod(last, p, 0.011 + 0.012 * rnd(k + 5), dim(SILK, 1.45), 4);
      last = p;
    }
  }
  // an apron of threads before it
  for (let k = 0; k <= 30; k++) {
    const a = -1.15 + (k / 30) * 2.3;
    // (uneven; a few broken short)
    const r = (2.6 + 1.1 * rnd(k)) * (rnd(k + 0.5) < 0.2 ? 0.7 : 1);
    const end: V = [Math.sin(a + 0.06 * (rnd(k + 0.9) - 0.5)) * r * 1.2, 0.03, 0.9 + Math.cos(a) * r];
    // (greyer to its rim, where it is thinnest)
    s.line(sag([Math.sin(a) * 1.25, 0.03, 1.75], end, -0.04, 5), 0.011, dim(SILK, 0.85));
  }
  for (let j = 0; j < 6; j++) s.line(path(30, -1.1, 1.1, (a) => { const r = 1.75 + j * 0.28; return [Math.sin(a) * r * 1.15, 0.07 - j * 0.006, 0.95 + Math.cos(a) * (r + 0.09 * Math.sin(a * 7 + j * 2) + 0.05 * Math.sin(a * 17 + j))] as const; }), 0.011, dim(SILK, 1 - 0.08 * j));
  for (const [x, y, z, ex, ez] of [[-1.4, 2.82, -0.4, -3.7, 0.6], [1.45, 2.62, -0.5, 3.7, 0.2], [-1.4, 2.82, -0.4, -3.4, -2.2], [1.45, 2.62, -0.5, 3.4, -2.2], [0, 2.97, -1.8, 0.8, -4]] as const) {
    s.line(sag([x, y, z], [ex, 0.02, ez], 0.12), 0.014, SILK);
  }
  return s.done();
}

// ---------------------------------------------------------------- cockroaches

const CHITIN: readonly V[] = [[0.3, 0.074, 0.008], [0.2, 0.042, 0.006], [0.38, 0.105, 0.012]];
const LEG: V = [0.085, 0.024, 0.007];

/** A shield: wide, domed, with a pale rim, a ridge down its middle and two dark spots. */
function shield(w: number, h: number, dome: number, tone: V, spots: boolean, point = 0.6): Soup {
  const s = new Soup();
  s.rough = 0.17;
  s.glow = 0.14;
  const f: Field = (x, y, z) => {
    const u = x / w;
    const v = y / h;
    // (a pointed oval: narrow to its lower tip)
    const out = (Math.hypot(u * (1 + 0.15 * v) / (1 - point * Math.max(0, -v) ** 1.6), v * 0.98) - 0.82) * 1.1;
    const c = dome * (1 - u * u * 1.1 - v * v * 0.9) + 0.018 * Math.exp(-((x / 0.16) ** 2));
    const edge = 0.03 * Math.exp(-(((out + 0.05) / 0.06) ** 2));
    return smax(out, Math.abs(z - c) - 0.065 - edge, 0.05) * 0.75;
  };
  s.field(f, [-w * 1.15, -h * 1.05, -0.8], [w * 1.15, h * 1.05, dome + 0.4], 0.1, (x, y) => {
    const u = x / w;
    const v = y / h;
    const e = Math.hypot(u * (1 + 0.15 * v) / (1 - point * Math.max(0, -v) ** 1.6), v * 0.98);
    const k = (0.86 + 0.08 * noise(x * 2, y * 2, 2) + 0.04 * Math.sin(y * 20 + 2 * noise(x, y, 5)) + 0.16 * v);
    // (a deep shell, darker to its rim; light comes off it as a gloss, not from its colour)
    return dim(tone, 0.78 * k * (1 - 0.4 * ss(0.6, 0.8, e)));
  });
  // (faint marks, not eyes)
  if (spots) for (const e of [-1, 1]) s.ball(e * 0.3 * w, 0.2 * h, dome * (1 - 0.1 - 0.036) + 0.07, 0.17 * w, 0.2 * h, 0.03, dim(tone, 0.55), 18, 8);
  return s;
}
/** A leg's segment: thick to thin, with spines. */
function spiny(s: Soup, a: V, b: V, r: number, spines: number): void {
  s.rough = 0.4;
  s.glow = 0.05;
  s.rod(a, b, r, LEG, 7, 0.6);
  s.ball(a[0], a[1], a[2], r * 1.12, r * 1.12, r * 1.12, LEG, 8, 5);
  for (let k = 0; k < spines; k++) {
    const t = (k + 0.7) / spines;
    const p: V = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const q = k % 2 ? 1 : -1;
    s.rod(p, [p[0] + q * 0.2, p[1] - 0.1, p[2] + (k % 3 ? 0.1 : -0.12)], 0.032, dim(LEG, 0.7), 4, 0.1);
  }
}

function shieldWall(): Model {
  const s = new Soup();
  // (wide and round like the shield behind a cockroach's head, a little narrower to its lower edge)
  const plates = CHITIN.map((c) => shield(1.55, 1.3, 0.22, c, false, 0.18));
  for (const side of [1, -1])
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 8 - (r % 2); i++) {
        const x = (i - (7 - (r % 2)) / 2) * 1.36;
        // (each over its neighbour, each row over the one under it)
        const big = 0.8 + 0.36 * rnd(i * 5 + r * 3 + side * 7);
        s.put(plates[(i * 2 + r) % 3], pose(x + (rnd(i * 2 + r + side) - 0.5) * 0.25, 1.05 + r * 1.42 + (big - 1) * 0.8, side * (0.5 + r * 0.1 + (1.1 - big) * 0.3), -0.11 + (rnd(i + r * 4 + side) - 0.5) * 0.2, (side > 0 ? 0.2 : Math.PI + 0.2) + (rnd(i * 7 + r + side) - 0.5) * 0.28, (rnd(i + r * 9 + side) - 0.5) * 0.28, big), 0.7 + 0.55 * rnd(i * 3 + r + side));
      }
  for (const e of [-1, 1]) for (let r = 0; r < 3; r++) s.put(plates[(r + 1) % 3], pose(e * (5.5 + 0.06 * r), 1.05 + r * 1.42, 0, -0.08, e * (Math.PI / 2), 0, 0.62, 0.98, 1), 0.95);
  // what holds it up, between the two
  for (let i = -3; i <= 3; i++) {
    const x = i * 1.55;
    spiny(s, [x, 4.3, 0.1], [x + 0.1, 2.4, 0], 0.17, 4);
    spiny(s, [x + 0.1, 2.4, 0], [x - 0.05, -0.4, 0], 0.14, 4);
    s.rod([x - 0.8, 4.3, 0], [x + 0.8, 4.5, 0], 0.1, LEG, 6);
  }
  s.rough = 0.9;
  s.glow = 0;
  for (let i = 0; i < 260; i++) {
    const x = (rnd(i) * 2 - 1) * 5.7;
    const z = (rnd(i + 0.3) + rnd(i + 0.6) - 1) * 2.1;
    const k = 0.07 + 0.13 * rnd(i + 0.9) ** 2;
    s.lump(x, 0.22 * Math.exp(-(z * z) / 0.8) + k * 0.3, z, k, dim(EARTH[i % 6], 0.55), i);
  }
  return s.done();
}

/** A plate of a back, across z, its far edge over the next one. */
function tergite(tone: V, rough = 0.13): Soup {
  const s = new Soup();
  s.rough = rough;
  s.glow = -0.2;
  const W = DECK + 0.05;
  const f: Field = (x, y, z) => {
    const u = z / W;
    // (tilted up to its back edge, like a shingle, and domed across)
    const c = -0.16 + 0.08 * (1 - u * u) - 0.9 * Math.max(0, Math.abs(u) - 0.72) ** 1.5 * 3 + 0.13 * x;
    const bow = 0.18 * u * u;
    const back = 0.028 * Math.exp(-(((x - 0.66 + bow) / 0.08) ** 2));
    return smax(smax(Math.abs(y - c) - 0.09 - back, Math.abs(z) - W + 0.12 * (x - 0.5) ** 2, 0.06), Math.abs(x + bow - 0.05) - 0.78, 0.12) * 0.8;
  };
  return s.field(f, [-1.2, -1.2, -2.6], [1.1, 0.3, 2.6], 0.095, (x, y, z) => {
    const bow = 0.18 * (z / W) ** 2;
    const k = Math.max(ss(0.5, 0.72, x + bow), ss(1.95, 2.25, Math.abs(z)));
    // (red amber in its middle, near black at its edges, in the shadow of the one over it at its front; fine pits all over it)
    const a = 0.55 * Math.exp(-((z / 1.5) ** 2));
    const c: V = [(tone[0] + (0.5 - tone[0]) * a) * 1.1, (tone[1] + (0.085 - tone[1]) * a) * 0.8, (tone[2] + (0.014 - tone[2]) * a) * 0.8];
    return dim(c, (0.8 + 0.08 * noise(x * 1.2, y, z * 0.7) - 0.12 * Math.max(0, noise(x * 9, y * 9, z * 9))) * (1 - 0.7 * k) * (1 - 0.68 * ss(-0.1, -0.6, x + bow)) * (1 + 1.4 * ss(0.6, 0.67, x + bow) * ss(0.76, 0.69, x + bow)));
  });
}

function scaleWalk(): Model {
  const s = new Soup();
  const plates = [...CHITIN.map((c) => tergite(c)), ...CHITIN.map((c) => tergite(c, 0.32))];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const x = 0.65 + (i / (n - 1)) * (LONG - 1.3);
    s.put(plates[(i * 7) % 6], pose(x, 0.04 * (rnd(i + 4.1) - 0.5), 0, 0.05 * (rnd(i + 5.3) - 0.5), 0.05 * (rnd(i + 6.7) - 0.5), 0.07 * (rnd(i + 7.9) - 0.5)), 0.8 + 0.26 * rnd(i * 13.7 + 2.1));
    const out = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const e = i < (n - 1) / 2 ? -1 : 1;
    for (const k of [-1, 1]) {
      // legs folded under it, longer towards its ends
      const j = rnd(i * 2 + k + 5) - 0.5;
      const a: V = [x, -0.4, k * 1.2];
      const b: V = [x + e * 0.25 + j * 0.3, -0.95 - 0.35 * out + j * 0.2, k * (1.95 - 0.15 * out + j * 0.25)];
      const c: V = [x + e * (0.75 + 0.3 * out) + j * 0.5, -1.65 - 1.0 * out ** 2 - j * 0.3, k * (1.0 + 0.4 * out - j * 0.3)];
      spiny(s, a, b, 0.21, 2);
      spiny(s, b, c, 0.15, 4);
      s.rod(c, [c[0] + e * 0.35, c[1] - 0.05, c[2] - k * 0.1], 0.05, dim(LEG, 0.8), 5, 0.4);
    }
  }
  // a shield at its far end
  const end = shield(1.9, 1.35, 0.16, CHITIN[1], false, 0);
  s.put(end, pose(LONG - 0.15, -0.16, 0, -Math.PI / 2, -Math.PI / 2, 0, 0.98, 0.9, 0.8), 0.8);
  // its belly
  s.rough = 0.45;
  s.glow = 0.08;
  s.field(
    (x, y, z) => smax(smax(Math.hypot(y * 1.2 + 0.8, z * 0.6) - 1.05 + 0.07 * Math.cos((x - 0.1) * 5.5), y + 0.2, 0.15), Math.abs(x - LONG / 2) - LONG / 2 + 0.25, 0.3) * 0.75,
    [-0.1, -1.8, -2],
    [LONG + 0.1, 0.1, 2],
    0.11,
    (x) => dim([0.15, 0.045, 0.012], 0.8 + 0.35 * Math.cos((x - 0.1) * 5.5)),
  );
  return s.done();
}

function husk(): Model {
  const s = new Soup();
  s.rough = 0.2;
  s.glow = 0.16;
  const rx = 2.0;
  const ry = 1.5;
  const rz = 2.85;
  for (let k = 0; k < 7; k++) {
    const z0 = -2.55 + k * 0.75;
    const tone = CHITIN[k % 3];
    // (one plate pushed out of line as it was shed)
    const shed = k === 3 ? 0.1 : 0;
    const f: Field = (x, y0, z) => {
      const y = y0 - shed;
      const b = z + 0.3 * (x / rx) ** 2;
      const lift = 0.12 * (1 - (b - z0));
      const e = (Math.hypot(x / (rx + lift), y / (ry + lift), z / rz) - 1) * 1.45;
      const lip = 0.045 * Math.exp(-(((b - z0 - 0.06) / 0.08) ** 2));
      let d = smax(e - lip, -(e + 0.15 + lip), 0.06);
      d = smax(d, k === 6 ? z0 - b : k === 0 ? b - z0 - 0.92 : Math.max(z0 - b, b - z0 - 0.92), 0.06);
      // its front edge is up: what hides looks out
      d = smax(d, -(Math.hypot(x / 1.2, (y - 0.05) / 1.16, (z - 2.75) / 1.5) - 1), 0.12);
      // (split down its back, where the bug came out of it)
      d = smax(d, -(Math.abs(x + 0.05 * Math.sin(z * 3)) - 0.07 - 0.05 * Math.abs(Math.sin(z * 9 + k))) * (y > 1.0 && z < 1.4 ? 1 : 0) - (y > 1.0 && z < 1.4 ? 0 : 1), 0.03);
      return smax(d, 0.01 - y0, 0.06) * 0.8;
    };
    s.field(f, [-2.4, -0.1, k === 0 ? -3.1 : Math.max(-3.1, z0 - 0.8)], [2.4, 1.9, Math.min(3.1, z0 + 1.2)], 0.07, (x, y, z) => {
      const b = z + 0.3 * (x / rx) ** 2 - z0;
      const e = Math.max(clamp(1 - Math.abs(b) / 0.16), clamp((0.26 - y) / 0.12));
      const inside = Math.hypot(x / rx, y / ry, z / rz) < 0.95 && z < 1.9 ? 0.25 : 1;
      // (amber and pale where it is thin, dark brown to its edges and the split)
      const split = ss(0.25, 0.08, Math.abs(x)) * ss(0.9, 1.2, y);
      const amber: V = [tone[0] * 0.6 + 0.2, tone[1] * 0.6 + 0.085, tone[2] * 0.6 + 0.018];
      return dim(amber, (1.0 + 0.14 * noise(x * 2, y, z * 4) + 0.05 * Math.sin(x * 18)) * (1 - 0.62 * e) * (1 - 0.5 * split) * (1 + 0.35 * ss(1.0, 1.45, y)) * inside);
    });
  }
  // (the hollow legs it left, short stubs at its rim)
  for (const e of [-1, 1])
    for (const z of [-1.3, -0.2, 0.9]) {
      const a: V = [e * rx * 0.93, 0.18, z];
      const b: V = [e * (rx + 0.45), 0.05 + 0.1 * rnd(z + e), z + 0.25 * (rnd(z * 3 + e) - 0.5)];
      s.rough = 0.3;
      s.rod(a, b, 0.1, dim(CHITIN[2], 1.3), 6, 0.6);
      s.rod(b, [b[0] + e * 0.35, 0.02, b[2] + 0.2], 0.065, dim(CHITIN[2], 1.45), 5, 0.5);
    }
  return s.done();
}

// ---------------------------------------------------------------- bees

const WAX: V = [0.6, 0.27, 0.035];
const wax = (k: number, deep = 0): V => [WAX[0] * k * (1 - 0.55 * deep), WAX[1] * k * (1 - 0.72 * deep), WAX[2] * k * (1 - 0.85 * deep)];
const HONEY: V = [0.62, 0.17, 0.006];
/** Honey in a cell: a lens of it. */
function honey(s: Soup, x: number, y: number, z: number, rx: number, ry: number, rz: number, tone: V = HONEY): void {
  s.rough = 0.1;
  s.glow = 0.5;
  s.ball(x, y, z, rx, ry, rz, tone, 10, 7);
  s.rough = 0.4;
  s.glow = 0.2;
}
function drip(s: Soup, x: number, y: number, z: number, l: number): void {
  s.rough = 0.1;
  s.glow = 0.5;
  s.field((a, b, c) => smin(capsule(a, b, c, [x, y, z], [x, y - l, z], 0.1, 0.045), Math.hypot(a - x, b - y + l, c - z) - 0.12, 0.1), [x - 0.3, y - l - 0.3, z - 0.3], [x + 0.3, y + 0.25, z + 0.3], 0.065, () => HONEY);
  s.rough = 0.4;
  s.glow = 0.2;
}

function combWall(): Model {
  const s = new Soup();
  s.rough = 0.52;
  s.glow = 0.2;
  const C = 0.56;
  const W = 5.35;
  const T = 1.0;
  const top = (x: number): number => WALL_HIGH + 0.25 + 0.4 * Math.sin(x * 1.0 + 1) + 0.18 * Math.sin(x * 2.3) - 0.028 * x * x;
  const kind = (x: number, y: number): number => (Math.abs(x) > W - 0.45 || y > top(x) - 0.55 || y < 0.4 || ((Math.abs(x) > W - 1.1 || y > top(x) - 1.1) && rnd(x * 3.3 + y * 1.7) < 0.45) ? 3 : noise(x * 0.5, y * 0.5, 4) > 0.22 ? 2 : noise(x * 0.55 + 9, y * 0.55, 1) > -0.05 ? 1 : 0);
  const f: Field = (x, y, z) => {
    const az = Math.abs(z);
    let d = smax(smax(Math.abs(x) - W + 0.1 * noise(2, y, z), y - top(x), 0.45), az - T, 0.2) + 0.05 * noise(x * 1.3, y * 1.3, z * 1.3) + 0.035 * noise(x * 3.7, y * 3.7, z * 3.7);
    d = smin(d, smax(az - T - 0.55 * Math.exp(-Math.max(0, y) * 2.6) * (1 + 0.5 * noise(x * 1.2, 1, z)), smax(Math.abs(x) - W - 0.35 * Math.exp(-Math.max(0, y) * 3) - 0.2 * noise(3, y, z), y - 0.7, 0.3), 0.3), 0.35);
    if (az > 0.3 && Math.abs(d) < 0.8) {
      const h = hexAt(x, y, C);
      const r = h[2];
      const k = kind(h[0], h[1]);
      const inside = r - (C * 0.866 - 0.085);
      if (k < 2) d = smax(d, -Math.max(inside, 0.45 - az), 0.05);
      else if (k === 2) d = Math.min(d, smax(inside + 0.04, az - T - 0.11 + r * r * 0.45, 0.07));
    }
    return d;
  };
  s.field(f, [-6.1, -0.5, -2], [6.1, 5.9, 2], 0.09, (x, y, z) => {
    const deep = clamp((T - 0.02 - Math.abs(z)) / 0.4) * (Math.abs(x) < W - 0.4 && y < top(x) - 0.4 ? 1 : 0);
    const h = hexAt(x, y, C);
    return wax((0.82 + 0.24 * noise(x, y, z)) * (kind(h[0], h[1]) === 2 && Math.abs(z) > T ? 1.15 : 1), deep);
  });
  for (let r = 0; r < 9; r++)
    for (let q = -8; q < 9; q++) {
      const h = hexAt(C * Math.sqrt(3) * (q + (r % 2) / 2), C * 1.5 * r, C);
      const a = h[0];
      const b = h[1];
      if (Math.abs(a) > W || b > top(a) || kind(a, b) !== 1) continue;
      // (none filled quite like the next: lighter, darker, higher, lower)
      for (const e of [-1, 1]) {
        const v = rnd(a * 5 + b * 11 + e);
        const tone: V = [HONEY[0] * (0.75 + 0.45 * v), HONEY[1] * (0.6 + 1.2 * v), HONEY[2] * (0.5 + 2 * v)];
        honey(s, a, b - 0.08 * rnd(a + b + e), e * (0.42 + 0.34 * rnd(a * 7 + b * 3 + e)), C * 0.86, C * (0.8 + 0.15 * v), 0.3, tone);
      }
    }
  return s.done();
}

function combSpan(): Model {
  const s = new Soup();
  s.rough = 0.62;
  s.glow = 0.2;
  const C = 0.46;
  const under = (x: number): number => { const t = Math.abs((x / LONG) * 2 - 1); return -1.15 - 1.25 * t ** 3 - 0.28 * Math.max(0, Math.sin(x * 1.7 + 0.6)) * (1 - t); };
  const over = (x: number): number => Math.max(0, Math.abs(x - LONG / 2) - LONG / 2 + 0.25);
  const f: Field = (x, y, z) => {
    const az = Math.abs(z);
    const n = 0.05 * noise(x * 1.2, y * 1.2, z * 1.2);
    // (its deck is flat: that is what is walked on)
    let d = smax(smax(az - DECK + 0.05, smax(y + 0.02 + 0.9 * over(x) ** 2, under(x) - y, 0.12), 0.25), Math.abs(x - LONG / 2) - LONG / 2 - 0.35 - 0.15 * noise(3, y, z), 0.3) + (y < -0.2 ? n : 0);
    if (y < -0.42) {
      const h = hexAt(x, y + 0.4, C);
      d = smax(d, -Math.max(h[2] - (C * 0.866 - 0.085), DECK - 0.5 - az), 0.05);
    } else if (y > -0.2 && az < DECK - 0.15) {
      const h = hexAt(x, z, 0.5);
      d -= 0.07 * Math.max(0, 1 - Math.abs(h[2] - 0.433) * 9);
      // (a few cells capped: flat across)
      if (rnd(h[0] * 3.1 + h[1] * 7.3) > 0.14) d += 0.05 * Math.max(0, 1 - h[2] / 0.36);
    }
    return smin(d, smax(Math.hypot(az - DECK + 0.1, y + 0.02 + 0.9 * over(x) ** 2) - 0.15, Math.abs(x - LONG / 2) - LONG / 2 - 0.2, 0.15), 0.1);
  };
  s.field(f, [-0.7, -2.8, -2.6], [LONG + 0.7, 0.4, 2.6], 0.09, (x, y, z) => {
    const deep = clamp((DECK - 0.1 - Math.abs(z)) / 0.4) * (y < -0.4 ? 1 : 0);
    const h = hexAt(x, z, 0.5);
    const rimmed = y > -0.15 ? 1 - 0.35 * ss(0.12, 0.0, Math.abs(h[2] - 0.433)) : 1;
    const cell = rnd(h[0] * 3.1 + h[1] * 7.3);
    const top = y > -0.15;
    // (capped cells pale; some full of honey to their brims)
    if (top && cell > 0.14 && cell < 0.27 && h[2] < 0.36) return dim(HONEY, 0.7 + 0.6 * rnd(h[0] + h[1] * 3));
    const cup = top && cell > 0.14 ? 0.35 * ss(0.3, 0.05, h[2]) : 0;
    const own = top ? (cell <= 0.14 ? 1.22 : 0.66 + 0.6 * rnd(h[0] * 5.7 + h[1] * 2.9)) : 1;
    return wax((0.8 + 0.2 * noise(x, y, z)) * rimmed * own, Math.max(deep, cup + 0.12));
  });
  for (let r = -6; r < 1; r++)
    for (let q = -14; q < 34; q++) {
      const a = C * Math.sqrt(3) * (q + r / 2);
      const b = C * 1.5 * r - 0.4;
      if (a < 0.5 || a > LONG - 0.5 || b > -0.8 || b < under(a) + 0.3 || rnd(a * 3 + b * 7) > 0.4) continue;
      for (const e of [-1, 1]) honey(s, a, b, e * (DECK - 0.42), C * 0.84, C * 0.94, 0.26);
    }
  for (const [x, l] of [[2.2, 0.45], [3.4, 0.6], [5.5, 0.35], [7.6, 0.8], [9.4, 0.5], [11.2, 0.45], [12.6, 0.3]]) for (const e of [-1, 1]) drip(s, x + e * 0.4, under(x + e * 0.4) + 0.4, e * (DECK - 0.35 - 0.4 * rnd(x + e)), l * (0.8 + 0.5 * rnd(x * 3 + e)));
  return s.done();
}

function waxNest(): Model {
  const s = new Soup();
  s.rough = 0.28;
  s.glow = 0.2;
  const A: V = [2.2, 2.45, 2.2];
  // hexagons, laid round from its top
  const CELL = 0.27;
  const cell = (x: number, y: number, z: number): Float64Array => {
    const t = Math.acos(Math.max(-1, Math.min(1, y / A[1] / (Math.hypot(x / A[0], y / A[1], z / A[2]) || 1))));
    const l = Math.hypot(x, z) || 1;
    return hexAt((x / l) * t, (z / l) * t, CELL);
  };
  const full = (i: number, j: number): boolean => rnd(i * 5.3 + j * 11.7) < 0.13;
  const DY = 1.02;
  const f: Field = (x, y, z) => {
    let d = (Math.hypot(x / A[0], y / A[1], z / A[2]) - 1) * 2.2;
    if (Math.abs(d) < 0.5 && y > 0.05) {
      const h = cell(x, y, z);
      const t = ss(0, 0.045, CELL * 0.866 - h[2]);
      const off = 1 - ss(0.9, 1.35, z) * ss(1.55, 1.25, Math.abs(x)) * ss(2.3, 2.05, y);
      // (open cells cut in, a few capped flat; thin walls between)
      d += (full(h[0], h[1]) ? 0 : 0.14 * t) * off;
    }
    d = smin(d, smax(Math.hypot(x, z) - 2.5 - 0.16 * noise(x, 2, z), y - 0.2, 0.2), 0.3);
    const h = inHex(x, y - DY);
    d = smin(d, smax(smax(Math.abs(Math.hypot(x, y - DY) * 0.45 + h * 0.55 - 1.1) - 0.2, Math.abs(z - 1.35) - 0.62, 0.5), 0.02 - y, 0.1), 0.35);
    return smax(smax(d, -smax(smax(Math.hypot(x, y - DY) * 0.4 + h * 0.6 - 0.92, 0.1 - y, 0.05), -0.9 - z, 0.1), 0.12), -0.1 - y, 0.05) * 0.85;
  };
  s.field(f, [-3.1, -0.12, -3.1], [3.1, 2.85, 3.1], 0.065, (x, y, z) => {
    const c = cell(x, y, z);
    const e = CELL * 0.866 - c[2];
    const tone = 0.9 + 0.22 * rnd(c[0] * 7 + c[1] * 13);
    const inside = inHex(x, y - DY) < 0.97 && z < 2.1 && (z > 1.3 || Math.hypot(x / A[0], y / A[1], z / A[2]) < 0.9) ? Math.max(0.12, 0.62 - (1.9 - z) * 0.28) : 1;
    // (pale wax at the rims, deeper amber down in the cells)
    const open = (1 - ss(0.9, 1.35, z) * ss(1.55, 1.25, Math.abs(x)) * ss(2.3, 2.05, y)) * (full(c[0], c[1]) ? 0 : 1);
    return wax((0.82 + 0.2 * noise(x * 1.5, y, z)) * (1 + 0.3 * (1 - ss(0, 0.035, e))) * tone * inside, 0.55 * ss(0.03, 0.1, e) * open);
  });
  for (let r = -4; r <= 4; r++)
    for (let q = -6; q <= 6; q++) {
      const u = CELL * Math.sqrt(3) * (q + r / 2);
      const v = CELL * 1.5 * r;
      const h = Math.hypot(u, v);
      if (h > 1.35) continue;
      const c = hexAt(u, v, CELL);
      // (honey down in some open cells)
      const w = rnd(c[0] * 5.3 + c[1] * 11.7);
      if (w < 0.13 || w > 0.32) continue;
      const x = (u / (h || 1)) * Math.sin(h) * A[0] * 0.95;
      const y = Math.cos(h) * A[1] * 0.95;
      const z = (v / (h || 1)) * Math.sin(h) * A[2] * 0.95;
      if (z > 0.4 && Math.abs(x) < 1.25 && y < 2.2) continue;
      honey(s, x, y, z, 0.17, 0.17, 0.17, dim(HONEY, 0.8 + 0.5 * w));
    }
  return s.done();
}

/**
 * How far a place (in the frame of a wall or a bridge) is out of what is drawn, about (negative: inside): where the wall
 * of a hole ends.
 */
export function outOf(weapon: string, x: number, y: number, z: number): number {
  const az = Math.abs(z);
  switch (weapon) {
    case 'rampart':
      return Math.max(az - Math.max(y < 4.4 ? 0.74 : 0.5, y < 2.5 ? Math.sqrt(Math.max(0, -1.9 * Math.log(Math.max(0.05, y) / 2.5))) : 0), y - 4.75, Math.abs(x) - 5.5);
    case 'silk-curtain': {
      const u = Math.max(0, Math.min(3.999, (x + 5.2) / 2.6));
      const t = u - Math.floor(u);
      const v = clamp(y / 4.6);
      return Math.max(az - (0.8 + 0.24 * Math.sin(Math.PI * t) ** 2) * (1 - 0.4 * v ** 8) - 0.75 * Math.exp(-Math.max(0, y) * 2.2), y - 4.95 + 2 * t * (1 - t), Math.abs(x) - 5.2);
    }
    case 'shield-wall':
      return Math.max(az - 0.78, y - 4.9, Math.abs(x) - 5.35);
    case 'comb-wall':
      return Math.max(az - 0.94, y - WALL_HIGH - 0.15 - 0.4 * Math.sin(x + 1) - 0.18 * Math.sin(x * 2.3) + 0.028 * x * x, Math.abs(x) - 5.25);
    // (a bridge's hole goes through its deck: the wall of it is the deck's thickness, the ground shows under it)
    case 'living-bridge':
      return Math.max(az - DECK + 0.45, y + 0.2, -0.9 - y);
    case 'silk-span':
      return Math.max(az - DECK, y + 0.03, -0.32 - y);
    case 'scale-walk':
      return Math.max(az - DECK + 0.3, y + 0.1, -0.55 - y);
    default:
      return Math.max(az - DECK + 0.1, y + 0.04, -1.4 - 0.9 * Math.abs((x / LONG) * 2 - 1) ** 3 - y);
  }
}

const MAKERS: Record<string, () => Model> = {
  rampart,
  'living-bridge': livingBridge,
  anthill,
  'silk-curtain': silkCurtain,
  'silk-span': silkSpan,
  'silk-funnel': silkFunnel,
  'shield-wall': shieldWall,
  'scale-walk': scaleWalk,
  husk,
  'comb-wall': combWall,
  'comb-span': combSpan,
  'wax-nest': waxNest,
};

/** The model of a weapon that builds or hides. */
export function buildModel(weapon: string): Model {
  const m = MAKERS[weapon]();
  // (a bridge grows from its near end, the rest from the ground up)
  const span = SPANNING.includes(weapon);
  const n = m.position.length / 3;
  const look = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const x = m.position[k * 3];
    const y = m.position[k * 3 + 1];
    const z = m.position[k * 3 + 2];
    look[k * 3] = m.look[k * 2];
    look[k * 3 + 1] = m.look[k * 2 + 1];
    look[k * 3 + 2] = clamp((span ? x / LONG : y / 5.6) * 0.9 + 0.08 * (1 + noise(x * 1.5, y * 1.5, z * 1.5)) * 0.5);
  }
  return { ...m, look };
}
const SPANNING = ['living-bridge', 'silk-span', 'scale-walk', 'comb-span'];
export const BUILD_MODELS = Object.keys(MAKERS);
