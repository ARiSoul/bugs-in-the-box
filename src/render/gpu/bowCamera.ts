import * as THREE from 'three/webgpu';
import type { Bug } from '../../game/bug';
import type { BugView } from '../BugView';
import type { DrawnGround } from '../drawnGround';

/** What the camera needs to know of the scene, every frame. */
export interface BowShot {
  /** Seconds into the scene; seconds since the shot and the hit (-1: not yet). */
  t: number;
  shotT: number;
  hitT: number;
  at: THREE.Vector3;
  up: THREE.Vector3;
  radius: number;
  aim: THREE.Vector3;
  dart: THREE.Vector3;
  dartDir: THREE.Vector3;
  hit: THREE.Vector3;
  dt: number;
  ground: DrawnGround;
  charging: boolean;
}

/**
 * One shot of the scene: from `t0`, the camera's place about the spider at its start and end: the angle round from its
 * front (degrees, to the side the room allows), the angle up, the distance (radii), how high it looks (radii), the lens.
 */
interface Cut {
  t0: number;
  t1: number;
  a: [number, number, number, number, number, number];
  b: [number, number, number, number, number, number];
  /** It has to be on the drawing hand's side (over the shoulder). */
  right?: boolean;
}

const CUTS: Cut[] = [
  // it has risen, the scarf ties itself on: low in front of it, coming closer
  { t0: 0, t1: 0.68, a: [30, 5, 9.4, 1.05, 42, 0], b: [20, 2, 7.8, 1.15, 40, 0] },
  // the light breaks out: wide, sweeping round it
  { t0: 0.68, t1: 1.4, a: [44, 9, 9.6, 1.5, 48, 0], b: [92, 15, 11.2, 1.6, 46, 0.3] },
  // the bow and the dart: at its side
  { t0: 1.4, t1: 2.1, a: [84, 6, 11.4, 1.35, 40, 1.0], b: [66, 4, 10.4, 1.4, 39, 1.0] },
  // the face behind the drawn bow, the point towards the view
  { t0: 2.1, t1: 2.56, a: [40, 8, 10.2, 1.4, 36, 0.8], b: [34, 6, 9.2, 1.42, 35, 0.8] },
  // over its shoulder, along the dart
  { t0: 2.56, t1: 9, a: [151, 17, 9.4, 1.75, 42, 1.4], b: [153, 14, 8.4, 1.8, 40, 1.5], right: true },
];
/** The moment it lets go: from the side, the dart crossing the picture. */
const RELEASE: Cut = { t0: 0, t1: 1, a: [80, 5, 10.6, 1.45, 44, 2.2], b: [76, 5, 11, 1.45, 44, 2.6] };

const CLEAR = 0.7;

/** The special attack's camera: cuts round the spider, then with the dart, then round where it hits. */
export class BowCamera {
  /** It has the view. */
  active = false;
  private shake = 0;
  private side = -1;
  private lastCut = -1;
  private readonly look = new THREE.Vector3();
  private readonly place = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private fromT = 0;
  private baseFov = 55;
  private hitAngle = 0;
  private hitSet = false;
  private lift = 0;
  private reach = 1;

  start(camera: THREE.PerspectiveCamera, bug: Bug, view: BugView, ground: DrawnGround): void {
    void view;
    void ground;
    void bug;
    this.active = true;
    this.baseFov = 55;
    this.shake = 0;
    this.lastCut = -1;
    this.hitSet = false;
    void camera;
    this.fromT = 0;
  }

  stop(): void {
    this.active = false;
  }

  /** The lens the game has outside the scene. */
  get fov(): number {
    return this.baseFov;
  }

  kick(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /** From a point to the camera (unit), for rings that face it. */
  towards(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.place).sub(p).normalize();
  }

