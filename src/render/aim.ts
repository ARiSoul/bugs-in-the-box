import * as THREE from 'three';
import type { Match } from '../game/match';

/** Length of the aim pointer. Fixed on purpose: it shows the direction only, never the range. */
const LENGTH = 3.2;

/**
 * Aim helpers: a short pointer from the active bug along the aim direction (no trajectory, so it
 * does not suggest where the shot lands) and a bobbing marker above the bug whose turn it is.
 */
export class AimView {
  private readonly pointer = new THREE.Group();
  private readonly marker: THREE.Mesh;
  private readonly dir = new Float64Array(3);
  private readonly v = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    // Built along +Y from the origin, then oriented with a quaternion each frame.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, LENGTH - 0.6, 6).translate(0, (LENGTH - 0.6) / 2, 0), mat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10).translate(0, LENGTH - 0.3, 0), mat);
    shaft.renderOrder = tip.renderOrder = 10; // drawn over the terrain, so it never hides in a wall
    this.pointer.add(shaft, tip);
    scene.add(this.pointer);

    this.marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.9, 12).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffe066 }),
    );
    scene.add(this.marker);
  }

  /** `bugPosition`: interpolated render position of the active bug. */
  update(match: Match, bugPosition: THREE.Vector3, labelHeight: number, now: number): void {
    const unit = match.activeUnit;
    const aiming = match.phase === 'aim' && unit.bug.alive;
    // (a special attack's scene has begun: nothing over the picture)
    if (aiming && match.charging && match.currentWeapon.sceneTicks > 0) {
      this.pointer.visible = this.marker.visible = false;
      return;
    }
    this.pointer.visible = aiming;
    this.marker.visible = aiming;
    if (!aiming) return;

    match.aimDirection(unit, this.dir);
    this.v.set(this.dir[0], this.dir[1], this.dir[2]);
    this.pointer.quaternion.setFromUnitVectors(AimView.UP, this.v);
    this.pointer.position.copy(bugPosition).addScaledVector(this.v, unit.bug.species.radius * 0.6);

    this.marker.position.set(bugPosition.x, bugPosition.y + labelHeight + 1.4 + Math.sin(now / 180) * 0.25, bugPosition.z);
  }
}
