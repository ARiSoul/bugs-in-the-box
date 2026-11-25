import * as THREE from 'three/webgpu';
import type { DrawnGround } from '../drawnGround';

/** What the camera needs to know of the scene, every frame. */
export interface FlockShot {
  /** Seconds into the scene; since it set out, since it struck (-1: not yet). */
  t: number;
  shotT: number;
  hitT: number;
  stance: boolean;
  /** Where the bee stands in the match, and how. */
  at: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  /** Which way it aims. */
  aim: THREE.Vector3;
  radius: number;
  /** The swarm's head and its way. */
  head: THREE.Vector3;
  dir: THREE.Vector3;
  /** A ring was just taken (1, dying away). */
  boost: number;
  /** On its last leg (0..1). */
  dive: number;
  /** Where the first ring is (none: null), and which way what it struck faces (radians; NaN: nothing). */
  ring: THREE.Vector3 | null;
  /** How large it dances (0..1). */
  room: number;
  facing: number;
  /** What it struck. */
  hit: THREE.Vector3;
  dt: number;
  ground: DrawnGround;
}

/** One shot: angle round from its front (degrees), angle up, distance (radii), height it looks at (radii), lens. */
interface Cut {
  t0: number;
  t1: number;
  a: [number, number, number, number, number];
  b: [number, number, number, number, number];
}

/** When each part of the scene starts (seconds). */
export const DANCE = 0.5;
export const DANCED = 2.45;
export const RISE = 2.95;
export const CROWN = 3.7;
export const BURST = 4.05;
export const READY = 5.4;

const CUTS: Cut[] = [
  { t0: 0, t1: DANCE, a: [32, 7, 5.6, 0.35, 38], b: [22, 10, 5.0, 0.4, 38] },
  // the dance: round it and from over it, its track on the ground
  { t0: DANCE, t1: DANCED, a: [34, 36, 10, -0.1, 46], b: [8, 43, 9.2, 0, 46] },
  // the whole eight, from over it
  { t0: DANCED, t1: RISE, a: [4, 50, 11, -0.6, 46], b: [0, 57, 11.4, -0.5, 46] },
  // the track rises round it and becomes a crown
  { t0: RISE, t1: BURST, a: [-18, 12, 8.8, 0.95, 38], b: [-8, 4, 6.8, 0.95, 36] },
  // the swarm
  { t0: BURST, t1: 99, a: [-8, 3, 7, 1.4, 50], b: [8, 2, 8.4, 1.6, 54] },
];
/** Back home. */
const LAST: Cut = { t0: 0, t1: 1, a: [18, 13, 9.4, 1.0, 42], b: [6, 9, 7, 1.15, 40] };
/** Where it aims from: how far behind the bee, how high, how far to its right, how far ahead it looks. */
const STANCE: [number, number, number, number][] = [
  [7.4, 5.4, 3, 13],
  [7.4, 5.4, -3, 13],
  [10, 4.4, 1.6, 13],
  [10, 4.4, -1.6, 13],
  [9, 7, 1.4, 9],
  [6.5, 9, 1.2, 6],
  [4, 10.5, 0.8, 6],
  [1.5, 11.5, 0.5, 5],
  [5, 4.5, 7.5, 7],
  [5, 4.5, -7.5, 7],
  [-2, 4, 9, 4],
  [-2, 4, -9, 4],
];
const CLEAR = 0.7;
const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Seconds at the start: it goes past the view. */
export const PAST = 0.6;
/** After the hit: the view goes back to the bee. */
export const HOME = 2.75;

/** The Queen's Flight's camera: cuts round the dance, behind it while it aims, behind the swarm, round what it struck. */
export class FlockCamera {
  active = false;
  private shake = 0;
  private side = 1;
  private lift = 0;
  private lastCut = -1;
  private clock = 0;
  private angle = 0;
  private mode = 0;
  private bank = 0;
  private fovNow = 55;
  private readonly place = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly level = new THREE.Vector3();
  private readonly lastDir = new THREE.Vector3();
  private readonly heading = new THREE.Vector3();
  private readonly tilt = new THREE.Vector3(0, 1, 0);
  private readonly d = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  start(): void {
    this.active = true;
    this.shake = 0;
    this.bank = 0;
    this.lastCut = -1;
    this.side = 1;
  }

  stop(): void {
    this.active = false;
  }

