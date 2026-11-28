import * as THREE from 'three';
import { GALE_SPEED } from '../game/match';

/** Streaks along the ground in one gale; dust specks it lifts; specks one hit throws off; specks drawn in by the wind-up. */
const STREAKS = 64;
const DUST = 110;
const PUFF = 28;
const INHALE = 56;
/** How long the streaks, the dust and the trails last after the front has passed (ms). */
const AFTER = 1600;
/** Pieces across the front's sheet, and of the outline's arc. */
const SHEET = 24;
const ARC = 16;
/** The front's sheet: how high it stands, from just under the bug's middle. */
const SHEET_HIGH = 2.6;
const SHEET_LOW = -0.9;
/** A gale's way is kept this near the level, for what it draws (its streaks hug the ground). */
const LOW = 0.15;

const COLD = new THREE.Color(0xbfeaff);
const WHITE = new THREE.Color(0xffffff);
const GREY = new THREE.Color(0x9a948a);

interface Gust {
  readonly from: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly side: THREE.Vector3;
  readonly half: number;
  readonly reach: number;
  readonly t0: number;
  /** The front: a curved sheet of wind across the cone, out at the front's distance. */
  readonly sheet: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Streaks along the ground that the front drives on: their angle across the cone, how far each lags, its length. */
  readonly streaks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly width: Float32Array;
  readonly across: Float32Array;
  readonly lag: Float32Array;
  readonly len: Float32Array;
  readonly lift: Float32Array;
  /** Dust the front lifts as it passes: where each speck lies (its angle, its distance), and how it drifts. */
  readonly dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly dustAt: Float32Array;
}

/** A ring of air on the ground, out fast and gone: at a gale's release, and where a bug it threw lands. */
interface Ring {
  readonly mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly t0: number;
  /** How far out it goes (its scale), in how long (s), how bright it starts. */
  readonly to: number;
  readonly time: number;
  readonly peak: number;
}

interface Puff {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly vel: Float32Array;
  readonly t0: number;
}

/**
 * A gale (Wing Storm), seen. While it is aimed: a pale wedge on the ground with chevrons running out along it. As it winds
 * up: dust drawn in to the bug. At the release: a ring of air at its feet. Then its front: a curved sheet of wind that goes
 * out at the gale's own speed (`GALE_SPEED`, the same the rule throws the bugs by), driving streaks along the ground and
 * lifting the dust where it passes. Each bug it gets to throws off a puff. Render only: its randomness never feeds the game.
 */
export class GaleView {
  private readonly gusts: Gust[] = [];
  private readonly puffs: Puff[] = [];
  private readonly rings: Ring[] = [];
  /** The wedge a gale would sweep, while it is aimed: filled, its edges, and chevrons running out. */
  private readonly wedge: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** Dust drawn in as the gale winds up. */
  private readonly inhaling: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly inhaleFrom = new Float32Array(INHALE * 3);
  private inhaleT = -1;

