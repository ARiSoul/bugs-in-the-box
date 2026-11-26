import * as THREE from 'three';
import { BUILT, COLLIDER } from '../terrain/materials';
import type { Terrain } from '../terrain/Terrain';

/** Size of a lookup cell (world units). */
const CELL = 4;
/** A drawn surface this far above the density's, or this far below it, is the one a foot rests on. */
const ABOVE = 1.3;
const BELOW = 0.75;
/** A drawn surface may lie this far behind the start of the ray (it is drawn thicker than its body). */
const BEHIND = 0.4;
/** A part no larger than this falls away when nothing solid is left within HELD of it. */
const SMALL = 9;
const HELD = 0.3;
/** Triangles between two looks at the clock while indexing. */
const SLICE = 400;
const NONE = -1e9;

/**
 * Where a foot rests (render only). Many parts are smooth meshes laid over hidden density bodies, and the two
 * differ by a fraction of a unit (the grid has one sample per unit). The simulation stands on the density; the
 * eye sees the mesh. This indexes the drawn triangles of a map in a grid, a few milliseconds per frame, and
 * answers short rays against them.
 */
export class DrawnGround {
  /** After `rest`: how far what is drawn lies above the density's surface (negative: below it). */
  offset = 0;

  private nx = 0;
  private ny = 0;
  private nz = 0;
  /** First entry of each cell, and the entries (triangle, next entry). */
  private heads = new Int32Array(0);
  private entries = new Int32Array(0);
  private entryCount = 0;
  /** Nine numbers per triangle, and the part each one belongs to. */
  private tris = new Float32Array(0);
  private owner = new Uint16Array(0);
  private count = 0;
  /** The indexed parts, and where each one was: one that moved since no longer counts. */
  private parts: { mesh: THREE.Mesh; at: THREE.Matrix4; held: THREE.Box3 | null }[] = [];
  private job: Generator<void> | null = null;
  /** What gameplay carved (x, y, z, radius): the drawn parts are cut there. */
  private craters: number[] = [];

  constructor(private readonly terrain: Terrain) {}

  /** A new map: index what `scene` draws, except `skip` (the bugs). The work is done by `step`. */
  reset(scene: THREE.Scene, skip: readonly THREE.Object3D[]): void {
    this.craters = [];
    this.reindex(scene, skip);
  }

  /** Index again (a part of the map stands in a new place); the craters stay. */
  reindex(scene: THREE.Scene, skip: readonly THREE.Object3D[]): void {
    this.count = 0;
    this.entryCount = 0;
    this.heads.fill(-1);
    this.job = this.build(scene, new Set(skip));
  }

  /** Go on indexing for at most about `ms` milliseconds. */
  step(ms: number): void {
    if (!this.job) return;
    const until = performance.now() + ms;
    do {
      if (this.job.next().done) {
        this.job = null;
        return;
      }
    } while (performance.now() < until);
  }

  /** True once the whole map is indexed. */
  get ready(): boolean {
    return this.job === null;
  }

  addCrater(x: number, y: number, z: number, radius: number): void {
    this.craters.push(x, y, z, radius);
  }

