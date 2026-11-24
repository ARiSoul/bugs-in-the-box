import * as THREE from 'three';
import type { Match, Web } from '../game/match';
import type { DrawnGround } from './drawnGround';

/** Strands a special attack's web shoots into the room round it, and how far. */
const BURST = 34;
const BURST_REACH = 10;

/** A special attack's web: its spokes and rings. */
export const GRAND_SPOKES = 16;
export const GRAND_RINGS = 9;
/** Half the width of a strand, and how far over the ground it lies. */
const HALF = 0.035;
const OVER = 0.1;
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

/** Points along a line over the ground, from `from` to `to`: their heights over what is drawn, pulled taut over it. */
function taut(ground: DrawnGround, pts: THREE.Vector3[], n: THREE.Vector3): void {
  const last = pts.length - 1;
  const h: number[] = pts.map((q) => {
    const t = ground.rest(q.x + n.x * LOOK, q.y + n.y * LOOK, q.z + n.z * LOOK, -n.x, -n.y, -n.z, LOOK * 2);
    return t > 0 ? LOOK - t + OVER : -LOOK;
  });
  // (the upper hull of the heights: a strand bridges a gap, and lies on what stands up)
  const hull: number[] = [];
  for (let i = 0; i <= last; i++) {
    while (hull.length > 1) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      if ((h[b] - h[a]) * (i - a) > (h[i] - h[a]) * (b - a)) break;
      hull.pop();
    }
    hull.push(i);
  }
  for (let k = 0; k + 1 < hull.length; k++)
    for (let i = hull[k]; i <= hull[k + 1]; i++) {
      const f = (i - hull[k]) / Math.max(1, hull[k + 1] - hull[k]);
      pts[i].addScaledVector(n, h[hull[k]] + (h[hull[k + 1]] - h[hull[k]]) * f);
    }
  // (the ends of a piece were moved twice)
  for (let k = 1; k + 1 < hull.length; k++) pts[hull[k]].addScaledVector(n, -h[hull[k]]);
}

/** A web's spoke, `rings` + 1 points from its middle outwards, taut over the ground; it ends where the ground does. */
export function tautSpoke(ground: DrawnGround, mid: THREE.Vector3, n: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, angle: number, reach: number, rings: number): THREE.Vector3[] {
  const fine = 5;
  const at = (d: number): THREE.Vector3 => mid.clone().addScaledVector(u, Math.cos(angle) * d).addScaledVector(v, Math.sin(angle) * d);
  let end = reach;
  let was = 0;
  let gap = 0;
  for (let d = 0.2; d <= reach; d += 0.2) {
    const q = at(d);
    const t = ground.rest(q.x + n.x * LOOK, q.y + n.y * LOOK, q.z + n.z * LOOK, -n.x, -n.y, -n.z, LOOK * 2);
    const h = t > 0 ? LOOK - t : -9;
    // (over a gap it may stretch; off the end of what it lies on, not)
    if (h < was - 1) {
      gap += 0.2;
      if (gap > 1.3) {
        end = Math.max(0.5, d - gap);
        break;
      }
      continue;
    }
    gap = 0;
    was = h;
  }
  const last = Math.floor((end / reach) * rings + 1e-6);
  const pts = Array.from({ length: Math.max(1, last) * fine + 1 }, (_, k) => at((k / (rings * fine)) * reach));
  taut(ground, pts, n);
  return pts.filter((_, k) => k % fine === 0);
}

/** Pull a web level between its spokes: one that runs along a gap is held up by its neighbours. */
export function levelWeb(p: THREE.Vector3[][], n: THREE.Vector3): void {
  const S = p.length;
  for (let pass = 0; pass < 4; pass++)
    for (let s = 0; s < S; s++)
      for (let k = 1; k < p[s].length; k++) {
        const a = p[(s + S - 1) % S][k];
        const b = p[(s + 1) % S][k];
        if (!a || !b) continue;
        const up = (a.dot(n) + b.dot(n)) / 2 - p[s][k].dot(n) - 0.06;
        if (up > 0) p[s][k].addScaledVector(n, up);
      }
}

/** A ring's strand from one spoke to the next, sagging to the middle a little, taut over the ground: short pieces. */
export function tautArc(ground: DrawnGround, a: THREE.Vector3, b: THREE.Vector3, mid: THREE.Vector3, n: THREE.Vector3): [THREE.Vector3, THREE.Vector3][] {
  const N = 16;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const f = i / N;
    return a.clone().lerp(b, f).lerp(mid, 0.06 * Math.sin(Math.PI * f));
  });
  // (the upper hull of what stands in its way: no strand dips into a gap, none cuts through an edge)
  const h = pts.map((q, i) => {
    if (i === 0 || i === N) return 0;
    const t = ground.rest(q.x + n.x * LOOK, q.y + n.y * LOOK, q.z + n.z * LOOK, -n.x, -n.y, -n.z, LOOK);
    return t > 0 ? LOOK - t + OVER : -1;
  });
  const hull: number[] = [];
  for (let i = 0; i <= N; i++) {
    while (hull.length > 1) {
      const p = hull[hull.length - 2];
      const q = hull[hull.length - 1];
      if ((h[q] - h[p]) * (i - p) > (h[i] - h[p]) * (q - p)) break;
      hull.pop();
    }
    hull.push(i);
  }
  for (let k = 0; k + 1 < hull.length; k++)
    for (let i = hull[k] + (k > 0 ? 1 : 0); i <= hull[k + 1]; i++) pts[i].addScaledVector(n, h[hull[k]] + ((h[hull[k + 1]] - h[hull[k]]) * (i - hull[k])) / (hull[k + 1] - hull[k]));
  return pts.slice(1).map((q, i) => [pts[i], q]);
}

