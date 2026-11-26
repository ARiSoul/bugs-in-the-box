import { CHUNK, DENSITY_CLAMP } from './constants';
import { BUILT } from './materials';
import { HIDDEN_CLEAR } from './sdf';

/**
 * Destructible terrain stored as a grid of signed-distance-like density samples.
 *
 *   density < 0  -> solid
 *   density > 0  -> air
 *
 * Samples live on grid points (W+1 × H+1 × D+1); one world unit == one cell.
 *
 * Game logic (movement, projectiles, picking) talks to the terrain only through
 * `sample`, `normal`, `raycast` and `carve`. It never needs to know how the surface is meshed,
 * which is what lets the representation and the mesher change without touching gameplay.
 */
export class Terrain {
  cx!: number;
  cy!: number;
  cz!: number;
  /** World size in cells. */
  W!: number;
  H!: number;
  D!: number;
  /** Samples per axis (cells + 1). */
  sx!: number;
  sy!: number;
  sz!: number;
  dens!: Float32Array;
  /** Visual-only burn mark, 0..255 per sample. */
  scorch!: Uint8Array;
  /** Visual-only material id per sample (see `materials.ts`): what the surface near it is made of. */
  material!: Uint8Array;
  /** Ids of chunks whose mesh is out of date. */
  readonly dirty = new Set<number>();

  constructor(cx = 3, cy = 2, cz = 3) {
    this.resize(cx, cy, cz);
  }

  /** Another size (in chunks), all air: a generator fills it next. */
  resize(cx: number, cy: number, cz: number): void {
    this.dirty.clear();
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.W = cx * CHUNK;
    this.H = cy * CHUNK;
    this.D = cz * CHUNK;
    this.sx = this.W + 1;
    this.sy = this.H + 1;
    this.sz = this.D + 1;
    this.dens = new Float32Array(this.sx * this.sy * this.sz).fill(DENSITY_CLAMP);
    this.scorch = new Uint8Array(this.sx * this.sy * this.sz);
    this.material = new Uint8Array(this.sx * this.sy * this.sz);
  }

  get chunkCount(): number {
    return this.cx * this.cy * this.cz;
  }

  idx(i: number, j: number, k: number): number {
    return i + this.sx * (j + this.sy * k);
  }

  chunkId(x: number, y: number, z: number): number {
    return x + this.cx * (y + this.cy * z);
  }

  chunkCoords(id: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    out[0] = id % this.cx;
    out[1] = Math.floor(id / this.cx) % this.cy;
    out[2] = Math.floor(id / (this.cx * this.cy));
    return out;
  }

  markAllDirty(): void {
    for (let id = 0; id < this.chunkCount; id++) this.dirty.add(id);
  }

  /** Generators call this first: the whole grid becomes air, with no material and no scorch. */
  beginGeneration(): void {
    this.dens.fill(DENSITY_CLAMP);
    this.material.fill(0);
    this.scorch.fill(0);
  }

  /** Generators call this when they are done writing `dens`. */
  commitGeneration(): void {
    this.scorch.fill(0);
    this.markAllDirty();
  }

  /** Trilinear sample of the density field. Outside the world it reads as air. */
  sample(x: number, y: number, z: number): number {
    const { sx, sy, sz, dens } = this;
    if (x < 0 || y < 0 || z < 0 || x > sx - 1 || y > sy - 1 || z > sz - 1) return DENSITY_CLAMP;
    let i = Math.floor(x);
    let j = Math.floor(y);
    let k = Math.floor(z);
    if (i >= sx - 1) i = sx - 2;
    if (j >= sy - 1) j = sy - 2;
    if (k >= sz - 1) k = sz - 2;
    const fx = x - i;
    const fy = y - j;
    const fz = z - k;
    const b = i + sx * (j + sy * k);
    const sk = sx * sy;
    const c000 = dens[b];
    const c100 = dens[b + 1];
    const c010 = dens[b + sx];
    const c110 = dens[b + sx + 1];
    const c001 = dens[b + sk];
    const c101 = dens[b + sk + 1];
    const c011 = dens[b + sk + sx];
    const c111 = dens[b + sk + sx + 1];
    const x00 = c000 + (c100 - c000) * fx;
    const x10 = c010 + (c110 - c010) * fx;
    const x01 = c001 + (c101 - c001) * fx;
    const x11 = c011 + (c111 - c011) * fx;
    const y0 = x00 + (x10 - x00) * fy;
    const y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }

