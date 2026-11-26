import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** What the camera needs to see the terrain (the density field, never the mesh). */
export interface CameraObstacles {
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number;
  sample(x: number, y: number, z: number): number;
  normal(x: number, y: number, z: number, out?: [number, number, number]): [number, number, number];
}

/** The view ray starts this far from the target, so the ground under the bug does not count. */
const RAY_START = 1.2;
/** Gap kept between the camera and the terrain that blocks the view (the near plane is 0.5). */
const MARGIN = 1.5;
const MIN_DISTANCE = 3;
/** How far the camera may rise above the player's chosen angle to see past terrain (radians), and in what steps. */
const MAX_LIFT = 1.1;
const LIFT_STEP = 0.1;
/** Extra rise above the first clear angle, so an island edge does not graze the view. */
const LIFT_MARGIN = 0.08;
/** Radians per second when rising. */
const RISE_SPEED = 2.5;
/** Seconds the view must stay clear before the camera comes back down or out. */
const SETTLE_DELAY = 0.8;
/** Never closer to straight down than this (polar angle from +Y). */
const MIN_PHI = 0.12;
/** The camera keeps at least this much distance field around it (inside walls the field is negative). */
const CLEARANCE = 1.2;
/** Chase view at the start of a turn: this far behind the bug, this high above it (radians). */
export const CHASE_DISTANCE = 15;
export const CHASE_ELEVATION = 0.42;
/** Highest the chase view climbs (radians) to see past terrain behind the bug before it comes closer. */
const CHASE_MAX_ELEVATION = 1.2;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Keeps the orbit camera centred on a moving point. The player can still orbit and zoom:
 * the camera and its target move by the same amount, so the viewing angle and distance are kept.
 */
