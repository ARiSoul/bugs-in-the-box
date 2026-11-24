import * as THREE from 'three/webgpu';
import type { DrawnGround } from '../drawnGround';

/** What the camera needs to know of the scene, every frame. */
export interface BroodShot {
  /** Seconds into the scene; since the call, since the light came back (-1: not yet). */
  t: number;
  shotT: number;
  hitT: number;
  stance: boolean;
  at: THREE.Vector3;
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  radius: number;
  /** The marked spot and its normal; what the picture is about there (a bug it covers, or the spot). */
  mark: THREE.Vector3;
  markUp: THREE.Vector3;
  subject: THREE.Vector3;
  covered: boolean;
  /** Which way the player moves the view over the ground. */
  pan: number;
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
  // it opens its wings and rubs them: low, close
  { t0: 0, t1: 1.3, a: [42, 10, 7.4, 0.5, 40], b: [30, 7, 6.2, 0.55, 38] },
  // the lights fail, all over the place
  { t0: 1.3, t1: 2.35, a: [150, 24, 13, 1.5, 54], b: [162, 30, 22, 2, 54] },
  // its eyes
  { t0: 2.35, t1: 3.2, a: [16, 5, 5.2, 0.15, 36], b: [10, 4, 4.4, 0.15, 34] },
  // and all the others
  { t0: 3.2, t1: 99, a: [172, 20, 10, 1.5, 54], b: [178, 30, 18, 2.5, 54] },
];
/** The caller, when it is done. */
const LAST: Cut = { t0: 0, t1: 1, a: [34, 8, 8.2, 0.5, 40], b: [26, 6, 7.4, 0.55, 38] };
const CLEAR = 0.7;
/** The view it marks from: how far, how high (radians); how far it may be moved over the ground. */
const NEAR = 10;
const FAR = 60;
const PAN = 34;

