import * as THREE from 'three';
import type { Match, Web } from '../game/match';
import type { DrawnGround } from './drawnGround';

const SPOKES = 15;
const RINGS = 8;
/** Half the width of a strand, and how far over the ground it lies. */
const HALF = 0.035;
const OVER = 0.07;
/** How far from the web's plane the ground is looked for. */
const LOOK = 2.4;
/** Seconds for a new web to open, and for one to go. */
const OPEN = 0.35;
const GO = 0.5;
const THREAD = 0.04;
/** Strands from a held bug to its web. */
const HOLD = 6;

interface WebView {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  web: Web;
  /** Where the web was when its geometry was made (it turns with a turntable from there). */
  x: number;
  z: number;
  born: number;
  gone: number;
  count: number;
}

/** Sticky webs, the threads spiders hang on, the strands that hold a bug (render only). */
export class WebViews {
  private readonly views = new Map<number, WebView>();
  private readonly strands: THREE.Mesh[] = [];
  private readonly silk = new THREE.MeshBasicMaterial({ color: 0xd9dadb, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
  private readonly strand = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  private used = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(private readonly scene: THREE.Scene) {}

  /** A new match: no webs. */
  clear(): void {
    for (const v of this.views.values()) this.dispose(v);
    this.views.clear();
  }

  /** `at(i, out)`: where bug `i` is drawn. */
  update(match: Match, ground: DrawnGround, at: (i: number, out: THREE.Vector3) => THREE.Vector3, now: number): void {
    const t = now / 1000;
    for (const w of match.webs) {
      if (!this.views.has(w.id)) this.views.set(w.id, this.make(w, ground, t));
    }
    for (const [id, v] of this.views) {
      if (v.gone < 0 && !match.webs.includes(v.web)) v.gone = t;
      const open = Math.min(1, (t - v.born) / OPEN);
      v.mesh.geometry.setDrawRange(0, Math.floor((v.count * open) / 6) * 6);
      if (v.gone >= 0) {
        const k = (t - v.gone) / GO;
        if (k >= 1) {
          this.dispose(v);
          this.views.delete(id);
          continue;
        }
        v.mesh.material.opacity = 0.75 * (1 - k);
      } else if (v.web.x !== v.x || v.web.z !== v.z) this.turn(v, match);
    }
    // threads, and what holds the bugs that are stuck
    this.used = 0;
    for (const u of match.units) {
      const b = u.bug;
      if (!b.alive) continue;
      if (b.thread) this.thread(b.tx, b.ty, b.tz, at(u.id, this.b), ground);
      const w = u.web >= 0 ? match.webs.find((q) => q.id === u.web) : undefined;
      if (!w) continue;
      at(u.id, this.b);
      const r = b.species.radius;
      for (let k = 0; k < HOLD; k++) {
        const c = Math.cos((k / HOLD) * Math.PI * 2 + 0.4);
        const s = Math.sin((k / HOLD) * Math.PI * 2 + 0.4);
        // (from its back to the surface round it: across the surface's normal)
        this.a.set(b.hx * c, b.hy * c, b.hz * c).addScaledVector(this.side(b), s).multiplyScalar(r * 2.1);
        this.a.add(this.b);
        this.a.x -= b.nx * r;
        this.a.y -= b.ny * r;
        this.a.z -= b.nz * r;
        const top = this.top.set(b.nx, b.ny, b.nz).multiplyScalar(r * 0.3).add(this.b);
        this.line(this.a, top, 0.03);
      }
    }
    for (let i = this.used; i < this.strands.length; i++) this.strands[i].visible = false;
  }

  /** From the bug up to where its thread hangs; over the edge it went off, if that is in the way. */
  private thread(x: number, y: number, z: number, bug: THREE.Vector3, ground: DrawnGround): void {
    const d = this.across.set(x - bug.x, y - bug.y, z - bug.z);
    const len = d.length();
    if (len < 0.2) return;
    d.divideScalar(len);
    const t = ground.raycast(bug.x, bug.y, bug.z, d.x, d.y, d.z, len);
    if (t < 0 || t > len - 0.8 || y <= bug.y) {
      this.line(this.a.set(x, y, z), bug, THREAD);
      return;
    }
    // the lip: the last place towards the bug that still has that surface under it
    let lip = 0;
    const steps = 12;
    while (lip < steps) {
      const k = (lip + 1) / steps;
      const below = ground.raycast(x + (bug.x - x) * k, y + 0.6, z + (bug.z - z) * k, 0, -1, 0, 1.6);
      if (below < 0) break;
      lip++;
    }
    // (a little past it: a round edge is wider than it is found)
    const k = Math.min(1, (lip + 1.2) / steps);
    const px = x + (bug.x - x) * k;
    const pz = z + (bug.z - z) * k;
    const down = ground.raycast(px, y + 0.6, pz, 0, -1, 0, 2);
    this.top.set(px, down > 0 ? y + 0.65 - down : y + 0.1, pz);
    this.line(this.a.set(x, y + 0.15, z), this.top, THREAD);
    this.line(this.top, bug, THREAD);
  }

  private readonly top = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private side(b: { nx: number; ny: number; nz: number; hx: number; hy: number; hz: number }): THREE.Vector3 {
    return this.across.set(b.ny * b.hz - b.nz * b.hy, b.nz * b.hx - b.nx * b.hz, b.nx * b.hy - b.ny * b.hx);
  }

  private line(from: THREE.Vector3, to: THREE.Vector3, radius: number): void {
    let m = this.strands[this.used];
    if (!m) {
      m = new THREE.Mesh(this.strand, this.silk);
      m.frustumCulled = false;
      this.scene.add(m);
      this.strands.push(m);
    }
    this.used++;
    m.visible = true;
    m.position.copy(from);
    const d = this.across.copy(to).sub(from);
    const len = d.length();
    m.scale.set(radius, Math.max(1e-3, len), radius);
    if (len > 1e-6) m.quaternion.setFromUnitVectors(WebViews.UP, d.divideScalar(len));
  }

  /** The web's strands, laid on what is drawn round its middle: flat ribbons along spokes and round rings. */
  private make(w: Web, ground: DrawnGround, t: number): WebView {
    const n = new THREE.Vector3(w.nx, w.ny, w.nz);
    const u = new THREE.Vector3(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const rnd = (i: number): number => {
      const s = Math.sin(i * 127.1 + w.id * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const p: THREE.Vector3[][] = [];
    for (let s = 0; s < SPOKES; s++) {
      const a = ((s + (rnd(s) - 0.5) * 0.5) / SPOKES) * Math.PI * 2;
      const reach = w.radius * (0.85 + 0.2 * rnd(s + 50));
      const row: THREE.Vector3[] = [];
      let height = 0;
      for (let k = 0; k <= RINGS; k++) {
        const d = (k / RINGS) * reach;
        const q = new THREE.Vector3(w.x, w.y, w.z).addScaledVector(u, Math.cos(a) * d).addScaledVector(v, Math.sin(a) * d);
        const o = q.clone().addScaledVector(n, height + LOOK);
        const hit = ground.rest(o.x, o.y, o.z, -n.x, -n.y, -n.z, LOOK * 2);
        // (past an edge it hangs on level with the last strand)
        if (hit > 0) height += LOOK - hit;
        row.push(q.addScaledVector(n, height + OVER));
      }
      p.push(row);
    }
    const pos: number[] = [];
    const e = new THREE.Vector3();
    const f = new THREE.Vector3();
    const ribbon = (a: THREE.Vector3, b: THREE.Vector3): void => {
      e.copy(b).sub(a);
      if (e.lengthSq() < 1e-6) return;
      f.crossVectors(e, n).normalize().multiplyScalar(HALF);
      pos.push(a.x - f.x, a.y - f.y, a.z - f.z, b.x - f.x, b.y - f.y, b.z - f.z, b.x + f.x, b.y + f.y, b.z + f.z);
      pos.push(a.x - f.x, a.y - f.y, a.z - f.z, b.x + f.x, b.y + f.y, b.z + f.z, a.x + f.x, a.y + f.y, a.z + f.z);
    };
    for (let k = 0; k < RINGS; k++)
      for (let s = 0; s < SPOKES; s++) {
        ribbon(p[s][k], p[s][k + 1]);
        if (k === 0) continue;
        // a ring's strand sags towards the middle between two spokes
        const a = p[s][k];
        const b = p[(s + 1) % SPOKES][k];
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mid.lerp(p[s][0], 0.06);
        ribbon(a, mid);
        ribbon(mid, b);
      }
    const g = new THREE.BufferGeometry();
    // (about the turntable-proof origin: the web's own middle)
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= w.x;
      pos[i + 1] -= w.y;
      pos[i + 2] -= w.z;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd4d6d8, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(w.x, w.y, w.z);
    this.scene.add(m);
    return { mesh: m, web: w, x: w.x, z: w.z, born: t, gone: -1, count: pos.length / 3 };
  }

  /** A web on the turntable: turned with it about its axis. */
  private turn(v: WebView, match: Match): void {
    const tt = match.options.turntable;
    if (!tt) return;
    const from = Math.atan2(v.z - tt.z, v.x - tt.x);
    const to = Math.atan2(v.web.z - tt.z, v.web.x - tt.x);
    v.mesh.position.set(v.web.x, v.web.y, v.web.z);
    v.mesh.rotation.y = from - to;
  }

  private dispose(v: WebView): void {
    this.scene.remove(v.mesh);
    v.mesh.geometry.dispose();
    v.mesh.material.dispose();
  }
}