  get fov(): number {
    return 55;
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(camera: THREE.PerspectiveCamera, x: FlockShot): void {
    if (!this.active) return;
    this.clock += x.dt;
    let fov = 50;
    const cut = (id: number): boolean => {
      const is = this.lastCut !== id;
      this.lastCut = id;
      return is;
    };
    let roll = 0;
    if (x.hitT > HOME) {
      if (cut(6)) this.choose(LAST, x);
      const u = Math.min(1, (x.hitT - HOME) / 1.4);
      this.pose(LAST.a.map((q, i) => q + (LAST.b[i] - q) * u), x);
      fov = LAST.a[4];
    } else if (x.hitT >= 0) {
      if (cut(4)) {
        this.angle = this.freest(x);
        this.orbit(this.angle, 0.32, 10.2, x);
        this.place.copy(this.want);
        this.look.copy(x.hit);
      }
      const t = x.hitT;
      // (something in the way: back round)
      this.orbit(this.angle + t * 0.16 + 0.3, 0.3, 8, x);
      if (this.want.distanceTo(this.s) < 6) this.angle -= x.dt * 1.1;
      this.orbit(this.angle + t * 0.16, 0.32 + 0.06 * Math.min(1, t / 2), 10.2 + 1.6 * ss(0.5, 1.4, t) - 3.6 * ss(1.4, 2.7, t), x);
      this.place.lerp(this.want, 1 - Math.exp(-x.dt * 7));
      // (the two of them in the picture, side by side)
      this.d.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this.look.lerp(this.s.copy(x.hit).addScaledVector(this.d, Number.isNaN(x.facing) ? 0 : 0.9).addScaledVector(this.aim.set(0, 1, 0), 0.9), 1 - Math.exp(-x.dt * 14));
      fov = 46;
    } else if (x.shotT >= 0 && x.shotT < PAST) {
      // low before it: it goes past the view
      if (cut(2)) {
        // (from the side with the most room, and the most behind it)
        let best = -1;
        for (let k = 0; k < 10; k++) {
          const an = (k % 2 ? 1 : -1) * (0.38 + 0.2 * (k >> 1));
          this.want.copy(x.aim).applyAxisAngle(this.s.set(0, 1, 0), an).multiplyScalar(11 - 0.6 * (k >> 1)).add(x.at);
          this.want.y += 0.9;
          this.clear(x.at, this.want, x.ground);
          // (both where it stands and where it will be are seen from there)
          this.s.copy(x.at).addScaledVector(x.aim, 4).sub(this.want);
          const l = this.s.length();
          this.s.divideScalar(l);
          const hidden = x.ground.raycast(this.want.x, this.want.y, this.want.z, this.s.x, this.s.y, this.s.z, l - 1) >= 0;
          const room = this.want.distanceTo(x.at) - 0.35 * (k >> 1) - (hidden ? 4 : 0);
          if (room <= best) continue;
          best = room;
          this.place.copy(this.want);
        }
      }
      this.look.lerp(this.s.copy(x.head).addScaledVector(x.up, 0.2), x.shotT < 0.03 ? 1 : 1 - Math.exp(-x.dt * 20));
      fov = 52;
    } else if (x.shotT >= 0) {
      const c = cut(3);
      if (c) {
        this.lastDir.copy(x.dir);
        this.heading.copy(x.dir);
        this.bank = 0;
      }
      // (the view turns a little after it: its turns are seen)
      this.heading.lerp(x.dir, 1 - Math.exp(-x.dt * 9)).normalize();
      const turn = (this.lastDir.x * x.dir.z - this.lastDir.z * x.dir.x) / Math.max(1e-3, x.dt);
      this.lastDir.copy(x.dir);
      this.bank += (Math.max(-1, Math.min(1, turn * 0.4)) * 0.08 - this.bank) * (1 - Math.exp(-x.dt * 4));
      roll = this.bank;
      const back = 8.2 + 1.6 * x.boost;
      this.want.copy(x.head).addScaledVector(this.heading, -back);
      this.want.y += 2.9;
      this.aim.copy(x.head);
      this.aim.y += 0.5;
      this.clear(this.aim, this.want, x.ground);
      this.place.lerp(this.want, c ? 1 : 1 - Math.exp(-x.dt * 13));
      this.look.lerp(this.s.copy(x.head).addScaledVector(x.dir, 9).addScaledVector(x.up, 0.75), c ? 1 : 1 - Math.exp(-x.dt * 13));
      fov = 66 + 8 * x.boost + 11 * x.dive;
      this.kick(0.035);
    } else if (x.stance) {
      const c = cut(1);
      // (level, or it would be under the ground when it aims high)
      this.level.copy(x.aim).addScaledVector(x.up, -0.75 * x.aim.dot(x.up));
      if (this.level.lengthSq() < 0.05) this.level.copy(x.fwd);
      this.level.normalize();
      let best = -1e9;
      let mode = 0;
      for (let i = 0; i < STANCE.length; i++) {
        this.stanceAt(i, x);
        const score = 1.6 * Math.min(7, this.want.distanceTo(this.aim)) - i * 0.6 + this.frames(x) + (!c && i === this.mode ? 2 : 0);
        if (score <= best) continue;
        best = score;
        mode = i;
      }
      this.mode = mode;
      this.stanceAt(mode, x);
      this.place.lerp(this.want, c ? 1 : 1 - Math.exp(-x.dt * 12));
      this.look.lerp(this.between(x, STANCE[mode][3]), c ? 1 : 1 - Math.exp(-x.dt * 14));
      fov = 68;
    } else {
      const i = CUTS.findIndex((q) => x.t >= q.t0 && x.t < q.t1);
      const q = CUTS[Math.max(0, i)];
      if (cut(10 + i)) this.choose(q, x);
      const u = Math.min(1, (x.t - q.t0) / (Math.min(q.t1, q.t0 + 1.35) - q.t0));
      const e = u * u * (3 - 2 * u);
      const v = q.a.map((w, k) => w + (q.b[k] - w) * e);
      // (nearer to a smaller dance)
      if (q.t0 >= DANCE && q.t1 <= RISE) v[2] *= 0.72 + 0.28 * x.room;
      this.pose(v, x);
      fov = v[4];
    }
    camera.position.copy(this.place);
    if (this.shake > 0.001) {
      const a = this.shake * 0.3;
      camera.position.x += Math.sin(this.clock * 91) * a;
      camera.position.y += Math.sin(this.clock * 83 + 1) * a;
      this.shake *= Math.exp(-x.dt * 5);
    }
    this.tilt.set(0, 1, 0);
    if (roll !== 0) this.tilt.addScaledVector(this.s.crossVectors(this.heading, this.tilt).normalize(), roll).normalize();
    camera.up.copy(this.tilt);
    camera.lookAt(this.look);
    camera.up.set(0, 1, 0);
    const flying = x.shotT >= PAST && x.hitT < 0;
    this.fovNow = flying ? this.fovNow + (fov - this.fovNow) * (1 - Math.exp(-x.dt * 7)) : fov;
    if (Math.abs(camera.fov - this.fovNow) > 0.001) {
      camera.fov = this.fovNow;
      camera.updateProjectionMatrix();
    }
  }

  /** How well the bee and the first ring are in the picture from `want`. */
  private frames(x: FlockShot): number {
    let score = 0;
    if (x.ring) {
      this.d.copy(x.ring).sub(this.want);
      const far = this.d.length();
      this.d.divideScalar(far);
      this.s.copy(x.at).sub(this.want).normalize();
      const an = Math.acos(Math.max(-1, Math.min(1, this.d.dot(this.s))));
      score -= 26 * Math.max(0, an - 0.62) + 8 * Math.max(0, 0.16 - an);
      if (x.ground.raycast(this.want.x, this.want.y, this.want.z, this.d.x, this.d.y, this.d.z, far - 1) >= 0) score -= 6;
    }
    // (nothing close before the lens)
    this.s.copy(x.at).sub(this.want).normalize();
    for (const [a, b] of [[0.35, 0.2], [-0.35, 0.2], [0.35, -0.2], [-0.35, -0.2], [0, 0.3]]) {
      this.d.set(0, 1, 0).cross(this.s).normalize();
      this.d.multiplyScalar(a).add(this.s);
      this.d.y += b;
      this.d.normalize();
      const t = x.ground.raycast(this.want.x, this.want.y, this.want.z, this.d.x, this.d.y, this.d.z, 3.2);
      if (t >= 0) score -= 1.2;
    }
    return score;
  }

  /** What it looks at: between the bee and the first ring. */
  private between(x: FlockShot, ahead: number): THREE.Vector3 {
    if (!x.ring) return this.s.copy(x.at).addScaledVector(this.level, ahead).addScaledVector(x.up, 1);
    this.s.copy(x.at).addScaledVector(x.up, 0.4).sub(this.want).normalize();
    this.d.copy(x.ring).sub(this.want).normalize();
    return this.s.add(this.d).normalize().multiplyScalar(12).add(this.want);
  }

  private stanceAt(i: number, x: FlockShot): void {
    const [back, high, over] = STANCE[i];
    this.s.crossVectors(this.level, x.up);
    if (this.s.lengthSq() < 1e-4) this.s.crossVectors(x.fwd, x.up);
    this.s.normalize();
    this.want.copy(x.at).addScaledVector(this.level, -back).addScaledVector(x.up, high).addScaledVector(this.s, over);
    this.aim.copy(x.at).addScaledVector(x.up, 1.5 * x.radius);
    this.clear(this.aim, this.want, x.ground);
  }

  /** Round what it struck. */
  private orbit(an: number, el: number, dist: number, x: FlockShot): void {
    this.s.copy(x.hit);
    this.s.y += 0.8;
    this.want.set(Math.sin(an) * Math.cos(el), Math.sin(el), Math.cos(an) * Math.cos(el)).multiplyScalar(dist).add(this.s);
    this.clear(this.s, this.want, x.ground);
  }

  private freest(x: FlockShot): number {
    const from = Math.atan2(this.place.x - x.hit.x, this.place.z - x.hit.z);
    let best = -1e9;
    let angle = from;
    for (let k = 0; k < 18; k++) {
      // (best from the side of its way)
      const off = (k % 2 ? 1 : -1) * (1.15 + Math.floor(k / 2) * 0.33);
      let room = 0;
      for (const ahead of [0, 0.25, 0.5]) {
        this.orbit(from + off + ahead, 0.36, 12, x);
        room += this.want.distanceTo(this.s);
        // (and the one that stings, to its right)
        this.d.set(Math.cos(from + off + ahead), 0.3, -Math.sin(from + off + ahead)).normalize();
        const t = x.ground.raycast(this.s.x, this.s.y, this.s.z, this.d.x, this.d.y, this.d.z, 3.4);
        if (t >= 0) room -= 4 * (1 - t / 3.4);
        this.d.multiplyScalar(2.5).add(this.s);
        this.aim.copy(this.want).sub(this.d);
        const l = this.aim.length();
        this.aim.divideScalar(l);
        if (x.ground.raycast(this.d.x, this.d.y, this.d.z, this.aim.x, this.aim.y, this.aim.z, l) >= 0) room -= 4;
      }
      // (its face to the lens)
      const score = room - (Math.abs(off) - 1.15) * 0.8 + (Number.isNaN(x.facing) ? 0 : 5 * Math.cos(from + off - x.facing));
      if (score <= best) continue;
      best = score;
      angle = from + off;
    }
    return angle;
  }

  /** How many of four points at its feet and sides are hidden from `place`. */
  private covered(x: FlockShot): number {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      this.want.copy(x.at).addScaledVector(x.up, -0.7).addScaledVector(this.s.crossVectors(x.up, x.fwd), k < 2 ? 1 : -1).addScaledVector(x.fwd, k % 2 ? 1 : -0.6);
      this.aim.copy(this.place).sub(this.want);
      const l = this.aim.length();
      this.aim.divideScalar(l);
      if (x.ground.raycast(this.want.x + this.aim.x * 0.3, this.want.y + this.aim.y * 0.3 + 0.2, this.want.z + this.aim.z * 0.3, this.aim.x, this.aim.y, this.aim.z, l - 0.4) >= 0) n++;
    }
    return n;
  }