export class FollowCamera {
  private readonly delta = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly sph = new THREE.Spherical();
  private readonly dir = new THREE.Vector3();
  private readonly n: [number, number, number] = [0, 0, 0];
  /** Distance and polar angle the player chose. The camera only rises or comes closer while terrain is in the way. */
  private wanted = -1;
  private basePhi = 0;
  /** Current extra rise above `basePhi` (radians). */
  private lift = 0;
  private lowerWait = 0;
  private outWait = 0;
  /** What this class last set, to tell the player's zoom and orbit apart from our own moves. */
  private placed = -1;
  private placedPhi = -1;
  /** A glide to the chase view in progress: seconds done and total, start pose, offset from the target. */
  private glideT = -1;
  private glideTime = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly chaseOffset = new THREE.Vector3();
  /** Lowest angle of the chase view above the bug (radians); a scenario with tall walls sets it higher. */
  chaseElevation = CHASE_ELEVATION;
  /** It stays where the player put it, whatever is in the way (that is seen through); or it moves out of the way. */
  stays = true;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly controls: OrbitControls,
  ) {
    controls.enablePan = false; // panning would fight the follow
  }

  /** Jump straight to `point`, keeping the viewing angle, at the given distance. */
  focus(point: THREE.Vector3, distance: number): void {
    this.offset.copy(this.camera.position).sub(this.controls.target).setLength(distance);
    this.controls.target.copy(point);
    this.camera.position.copy(point).add(this.offset);
    this.controls.update();
    this.wanted = -1;
    this.placed = -1;
    this.placedPhi = -1;
    this.lift = 0;
  }

  /** True while gliding to a chase view (`avoid` waits for it). */
  get gliding(): boolean {
    return this.glideT >= 0;
  }

  /**
   * Where the chase view of a bug at `point` facing (fx, fz) puts the camera: behind it and a little above,
   * looking where it walks. Pulled in front of any terrain behind the bug.
   */
  chasePose(obstacles: CameraObstacles, point: THREE.Vector3, fx: number, fz: number, outPos: THREE.Vector3): THREE.Vector3 {
    const l = Math.sqrt(fx * fx + fz * fz) || 1;
    // the lowest clear angle at the full distance; with a wall right behind, the angle that sees farthest
    if (this.stays) {
      const c = Math.cos(CHASE_ELEVATION);
      return outPos.copy(point).add(this.dir.set((-fx / l) * c, Math.sin(CHASE_ELEVATION), (-fz / l) * c).multiplyScalar(CHASE_DISTANCE));
    }
    let bestElev = this.chaseElevation;
    let bestDist = -1;
    for (let e = this.chaseElevation; e <= CHASE_MAX_ELEVATION + 1e-6; e += LIFT_STEP) {
      const c = Math.cos(e);
      const d = this.dir.set((-fx / l) * c, Math.sin(e), (-fz / l) * c);
      const hit = obstacles.raycast(point.x + d.x * RAY_START, point.y + d.y * RAY_START, point.z + d.z * RAY_START, d.x, d.y, d.z, CHASE_DISTANCE);
      const dist = hit >= 0 ? Math.max(MIN_DISTANCE, RAY_START + hit - MARGIN) : CHASE_DISTANCE;
      if (dist > bestDist + 0.5) {
        bestDist = dist;
        bestElev = e;
      }
      if (hit < 0) break;
    }
    const c = Math.cos(bestElev);
    const d = this.dir.set((-fx / l) * c, Math.sin(bestElev), (-fz / l) * c);
    return outPos.copy(point).addScaledVector(d, bestDist);
  }

  /** Glide (over `seconds`) to the chase view of a bug at `point` facing (fx, fz); `update` carries it on. */
  chase(obstacles: CameraObstacles, point: THREE.Vector3, fx: number, fz: number, seconds: number): void {
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.controls.target);
    this.chaseOffset.copy(this.chasePose(obstacles, point, fx, fz, this.delta)).sub(point);
    this.glideT = 0;
    this.glideTime = seconds;
  }

  /**
   * Look down on the target at least this steeply (`elevation`, radians over the level) and from at least this far,
   * eased: to see a way laid on the ground (a burrow's) from above, not along it.
   */
  overlook(elevation: number, distance: number, dt: number, fx = 0, fz = 0): void {
    this.offset.copy(this.camera.position).sub(this.controls.target);
    this.sph.setFromVector3(this.offset);
    const phi = Math.PI / 2 - elevation;
    const k = 1 - Math.exp(-dt * 5);
    // (from behind the way (fx, fz), turned a little aside: the way runs across the view, not up it)
    if (fx !== 0 || fz !== 0) {
      let d = Math.atan2(-fx, -fz) + 0.55 - this.sph.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.sph.theta += d * k;
    }
    if (this.sph.phi > phi) this.sph.phi += (phi - this.sph.phi) * k;
    if (this.sph.radius < distance) this.sph.radius += (distance - this.sph.radius) * k;
    this.camera.position.copy(this.controls.target).add(this.offset.setFromSpherical(this.sph));
  }

  /** Turn the view about the target by `radians` (with the bug, so it stays behind it). */
  turnWith(radians: number): void {
    this.offset.copy(this.camera.position).sub(this.controls.target).applyAxisAngle(UP, radians);
    this.camera.position.copy(this.controls.target).add(this.offset);
  }

  /** Ease the view towards `point`. `dt` in seconds. */
  update(point: THREE.Vector3, dt: number): void {
    if (this.glideT >= 0) {
      this.glideT += dt;
      const u = Math.min(1, this.glideT / this.glideTime);
      const e = u * u * (3 - 2 * u);
      this.controls.target.lerpVectors(this.fromTarget, point, e);
      this.camera.position.lerpVectors(this.fromPos, this.delta.copy(point).add(this.chaseOffset), e);
      if (u >= 1) {
        // the chase view becomes the player's chosen angle and distance
        this.glideT = -1;
        this.wanted = -1;
        this.placed = -1;
        this.placedPhi = -1;
        this.lift = 0;
      }
      return;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.delta.copy(point).sub(this.controls.target).multiplyScalar(k);
    this.controls.target.add(this.delta);
    this.camera.position.add(this.delta);
  }

  /**
   * Keep terrain from hiding the target. If an island is in the way, the camera first rises (up to
   * MAX_LIFT above the player's angle) to look over it; only if that is not enough does it come closer,
   * in front of the terrain. Once the view is clear it eases back to the player's angle and distance.
   * Call after `controls.update()`, once per frame.
   */
  avoid(obstacles: CameraObstacles, dt: number): void {
    if (this.glideT >= 0) return;
    if (this.stays) {
      // (as if nothing were in the way; back to the other way, it begins anew)
      this.wanted = this.placed = this.placedPhi = -1;
      this.lift = 0;
      return;
    }
    const target = this.controls.target;
    this.sph.setFromVector3(this.dir.copy(this.camera.position).sub(target));
    const dist = this.sph.radius;
    if (dist < 1e-6) return;
    if (this.wanted < 0) {
      this.wanted = dist;
      this.basePhi = this.sph.phi;
    } else {
      if (this.placed > 0 && Math.abs(dist - this.placed) > 1e-3) this.wanted *= dist / this.placed; // player zoomed
      if (this.placedPhi >= 0 && Math.abs(this.sph.phi - this.placedPhi) > 1e-4) this.basePhi += this.sph.phi - this.placedPhi; // player orbited
    }
    this.wanted = Math.min(this.controls.maxDistance, Math.max(MIN_DISTANCE, this.wanted));
    this.basePhi = Math.min(Math.PI - 0.05, Math.max(MIN_PHI, this.basePhi));
    const theta = this.sph.theta;

    // Smallest rise that gives a clear view at the chosen distance (-1: none does).
    let need = -1;
    for (let l = 0; l <= MAX_LIFT + 1e-6; l += LIFT_STEP) {
      if (this.blocked(obstacles, Math.max(MIN_PHI, this.basePhi - l), theta, this.wanted) < 0) {
        need = l;
        break;
      }
    }
    const canSee = need >= 0;
    const goalLift = canSee ? Math.min(MAX_LIFT, need + LIFT_MARGIN) : MAX_LIFT;
    // Rise at once (at a steady speed); come down only after the lower view has stayed clear for a while,
    // so things passing by do not make the camera bob up and down.
    if (goalLift >= this.lift) {
      this.lowerWait = 0;
      this.lift = Math.min(goalLift, this.lift + RISE_SPEED * dt);
    } else if ((this.lowerWait += dt) > SETTLE_DELAY) {
      this.lift += (goalLift - this.lift) * (1 - Math.exp(-dt * 1.2));
    }
    const phi = Math.max(MIN_PHI, this.basePhi - this.lift);

    // Come closer only when no rise can clear the view; go back out only after it has stayed clear.
    let goal = this.wanted;
    if (!canSee) {
      const hit = this.blocked(obstacles, phi, theta, this.wanted);
      if (hit >= 0) goal = Math.max(MIN_DISTANCE, RAY_START + hit - MARGIN);
    }
    let next = dist;
    if (goal < dist) {
      next = goal;
      this.outWait = 0;
    } else if ((this.outWait += dt) > SETTLE_DELAY) {
      next = dist + (goal - dist) * (1 - Math.exp(-dt * 2));
    }
    this.sph.set(next, phi, theta);
    this.camera.position.setFromSpherical(this.sph).add(target);
    this.pushOut(obstacles);
    // (where it really is: pushed out of a wall is not zoomed)
    this.sph.setFromVector3(this.dir.copy(this.camera.position).sub(target));
    this.placed = this.sph.radius;
    this.placedPhi = this.sph.phi;
  }

  /** Whether something is in the way of the target, or of the bug's sides (from the camera's side). */
  hides(obstacles: CameraObstacles): boolean {
    const t = this.controls.target;
    const c = this.camera.position;
    if (obstacles.sample(c.x, c.y, c.z) < 0.6) return true;
    this.dir.copy(c).sub(t);
    const far = this.dir.length();
    if (far < RAY_START) return false;
    this.dir.divideScalar(far);
    const side = this.offset.crossVectors(UP, this.dir).normalize();
    const up = this.delta.crossVectors(this.dir, side);
    for (const [a, b] of [[0, 0.4], [1.6, 0.6], [-1.6, 0.6], [0, 2]]) {
      const x = t.x + side.x * a + up.x * b + this.dir.x * RAY_START;
      const y = t.y + side.y * a + up.y * b + this.dir.y * RAY_START;
      const z = t.z + side.z * a + up.z * b + this.dir.z * RAY_START;
      const hit = obstacles.raycast(x, y, z, this.dir.x, this.dir.y, this.dir.z, far - RAY_START);
      if (hit >= 0 && hit < far - RAY_START) return true;
    }
    return false;
  }

  /** Softly push the camera out of solid terrain (a wall behind it), along the field's gradient. */
  private pushOut(obstacles: CameraObstacles): void {
    const p = this.camera.position;
    for (let i = 0; i < 4; i++) {
      const d = obstacles.sample(p.x, p.y, p.z);
      if (d >= CLEARANCE) return;
      const n = obstacles.normal(p.x, p.y, p.z, this.n);
      p.x += n[0] * (CLEARANCE - d);
      p.y += n[1] * (CLEARANCE - d);
      p.z += n[2] * (CLEARANCE - d);
    }
  }

  /** Distance along the view ray (from RAY_START) to the first terrain, or -1 if clear up to `range`. */
  private blocked(obstacles: CameraObstacles, phi: number, theta: number, range: number): number {
    const d = this.dir.setFromSphericalCoords(1, phi, theta);
    const t = this.controls.target;
    return obstacles.raycast(t.x + d.x * RAY_START, t.y + d.y * RAY_START, t.z + d.z * RAY_START, d.x, d.y, d.z, range);
  }
}
