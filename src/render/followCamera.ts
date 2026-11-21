import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Keeps the orbit camera centred on a moving point. The player can still orbit and zoom:
 * the camera and its target move by the same amount, so the viewing angle and distance are kept.
 */
export class FollowCamera {
  private readonly delta = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

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
  }

  /** Ease the view towards `point`. `dt` in seconds. */
  update(point: THREE.Vector3, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.delta.copy(point).sub(this.controls.target).multiplyScalar(k);
    this.controls.target.add(this.delta);
    this.camera.position.add(this.delta);
  }
}
