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

/**
 * Keeps the orbit camera centred on a moving point. The player can still orbit and zoom:
 * the camera and its target move by the same amount, so the viewing angle and distance are kept.
 */
export class FollowCamera {
  private readonly delta = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  /** Distance the player chose (zoom). The camera only comes closer while terrain is in the way. */
  private wanted = -1;
  /** Distance this class last set, to tell the player's zoom apart from our own moves. */
  private placed = -1;

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
    this.wanted = distance;
    this.placed = -1;
  }

  /** Ease the view towards `point`. `dt` in seconds. */
  update(point: THREE.Vector3, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.delta.copy(point).sub(this.controls.target).multiplyScalar(k);
    this.controls.target.add(this.delta);
    this.camera.position.add(this.delta);
  }

  /**
   * Keep terrain from hiding the target: if an island is between the target and the camera, move the
   * camera in front of it (at once); once the view is clear, ease back to the chosen distance.
   * Call after `controls.update()`, once per frame.
   */
  avoid(obstacles: CameraObstacles, dt: number): void {
    const target = this.controls.target;
    this.offset.copy(this.camera.position).sub(target);
    const dist = this.offset.length();
    if (dist < 1e-6) return;
    if (this.wanted < 0) this.wanted = dist;
    else if (this.placed > 0 && Math.abs(dist - this.placed) > 1e-3) this.wanted *= dist / this.placed; // player zoomed
    this.offset.divideScalar(dist);

    const o = this.offset;
    const hit = obstacles.raycast(
      target.x + o.x * RAY_START,
      target.y + o.y * RAY_START,
      target.z + o.z * RAY_START,
      o.x,
      o.y,
      o.z,
      this.wanted,
    );
    const free = hit < 0 ? this.wanted : Math.max(MIN_DISTANCE, RAY_START + hit - MARGIN);
    const goal = Math.min(this.wanted, free);
    const next = goal < dist ? goal : dist + (goal - dist) * (1 - Math.exp(-dt * 3));
    this.camera.position.copy(target).addScaledVector(o, next);
    this.placed = next;
  }
}
