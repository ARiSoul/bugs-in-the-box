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
  /** The tunnel's inside, seen through the ground: shaded by itself (no light reaches it), its floor lit, its roof dark. */
  private readonly tunnelMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
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
    this.earth.visible = false;
    this.earth.frustumCulled = false;
    scene.add(this.earth);
  }

  /** A new match: no mounds, no tunnel. */
  clear(): void {
    for (let i = 0; i < LUMPS; i++) {
      this.lumps.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.lumps.instanceMatrix.needsUpdate = true;
    this.next = 0;
    this.dropTunnel();
  }

  on(e: MatchEvent, match: Match): void {
    if (e.type === 'burrow') {
      const p = e.path;
      const b = match.units[e.unit].bug;
      const r = b.species.radius;
      // (where it goes in: the ground under it, on what is drawn there; it faces from the first point to the second)
      const up = r - this.drawnOver(match, p[0], p[1], p[2], b.nx, b.ny, b.nz);
      // (one tunnel, one earth: both its ends heaped with what was dug where it went in)
      this.soil = this.dug(this.groundColor?.(p[0] - b.nx * (r + 1), p[1] - b.ny * (r + 1), p[2] - b.nz * (r + 1)) ?? GREY);
      this.mound(match, p[0] - b.nx * up, p[1] - b.ny * up, p[2] - b.nz * up, b.nx, b.ny, b.nz, p[0] - p[3], p[2] - p[5], 90, 1.0, 0.35);
      this.tube(p, e.radius);
      // (a burst of earth out of the hole as it goes in)
      this.puff?.(p[0] - b.nx * up * 0.6, p[1] - b.ny * up * 0.6, p[2] - b.nz * up * 0.6, 5);
      this.n.set(b.nx, b.ny, b.nz);
      this.puffAt = 0;
    } else if (e.type === 'emerge') {
      const b = match.units[e.unit].bug;
      const r = b.species.radius;
      this.mound(match, e.x - b.nx * r, e.y - b.ny * r, e.z - b.nz * r, b.nx, b.ny, b.nz, b.hx, b.hz, 90, 1.0, 0.6);
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
    // (under a bug under the ground, the earth: what is seen through the ground round its tunnel, not the dark below)
    const deep = u ?? match.inTunnel;
    // (the earth only while the bug is down along its tunnel, laid under the tunnel's floor there: never up by a mouth,
    // where it would stand over the ground)
    const b0 = deep ? match.units[deep.unit].bug : null;
    const floor = deep ? deep.path[4] - BURROW_FLOOR_UNDER : 0;
    const down = b0 !== null && b0.y < deep!.path[4] + 0.6;
    this.earth.visible = down;
    // (what lies over the tunnel is hidden while a bug is seen in it, so it never covers it)
    if (deep && b0) {
      const b = b0;
      this.earth.position.set(b.x, floor, b.z);
      if (this.earthOf !== deep.path) {
        this.earthOf = deep.path;
        const e = this.dug(this.groundColor?.(deep.path[0], deep.path[1] - 1.5, deep.path[2]) ?? GREY);
        // (darker and warmer than the tunnel's walls: the earth round it, not more of it)
        // (earth: some of the map's own broken stuff in a brown)
        const s = brown(e);
        (this.earth.material as THREE.MeshBasicMaterial).color.setRGB(s[0], s[1], s[2]);
      }
    }
    // (a bug walking through a tunnel: its far wall drawn, so the bug is seen in it through the ground)
    const walk = u ? null : match.inTunnel;
    if (walk) {
      if (!this.tunnel || this.walking !== walk.path) {
        this.tube(walk.path, walk.radius);
        this.walking = walk.path;
        // (all of it: it was dug before)
        this.tunnel?.geometry.setDrawRange(0, Infinity);
      }
      this.gone = 0;
      return;
    }
    this.walking = null;
    if (!this.tunnel) return;
    const g = this.tunnel.geometry;
    const index = g.getIndex() as THREE.BufferAttribute;
    if (u) {
      const quads = Math.floor((u.s / u.end) * TUBE_SEGMENTS);
      g.setDrawRange(0, Math.min(index.count, quads * TUBE_SIDES * 6));
      this.gone = 0;
    } else {
      if ((this.gone += dt) > LINGER) this.dropTunnel();
    }
  }

  /** Where a ray meets what is drawn (set by the owner); without it, the density field's own surface. */
  rest: ((ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) => number) | null = null;

  private surface(match: Match, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    return this.rest ? this.rest(ox, oy, oz, dx, dy, dz, maxT) : match.field.raycast(ox, oy, oz, dx, dy, dz, maxT);
  }

  /** Earth dug out from under a skin of colour `skin`: mostly the map's broken inside, a little of its outside. */
  private dug(skin: readonly [number, number, number]): readonly [number, number, number] {
    const core = this.inside?.();
    return core ? [skin[0] * 0.3 + core[0] * 0.7, skin[1] * 0.3 + core[1] * 0.7, skin[2] * 0.3 + core[2] * 0.7] : skin;
  }

  /** The earth of the tunnel dug last (its mounds, its mouths, its inside are all of it); null: none yet. */
  private soil: readonly [number, number, number] | null = null;

  /** The colour of the map's outside where its material says less (set by the owner; linear). */
  skin: (() => readonly [number, number, number] | undefined) | null = null;
  /** What the map is made of inside (set by the owner; linear): the earth dug out is mostly that. */
  inside: (() => readonly [number, number, number] | undefined) | null = null;
  /** The colour of the ground at a place (set by the owner); without it, a dull grey-brown. */
  groundColor: ((x: number, y: number, z: number) => readonly [number, number, number]) | null = null;


  /** Dust that puffs up from the ground (set by the owner: the build views throw it). */
  puff: ((x: number, y: number, z: number, n: number) => void) | null = null;
  private puffAt = 0;
  private readonly n = new THREE.Vector3(0, 1, 0);

  /**
   * How far what is drawn round (x, y, z) stands over the field's own ground (0..2): a drawn floor (a carpet, a desk's
   * top) lies over the hidden body that holds the bugs up. Measured a little way round it, off the hole.
   */
  private drawnOver(match: Match, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const ax = Math.abs(nx) < 0.9 ? 1 : 0;
    const az = 1 - ax;
    // (two ways across the normal)
    let ux = ny * az - nz * 0;
    let uy = nz * ax - nx * az;
    let uz = nx * 0 - ny * ax;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const over: number[] = [];
    for (let k = 0; k < 4; k++) {
      const c = k === 0 ? 1 : k === 2 ? -1 : 0;
      const s = k === 1 ? 1 : k === 3 ? -1 : 0;
      const ox = x + (ux * c + vx * s) * 2.6 + nx * 4;
      const oy = y + (uy * c + vy * s) * 2.6 + ny * 4;
      const oz = z + (uz * c + vz * s) * 2.6 + nz * 4;
      const f = match.field.raycast(ox, oy, oz, -nx, -ny, -nz, 10);
      const d = this.surface(match, ox, oy, oz, -nx, -ny, -nz, 10);
      if (f >= 0 && d >= 0) over.push(f - d);
    }
    if (over.length === 0) return 0;
    over.sort((a, b) => a - b);
    return Math.max(0, Math.min(2, over[over.length >> 1]));
  }


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
    // (dug out from under its skin: mostly the map's broken inside, a little of its outside)
    const ground = this.soil ?? this.dug(this.groundColor?.(x, y, z) ?? GREY);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      // (more on the side it faced)
      if (Math.random() > even + (1 - even) * Math.cos(a)) continue;
      const rr = (1.55 + 1.1 * Math.random() ** 1.4) * (0.9 + 0.1 * big);
      const ox = x + (f.x * Math.cos(a) + t2.x * Math.sin(a)) * rr;
      const oy = y + (f.y * Math.cos(a) + t2.y * Math.sin(a)) * rr;
      const oz = z + (f.z * Math.cos(a) + t2.z * Math.sin(a)) * rr;
      const near = 1 - (rr - 1.55) / 1.1;
      // (lumps no bigger than a bug's foot: the mound reads as earth, not as stones)
      const size = (0.14 + 0.18 * Math.random()) * big * (0.9 + 0.35 * near);
      // (fallen: on what is under it there, a key, the floor, or down in the hole; none where nothing is near under it)
      const hit = this.surface(match, ox + nx * 3, oy + ny * 3, oz + nz * 3, -nx, -ny, -nz, 8);
      if (hit < 0) continue;
      const t = hit - 1;
      const heap = 0;
      const i = this.next++ % LUMPS;
      this.q.setFromEuler(this.e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      // (flattened: earth slumps)
      const up = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      this.m.compose(this.s.set(ox + nx * (2 - t + size * 0.2 + heap), oy + ny * (2 - t + size * 0.2 + heap), oz + nz * (2 - t + size * 0.2 + heap)), up.multiply(this.q), new THREE.Vector3(size * 1.2, size * 0.55, size));
      this.lumps.setMatrixAt(i, this.m);
      // (the ground's own stuff, dug out: its colour, paler and drier, some of it darker and damp from deeper down)
      const k = 0.75 + 0.5 * Math.random();
      const damp = Math.random() < 0.3 ? 0.6 : 1;
      // (a little dimmer than fresh: it lies on the ground in its light)
      this.lumps.setColorAt(i, this.c.setRGB((ground[0] * 1.05 + 0.025) * k * damp, (ground[1] * 1.03 + 0.02) * k * damp, (ground[2] * 1.0 + 0.015) * k * damp));
    }
    this.lumps.instanceMatrix.needsUpdate = true;
    if (this.lumps.instanceColor) this.lumps.instanceColor.needsUpdate = true;
  }

  /** The tunnel along `path` (its far wall only, drawn as the ant goes). */
  /** The earth under a bug under the ground (a flat disc of it, below its tunnel), and the tunnel it was coloured for. */
  private readonly earth = new THREE.Mesh(earthDisc(), new THREE.MeshBasicMaterial({ color: 0x2a2018, vertexColors: true }));
  private earthOf: readonly number[] | null = null;

  /** The way of the tunnel a bug walks through now (its far wall is drawn); null: none. */
  private walking: readonly number[] | null = null;

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
    // (the dug earth's colour: its floor pale, as if lit from the way in, its sides darker, its roof darkest; a little
    // grain along it)
    // (the earth round it, as the disc under a bug shows it, darker: dug through, not a pipe)
    const earth = brown(this.soil ?? this.dug(this.groundColor?.(path[0], path[1] - 1.5, path[2]) ?? GREY));
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const col = new Float32Array(nor.count * 3);
    for (let i = 0; i < nor.count; i++) {
      const down = Math.max(0, -nor.getY(i));
      // (rings along it, as it was dug bite by bite)
      const rib = Math.floor(i / (TUBE_SIDES + 1)) % 4 === 0 ? 0.72 : 1;
      const k = (0.18 + 0.62 * down * down) * rib * (0.9 + 0.2 * Math.abs(Math.sin(i * 12.9898)));
      // (darker than the earth round it: a hollow, not a log)
      col[i * 3] = Math.min(1, earth[0] * 0.62 * k);
      col[i * 3 + 1] = Math.min(1, earth[1] * 0.62 * k);
      col[i * 3 + 2] = Math.min(1, earth[2] * 0.66 * k);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
/** The earth seen under a tunnel lies this far under the middle of its run. */
const BURROW_FLOOR_UNDER = 1.9;
const GREY: readonly [number, number, number] = [0.3, 0.27, 0.24];
const TUBE_SIDES = 10;

/**
 * A flat disc of earth (lying level): grainy, with clods, darker out towards the edge of what is seen of it through the
 * ground (about 4 round its middle), so it reads as a cut through the earth, not a flat colour. Its colours multiply the
 * material's.
 */
function earthDisc(): THREE.BufferGeometry {
  // (a fine square grid, not rings: its grain has no circles in it)
  const g = new THREE.PlaneGeometry(14, 14, 70, 70).rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    // (darker out to the edge of what is seen of it: the ground's cut edge, not a pasted circle)
    const e0 = Math.min(1, Math.max(0, (r - 2.6) / 1.5));
    const edge = 1 - 0.78 * e0 * e0 * (3 - 2 * e0);
    // (grain: a cheap hash of the place, and clods a little lighter)
    const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    const cx = Math.floor(x * 0.9);
    const cz = Math.floor(z * 0.9);
    const clod = Math.abs(Math.sin(cx * 41.3 + cz * 17.9) * 9137.7) % 1;
    const k = edge * (0.78 + 0.32 * h) * (0.88 + 0.24 * clod);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // (only a round disc of it, about as wide as what is seen through the ground: never past the edge of a thin top)
  const index = g.getIndex() as THREE.BufferAttribute;
  const keep: number[] = [];
  const R = 4.7;
  for (let k = 0; k < index.count; k += 3) {
    const a = index.getX(k);
    const b = index.getX(k + 1);
    const c = index.getX(k + 2);
    if (Math.max(Math.hypot(p.getX(a), p.getZ(a)), Math.hypot(p.getX(b), p.getZ(b)), Math.hypot(p.getX(c), p.getZ(c))) <= R) keep.push(a, b, c);
  }
  g.setIndex(keep);
  return g;
}

/** Earth in a brown: a little of the map's own broken stuff in it (what the disc under a bug and its tunnel show). */
function brown(e: readonly [number, number, number]): [number, number, number] {
  return [e[0] * 0.22 + 0.095, e[1] * 0.17 + 0.062, e[2] * 0.12 + 0.03];
}