  update(camera: THREE.PerspectiveCamera, x: BowShot): void {
    if (!this.active) return;
    this.fromT += x.dt;
    let fov = this.baseFov;
    if (x.shotT < 0) {
      const i = CUTS.findIndex((c) => x.t >= c.t0 && x.t < c.t1);
      const c = CUTS[Math.max(0, i)];
      if (i !== this.lastCut) {
        this.lastCut = i;
        this.choose(c, x);
      }
      const span = Math.min(c.t1, c.t0 + 0.75) - c.t0;
      const u = Math.min(1, (x.t - c.t0) / span);
      const e = 1 - (1 - u) * (1 - u);
      const v = c.a.map((q, k) => q + (c.b[k] - q) * e);
      this.pose(v, x, this.place, this.look);
      fov = v[4];
    } else if (x.hitT < 0) {
      // with the dart: behind it and a little above, falling back as it speeds away
      if (x.shotT < 0.05) this.kick(0.35);
      const k = Math.min(1, x.shotT / 0.35);
      this.want.copy(x.dart).addScaledVector(x.dartDir, -(6.2 + 1.2 * k)).addScaledVector(x.up, 1.7);
      this.clear(x.dart, this.want, x.ground);
      // a cut to it, once the string has sung
      const cut = x.shotT > 0.16 && x.dart.distanceTo(x.at) > 8 && this.lastCut !== 90;
      if (cut) this.lastCut = 90;
      if (this.lastCut !== 90) return this.hold(camera, x);
      const e = cut ? 1 : 1 - Math.exp(-x.dt * (6 + 14 * k));
      this.place.lerp(this.want, e);
      this.want.copy(x.dart).addScaledVector(x.dartDir, 6);
      this.look.lerp(this.want, cut ? 1 : 1 - Math.exp(-x.dt * 14));
      fov = 60 + 15 * k;
    } else {
      // round where it hit
      if (!this.hitSet) {
        this.hitSet = true;
        this.kick(0.6);
        this.d.copy(this.place).sub(x.hit);
        this.hitAngle = Math.atan2(this.d.x, this.d.z);
        this.settle(x);
      }
      const an = this.hitAngle + x.hitT * 0.38;
      // (out for the web to open, then close to what it caught)
      const near = Math.min(1, Math.max(0, (x.hitT - 1.0) / 1.1));
      const dist = (11 - 4.2 * near * near * (3 - 2 * near)) * this.reach;
      const el = this.lift * (1 - 0.35 * near);
      const c = Math.cos(el);
      this.want.set(Math.sin(an) * c, Math.sin(el), Math.cos(an) * c).multiplyScalar(dist).add(x.hit);
      this.clear(x.hit, this.want, x.ground);
      this.place.lerp(this.want, 1 - Math.exp(-x.dt * 7));
      this.look.lerp(x.hit, 1 - Math.exp(-x.dt * 10));
      fov = 48;
    }
    camera.position.copy(this.place);
    if (this.shake > 0.001) {
      const a = this.shake * 0.22;
      camera.position.x += Math.sin(x.t * 91 + this.fromT * 77) * a;
      camera.position.y += Math.sin(x.t * 83 + this.fromT * 95 + 1) * a;
      this.shake *= Math.exp(-x.dt * 6);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    const was = camera.fov;
    camera.fov = x.hitT >= 0 || x.shotT >= 0 ? camera.fov + (fov - camera.fov) * (1 - Math.exp(-x.dt * 12)) : fov;
    if (Math.abs(camera.fov - was) > 0.001) camera.updateProjectionMatrix();
  }

  /** The moment it lets go, from the side. */
  private hold(camera: THREE.PerspectiveCamera, x: BowShot): void {
    if (this.lastCut !== 80) {
      this.lastCut = 80;
      this.choose(RELEASE, x);
    }
    const u = Math.min(1, x.shotT / 0.25);
    this.pose(RELEASE.a.map((q, k) => q + (RELEASE.b[k] - q) * u), x, this.place, this.look);
    camera.position.copy(this.place);
    camera.position.y += Math.sin(this.fromT * 95) * this.shake * 0.1;
    camera.lookAt(this.look);
    camera.fov = RELEASE.a[4];
    camera.updateProjectionMatrix();
    this.shake *= Math.exp(-x.dt * 6);
  }

  /** The place and the look of one moment: (round, up, distance, look height, lens). */
  private pose(v: number[], x: BowShot, place: THREE.Vector3, look: THREE.Vector3): void {
    const yaw = (v[0] * Math.PI) / 180 * this.side;
    const el = (v[1] * Math.PI) / 180 + this.lift;
    // its front along the ground it stands on, its side, its up
    this.f.copy(x.aim).addScaledVector(x.up, -x.aim.dot(x.up));
    if (this.f.lengthSq() < 1e-4) this.f.set(0, 0, 1).addScaledVector(x.up, -x.up.z);
    this.f.normalize();
    this.s.crossVectors(x.up, this.f);
    look.copy(x.at).addScaledVector(x.up, (v[3] - 0.1) * x.radius).addScaledVector(x.aim, v[5] * x.radius);
    this.d.copy(this.f).multiplyScalar(Math.cos(yaw)).addScaledVector(this.s, Math.sin(yaw)).multiplyScalar(Math.cos(el)).addScaledVector(x.up, Math.sin(el));
    place.copy(look).addScaledVector(this.d, v[2] * x.radius * this.reach);
    this.clear(look, place, x.ground);
  }

  /** Which side the room allows for this cut, and how much higher it has to look from. */
  private choose(c: Cut, x: BowShot): void {
    let best = -1;
    let bestSide = this.side;
    let bestLift = 0;
    const was = this.side;
    for (const lift of [0, 0.2, 0.45, 0.75])
      for (const side of c.right ? [-1] : [was, -was]) {
        this.side = side;
        this.lift = lift;
        this.reach = 1;
        let room = 9;
        for (const v of [c.a, c.b]) {
          this.pose(v, x, this.want, this.look);
          room = Math.min(room, this.want.distanceTo(this.look) / (v[2] * x.radius));
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
    this.reach = 1;
  }

  /** How high to look from at the hit. */
  private settle(x: BowShot): void {
    let best = -1;
    let bestLift = 0.5;
    for (const lift of [0.42, 0.65, 0.95]) {
      const c = Math.cos(lift);
      this.want.set(Math.sin(this.hitAngle) * c, Math.sin(lift), Math.cos(this.hitAngle) * c).multiplyScalar(12).add(x.hit);
      this.clear(x.hit, this.want, x.ground);
      const room = this.want.distanceTo(x.hit) - lift;
      if (room > best + 0.5) {
        best = room;
        bestLift = lift;
      }
    }
    this.lift = bestLift;
    this.reach = 1;
  }

  /** Pull `place` in front of anything solid between it and `look`. */
  private clear(look: THREE.Vector3, place: THREE.Vector3, ground: DrawnGround): void {
    this.d.copy(place).sub(look);
    const l = this.d.length();
    if (l < 1e-3) return;
    this.d.divideScalar(l);
    const start = Math.min(1.2, l * 0.3);
    const hit = ground.raycast(look.x + this.d.x * start, look.y + this.d.y * start, look.z + this.d.z * start, this.d.x, this.d.y, this.d.z, l - start + CLEAR);
    if (hit < 0) return;
    place.copy(look).addScaledVector(this.d, Math.max(1.8, start + hit - CLEAR));
  }
}
