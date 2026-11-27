import * as THREE from 'three';
import type { Match } from '../game/match';

/** Length of the aim pointer. Fixed on purpose: it shows the direction only, never the range. */
const LENGTH = 3.2;
/** Dots along where a burrow would go. */
const DOTS = 42;

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
  /** A burrow's way: dots down, along under the ground and up, and a ring where it comes out. */
  private readonly dots: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  private readonly start: THREE.Mesh;
  /** A red cross in the start ring, where the Burrow cannot dig. */
  private readonly cross: THREE.Group;
  private readonly path: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

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

    const dot = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), dot, DOTS);
    this.dots.renderOrder = 10;
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    scene.add(this.dots);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthTest: false }));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    scene.add(this.ring);
    // (on the ground at its feet: its body over it)
    this.start = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.07, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6 }));
    this.start.renderOrder = 10;
    this.start.visible = false;
    scene.add(this.start);
    // (where it cannot dig: a red cross in its ring)
    const bar = new THREE.BoxGeometry(2.2, 0.06, 0.26);
    const red = new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.95, depthTest: false });
    this.cross = new THREE.Group();
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const m = new THREE.Mesh(bar, red);
      m.rotation.y = a;
      m.renderOrder = 10;
      m.scale.setScalar(1.25);
      this.cross.add(m);
    }
    this.cross.visible = false;
    scene.add(this.cross);
  }

  hide(): void {
    this.pointer.visible = this.marker.visible = this.dots.visible = this.ring.visible = this.start.visible = this.cross.visible = false;
  }

  /** `bugPosition`: interpolated render position of the active bug. */
  update(match: Match, bugPosition: THREE.Vector3, labelHeight: number, now: number, cameraDistance: number): void {
    const unit = match.activeUnit;
    const aiming = match.phase === 'aim' && unit.bug.alive && match.underground === null && match.inTunnel === null;
    // (a special attack has a view and a sight of its own)
    if (aiming && match.currentWeapon.sceneTicks > 0) {
      this.pointer.visible = this.marker.visible = false;
      return;
    }
    this.pointer.visible = aiming;
    // (a burrow: where it goes, not which way it points; longer as it is charged)
    const burrow = aiming && match.currentWeapon.kind === 'burrow';
    this.dots.visible = this.ring.visible = this.start.visible = burrow;
    if (!burrow) this.cross.visible = false;
    if (burrow) {
      this.pointer.visible = false;
      this.showBurrow(match, now, bugPosition);
    }
    // (near enough, it needs no mark)
    this.marker.visible = aiming && cameraDistance > 24;
    if (!aiming) return;

    match.aimDirection(unit, this.dir);
    this.v.set(this.dir[0], this.dir[1], this.dir[2]);
    this.pointer.quaternion.setFromUnitVectors(AimView.UP, this.v);
    this.pointer.position.copy(bugPosition).addScaledVector(this.v, unit.bug.species.radius * 0.6);

    this.marker.position.set(bugPosition.x, bugPosition.y + labelHeight + 1.4 + Math.sin(now / 180) * 0.25, bugPosition.z);
  }

  private showBurrow(match: Match, now: number, drawn: THREE.Vector3): void {
    const u = match.activeUnit;
    const p = match.burrowPath(u, match.charging ? match.power : 0, this.path);
    // (the ground before it is too thin, or hard: no way)
    const start = this.start.material as THREE.MeshBasicMaterial;
    const b0 = u.bug;
    // (at its feet as it is drawn: on a drawn floor, over the field's own ground)
    this.start.position.set(drawn.x - b0.nx * (b0.species.radius * 0.9 - 0.06), drawn.y - b0.ny * (b0.species.radius * 0.9 - 0.06), drawn.z - b0.nz * (b0.species.radius * 0.9 - 0.06));
    this.start.quaternion.setFromUnitVectors(AimView.UP, this.v.set(b0.nx, b0.ny, b0.nz));
    this.cross.visible = p.length < 12;
    if (p.length < 12) {
      this.dots.visible = this.ring.visible = false;
      start.color.set(0xff6a5a);
      // (before it, the way it would have dug: over all, not under its body)
      this.cross.position.copy(this.start.position).add(this.v.set(b0.hx, 0, b0.hz).normalize().multiplyScalar(3.6));
      this.cross.quaternion.copy(this.start.quaternion);
      return;
    }
    start.color.set(0xffd27a);
    let total = 0;
    for (let k = 0; k + 3 < p.length; k += 3) total += Math.hypot(p[k + 3] - p[k], p[k + 4] - p[k + 1], p[k + 5] - p[k + 2]);
    // (the dots run along it, slowly)
    const shift = (now / 900) % 1;
    for (let i = 0; i < DOTS; i++) {
      let s = ((i + shift) / DOTS) * total;
      let k = 0;
      for (; k + 6 < p.length; k += 3) {
        const l = Math.hypot(p[k + 3] - p[k], p[k + 4] - p[k + 1], p[k + 5] - p[k + 2]);
        if (s <= l) break;
        s -= l;
      }
      const l = Math.hypot(p[k + 3] - p[k], p[k + 4] - p[k + 1], p[k + 5] - p[k + 2]) || 1;
      const f = Math.min(1, s / l);
      let x = p[k] + (p[k + 3] - p[k]) * f;
      let y = p[k + 1] + (p[k + 4] - p[k + 1]) * f;
      let z = p[k + 2] + (p[k + 5] - p[k + 2]) * f;
      // (laid on the ground over where it goes: what the player reads is the way over the top)
      const b = u.bug;
      const t = match.field.raycast(x + b.nx * 6, y + b.ny * 6, z + b.nz * 6, -b.nx, -b.ny, -b.nz, 12);
      if (t >= 0) {
        x += b.nx * (6 - t + 0.08);
        y += b.ny * (6 - t + 0.08);
        z += b.nz * (6 - t + 0.08);
      }
      // (where it runs under the ground: smaller, in the earth's colour; bright where it goes in and comes up)
      const under = k === 3;
      const dash = (i % 3 === 2 ? 0.45 : 1) * (under ? 0.75 : 1);
      this.m.makeScale(dash, 0.45 * dash, dash).setPosition(x, y, z);
      this.dots.setMatrixAt(i, this.m);
      this.dots.setColorAt(i, this.c.set(under ? 0xc89a62 : 0xffd27a));
    }
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    const b = u.bug;
    this.ring.position.set(p[9] - b.nx * b.species.radius * 0.9, p[10] - b.ny * b.species.radius * 0.9, p[11] - b.nz * b.species.radius * 0.9);
    // (and a ring where it goes in, at its feet)
    this.start.position.set(drawn.x - b.nx * (b.species.radius * 0.9 - 0.06), drawn.y - b.ny * (b.species.radius * 0.9 - 0.06), drawn.z - b.nz * (b.species.radius * 0.9 - 0.06));
    this.start.quaternion.setFromUnitVectors(AimView.UP, this.v.set(b.nx, b.ny, b.nz));
    this.ring.quaternion.setFromUnitVectors(AimView.UP, this.v.set(b.nx, b.ny, b.nz));
    this.ring.scale.setScalar(1 + 0.08 * Math.sin(now / 160));
  }
}