  constructor(private readonly scene: THREE.Scene) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC + 1) * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < ARC; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    wg.setIndex(idx);
    this.wedge = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
    this.wedge.frustumCulled = false;
    this.wedge.renderOrder = 5;
    this.wedge.visible = false;
    scene.add(this.wedge);
    const eg = new THREE.BufferGeometry();
    // (its two sides, its far arc, and three chevrons)
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((2 + ARC + 3 * 2) * 6), 3));
    this.edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xcff0ff, transparent: true, opacity: 0.8, depthTest: false }));
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 6;
    this.edges.visible = false;
    scene.add(this.edges);
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.BufferAttribute(new Float32Array(INHALE * 3), 3));
    this.inhaling = new THREE.Points(ig, new THREE.PointsMaterial({ color: 0xc9c2b4, size: 0.22, transparent: true, opacity: 0.85, depthWrite: false }));
    this.inhaling.frustumCulled = false;
    this.inhaling.visible = false;
    scene.add(this.inhaling);
  }

  /** The wedge a gale from `at` along `dir` (unit) would sweep, this far and wide; null: hide it. `now`: ms, for the chevrons. */
  preview(at: THREE.Vector3 | null, dir?: THREE.Vector3, reach = 0, cone = 1, now = 0, ground = 0): void {
    const on = at !== null && dir !== undefined;
    this.wedge.visible = this.edges.visible = on;
    if (!at || !dir) return;
    const half = Math.acos(Math.max(-1, Math.min(1, cone)));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const base = new THREE.Vector3(at.x, at.y - ground, at.z);
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const point = (a: number, d: number, out: THREE.Vector3): THREE.Vector3 =>
      out.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).setY(0).normalize().multiplyScalar(d).add(base).setY(base.y + dir.y * d);
    const w = (this.wedge.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i <= ARC; i++) {
      const a = -half + (2 * half * i) / ARC;
      point(a, 1, p);
      point(a, reach, q);
      w.set([p.x, p.y, p.z, q.x, q.y, q.z], i * 6);
    }
    (this.wedge.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const e = (this.edges.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    let k = 0;
    const seg = (a: THREE.Vector3, b: THREE.Vector3): void => {
      e.set([a.x, a.y, a.z, b.x, b.y, b.z], k);
      k += 6;
    };
    for (const s of [-1, 1]) seg(point(s * half, 1, p), point(s * half, reach, q));
    for (let i = 0; i < ARC; i++) seg(point(-half + (2 * half * i) / ARC, reach, p), point(-half + (2 * half * (i + 1)) / ARC, reach, q));
    // (chevrons running out along its middle, a third of the way apart)
    for (let c = 0; c < 3; c++) {
      const d = 2 + (((now / 1000) * 6 + (c * reach) / 3) % (reach - 2));
      const tip = point(0, d + 1.2, new THREE.Vector3());
      seg(point(-0.18, d, p), tip);
      seg(point(0.18, d, q), tip);
    }
    (this.edges.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** The wind-up: dust drawn in to the bug at `at` (null: none). */
  inhale(at: THREE.Vector3 | null, ground = 0): void {
    if (!at) {
      this.inhaling.visible = false;
      this.inhaleT = -1;
      return;
    }
    const pos = (this.inhaling.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    if (this.inhaleT < 0) {
      for (let i = 0; i < INHALE; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 2.5 + Math.random() * 4;
        this.inhaleFrom.set([Math.cos(a) * r, -ground + Math.random() * 0.6, Math.sin(a) * r], i * 3);
      }
      this.inhaleT = performance.now();
    }
    // (each speck comes in faster as it nears, and starts again from further out)
    const t = (performance.now() - this.inhaleT) / 1000;
    for (let i = 0; i < INHALE; i++) {
      const k = (t * 0.9 + i / INHALE) % 1;
      const s = 1 - k * k;
      pos.set([at.x + this.inhaleFrom[i * 3] * s, at.y + this.inhaleFrom[i * 3 + 1] * s + k * 0.6, at.z + this.inhaleFrom[i * 3 + 2] * s], i * 3);
    }
    (this.inhaling.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.inhaling.visible = true;
  }

  /** A gale from `at` (the bug's middle; `ground` below it) along `dir` (unit), this far, this wide (the cosine of half its angle). */
  spawn(at: THREE.Vector3, dir: THREE.Vector3, reach: number, cone: number, ground = 1): void {
    const half = Math.acos(Math.max(-1, Math.min(1, cone)));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    // (the front's sheet: SHEET pieces across, two rows high; a pale white middle, cold blue at its sides)
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SHEET + 1) * 2 * 3), 3));
    const colors = new Float32Array((SHEET + 1) * 2 * 3);
    const c = new THREE.Color();
    for (let i = 0; i <= SHEET; i++) {
      const across = Math.abs(i / SHEET - 0.5) * 2;
      c.copy(WHITE).lerp(COLD, across);
      colors.set([c.r, c.g, c.b, c.r * 0.15, c.g * 0.15, c.b * 0.15], i * 6);
    }
    sg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const idx: number[] = [];
    for (let i = 0; i < SHEET; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    sg.setIndex(idx);
    const sheet = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sheet.frustumCulled = false;
    sheet.renderOrder = 5;
    // (streaks: low over the ground, across the cone)
    // (flat ribbons lying along the ground, dark at the tail and bright at the head: added, that is a fade)
    const across = new Float32Array(STREAKS);
    const lag = new Float32Array(STREAKS);
    const len = new Float32Array(STREAKS);
    const lift = new Float32Array(STREAKS);
    const width = new Float32Array(STREAKS);
    for (let i = 0; i < STREAKS; i++) {
      across[i] = (Math.random() * 2 - 1) * half;
      lag[i] = Math.random() * 4;
      len[i] = 2.5 + Math.random() * 1.5;
      lift[i] = 0.1 + Math.random() * 0.5;
      width[i] = 0.12 + Math.random() * 0.08;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 12), 3));
    const sc = new Float32Array(STREAKS * 12);
    const head = new THREE.Color(0xdff4ff).multiplyScalar(0.55);
    for (let i = 0; i < STREAKS; i++) sc.set([0, 0, 0, 0, 0, 0, head.r, head.g, head.b, head.r, head.g, head.b], i * 12);
    lg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const li: number[] = [];
    for (let i = 0; i < STREAKS; i++) li.push(i * 4, i * 4 + 1, i * 4 + 3, i * 4, i * 4 + 3, i * 4 + 2);
    lg.setIndex(li);
    const streaks = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    streaks.frustumCulled = false;
    streaks.renderOrder = 5;
    // (dust that lies in the cone until the front lifts it)
    const dustAt = new Float32Array(DUST * 2);
    for (let i = 0; i < DUST; i++) dustAt.set([(Math.random() * 2 - 1) * half, 1.5 + Math.sqrt(Math.random()) * (reach - 1.5)], i * 2);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: GREY, size: 0.32, transparent: true, opacity: 0.9, depthWrite: false }));
    dust.frustumCulled = false;
    // (two rings of air at its feet, the second a little after)
    const feet = new THREE.Vector3(at.x, at.y - ground + 0.05, at.z);
    this.ring(feet, 7, 0.18, 0.8);
    this.ring(feet, 5, 0.22, 0.4, 60);
    for (const o of [sheet, streaks, dust]) this.scene.add(o);
    const low = dir.clone();
    low.y = Math.max(-LOW, Math.min(LOW, low.y));
    const g: Gust = { from: at.clone().setY(at.y - ground), dir: low, side, half, reach, t0: performance.now(), sheet, streaks, width, across, lag, len, lift, dust, dustAt };
    this.gusts.push(g);
    this.place(g, 0);
  }

  /** A bug the front got to, at `at`, thrown along (vx, vy, vz): a puff of dust off it. */
  hit(at: THREE.Vector3, vx: number, vy: number, vz: number): void {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(PUFF * 3);
    const vel = new Float32Array(PUFF * 3);
    const l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    for (let i = 0; i < PUFF; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const s = 3 + Math.random() * 7;
      vel.set([(vx / l) * s + (Math.random() - 0.5) * 5, Math.random() * 3, (vz / l) * s + (Math.random() - 0.5) * 5], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf2ece0, size: 0.7, transparent: true, opacity: 1, depthWrite: false }));
    points.frustumCulled = false;
    this.scene.add(points);
    this.puffs.push({ points, vel, t0: performance.now() });
  }

  /** Where a bug a gale threw lands: a small ring of dust. */
  land(at: THREE.Vector3): void {
    this.ring(at, 5, 0.2, 0.5, 0, 0x9a948a);
  }

  /** A ring of air (or dust) on the ground at `at`: 1 across, out to `to` times that in `time` s, `delay` ms from now. */
  private ring(at: THREE.Vector3, to: number, time: number, peak: number, delay = 0, color = 0xdff4ff): void {
    const air = color === 0xdff4ff;
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.05, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: peak, blending: air ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.renderOrder = 5;
    mesh.visible = delay <= 0;
    this.scene.add(mesh);
    this.rings.push({ mesh, t0: performance.now() + delay, to, time, peak });
  }

  update(now: number): void {
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      const t = (now - g.t0) / 1000;
      if (t * 1000 > (g.reach / GALE_SPEED) * 1000 + AFTER) {
        for (const o of [g.sheet, g.streaks, g.dust]) {
          o.geometry.dispose();
          o.material.dispose();
          this.scene.remove(o);
        }
        this.gusts.splice(i, 1);
        continue;
      }
      this.place(g, t);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const t = (now - r.t0) / 1000;
      if (t > r.time * 1.6) {
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.scene.remove(r.mesh);
        this.rings.splice(i, 1);
        continue;
      }
      // (out with an ease, faded as it goes; not before its time)
      const k = Math.max(0, Math.min(1, t / r.time));
      r.mesh.visible = t >= 0;
      r.mesh.scale.setScalar(1 + (r.to - 1) * k * (2 - k));
      r.mesh.material.opacity = r.peak * Math.max(0, 1 - t / (r.time * 1.4));
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      const t = (now - p.t0) / 1000;
      if (t > 0.6) {
        p.points.geometry.dispose();
        p.points.material.dispose();
        this.scene.remove(p.points);
        this.puffs.splice(i, 1);
        continue;
      }
      const pos = (p.points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const drag = Math.exp(-t * 3);
      for (let k = 0; k < PUFF * 3; k++) pos[k] += p.vel[k] * 0.016 * drag;
      (p.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      p.points.material.opacity = 1 - t / 0.6;
      p.points.material.size = 0.7 + (t / 0.6) * 1.1;
    }
  }

  clear(): void {
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      this.scene.remove(r.mesh);
    }
    this.rings.length = 0;
    for (const g of this.gusts)
      for (const o of [g.sheet, g.streaks, g.dust]) {
        o.geometry.dispose();
        o.material.dispose();
        this.scene.remove(o);
      }
    this.gusts.length = 0;
    for (const p of this.puffs) {
      p.points.geometry.dispose();
      p.points.material.dispose();
      this.scene.remove(p.points);
    }
    this.puffs.length = 0;
    this.preview(null);
    this.inhale(null);
  }

  /** Everything of a gale where it is `t` seconds after it went out. */
  private place(g: Gust, t: number): void {
    const front = 1 + t * GALE_SPEED;
    const passed = front > g.reach;
    const fade = passed ? Math.max(0, 1 - ((t - g.reach / GALE_SPEED) * 1000) / AFTER) : 1;
    const out = new THREE.Vector3();
    const at = (a: number, d: number, up: number): THREE.Vector3 =>
      out.copy(g.dir).multiplyScalar(Math.cos(a)).addScaledVector(g.side, Math.sin(a)).setY(0).normalize().multiplyScalar(d).add(g.from).setY(g.from.y + g.dir.y * d + up);
    // (the front's sheet: while it is out; it thins as it goes)
    const s = (g.sheet.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const r = Math.min(front, g.reach);
    for (let i = 0; i <= SHEET; i++) {
      const a = -g.half + (2 * g.half * i) / SHEET;
      const lo = at(a, r, SHEET_LOW + 1);
      s.set([lo.x, lo.y, lo.z], i * 6);
      const hi = at(a, r - 1.2, SHEET_HIGH);
      s.set([hi.x, hi.y, hi.z], i * 6 + 3);
    }
    (g.sheet.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    g.sheet.material.opacity = passed ? 0 : 0.7 * (1 - 0.45 * (front / g.reach));
    // (the streaks: flat ribbons driven along behind the front, low; each as wide across its own way)
    const l = (g.streaks.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < STREAKS; i++) {
      const head = Math.max(1, Math.min(g.reach, front - g.lag[i]) + (passed ? (t - g.reach / GALE_SPEED) * 6 : 0));
      // (near the front only: they do not all run back to the bug)
      const tail = Math.max(1, head - Math.min(g.len[i], head * 0.55));
      const w = g.width[i] * 0.5;
      // (across: the cone's side turned by the streak's own angle)
      const c = Math.cos(g.across[i]);
      const s = Math.sin(g.across[i]);
      const ox = (g.side.x * c - g.dir.x * s) * w;
      const oz = (g.side.z * c - g.dir.z * s) * w;
      const a = at(g.across[i], tail, g.lift[i]);
      l.set([a.x - ox, a.y, a.z - oz, a.x + ox, a.y, a.z + oz], i * 12);
      const b = at(g.across[i], head, g.lift[i]);
      l.set([b.x - ox, b.y, b.z - oz, b.x + ox, b.y, b.z + oz], i * 12 + 6);
    }
    (g.streaks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    g.streaks.material.opacity = fade;
    // (the dust: lifted and carried on once the front has passed it)
    const d = (g.dust.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < DUST; i++) {
      const a0 = g.dustAt[i * 2];
      const d0 = g.dustAt[i * 2 + 1];
      const since = Math.max(0, (front - d0) / GALE_SPEED);
      const p = at(a0, d0 + since * 7, 0.1 + since * 1.6 - since * since * 0.8);
      d.set([p.x, p.y, p.z], i * 3);
    }
    (g.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    g.dust.material.opacity = 0.9 * fade;
  }
}
