import * as THREE from 'three';

/** Streaks in one gale, and how long they fly (ms). */
const STREAKS = 70;
const LIFE = 900;
/** A streak's length, as a share of the gale's reach. */
const LENGTH = 0.16;
/** Pieces of the arc at the far end of the outline of a gale being aimed. */
const ARC = 16;

interface Gust {
  readonly lines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** Per streak: its way (unit), how far it goes, when it sets off (0..1 of the life), its start. */
  readonly ways: Float32Array;
  readonly far: Float32Array;
  readonly delay: Float32Array;
  readonly from: THREE.Vector3;
  readonly reach: number;
  readonly t0: number;
}

/**
 * A gale (Wing Storm), seen: pale streaks of wind that leave the bug in its cone and fly out to its reach, thinning as
 * they go. Render only: its randomness never feeds the game.
 */
export class GaleView {
  private readonly gusts: Gust[] = [];
  /** The cone a gale would sweep, shown while it is aimed: its two sides and the arc at its reach. */
  private readonly outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

  constructor(private readonly scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((2 + ARC) * 6), 3));
    this.outline = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.7, depthTest: false }));
    this.outline.frustumCulled = false;
    this.outline.renderOrder = 6;
    this.outline.visible = false;
    scene.add(this.outline);
  }

  /** Show the cone a gale from `at` along `dir` (unit) would sweep, this far and wide; null: hide it. */
  preview(at: THREE.Vector3 | null, dir?: THREE.Vector3, reach = 0, cone = 1): void {
    this.outline.visible = at !== null && dir !== undefined;
    if (!at || !dir) return;
    const half = Math.acos(Math.max(-1, Math.min(1, cone)));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const point = (a: number, d: number, out: THREE.Vector3): THREE.Vector3 =>
      out.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize().multiplyScalar(d).add(at);
    const arr = (this.outline.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    let k = 0;
    const seg = (a: THREE.Vector3, b: THREE.Vector3): void => {
      arr.set([a.x, a.y, a.z, b.x, b.y, b.z], k);
      k += 6;
    };
    // (its two sides, from just before the bug)
    for (const s of [-1, 1]) seg(point(s * half, 1.2, p), point(s * half, reach, q));
    for (let i = 0; i < ARC; i++) seg(point(-half + (2 * half * i) / ARC, reach, p), point(-half + (2 * half * (i + 1)) / ARC, reach, q));
    (this.outline.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** A gale from `at` along `dir` (unit), this far, this wide (the cosine of half its angle). */
  spawn(at: THREE.Vector3, dir: THREE.Vector3, reach: number, cone: number): void {
    const ways = new Float32Array(STREAKS * 3);
    const far = new Float32Array(STREAKS);
    const delay = new Float32Array(STREAKS);
    // (two ways across the axis, to spread the streaks over the cone)
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    const spread = Math.sqrt(Math.max(0, 1 - cone * cone)) / Math.max(0.2, cone);
    const v = new THREE.Vector3();
    for (let i = 0; i < STREAKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      v.copy(dir)
        .addScaledVector(side, Math.cos(a) * r)
        .addScaledVector(up, Math.sin(a) * r * 0.7)
        .normalize();
      ways.set([v.x, v.y, v.z], i * 3);
      far[i] = reach * (0.55 + Math.random() * 0.45);
      delay[i] = Math.random() * 0.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.85, depthWrite: false }));
    lines.frustumCulled = false;
    lines.renderOrder = 4;
    this.scene.add(lines);
    this.gusts.push({ lines, ways, far, delay, from: at.clone(), reach, t0: performance.now() });
    this.place(this.gusts[this.gusts.length - 1], 0);
  }

  update(now: number): void {
    for (let i = this.gusts.length - 1; i >= 0; i--) {
      const g = this.gusts[i];
      const k = (now - g.t0) / LIFE;
      if (k >= 1) {
        g.lines.geometry.dispose();
        g.lines.material.dispose();
        this.scene.remove(g.lines);
        this.gusts.splice(i, 1);
        continue;
      }
      this.place(g, k);
      g.lines.material.opacity = 0.85 * (1 - k * k);
    }
  }

  clear(): void {
    for (const g of this.gusts) {
      g.lines.geometry.dispose();
      g.lines.material.dispose();
      this.scene.remove(g.lines);
    }
    this.gusts.length = 0;
  }

  /** Every streak where it is at `k` (0..1) of the gale's life: out along its way, fast at first. */
  private place(g: Gust, k: number): void {
    const pos = g.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const len = g.reach * LENGTH;
    for (let i = 0; i < STREAKS; i++) {
      const s = Math.min(1, Math.max(0, (k - g.delay[i]) / (1 - g.delay[i])));
      const eased = 1 - (1 - s) * (1 - s);
      const head = 1.2 + eased * g.far[i];
      const tail = Math.max(1.2, head - len * (1 - s * 0.6));
      const wx = g.ways[i * 3];
      const wy = g.ways[i * 3 + 1];
      const wz = g.ways[i * 3 + 2];
      arr.set([g.from.x + wx * tail, g.from.y + wy * tail, g.from.z + wz * tail, g.from.x + wx * head, g.from.y + wy * head, g.from.z + wz * head], i * 6);
    }
    pos.needsUpdate = true;
  }
}