  private pose(v: number[], x: FlockShot): void {
    const yaw = ((v[0] * Math.PI) / 180) * this.side;
    const el = (v[1] * Math.PI) / 180 + this.lift;
    this.s.crossVectors(x.up, x.fwd);
    this.look.copy(x.at).addScaledVector(x.up, (v[3] - 0.1) * x.radius);
    this.d.copy(x.fwd).multiplyScalar(Math.cos(yaw)).addScaledVector(this.s, Math.sin(yaw)).multiplyScalar(Math.cos(el)).addScaledVector(x.up, Math.sin(el));
    this.place.copy(this.look).addScaledVector(this.d, v[2] * x.radius);
    this.clear(this.look, this.place, x.ground);
  }

  /** The side and the height the room allows for a cut. */
  private choose(c: Cut, x: FlockShot): void {
    let best = -1;
    let bestSide = this.side;
    let bestLift = 0;
    const was = this.side;
    for (const lift of [0, 0.2, 0.45, 0.75])
      for (const side of [was, -was]) {
        this.side = side;
        this.lift = lift;
        let room = 9;
        for (const v of [c.a, c.b]) {
          this.pose(v, x);
          room = Math.min(room, this.place.distanceTo(this.look) / (v[2] * x.radius));
        }
        // (and nothing before its feet)
        this.pose(c.b, x);
        const score = room - lift * 0.25 - 0.3 * this.covered(x);
        if (score > best + 0.02) {
          best = score;
          bestSide = side;
          bestLift = lift;
        }
      }
    this.side = bestSide;
    this.lift = bestLift;
  }

  /** Pull `place` in front of anything solid between it and `look`. */
  private clear(look: THREE.Vector3, place: THREE.Vector3, ground: DrawnGround): void {
    this.d.copy(place).sub(look);
    const l = this.d.length();
    if (l < 1e-3) return;
    this.d.divideScalar(l);
    const start = Math.min(1.2, l * 0.3);
    const hit = ground.raycast(look.x + this.d.x * start, look.y + this.d.y * start, look.z + this.d.z * start, this.d.x, this.d.y, this.d.z, l - start + CLEAR);
    if (hit >= 0) place.copy(look).addScaledVector(this.d, Math.max(1.8, start + hit - CLEAR));
  }
}
