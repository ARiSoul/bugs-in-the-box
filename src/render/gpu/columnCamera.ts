import * as THREE from 'three/webgpu';
import type { DrawnGround } from '../drawnGround';

/** What the camera needs to know of the scene, every frame. */
export interface ColumnShot {
  /** Seconds into the scene; since the column set out, met an enemy, went under (-1: not yet). */
  t: number;
  shotT: number;
  swarmT: number;
  fallT: number;
  stance: boolean;
  power: number;
  at: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  radius: number;
  head: THREE.Vector3;
  headUp: THREE.Vector3;
  headDir: THREE.Vector3;
  fall: THREE.Vector3;
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

const CUTS: Cut[] = [
  // it rears, its arms up: low before it
  { t0: 0, t1: 1.06, a: [26, 3, 8.8, 1.2, 40], b: [14, 1, 7.4, 1.3, 38] },
  // and slams it down: a step back, the ground in the picture
  { t0: 1.06, t1: 1.72, a: [22, 9, 10.4, 0.62, 42], b: [26, 11, 10.8, 0.5, 42] },
  // the ground breaks: from above its side, falling back
  { t0: 1.72, t1: 2.6, a: [58, 30, 9.5, 0.4, 46], b: [82, 22, 15, 0.5, 48] },
  // they pour out: at the ground, among them
  { t0: 2.6, t1: 3.45, a: [128, 5, 12.5, 0.5, 46], b: [108, 9, 11, 0.7, 46] },
  // the army drawn up, its commander before it
  { t0: 3.45, t1: 99, a: [16, 8, 9, 1.0, 46], b: [4, 21, 17.5, 0.6, 46] },
];
/** Its commander, when it is done. */
const LAST: Cut = { t0: 0, t1: 1, a: [36, 5, 9.2, 1.15, 40], b: [28, 4, 8.4, 1.2, 38] };
/** Where it aims from: how far behind the ant, how high, how far to its right, how far ahead of it it looks (radii). */
const STANCE: [number, number, number, number][] = [
  [12.5, 7, 2.2, 9],
  [12.5, 7, -2.2, 9],
  [9, 12, 0, 5],
  [5, 15, 0, 2.5],
  [8, 8, 7.5, 4],
  [8, 8, -7.5, 4],
  [1, 16, 0, 1.2],
  [-3, 14, 4, 0.4],
  [-3, 14, -4, 0.4],
];
const CLEAR = 0.7;

/** The Ant Column's camera: cuts round the ant, behind it while it aims, in the column, round what it swarms. */
export class ColumnCamera {
  active = false;
  private shake = 0;
  private side = 1;
  private lift = 0;
  private lastCut = -1;
  private clock = 0;
  private angle = 0;
  private mode = 0;
  private readonly tilted = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly place = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly ant = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly tilt = new THREE.Vector3(0, 1, 0);