  /** Outward surface normal (gradient of the field), written into `out`. */
  normal(x: number, y: number, z: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const e = 0.6;
    const nx = this.sample(x + e, y, z) - this.sample(x - e, y, z);
    const ny = this.sample(x, y + e, z) - this.sample(x, y - e, z);
    const nz = this.sample(x, y, z + e) - this.sample(x, y, z - e);
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
    return out;
  }

  /**
   * Sphere-traced ray against the field (direction must be normalised).
   * Returns the distance to the first solid point, 0 if the origin is already inside, or -1 on a miss.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT = 400): number {
    if (this.sample(ox, oy, oz) < 0) return 0;
    let t = 0;
    let prev = 0;
    while (t < maxT) {
      const d = this.sample(ox + dx * t, oy + dy * t, oz + dz * t);
      if (d < 0) {
        let a = prev;
        let b = t;
        for (let it = 0; it < 12; it++) {
          const m = (a + b) * 0.5;
          if (this.sample(ox + dx * m, oy + dy * m, oz + dz * m) < 0) b = m;
          else a = m;
        }
        return b;
      }
      prev = t;
      t += Math.max(0.25, d * 0.6);
    }
    return -1;
  }

  /**
   * Subtract a sphere: d = max(d, r - dist). Marks every affected chunk dirty, including neighbours
   * (their meshes share the seam vertices). The outer shell of the world is never opened.
   */
  carve(px: number, py: number, pz: number, r: number): void {
    const { sx, sy, sz, dens, scorch } = this;
    const pad = r + 2;
    const i0 = Math.max(0, Math.floor(px - pad));
    const i1 = Math.min(sx - 1, Math.ceil(px + pad));
    const j0 = Math.max(0, Math.floor(py - pad));
    const j1 = Math.min(sy - 1, Math.ceil(py + pad));
    const k0 = Math.max(0, Math.floor(pz - pad));
    const k1 = Math.min(sz - 1, Math.ceil(pz + pad));
    const scorchR = r * 1.6;
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (Math.min(i, j, k, sx - 1 - i, sy - 1 - j, sz - 1 - k) < 1) continue;
          // Math.sqrt, not Math.hypot: hypot's result is not pinned by the spec (engines can differ), and it is slow.
          const ddx = i - px;
          const ddy = j - py;
          const ddz = k - pz;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          const id = i + sx * (j + sy * k);
          const nd = Math.max(dens[id], r - dist);
          dens[id] = nd > DENSITY_CLAMP ? DENSITY_CLAMP : nd;
          const sc = Math.max(0, 1 - dist / scorchR) * 255;
          if (sc > scorch[id]) scorch[id] = sc;
        }
      }
    }
    const c0x = Math.max(0, Math.floor((i0 - 1) / CHUNK));
    const c1x = Math.min(this.cx - 1, Math.floor((i1 + 1) / CHUNK));
    const c0y = Math.max(0, Math.floor((j0 - 1) / CHUNK));
    const c1y = Math.min(this.cy - 1, Math.floor((j1 + 1) / CHUNK));
    const c0z = Math.max(0, Math.floor((k0 - 1) / CHUNK));
    const c1z = Math.min(this.cz - 1, Math.floor((k1 + 1) / CHUNK));
    for (let z = c0z; z <= c1z; z++)
      for (let y = c0y; y <= c1y; y++) for (let x = c0x; x <= c1x; x++) this.dirty.add(this.chunkId(x, y, z));
  }

  /**
   * Add thick flat pieces with round edges (eleven numbers each: the middle, two half axes square to each other, how
   * thick they are round them, and one not used here). Their body is hidden (COLLIDER: what is built is drawn apart, the
   * hidden body stops shots and bugs); what was solid keeps its material. The outer shell
   * of the world stays as it is.
   */
  deposit(pieces: readonly number[]): void {
    const { sx, sy, sz, dens, scorch, material } = this;
    for (let q = 0; q + 10 < pieces.length; q += 11) {
      const px = pieces[q];
      const py = pieces[q + 1];
      const pz = pieces[q + 2];
      const ux = pieces[q + 3];
      const uy = pieces[q + 4];
      const uz = pieces[q + 5];
      const vx = pieces[q + 6];
      const vy = pieces[q + 7];
      const vz = pieces[q + 8];
      const r = pieces[q + 9];
      const iu = 1 / (ux * ux + uy * uy + uz * uz);
      const iv = 1 / (vx * vx + vy * vy + vz * vz);
      const pad = r + DENSITY_CLAMP;
      const ex = pad + Math.abs(ux) + Math.abs(vx);
      const ey = pad + Math.abs(uy) + Math.abs(vy);
      const ez = pad + Math.abs(uz) + Math.abs(vz);
      const i0 = Math.max(1, Math.floor(px - ex));
      const i1 = Math.min(sx - 2, Math.ceil(px + ex));
      const j0 = Math.max(1, Math.floor(py - ey));
      const j1 = Math.min(sy - 2, Math.ceil(py + ey));
      const k0 = Math.max(1, Math.floor(pz - ez));
      const k1 = Math.min(sz - 2, Math.ceil(pz + ez));
      if (i0 > i1 || j0 > j1 || k0 > k1) continue;
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const dx = i - px;
            const dy = j - py;
            const dz = k - pz;
            let a = (dx * ux + dy * uy + dz * uz) * iu;
            let b = (dx * vx + dy * vy + dz * vz) * iv;
            a = a > 1 ? 1 : a < -1 ? -1 : a;
            b = b > 1 ? 1 : b < -1 ? -1 : b;
            const ox = dx - ux * a - vx * b;
            const oy = dy - uy * a - vy * b;
            const oz = dz - uz * a - vz * b;
            let d = Math.sqrt(ox * ox + oy * oy + oz * oz) - r;
            // (no surface exactly on a sample, see `stamp`)
            if (d < 1e-3 && d > -1e-3) d = d < 0 ? -1e-3 : 1e-3;
            const id = i + sx * (j + sy * k);
            // (clear samples round it too: a vertex of its body blends what all eight corners of its cell are of)
            if (dens[id] > 0 && d < HIDDEN_CLEAR) {
              material[id] = BUILT;
              scorch[id] = 0;
            }
            if (d < dens[id]) dens[id] = d;
          }
      const c0x = Math.max(0, Math.floor((i0 - 1) / CHUNK));
      const c1x = Math.min(this.cx - 1, Math.floor((i1 + 1) / CHUNK));
      const c0y = Math.max(0, Math.floor((j0 - 1) / CHUNK));
      const c1y = Math.min(this.cy - 1, Math.floor((j1 + 1) / CHUNK));
      const c0z = Math.max(0, Math.floor((k0 - 1) / CHUNK));
      const c1z = Math.min(this.cz - 1, Math.floor((k1 + 1) / CHUNK));
      for (let z = c0z; z <= c1z; z++)
        for (let y = c0y; y <= c1y; y++) for (let x = c0x; x <= c1x; x++) this.dirty.add(this.chunkId(x, y, z));
    }
  }

  /**
   * Take pieces (as `deposit` lays them) away again, or only what of them is inside a sphere (x, y, z, radius). What is
   * clear of them keeps its density.
   */
  erase(pieces: readonly number[], sphere: readonly number[] | null = null): void {
    const { sx, sy, sz, dens } = this;
    for (let q = 0; q + 10 < pieces.length; q += 11) {
      const px = pieces[q];
      const py = pieces[q + 1];
      const pz = pieces[q + 2];
      const ux = pieces[q + 3];
      const uy = pieces[q + 4];
      const uz = pieces[q + 5];
      const vx = pieces[q + 6];
      const vy = pieces[q + 7];
      const vz = pieces[q + 8];
      const r = pieces[q + 9] + 0.12;
      const iu = 1 / (ux * ux + uy * uy + uz * uz);
      const iv = 1 / (vx * vx + vy * vy + vz * vz);
      const pad = r + DENSITY_CLAMP;
      const ex = pad + Math.abs(ux) + Math.abs(vx);
      const ey = pad + Math.abs(uy) + Math.abs(vy);
      const ez = pad + Math.abs(uz) + Math.abs(vz);
      const i0 = Math.max(1, Math.floor(px - ex));
      const i1 = Math.min(sx - 2, Math.ceil(px + ex));
      const j0 = Math.max(1, Math.floor(py - ey));
      const j1 = Math.min(sy - 2, Math.ceil(py + ey));
      const k0 = Math.max(1, Math.floor(pz - ez));
      const k1 = Math.min(sz - 2, Math.ceil(pz + ez));
      if (i0 > i1 || j0 > j1 || k0 > k1) continue;
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const dx = i - px;
            const dy = j - py;
            const dz = k - pz;
            let a = (dx * ux + dy * uy + dz * uz) * iu;
            let b = (dx * vx + dy * vy + dz * vz) * iv;
            a = a > 1 ? 1 : a < -1 ? -1 : a;
            b = b > 1 ? 1 : b < -1 ? -1 : b;
            const ox = dx - ux * a - vx * b;
            const oy = dy - uy * a - vy * b;
            const oz = dz - uz * a - vz * b;
            let d = Math.sqrt(ox * ox + oy * oy + oz * oz) - r;
            if (sphere) {
              const qx = i - sphere[0];
              const qy = j - sphere[1];
              const qz = k - sphere[2];
              const s = Math.sqrt(qx * qx + qy * qy + qz * qz) - sphere[3];
              if (s > d) d = s;
            }
            if (d < 1e-3 && d > -1e-3) d = d < 0 ? -1e-3 : 1e-3;
            const id = i + sx * (j + sy * k);
            if (-d > dens[id]) dens[id] = -d > DENSITY_CLAMP ? DENSITY_CLAMP : -d;
          }
      const c0x = Math.max(0, Math.floor((i0 - 1) / CHUNK));
      const c1x = Math.min(this.cx - 1, Math.floor((i1 + 1) / CHUNK));
      const c0y = Math.max(0, Math.floor((j0 - 1) / CHUNK));
      const c1y = Math.min(this.cy - 1, Math.floor((j1 + 1) / CHUNK));
      const c0z = Math.max(0, Math.floor((k0 - 1) / CHUNK));
      const c1z = Math.min(this.cz - 1, Math.floor((k1 + 1) / CHUNK));
      for (let z = c0z; z <= c1z; z++)
        for (let y = c0y; y <= c1y; y++) for (let x = c0x; x <= c1x; x++) this.dirty.add(this.chunkId(x, y, z));
    }
  }

  /**
   * Turn a vertical cylinder of the grid (a turntable) a quarter turn about the vertical axis through the
   * sample (cx, cz): rows j0..j1, radius `r` (whole samples). +x goes to +z. The samples only move (density,
   * material and scorch): exact and lossless, so any number of turns keeps every shape and crater. Marks
   * the chunks it touches dirty.
   */
  rotateQuarter(cx: number, cz: number, j0: number, j1: number, r: number): void {
    const { sx, sy, dens, material, scorch } = this;
    const n = 2 * r + 1;
    const r2 = r * r;
    const rows = j1 - j0 + 1;
    const tmpD = new Float32Array(n * n * rows);
    const tmpM = new Uint8Array(n * n * rows);
    const tmpS = new Uint8Array(n * n * rows);
    // copy the cylinder out...
    for (let j = 0; j < rows; j++)
      for (let b = -r; b <= r; b++)
        for (let a = -r; a <= r; a++) {
          if (a * a + b * b > r2) continue;
          const t = a + r + n * (b + r + n * j);
          const id = cx + a + sx * (j0 + j + sy * (cz + b));
          tmpD[t] = dens[id];
          tmpM[t] = material[id];
          tmpS[t] = scorch[id];
        }
    // ...and write it back turned: the sample at offset (a, b) goes to (-b, a)
    for (let j = 0; j < rows; j++)
      for (let b = -r; b <= r; b++)
        for (let a = -r; a <= r; a++) {
          if (a * a + b * b > r2) continue;
          const t = a + r + n * (b + r + n * j);
          const id = cx - b + sx * (j0 + j + sy * (cz + a));
          dens[id] = tmpD[t];
          material[id] = tmpM[t];
          scorch[id] = tmpS[t];
        }
    const c0x = Math.max(0, Math.floor((cx - r - 1) / CHUNK));
    const c1x = Math.min(this.cx - 1, Math.floor((cx + r + 1) / CHUNK));
    const c0y = Math.max(0, Math.floor((j0 - 1) / CHUNK));
    const c1y = Math.min(this.cy - 1, Math.floor((j1 + 1) / CHUNK));
    const c0z = Math.max(0, Math.floor((cz - r - 1) / CHUNK));
    const c1z = Math.min(this.cz - 1, Math.floor((cz + r + 1) / CHUNK));
    for (let z = c0z; z <= c1z; z++)
      for (let y = c0y; y <= c1y; y++) for (let x = c0x; x <= c1x; x++) this.dirty.add(this.chunkId(x, y, z));
  }
}