/** The Blackout Swarm's camera: cuts round the cockroach, a view over the dark to mark from, the marked spot. */
export class BroodCamera {
  active = false;
  private shake = 0;
  private side = 1;
  private lift = 0;
  private lastCut = -1;
  private clock = 0;
  private angle = 0;
  /** The player's view: turned, raised, how far, how far ahead of the bug it looks. */
  private yaw = 0;
  private tiltUp = 0.62;
  private zoom = 30;
  private ahead = 8;
  private readonly tilted = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly place = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  start(): void {
    this.active = true;
    this.shake = 0;
    this.lastCut = -1;
    this.yaw = 0;
    this.tiltUp = 0.62;
    this.zoom = 30;
    this.ahead = 8;
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

  /** The player turns the view (radians), and draws it nearer or further (a factor). */
  turn(yaw: number, up: number): void {
    this.yaw += yaw;
    this.tiltUp = Math.min(1.35, Math.max(0.12, this.tiltUp + up));
  }

  zoomBy(f: number): void {
    this.zoom = Math.min(FAR, Math.max(NEAR, this.zoom * f));
  }

  update(camera: THREE.PerspectiveCamera, x: BroodShot): void {
    if (!this.active) return;
    this.clock += x.dt;
    let fov = 50;
    const cut = (id: number): boolean => {
      const is = this.lastCut !== id;
      this.lastCut = id;
      return is;
    };
    if (x.hitT > 3.4) {
      if (cut(6)) this.choose(LAST, x);
      const u = Math.min(1, (x.hitT - 3.4) / 1.1);
      this.pose(LAST.a.map((q, i) => q + (LAST.b[i] - q) * u), x);
      fov = LAST.a[4];
    } else if (x.shotT >= 0) {
      // over the spot, low: they stream in, they cover, and the light comes back
      if (cut(3)) this.angle = this.freest(x);
      const near = x.hitT >= 0 ? 8.4 + 3.4 * (1 - Math.exp(-x.hitT * 2.2)) : x.covered ? 12.5 - 4.1 * Math.min(1, (x.shotT - 1.8) / 1.7) : 16 - 3.5 * Math.min(1, x.shotT / 1.8);
      const el = x.hitT >= 0 ? 0.42 + 0.14 * Math.min(1, x.hitT / 2) : 0.34;
      this.spot(this.angle + x.shotT * 0.09, el, near, x);
      const c = x.shotT < 0.05;
      const hit = x.hitT >= 0 && x.hitT < 0.02;
      this.place.lerp(this.want, c || hit ? 1 : 1 - Math.exp(-x.dt * 5));
      this.s.copy(x.subject).addScaledVector(x.markUp, 0.5);
      this.look.lerp(this.s, c ? 1 : 1 - Math.exp(-x.dt * 4));
      fov = 46;
    } else if (x.stance) {
      const c = cut(1);
      this.ahead = Math.min(PAN, Math.max(-PAN, this.ahead + x.pan * x.dt * 16));
      const an = Math.atan2(x.fwd.x, x.fwd.z) + this.yaw;
      this.d.set(Math.sin(an), 0, Math.cos(an));
      this.s.copy(x.at).addScaledVector(this.d, this.ahead);
      // (from over the bug when what lies ahead of it is inside something)
      const t = x.ground.raycast(x.at.x, x.at.y + 1.5, x.at.z, this.d.x * Math.sign(this.ahead || 1), 0, this.d.z * Math.sign(this.ahead || 1), Math.abs(this.ahead) + 1);
      if (t >= 0) this.s.copy(x.at).addScaledVector(this.d, Math.sign(this.ahead) * Math.max(0, t - 1));
      this.s.y += 1.5;
      this.want.copy(this.s).addScaledVector(this.d, -Math.cos(this.tiltUp) * this.zoom);
      this.want.y += Math.sin(this.tiltUp) * this.zoom;
      this.clear(this.s, this.want, x.ground);
      this.place.lerp(this.want, c ? 1 : 1 - Math.exp(-x.dt * 9));
      this.look.lerp(this.s, c ? 1 : 1 - Math.exp(-x.dt * 11));
      fov = 55;
    } else {
      const i = CUTS.findIndex((c) => x.t >= c.t0 && x.t < c.t1);
      const c = CUTS[Math.max(0, i)];
      if (cut(10 + i)) this.choose(c, x);
      const u = Math.min(1, (x.t - c.t0) / (Math.min(c.t1, c.t0 + 1.2) - c.t0));
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
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** A place to see the spot from, `an` round it (the world's), `el` up. */
  private spot(an: number, el: number, dist: number, x: BroodShot): void {
    this.s.copy(x.subject).addScaledVector(x.markUp, 0.8);
    this.want.set(Math.sin(an) * Math.cos(el), Math.sin(el), Math.cos(an) * Math.cos(el));
    // (on a wall or a ceiling: from its own outside)
    if (x.markUp.y < 0.6) this.want.addScaledVector(x.markUp, 1.2 * (1 - x.markUp.y)).normalize();
    this.want.multiplyScalar(dist).add(this.s);
    this.clear(this.s, this.want, x.ground);
  }

  /** Round the spot: the side with the most room and the least in the way; best from where the caller stands. */
  private freest(x: BroodShot): number {
    const from = Math.atan2(x.at.x - x.subject.x, x.at.z - x.subject.z);
    let best = -1e9;
    let angle = from;
    for (let k = 0; k < 14; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45;
      this.spot(from + off, 0.36, 12, x);
      const room = this.want.distanceTo(this.s);
      const score = room - 0.5 * Math.abs(off) - 2 * this.covered(x.subject, x.markUp, 3, this.want, x.ground);
      if (score <= best) continue;
      best = score;
      angle = from + off;
    }
    return angle;
  }

  /** How many of four points round `at` (square to `up`, `size` away) are hidden from `from`. */
  private covered(at: THREE.Vector3, up: THREE.Vector3, size: number, from: THREE.Vector3, ground: DrawnGround): number {
    let n = 0;
    const side = this.tilted.copy(from).sub(at).cross(up).normalize();
    const along = this.across.crossVectors(up, side);
    for (let k = 0; k < 4; k++) {
      const p = this.point.copy(at).addScaledVector(up, 0.8).addScaledVector(k < 2 ? side : along, k % 2 ? size : -size);
      const l = this.d.copy(from).sub(p).length();
      this.d.divideScalar(l);
      if (ground.raycast(p.x, p.y, p.z, this.d.x, this.d.y, this.d.z, l) >= 0) n++;
    }
    return n;
  }

  private pose(v: number[], x: BroodShot): void {
    const yaw = ((v[0] * Math.PI) / 180) * this.side;
    const el = (v[1] * Math.PI) / 180 + this.lift;
    this.s.crossVectors(x.up, x.fwd);
    this.look.copy(x.at).addScaledVector(x.up, (v[3] - 0.1) * x.radius);
    this.d.copy(x.fwd).multiplyScalar(Math.cos(yaw)).addScaledVector(this.s, Math.sin(yaw)).multiplyScalar(Math.cos(el)).addScaledVector(x.up, Math.sin(el));
    this.place.copy(this.look).addScaledVector(this.d, v[2] * x.radius);
    this.clear(this.look, this.place, x.ground);
  }

  /** The side and the height the room allows for a cut. */
  private choose(c: Cut, x: BroodShot): void {
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