  start(): void {
    this.active = true;
    this.shake = 0;
    this.lastCut = -1;
    this.tilt.set(0, 1, 0);
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

  update(camera: THREE.PerspectiveCamera, x: ColumnShot): void {
    if (!this.active) return;
    this.clock += x.dt;
    let fov = 50;
    let ease = 1;
    const cut = (id: number): boolean => {
      const is = this.lastCut !== id;
      this.lastCut = id;
      return is;
    };
    this.tilt.lerp(this.s.set(0, 1, 0), 1 - Math.exp(-x.dt * 6)).normalize();
    if (x.fallT > 3.5) {
      // last, its commander
      if (cut(6)) this.choose(LAST, x);
      const u = Math.min(1, (x.fallT - 3.5) / 1);
      this.pose(LAST.a.map((q, i) => q + (LAST.b[i] - q) * u), x);
      fov = LAST.a[4];
    } else if (x.fallT >= 0) {
      if (cut(5)) {
        // from where it looks down into the hole, over the freest side
        this.d.copy(this.place).sub(x.fall);
        const now = Math.atan2(this.d.x, this.d.z);
        let best = -1;
        for (let k = 0; k < 9; k++) {
          const an = now + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
          this.want.set(Math.sin(an) * Math.cos(0.95), Math.sin(0.95), Math.cos(an) * Math.cos(0.95)).multiplyScalar(10).add(x.fall);
          this.clear(x.fall, this.want, x.ground);
          const room = this.want.distanceTo(x.fall) - Math.abs(an - now) * 1.2 - 2.5 * this.covered(x.fall, x.headUp, 3, this.want, x.ground);
          if (room > best + 0.1) {
            best = room;
            this.angle = an;
          }
        }
      }
      const an = this.angle + x.fallT * 0.12;
      const dist = 9 + 1.6 * (1 - Math.exp(-x.fallT * 2));
      const el = 0.62 + 0.36 * Math.min(1, x.fallT / 1.1);
      const deep = this.aim.copy(x.fall).addScaledVector(x.headUp, -1.1 * Math.min(1, x.fallT));
      this.want.set(Math.sin(an) * Math.cos(el), Math.sin(el), Math.cos(an) * Math.cos(el)).multiplyScalar(dist).add(x.fall);
      this.clear(x.fall, this.want, x.ground);
      ease = 1 - Math.exp(-x.dt * 5);
      this.place.lerp(this.want, ease);
      this.look.lerp(deep, ease);
      fov = 50;
    } else if (x.swarmT >= 0) {
      if (cut(4)) {
        this.d.copy(this.place).sub(x.head);
        this.angle = Math.atan2(this.d.x, this.d.z) + 0.55;
      }
      const an = this.angle + x.swarmT * 0.42;
      const dist = 8.4 - 2.2 * Math.min(1, x.swarmT / 3);
      const el = 0.34;
      const about = this.aim.copy(x.head).addScaledVector(x.headDir, 1.2).addScaledVector(x.headUp, 0.7);
      this.want.set(Math.sin(an) * Math.cos(el), Math.sin(el), Math.cos(an) * Math.cos(el)).multiplyScalar(dist).add(about);
      this.clear(about, this.want, x.ground);
      ease = 1 - Math.exp(-x.dt * 6);
      this.place.lerp(this.want, ease);
      this.look.lerp(about, 1 - Math.exp(-x.dt * 9));
      fov = 46;
    } else if (x.shotT >= 0) {
      if (x.shotT < 0.75) {
        // it swings its arm, and they go past the view
        if (cut(2)) {
          this.want.copy(x.at).addScaledVector(x.fwd, 5.0 * x.radius).addScaledVector(x.up, 2.3 * x.radius).addScaledVector(this.s.crossVectors(x.up, x.fwd), -7.4 * x.radius);
          this.clear(x.at, this.want, x.ground);
          this.place.copy(this.want);
        }
        this.look.copy(x.at).addScaledVector(x.up, 0.6 * x.radius).addScaledVector(x.fwd, x.shotT * 1.4);
        fov = 52;
      } else {
        // in the column, just over its head, and it leans with the walls
        const c = cut(3);
        this.want.copy(x.head).addScaledVector(x.headDir, -5.2).addScaledVector(x.headUp, 2.4);
        this.aim.copy(x.head).addScaledVector(x.headUp, 0.6);
        this.clear(this.aim, this.want, x.ground);
        this.place.lerp(this.want, c ? 1 : 1 - Math.exp(-x.dt * 7));
        this.look.lerp(this.want.copy(x.head).addScaledVector(x.headDir, 4.5).addScaledVector(x.headUp, 0.3), c ? 1 : 1 - Math.exp(-x.dt * 10));
        this.tilt.lerp(x.headUp, 1 - Math.exp(-x.dt * 9)).normalize();
        fov = 72;
        this.kick(0.07);
      }
    } else if (x.stance) {
      const c = cut(1);
      // (with a wall behind it: from higher, or over the other shoulder; it keeps its place while that is good)
      let best = -1e9;
      let mode = 0;
      for (let i = 0; i < STANCE.length; i++) {
        this.stanceAt(i, x);
        const score = this.want.distanceTo(this.aim) / x.radius - i * 0.6 + (!c && i === this.mode ? 2 : 0) - 5 * this.covered(this.aim, x.up, 1.6 * x.radius, this.want, x.ground) - 4 * this.covered(this.ant.copy(x.at).addScaledVector(x.up, -0.4 * x.radius), x.up, 1.3 * x.radius, this.want, x.ground);
        if (score <= best) continue;
        best = score;
        mode = i;
      }
      this.mode = mode;
      this.stanceAt(mode, x);
      this.place.lerp(this.want, c ? 1 : 1 - Math.exp(-x.dt * 14));
      this.look.lerp(this.want.copy(x.at).addScaledVector(x.fwd, STANCE[this.mode][3] * x.radius), c ? 1 : 1 - Math.exp(-x.dt * 16));
      fov = 54 - 4 * x.power;
    } else {
      const i = CUTS.findIndex((c) => x.t >= c.t0 && x.t < c.t1);
      const c = CUTS[Math.max(0, i)];
      if (cut(10 + i)) this.choose(c, x);
      const u = Math.min(1, (x.t - c.t0) / (Math.min(c.t1, c.t0 + 1.1) - c.t0));
      const e = u * u * (3 - 2 * u);
      const v = c.a.map((q, k) => q + (c.b[k] - q) * e);
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
    camera.up.copy(this.tilt);
    camera.lookAt(this.look);
    camera.up.set(0, 1, 0);
    const was = camera.fov;
    camera.fov = x.shotT >= 0.75 ? camera.fov + (fov - camera.fov) * (1 - Math.exp(-x.dt * 8)) : fov;
    if (Math.abs(camera.fov - was) > 0.001) camera.updateProjectionMatrix();
  }

  private stanceAt(i: number, x: ColumnShot): void {
    const [back, high, over] = STANCE[i];
    this.want.copy(x.at).addScaledVector(x.fwd, -(back - 2.5 * x.power) * x.radius).addScaledVector(x.up, (high - 1.2 * x.power) * x.radius).addScaledVector(this.s.crossVectors(x.fwd, x.up), over * x.radius);
    this.aim.copy(x.at).addScaledVector(x.up, 1.5 * x.radius);
    this.clear(this.aim, this.want, x.ground);
  }

  /** How many of four points round `at` (square to `up`, `size` away) are hidden from `from`. */
  private covered(at: THREE.Vector3, up: THREE.Vector3, size: number, from: THREE.Vector3, ground: DrawnGround): number {
    let n = 0;
    const side = this.tilted.copy(from).sub(at).cross(up).normalize();
    const along = this.across.crossVectors(up, side);
    for (let k = 0; k < 4; k++) {
      const p = this.point.copy(at).addScaledVector(up, 0.6).addScaledVector(k < 2 ? side : along, k % 2 ? size : -size);
      const l = this.d.copy(from).sub(p).length();
      this.d.divideScalar(l);
      const t = ground.raycast(p.x, p.y, p.z, this.d.x, this.d.y, this.d.z, l);
      if (t > 0) n++;
    }
    return n;
  }

  private pose(v: number[], x: ColumnShot): void {
    const yaw = ((v[0] * Math.PI) / 180) * this.side;
    const el = (v[1] * Math.PI) / 180 + this.lift;
    this.s.crossVectors(x.up, x.fwd);
    this.look.copy(x.at).addScaledVector(x.up, (v[3] - 0.1) * x.radius);
    this.d.copy(x.fwd).multiplyScalar(Math.cos(yaw)).addScaledVector(this.s, Math.sin(yaw)).multiplyScalar(Math.cos(el)).addScaledVector(x.up, Math.sin(el));
    this.place.copy(this.look).addScaledVector(this.d, v[2] * x.radius);
    this.clear(this.look, this.place, x.ground);
  }

  /** The side and the height the room allows for a cut. */
  private choose(c: Cut, x: ColumnShot): void {
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
        const score = room - lift * 0.25;
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
