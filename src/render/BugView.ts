import * as THREE from 'three';
import { TICK_RATE, type Bug } from '../game/bug';
import type { BugSpecies } from '../game/species';

const sphere = new THREE.SphereGeometry(1, 16, 12);
/** Unit cylinder along +Y from y=0 to y=1, so it can be stretched between two points. */
const limb = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);

interface Leg {
  pivot: THREE.Object3D;
  /** +1 on the bug's left (+x local), -1 on its right. */
  side: number;
  /** 0 or PI: tripod gait, alternate legs move together. */
  offset: number;
}

/**
 * The look of one bug: a few spheres and cylinders built from its species proportions.
 * Purely cosmetic: reads the simulation state, never writes it. Local frame: +Z forward, +Y up.
 */
export class BugView {
  readonly root = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private phase = 0;

  constructor(readonly species: BugSpecies) {
    const r = species.radius;
    const body = this.material(species.color, 0.45);
    const dark = this.material(species.accent, 0.6);
    const eye = this.material(0x050505, 0.2);
    const len = species.bodyLength * r;

    const thoraxR = 0.3 * r;
    this.part(body, 0, -0.05 * r, 0, thoraxR * 1.1, thoraxR, thoraxR * 1.3);
    const ab = species.abdomen * r;
    this.part(body, 0, 0.08 * r, -(thoraxR + ab * 0.85), ab * 0.8, ab * 0.68, ab);
    const hd = species.head * r;
    const headZ = thoraxR * 1.2 + hd * 0.8;
    this.part(body, 0, 0.02 * r, headZ, hd, hd * 0.9, hd);
    for (const s of [-1, 1]) {
      this.part(eye, s * hd * 0.55, 0.15 * hd, headZ + hd * 0.6, hd * 0.28, hd * 0.28, hd * 0.28);
      if (species.antennae > 0) {
        const base = new THREE.Vector3(s * hd * 0.35, hd * 0.6, headZ + hd * 0.5);
        const tip = base.clone().add(new THREE.Vector3(s * 0.35, 0.55, 0.75).normalize().multiplyScalar(species.antennae * r));
        this.root.add(this.limb(dark, base, tip, 0.035 * r));
      }
    }

    const perSide = Math.max(1, Math.floor(species.legs / 2));
    const reach = species.legLength * r;
    for (let i = 0; i < perSide; i++) {
      const z = perSide === 1 ? 0 : (0.5 - i / (perSide - 1)) * Math.min(len * 0.35, thoraxR * 2.4);
      for (const s of [1, -1]) {
        const pivot = new THREE.Object3D();
        pivot.position.set(s * thoraxR * 0.8, -0.1 * r, z);
        const splay = (z / (thoraxR * 1.2)) * 0.6 * reach;
        const knee = new THREE.Vector3(s * reach * 0.5, 0.35 * r, splay * 0.5);
        const foot = new THREE.Vector3(s * reach, -0.9 * r, splay);
        pivot.add(this.limb(dark, new THREE.Vector3(), knee, 0.06 * r));
        pivot.add(this.limb(dark, knee, foot, 0.045 * r));
        this.root.add(pivot);
        this.legs.push({ pivot, side: s, offset: (i + (s > 0 ? 0 : 1)) % 2 ? Math.PI : 0 });
      }
    }
  }

  /**
   * Place the view between the previous and the current tick (`alpha` in [0,1]) and animate it.
   * `dt` is the frame time in seconds (render smoothing only).
   */
  update(bug: Bug, alpha: number, dt: number): void {
    this.root.visible = bug.alive;
    if (!bug.alive) return;
    this.root.position.set(
      bug.px + (bug.x - bug.px) * alpha,
      bug.py + (bug.y - bug.py) * alpha,
      bug.pz + (bug.z - bug.pz) * alpha,
    );

    // Lean into the ground normal while standing, level out in the air. Smoothed so bumps do not jitter.
    if (bug.grounded) this.target.set(bug.nx, bug.ny, bug.nz);
    else this.target.copy(UP);
    this.up.lerp(this.target, 1 - Math.exp(-dt * 12)).normalize();
    this.fwd.set(bug.fx, 0, bug.fz);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.side.crossVectors(this.up, this.fwd);
    this.basis.makeBasis(this.side, this.up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(this.basis);

    // Walk cycle driven by actual ground speed; legs tuck in while airborne.
    const dx = bug.x - bug.px;
    const dz = bug.z - bug.pz;
    const speed = Math.sqrt(dx * dx + dz * dz) * TICK_RATE;
    this.phase += speed * dt * 2.2;
    const swingAmp = bug.grounded ? Math.min(1, speed / 2) * 0.45 : 0;
    for (const leg of this.legs) {
      const a = this.phase + leg.offset;
      leg.pivot.rotation.y = leg.side * Math.sin(a) * swingAmp;
      leg.pivot.rotation.z = bug.grounded ? leg.side * Math.max(0, Math.cos(a)) * swingAmp * 0.5 : leg.side * 0.35;
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }

  private material(color: number, roughness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
    this.materials.push(m);
    return m;
  }

  private part(m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    const mesh = new THREE.Mesh(sphere, m);
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    this.root.add(mesh);
    return mesh;
  }

  private limb(m: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, thickness: number): THREE.Mesh {
    const dir = to.clone().sub(from);
    const mesh = new THREE.Mesh(limb, m);
    mesh.castShadow = true;
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    mesh.scale.set(thickness, dir.length(), thickness);
    return mesh;
  }
}
