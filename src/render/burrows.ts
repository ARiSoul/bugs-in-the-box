import * as THREE from 'three';
import type { Match, MatchEvent } from '../game/match';

/** Lumps of earth there may be on the map at once (mounds round the holes ants dig). */
const LUMPS = 1600;
/** How long the tunnel behind an ant stays drawn after it is out (s). */
const LINGER = 0;

/**
 * What an ant's Burrow leaves and shows: a mound of the earth it dug out round each hole (a crescent, thicker on the
 * side it faced; more at the hole it pushed up out of), and, while it is under the ground, the tunnel behind it (its
 * far wall, dark, so the ant is seen in it through the ground). Reads the match; never changes it.
 */
export class BurrowViews {
  private readonly lumps: THREE.InstancedMesh;
  private next = 0;
  private tunnel: THREE.Mesh | null = null;
  private readonly tunnelMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, side: THREE.BackSide });
  private gone = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(private readonly scene: THREE.Scene) {
    this.lumps = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.96, flatShading: true }), LUMPS);
    this.lumps.castShadow = this.lumps.receiveShadow = true;
    this.lumps.frustumCulled = false;
    for (let i = 0; i < LUMPS; i++) {
      this.lumps.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.lumps.setColorAt(i, this.c.setRGB(GREY[0], GREY[1], GREY[2]));
    }
    scene.add(this.lumps);
  }

  /** A new match: no mounds, no tunnel. */
  clear(): void {
    for (const m of this.heaves) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.heaves.length = 0;
    this.heave = null;
    for (let i = 0; i < LUMPS; i++) this.lumps.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    this.lumps.instanceMatrix.needsUpdate = true;
    this.next = 0;
    this.dropTunnel();
  }

  on(e: MatchEvent, match: Match): void {
    if (e.type === 'burrow') {
      const p = e.path;
      const b = match.units[e.unit].bug;
      const r = b.species.radius;
      // (where it goes in: the ground under it; it faces from the first point to the second)
      this.mound(match, p[0] - b.nx * r, p[1] - b.ny * r, p[2] - b.nz * r, b.nx, b.ny, b.nz, p[0] - p[3], p[2] - p[5], 90, 1.0, 0.35);
      this.tube(p, e.radius);
      this.mouth(p[0] - b.nx * r, p[1] - b.ny * r, p[2] - b.nz * r, b.nx, b.ny, b.nz, p[3] - p[0], p[4] - p[1], p[5] - p[2], 1.25);
      this.rad = r;
      this.trace(match, p, b.nx, b.ny, b.nz, e.radius);
      this.n.set(b.nx, b.ny, b.nz);
      this.puffAt = 0;
    } else if (e.type === 'emerge') {
      const b = match.units[e.unit].bug;
      const r = b.species.radius;
      this.mound(match, e.x - b.nx * r, e.y - b.ny * r, e.z - b.nz * r, b.nx, b.ny, b.nz, b.hx, b.hz, 95, 1.3, 0.88);
      this.mouth(e.x - b.nx * r, e.y - b.ny * r, e.z - b.nz * r, b.nx, b.ny, b.nz, -b.hx, 0, -b.hz, 1.45);
    }
  }

  /** Each frame: the tunnel behind the ant fills as it goes, and goes a moment after it is out. */
  update(match: Match, dt: number): void {
    const u = match.underground;
    // (dust puffs up over it as it goes, and more where it is about to break out)
    if (u && this.puff && (this.puffAt -= dt) <= 0) {
      const near = u.s >= u.end - 1.6;
      this.puffAt = near ? 0.06 : 0.22;
      const b = match.units[u.unit].bug;
      const t = this.surface(match, b.x + this.n.x * 6, b.y + this.n.y * 6, b.z + this.n.z * 6, -this.n.x, -this.n.y, -this.n.z, 12);
      if (t >= 0) this.puff(b.x + this.n.x * (6 - t), b.y + this.n.y * (6 - t), b.z + this.n.z * (6 - t), near ? 3 : 1);
    }
    if (!this.tunnel) return;
    const g = this.tunnel.geometry;
    const index = g.getIndex() as THREE.BufferAttribute;
    if (u) {
      // (the ground over it heaves up as it gets there)
      const first = Math.hypot(u.path[3] - u.path[0], u.path[4] - u.path[1], u.path[5] - u.path[2]);
      let laid = false;
      while (this.ridge.length > 0 && this.ridge[0].at <= u.s - first) {
        const r = this.ridge.shift() as { m: THREE.Matrix4; c: number; at: number };
        const i = this.next++ % LUMPS;
        this.lumps.setMatrixAt(i, r.m);
        this.lumps.setColorAt(i, this.c.set(r.c));
        laid = true;
      }
      if (laid) {
        this.lumps.instanceMatrix.needsUpdate = true;
        if (this.lumps.instanceColor) this.lumps.instanceColor.needsUpdate = true;
      }
      if (this.heave) {
        const along = Math.hypot(u.path[6] - u.path[3], u.path[7] - u.path[4], u.path[8] - u.path[5]) || 1;
        const rows = Math.max(0, Math.min(this.heaveRows, Math.floor(((u.s - first) / along) * this.heaveRows)));
        this.heave.geometry.setDrawRange(0, rows * (HEAVE_ACROSS - 1) * 6);
      }
      const quads = Math.floor((u.s / u.end) * TUBE_SEGMENTS);
      g.setDrawRange(0, Math.min(index.count, quads * TUBE_SIDES * 6));
      this.gone = 0;
    } else {
      if (this.heave) {
        this.heave.geometry.setDrawRange(0, Infinity);
        this.heave = null;
      }
      if ((this.gone += dt) > LINGER) this.dropTunnel();
    }
  }

  /** Where a ray meets what is drawn (set by the owner); without it, the density field's own surface. */
  rest: ((ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) => number) | null = null;

  private surface(match: Match, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    return this.rest ? this.rest(ox, oy, oz, dx, dy, dz, maxT) : match.field.raycast(ox, oy, oz, dx, dy, dz, maxT);
  }

  /** The colour of the ground at a place (set by the owner); without it, a dull grey-brown. */
  groundColor: ((x: number, y: number, z: number) => readonly [number, number, number]) | null = null;
  /** The heaved mounds over tunnels: the one growing now, and all of them (gone with the match). */
  private heave: THREE.Mesh | null = null;
  private heaveRows = 0;
  private readonly heaves: THREE.Mesh[] = [];
  private readonly heaveMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });

  /** The ridge over a tunnel, waiting to be laid as the ant gets under each part of it: where, how big, its colour, how far along. */
  private readonly ridge: { m: THREE.Matrix4; c: number; at: number }[] = [];

  /** Dust that puffs up from the ground (set by the owner: the build views throw it). */
  puff: ((x: number, y: number, z: number, n: number) => void) | null = null;
  private puffAt = 0;
  private readonly n = new THREE.Vector3(0, 1, 0);
  /** The burrowing ant's radius (its centre is this far over the ground it stands on). */
  private rad = 1;

  /** Over the tunnel: crumbs along the ground, the way it went under. */
  private trace(match: Match, p: readonly number[], nx: number, ny: number, nz: number, radius: number): void {
    this.ridge.length = 0;
    const x0 = p[3];
    const y0 = p[4];
    const z0 = p[5];
    const x1 = p[6];
    const y1 = p[7];
    const z1 = p[8];
    const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
    const count = Math.ceil(l / 0.9);
    // (across the way)
    const sx = -(z1 - z0) / l;
    const sz = (x1 - x0) / l;
    const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz));
    // (the ground over its two ends: where the ant stood to go in, and where it comes out; between them taken as even)
    const r = this.rad;
    const t0 = 8 + (x0 - (p[0] - nx * r)) * nx + (y0 - (p[1] - ny * r)) * ny + (z0 - (p[2] - nz * r)) * nz;
    const t1 = 8 + (x1 - (p[9] - nx * r)) * nx + (y1 - (p[10] - ny * r)) * ny + (z1 - (p[11] - nz * r)) * nz;
    // (what is drawn may stand over the field: measured at the exit, not dug yet, and the mound set on it)
    const d3 = this.surface(match, p[9] + nx * 3, p[10] + ny * 3, p[11] + nz * 3, -nx, -ny, -nz, 8);
    const lift = d3 >= 0 ? Math.max(0, Math.min(1.5, 3 - d3 + r)) : 0;
    this.mount(x0, y0, z0, x1, y1, z1, t0 - lift, t1 - lift, nx, ny, nz, radius);
    const ground = this.groundColor?.(p[0] - nx * r, p[1] - ny * r, p[2] - nz * r) ?? GREY;
    for (let k = 0; k <= count; k++) {
      const f = k / count;
      // (crumbs along the lips of its crack)
      const w = (Math.random() < 0.5 ? -1 : 1) * radius * (0.12 + 0.3 * Math.random());
      const ox = x0 + (x1 - x0) * f + sx * w;
      const oy = y0 + (y1 - y0) * f;
      const oz = z0 + (z1 - z0) * f + sz * w;
      const t = t0 + (t1 - t0) * f;
      // (a heaved ridge: high along its middle, low to its sides)
      const size = 0.06 + 0.07 * Math.random();
      // (on the mound's flank, not in the air nor under it)
      const heave = HEAVE_HIGH * 0.8 * (1 - (w / radius) ** 2);
      this.q.setFromEuler(this.e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      const h = 8 - t + size * 0.2 + heave;
      const crack = Math.abs(w) < radius * 0.05;
      this.ridge.push({
        m: new THREE.Matrix4().compose(new THREE.Vector3(ox + nx * h, oy + ny * h, oz + nz * h), up.clone().multiply(this.q), new THREE.Vector3(size * 1.3, size * 0.7, size)),
        // (the crack down its middle dark, its sides dry and pale)
        c: crack ? 0x2e2317 : this.c.setRGB(ground[0], ground[1], ground[2]).multiplyScalar(0.6 + 0.3 * Math.random()).getHex(),
        at: f * l,
      });
    }
    this.ridge.sort((a, b) => a.at - b.at);
  }

  /** The heaved mound over the tunnel from (x0..) to (x1..): its ground `t0`..`t1` under 8 along the normal; grown as the ant goes. */
  private mount(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t0: number, t1: number, nx: number, ny: number, nz: number, radius: number): void {
    const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
    const rows = Math.max(2, Math.ceil(l / 0.22));
    const sx = -(z1 - z0) / l;
    const sz = (x1 - x0) / l;
    const W = radius * 0.8;
    const pos = new Float32Array((rows + 1) * HEAVE_ACROSS * 3);
    const col = new Float32Array((rows + 1) * HEAVE_ACROSS * 3);
    const ground = this.groundColor?.(x0 + nx * (8 - t0), y0 + ny * (8 - t0), z0 + nz * (8 - t0)) ?? GREY;
    for (let i = 0; i <= rows; i++) {
      const f = i / rows;
      const g = 8 - (t0 + (t1 - t0) * f);
      const cx = x0 + (x1 - x0) * f + nx * g;
      const cy = y0 + (y1 - y0) * f + ny * g;
      const cz = z0 + (z1 - z0) * f + nz * g;
      // (low at its ends, where it meets the holes)
      const end = Math.min(1, f / 0.12, (1 - f) / 0.12);
      const taper = end * end * (3 - 2 * end);
      for (let j = 0; j < HEAVE_ACROSS; j++) {
        const s = -W + (2 * W * j) / (HEAVE_ACROSS - 1);
        const a = Math.max(0, 1 - (s / W) ** 2);
        const lump = 0.85 + 0.3 * Math.abs(Math.sin(f * 37 + j * 2.3) * Math.sin(f * 11 - j * 1.7));
        let h = HEAVE_HIGH * taper * a ** 0.8 * lump - 0.04 * (1 - a);
        const crack = Math.abs(s) < W * 0.1;
        if (crack) h -= HEAVE_HIGH * 0.45 * taper;
        const o = (i * HEAVE_ACROSS + j) * 3;
        pos[o] = cx + sx * s + nx * h;
        pos[o + 1] = cy + ny * h;
        pos[o + 2] = cz + sz * s + nz * h;
        const k = crack ? 0.35 : (0.8 + 0.25 * lump - 0.2 * (1 - a) + 0.85 * a ** 6) * (0.92 + 0.16 * Math.sin(f * 53 + j * 5.1));
        // (fresh earth: the ground's colour, paler and a little warmer, dry)
        col[o] = (ground[0] * 1.3 + 0.035) * k;
        col[o + 1] = (ground[1] * 1.28 + 0.03) * k;
        col[o + 2] = (ground[2] * 1.22 + 0.022) * k;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < rows; i++)
      for (let j = 0; j + 1 < HEAVE_ACROSS; j++) {
        const a = i * HEAVE_ACROSS + j;
        const b = a + HEAVE_ACROSS;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.setDrawRange(0, 0);
    const m = new THREE.Mesh(g, this.heaveMaterial);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    this.scene.add(m);
    this.heave = m;
    this.heaveRows = rows;
    this.heaves.push(m);
  }

  /**
   * The mouth of a hole: a dark, matte funnel set into it, sloping down the way (dx, dy, dz) the tunnel goes (the
   * ground's own hole walls shine; an ant's hole is a small dark mouth).
   */
  private mouth(x: number, y: number, z: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number, r: number): void {
    const n = new THREE.Vector3(nx, ny, nz);
    const f = new THREE.Vector3(dx, dy, dz);
    f.addScaledVector(n, -f.dot(n));
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0);
    f.normalize();
    const s = new THREE.Vector3().crossVectors(n, f);
    const RINGS = 6;
    const AROUND = 20;
    const pos = new Float32Array((RINGS + 1) * AROUND * 3);
    for (let i = 0; i <= RINGS; i++) {
      const t = i / RINGS;
      // (from the rim, just over the ground, down and along: narrower as it goes)
      const rr = r * (1 - 0.65 * t);
      const down = 0.05 - 1.6 * t;
      const along = 1.3 * t * t;
      for (let j = 0; j < AROUND; j++) {
        const a = (j / AROUND) * Math.PI * 2;
        const wob = 1 + 0.08 * Math.sin(a * 3 + r * 7) * (1 - t);
        const u = Math.cos(a) * rr * wob + along;
        const v = Math.sin(a) * rr * wob;
        const o = (i * AROUND + j) * 3;
        pos[o] = x + f.x * u + s.x * v + n.x * down;
        pos[o + 1] = y + f.y * u + s.y * v + n.y * down;
        pos[o + 2] = z + f.z * u + s.z * v + n.z * down;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < RINGS; i++)
      for (let j = 0; j < AROUND; j++) {
        const a = i * AROUND + j;
        const b = i * AROUND + ((j + 1) % AROUND);
        idx.push(a, b, a + AROUND, b, b + AROUND, a + AROUND);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mouthMaterial);
    m.receiveShadow = true;
    m.frustumCulled = false;
    this.scene.add(m);
    this.heaves.push(m);
  }
  private readonly mouthMaterial = new THREE.MeshStandardMaterial({ color: 0x0e0b08, roughness: 1, metalness: 0, side: THREE.DoubleSide });

  /** A ring of lumps round a hole at (x, y, z) on ground of normal n, thicker the way (fx, fz); `even`: how much all round. */
  private mound(match: Match, x: number, y: number, z: number, nx: number, ny: number, nz: number, fx: number, fz: number, count: number, big: number, even: number): void {
    // (two ways along the ground)
    const t1 = this.p.set(fx, 0, fz);
    t1.addScaledVector(this.s.set(nx, ny, nz), -t1.dot(this.s));
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    const n = new THREE.Vector3(nx, ny, nz);
    const t2 = new THREE.Vector3().crossVectors(n, t1);
    const f = t1.clone();
    const ground = this.groundColor?.(x, y, z) ?? GREY;
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      // (more on the side it faced)
      if (Math.random() > even + (1 - even) * Math.cos(a)) continue;
      const rr = (1.55 + 1.1 * Math.random() ** 1.4) * (0.9 + 0.1 * big);
      const ox = x + (f.x * Math.cos(a) + t2.x * Math.sin(a)) * rr;
      const oy = y + (f.y * Math.cos(a) + t2.y * Math.sin(a)) * rr;
      const oz = z + (f.z * Math.cos(a) + t2.z * Math.sin(a)) * rr;
      // (on the ground there)
      // (on the ground round the hole, taken as level with it: the field's rays are not to be trusted the moment it is carved)
      const t = 2;
      const near = 1 - (rr - 1.55) / 1.1;
      const size = (0.2 + 0.26 * Math.random()) * big * (0.9 + 0.35 * near);
      // (heaped: higher near the hole)
      const heap = 0.45 * big * near * Math.random();
      const i = this.next++ % LUMPS;
      this.q.setFromEuler(this.e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      // (flattened: earth slumps)
      const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      this.m.compose(this.s.set(ox + nx * (2 - t + size * 0.2 + heap), oy + ny * (2 - t + size * 0.2 + heap), oz + nz * (2 - t + size * 0.2 + heap)), up.multiply(this.q), new THREE.Vector3(size * 1.2, size * 0.55, size));
      this.lumps.setMatrixAt(i, this.m);
      // (the ground's own stuff, dug out: its colour, paler and drier, some of it darker and damp from deeper down)
      const k = 0.75 + 0.5 * Math.random();
      const damp = Math.random() < 0.3 ? 0.6 : 1;
      this.lumps.setColorAt(i, this.c.setRGB((ground[0] * 1.3 + 0.035) * k * damp, (ground[1] * 1.28 + 0.03) * k * damp, (ground[2] * 1.22 + 0.022) * k * damp));
    }
    this.lumps.instanceMatrix.needsUpdate = true;
    if (this.lumps.instanceColor) this.lumps.instanceColor.needsUpdate = true;
  }

  /** The tunnel along `path` (its far wall only, drawn as the ant goes). */
  private tube(path: readonly number[], radius: number): void {
    this.dropTunnel();
    // (only what is under the ground: from halfway down its first stretch to halfway up its last)
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < path.length; k += 3) pts.push(new THREE.Vector3(path[k], path[k + 1], path[k + 2]));
    pts[0].lerp(pts[1], 0.85);
    pts[pts.length - 1].lerp(pts[pts.length - 2], 0.85);
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let k = 0; k + 1 < pts.length; k++) curve.add(new THREE.LineCurve3(pts[k], pts[k + 1]));
    const g = new THREE.TubeGeometry(curve, TUBE_SEGMENTS, radius * 0.92, TUBE_SIDES, false);
    g.setDrawRange(0, 0);
    this.tunnel = new THREE.Mesh(g, this.tunnelMaterial);
    this.tunnel.frustumCulled = false;
    this.scene.add(this.tunnel);
    this.gone = 0;
  }

  private dropTunnel(): void {
    if (!this.tunnel) return;
    this.scene.remove(this.tunnel);
    this.tunnel.geometry.dispose();
    this.tunnel = null;
  }
}

const TUBE_SEGMENTS = 60;
/** The heaved mound over a tunnel: points across it, and how high it rises. */
const HEAVE_ACROSS = 13;
const HEAVE_HIGH = 0.75;
const GREY: readonly [number, number, number] = [0.3, 0.27, 0.24];
const TUBE_SIDES = 10;
