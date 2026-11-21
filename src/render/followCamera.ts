import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** What the camera needs to see the terrain (the density field, never the mesh). */
export interface CameraObstacles {
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number;
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

/**
 * Keeps the orbit camera centred on a moving point. The player can still orbit and zoom:
 * the camera and its target move by the same amount, so the viewing angle and distance are kept.
 */
export class FollowCamera {
  private readonly delta = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly sph = new THREE.Spherical();
  private readonly dir = new THREE.Vector3();
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

  /** Ease the view towards `point`. `dt` in seconds. */
  update(point: THREE.Vector3, dt: number): void {
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
    // so islands passing by do not make the camera bob up and down.
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
    this.placed = next;
    this.placedPhi = phi;
  }

  /** Distance along the view ray (from RAY_START) to the first terrain, or -1 if clear up to `range`. */
  private blocked(obstacles: CameraObstacles, phi: number, theta: number, range: number): number {
    const d = this.dir.setFromSphericalCoords(1, phi, theta);
    const t = this.controls.target;
    return obstacles.raycast(t.x + d.x * RAY_START, t.y + d.y * RAY_START, t.z + d.z * RAY_START, d.x, d.y, d.z, range);
  }
}