  addTunnel(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / (radius * 0.7)));
    for (let i = 0; i <= steps; i++) this.addCrater(x1 + (dx * i) / steps, y1 + (dy * i) / steps, z1 + (dz * i) / steps, radius);
  }

  /** After a blast of `radius` at (x, y, z): the small parts that lost what they stood on are gone. */
  dropLoose(x: number, y: number, z: number, radius: number): void {
    const at = new THREE.Vector3(x, y, z);
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (!p.held || p.held.distanceToPoint(at) > radius + 1.5 || !this.still(i) || this.touches(p.held)) continue;
      p.mesh.visible = false;
      p.held = null;
    }
  }

  /** The bounds of a small part that something solid holds; null for any other. */
  private heldBox(mesh: THREE.Mesh): THREE.Box3 | null {
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) return null;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox) return null;
    const b = g.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const s = b.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z) <= SMALL && this.touches(b) ? b : null;
  }

  /** Is there anything solid in the box, or right at it? */
  private touches(b: THREE.Box3): boolean {
    // (not at its corners: the wall of the crater beside it holds nothing)
    for (let n = 0; n < 27; n++) {
      const x = b.min.x + (b.max.x - b.min.x) * (0.25 + (n % 3) / 4);
      const y = b.min.y + (b.max.y - b.min.y) * ((Math.floor(n / 3) % 3) / 2);
      const z = b.min.z + (b.max.z - b.min.z) * (0.25 + Math.floor(n / 9) / 4);
      if (this.terrain.sample(x, y, z) < HELD) return true;
    }
    return false;
  }

  /** The density field's own ray (what the simulation stands on). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number {
    return this.terrain.raycast(ox, oy, oz, dx, dy, dz, maxT);
  }

  /** Distance along a ray (unit direction) to what a foot rests on: the density, or what is drawn near it. */
  rest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    this.offset = 0;
    const t = this.terrain.raycast(ox, oy, oz, dx, dy, dz, maxT);
    if (t <= 0 || this.count === 0) return t;
    // below the density's surface there is only something to see where that surface itself is hidden
    const to = this.hidden(ox + dx * t, oy + dy * t, oz + dz * t) ? t + BELOW : t;
    const h = this.hit(ox, oy, oz, dx, dy, dz, Math.max(-BEHIND, t - ABOVE), to);
    if (h === NONE) return t;
    this.offset = t - h;
    return h;
  }

  private hidden(x: number, y: number, z: number): boolean {
    const { sx, sy, sz, material } = this.terrain;
    const i = Math.round(x);
    const j = Math.round(y);
    const k = Math.round(z);
    if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) return false;
    const m = material[i + sx * (j + sy * k)];
    return m === COLLIDER || m === BUILT;
  }

  /** First drawn surface between `from` and `to` along a short ray, or `NONE`. */
  private hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, from: number, to: number): number {
    const { heads, entries, tris, nx, ny, nz } = this;
    const ax = ox + dx * from;
    const ay = oy + dy * from;
    const az = oz + dz * from;
    const bx = ox + dx * to;
    const by = oy + dy * to;
    const bz = oz + dz * to;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) / CELL));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) / CELL));
    const k0 = Math.max(0, Math.floor(Math.min(az, bz) / CELL));
    const i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx) / CELL));
    const j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by) / CELL));
    const k1 = Math.min(nz - 1, Math.floor(Math.max(az, bz) / CELL));
    let best = to;
    let found = false;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++)
          for (let e = heads[i + nx * (j + ny * k)]; e >= 0; e = entries[e * 2 + 1]) {
            const tri = entries[e * 2];
            const o = tri * 9;
            const x0 = tris[o];
            const y0 = tris[o + 1];
            const z0 = tris[o + 2];
            const ux = tris[o + 3] - x0;
            const uy = tris[o + 4] - y0;
            const uz = tris[o + 5] - z0;
            const vx = tris[o + 6] - x0;
            const vy = tris[o + 7] - y0;
            const vz = tris[o + 8] - z0;
            const px = dy * vz - dz * vy;
            const py = dz * vx - dx * vz;
            const pz = dx * vy - dy * vx;
            const det = ux * px + uy * py + uz * pz;
            if (det > -1e-9 && det < 1e-9) continue;
            const sx = ox - x0;
            const sy = oy - y0;
            const sz = oz - z0;
            const u = (sx * px + sy * py + sz * pz) / det;
            if (u < 0 || u > 1) continue;
            const qx = sy * uz - sz * uy;
            const qy = sz * ux - sx * uz;
            const qz = sx * uy - sy * ux;
            const v = (dx * qx + dy * qy + dz * qz) / det;
            if (v < 0 || u + v > 1) continue;
            const t = (vx * qx + vy * qy + vz * qz) / det;
            if (t < from || t > best || !this.still(this.owner[tri])) continue;
            if (this.carved(ox + dx * t, oy + dy * t, oz + dz * t)) continue;
            best = t;
            found = true;
          }
    return found ? best : NONE;
  }

  /** Still where it was indexed, and still shown. */
  private still(part: number): boolean {
    const { mesh, at } = this.parts[part];
    const a = mesh.matrixWorld.elements;
    const b = at.elements;
    for (let i = 0; i < 16; i++) if (a[i] - b[i] > 0.02 || b[i] - a[i] > 0.02) return false;
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  private carved(x: number, y: number, z: number): boolean {
    const c = this.craters;
    for (let i = 0; i < c.length; i += 4) {
      const dx = x - c[i];
      const dy = y - c[i + 1];
      const dz = z - c[i + 2];
      if (dx * dx + dy * dy + dz * dz < c[i + 3] * c[i + 3]) return true;
    }
    return false;
  }

  /** The parts a foot can rest on: opaque meshes that are neither the terrain nor one of `skip`. */
  private collect(scene: THREE.Scene, skip: ReadonlySet<THREE.Object3D>): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const visit = (o: THREE.Object3D): void => {
      if (!o.visible || skip.has(o)) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
        const g = mesh.geometry;
        if (g.getAttribute('position') && !g.getAttribute('pbr') && m.colorWrite && (!m.transparent || m.depthWrite) && m.side !== THREE.BackSide) out.push(mesh);
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    return out;
  }

  private *build(scene: THREE.Scene, skip: ReadonlySet<THREE.Object3D>): Generator<void> {
    const { W, H, D } = this.terrain;
    scene.updateMatrixWorld(true);
    const meshes = this.collect(scene, skip);
    let total = 0;
    for (const m of meshes) total += this.triangles(m) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
    this.nx = Math.ceil(W / CELL);
    this.ny = Math.ceil(H / CELL);
    this.nz = Math.ceil(D / CELL);
    const cells = this.nx * this.ny * this.nz;
    if (this.heads.length !== cells) this.heads = new Int32Array(cells);
    this.heads.fill(-1);
    if (this.tris.length < total * 9) {
      this.tris = new Float32Array(total * 9);
      this.owner = new Uint16Array(total);
    }
    if (this.entries.length < total * 4) this.entries = new Int32Array(total * 4);
    this.parts = meshes.map((mesh) => ({ mesh, at: mesh.matrixWorld.clone(), held: this.heldBox(mesh) }));
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let since = 0;
    for (let n = 0; n < meshes.length; n++) {
      const mesh = meshes[n];
      const position = mesh.geometry.getAttribute('position');
      const { index } = mesh.geometry;
      const last = this.triangles(mesh);
      const many = mesh as THREE.InstancedMesh;
      const copies = many.isInstancedMesh ? many.count : 1;
      for (let c = 0; c < copies; c++) {
        if (many.isInstancedMesh) many.getMatrixAt(c, m);
        else m.identity();
        m.premultiply(this.parts[n].at);
        for (let t = 0; t < last; t++) {
          const o = this.count * 9;
          for (let v = 0; v < 3; v++) {
            p.fromBufferAttribute(position, index ? index.getX(t * 3 + v) : t * 3 + v).applyMatrix4(m);
            this.tris[o + v * 3] = p.x;
            this.tris[o + v * 3 + 1] = p.y;
            this.tris[o + v * 3 + 2] = p.z;
          }
          if (this.insert(this.count)) this.owner[this.count++] = n;
          if (++since >= SLICE) {
            since = 0;
            yield;
          }
        }
      }
    }
  }

  private triangles(mesh: THREE.Mesh): number {
    const g = mesh.geometry;
    return Math.floor(Math.min(g.index ? g.index.count : g.getAttribute('position').count, g.drawRange.count) / 3);
  }

  /** List triangle `tri` in the cells it passes through; false if that is none. */
  private insert(tri: number): boolean {
    const { tris, nx, ny, nz } = this;
    const o = tri * 9;
    const i0 = Math.max(0, Math.floor(Math.min(tris[o], tris[o + 3], tris[o + 6]) / CELL));
    const j0 = Math.max(0, Math.floor(Math.min(tris[o + 1], tris[o + 4], tris[o + 7]) / CELL));
    const k0 = Math.max(0, Math.floor(Math.min(tris[o + 2], tris[o + 5], tris[o + 8]) / CELL));
    const i1 = Math.min(nx - 1, Math.floor(Math.max(tris[o], tris[o + 3], tris[o + 6]) / CELL));
    const j1 = Math.min(ny - 1, Math.floor(Math.max(tris[o + 1], tris[o + 4], tris[o + 7]) / CELL));
    const k1 = Math.min(nz - 1, Math.floor(Math.max(tris[o + 2], tris[o + 5], tris[o + 8]) / CELL));
    const ux = tris[o + 3] - tris[o];
    const uy = tris[o + 4] - tris[o + 1];
    const uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o];
    const vy = tris[o + 7] - tris[o + 1];
    const vz = tris[o + 8] - tris[o + 2];
    const ax = uy * vz - uz * vy;
    const ay = uz * vx - ux * vz;
    const az = ux * vy - uy * vx;
    const reach = (Math.abs(ax) + Math.abs(ay) + Math.abs(az)) * (CELL / 2) * 1.001;
    let any = false;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          // (does its plane pass through the cell?)
          const d = ((i + 0.5) * CELL - tris[o]) * ax + ((j + 0.5) * CELL - tris[o + 1]) * ay + ((k + 0.5) * CELL - tris[o + 2]) * az;
          if (Math.abs(d) > reach) continue;
          if (this.entryCount * 2 + 2 > this.entries.length) {
            const more = new Int32Array(Math.max(1024, this.entries.length * 2));
            more.set(this.entries);
            this.entries = more;
          }
          const cell = i + nx * (j + ny * k);
          this.entries[this.entryCount * 2] = tri;
          this.entries[this.entryCount * 2 + 1] = this.heads[cell];
          this.heads[cell] = this.entryCount++;
          any = true;
        }
    return any;
  }
}