/** Sticky webs, the threads spiders hang on, the strands that hold a bug (render only). */
export class WebViews {
  private readonly views = new Map<number, WebView>();
  private readonly strands: THREE.Mesh[] = [];
  private readonly silk = new THREE.MeshBasicMaterial({ color: 0xd9dadb, transparent: true, opacity: 0.8, depthWrite: false, fog: false });
  private readonly bound = new THREE.MeshStandardMaterial({ color: 0xe9ebec, roughness: 0.6, emissive: 0x9fb4bd, emissiveIntensity: 0.35, fog: false });
  private readonly strand = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
  private used = 0;
  private soon = { id: -1, frames: 0 };
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(private readonly scene: THREE.Scene) {
    // (each material drawn once from the start, too small to see: none is compiled when the first web opens)
    const web = new THREE.MeshBasicMaterial({ color: 0xd4d6d8, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const m of [this.silk, this.bound, web]) {
      const speck = new THREE.Mesh(m === web ? new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]) : this.strand, m);
      speck.position.set(0, -500, 0);
      speck.scale.setScalar(1e-4);
      speck.frustumCulled = false;
      scene.add(speck);
    }
  }

  /** A new match: no webs. */
  clear(): void {
    for (const v of this.views.values()) this.dispose(v);
    this.views.clear();
  }

  /** `at(i, out)`: where bug `i` is drawn. */
  update(match: Match, ground: DrawnGround, at: (i: number, out: THREE.Vector3) => THREE.Vector3, now: number): void {
    const t = now / 1000;
    for (const w of match.webs) {
      if (this.views.has(w.id)) continue;
      // (a great web: a few frames after the hit, which has enough to do; nothing of it shows before)
      if (w.grand && this.soon.id !== w.id) this.soon = { id: w.id, frames: 4 };
      if (w.grand && this.soon.frames-- > 0) continue;
      this.views.set(w.id, this.make(w, ground, t));
    }
    for (const [id, v] of this.views) {
      if (v.gone < 0 && !match.webs.includes(v.web)) v.gone = t;
      // (a great web first has its spokes shot out, see BowScene)
      const open = Math.min(1, Math.max(0, t - v.born - (v.web.grand ? 0.22 : 0)) / (v.web.grand ? OPEN * 1.6 : OPEN));
      if (v.web.grand) v.mesh.material.color.setRGB(0.83, 0.84, 0.85).multiplyScalar(1 + 3.5 * Math.exp(-(t - v.born) * 1.6));
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
      if (w.grand) {
        // (they close over it one after the other, once the web has opened)
        const age = t - (this.views.get(w.id)?.born ?? t) - 0.35;
        // bound: threads that arc over its back from one side of the web to the other, and turns round its abdomen
        const side = this.side(b).clone();
        const mid = this.b.clone();
        const pt = (along: number, out: number, up: number): THREE.Vector3 =>
          new THREE.Vector3(mid.x + (b.hx * along + side.x * out + b.nx * up) * r, mid.y + (b.hy * along + side.y * out + b.ny * up) * r, mid.z + (b.hz * along + side.z * out + b.nz * up) * r);
        for (let k = 0; k < 8; k++) {
          // (across it, none along its length: those would end in the abdomen)
          const an = Math.PI / 2 + (k - 3.5) * 0.17;
          const reach = 2.1 + 0.35 * Math.sin(k * 2.7);
          const off = (k - 4.2) * 0.36;
          let last: THREE.Vector3 | null = null;
          const come = Math.min(1, Math.max(0, age * 4 - k * 0.22));
          if (come <= 0) continue;
          for (let i = 0; i <= Math.round(8 * come); i++) {
            const f = -1 + (2 * i) / 8;
            const q = pt(Math.cos(an) * f * reach + off * (1 - f * f) - 0.25, Math.sin(an) * f * reach, 0.5 * (1 - Math.min(1, Math.abs(f) * 1.15) ** 1.4) - 0.6 * Math.min(1, Math.abs(f) * 1.15) ** 1.4);
            if (i === 0 || i === 8) {
              const t = ground.rest(q.x + b.nx, q.y + b.ny, q.z + b.nz, -b.nx, -b.ny, -b.nz, 3);
              if (t > 0 && t < 2.2) q.set(q.x + b.nx * (1.08 - t), q.y + b.ny * (1.08 - t), q.z + b.nz * (1.08 - t));
            }
            if (last) this.line(last, q, 0.032, true);
            last = q;
          }
        }
        const ab = b.species.abdomen;
        for (let k = 0; k < 4; k++) {
          let last: THREE.Vector3 | null = null;
          const come = Math.min(1, Math.max(0, age * 4 - 2 - k * 0.4));
          if (come <= 0) continue;
          for (let i = 0; i <= Math.round(10 * come); i++) {
            const th = (i / 10) * Math.PI * 2;
            const z = -(0.3 + ab * (0.35 + 0.33 * k)) + Math.sin(th + k) * 0.07;
            const ring = ab * Math.sqrt(Math.max(0.1, 1 - ((z + 0.3 + ab * 0.85) / ab) ** 2));
            const q = pt(z, Math.cos(th) * ring * 0.84, 0.08 + Math.sin(th) * ring * 0.72);
            if (last) this.line(last, q, 0.028, true);
            last = q;
          }
        }
        continue;
      }
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

  private line(from: THREE.Vector3, to: THREE.Vector3, radius: number, solid = false): void {
    let m = this.strands[this.used];
    if (!m) {
      m = new THREE.Mesh(this.strand, this.silk);
      m.frustumCulled = false;
      this.scene.add(m);
      this.strands.push(m);
    }
    this.used++;
    m.material = solid ? this.bound : this.silk;
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
    // (a great web is the very one whose light BowScene draws on it)
    const SPOKES = w.grand ? GRAND_SPOKES : 15;
    const RINGS = w.grand ? GRAND_RINGS : 8;
    for (let s = 0; s < SPOKES; s++) {
      const a = ((s + (w.grand ? 0 : (rnd(s) - 0.5) * 0.5)) / SPOKES) * Math.PI * 2;
      const reach = w.radius * (w.grand ? 1 : 0.85 + 0.2 * rnd(s + 50));
      p.push(tautSpoke(ground, new THREE.Vector3(w.x, w.y, w.z), n, u, v, a, reach, RINGS));
    }
    levelWeb(p, n);
    const pos: number[] = [];
    const e = new THREE.Vector3();
    const f = new THREE.Vector3();
    const ribbon = (a: THREE.Vector3, b: THREE.Vector3): void => {
      e.copy(b).sub(a);
      if (e.lengthSq() < 1e-6) return;
      // (a strand that climbs a key's side shows its width along the wall)
      f.crossVectors(e, n);
      if (f.lengthSq() < 0.1 * e.lengthSq()) f.crossVectors(e, u);
      if (f.lengthSq() < 0.1 * e.lengthSq()) f.crossVectors(e, v);
      f.normalize().multiplyScalar(HALF);
      pos.push(a.x - f.x, a.y - f.y, a.z - f.z, b.x - f.x, b.y - f.y, b.z - f.z, b.x + f.x, b.y + f.y, b.z + f.z);
      pos.push(a.x - f.x, a.y - f.y, a.z - f.z, b.x + f.x, b.y + f.y, b.z + f.z, a.x + f.x, a.y + f.y, a.z + f.z);
    };
    for (let k = 0; k < RINGS; k++)
      for (let s = 0; s < SPOKES; s++) {
        // (a spoke that ends early has no more points; a ring's strand needs both its ends)
        if (p[s][k + 1]) ribbon(p[s][k], p[s][k + 1]);
        if (k === 0 || !p[s][k] || !p[(s + 1) % SPOKES][k]) continue;
        // a ring's strand sags towards the middle between two spokes
        for (const [a, b] of tautArc(ground, p[s][k], p[(s + 1) % SPOKES][k], p[s][0], n)) ribbon(a, b);
      }
    if (w.grand) {
      // (from the middle out to whatever is there: a wall, a ceiling, a part standing by; tied to each other)
      const out: THREE.Vector3[] = [];
      for (let k = 0; k < BURST; k++) {
        const a = k * 2.39996 + rnd(k + 900) * 0.5;
        const up = 0.06 + 0.9 * rnd(k + 700) * rnd(k + 701);
        const c = Math.sqrt(1 - up * up);
        const d = u.clone().multiplyScalar(Math.cos(a) * c).addScaledVector(v, Math.sin(a) * c).addScaledVector(n, up);
        const o = new THREE.Vector3(w.x, w.y, w.z).addScaledVector(n, 0.9);
        if (up < 0.22) continue;
        const hit = ground.raycast(o.x, o.y, o.z, d.x, d.y, d.z, BURST_REACH);
        if (hit < 2.5) continue;
        const end = o.clone().addScaledVector(d, hit);
        out.push(end);
        ribbon(new THREE.Vector3(w.x, w.y, w.z).addScaledVector(n, 0.15), end);
      }
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
