import * as THREE from 'three';
import { TICK_RATE, WALKABLE_NY, type Bug } from '../game/bug';
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
/** Rotation that lays a ring (made in the xy plane) flat on the floor. */
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class BugView {
  readonly root = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3();
  private readonly ascent = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private phase = 0;
  private ring: THREE.Mesh | null = null;
  /** Height of the bug's centre from the last `update` (before the far-away lift). */
  private groundY = 0;

  /**
   * Readability from afar (render only): the bug grows with the camera distance (from ~50 units, at most
   * 1.7×, lifted so its feet stay on the floor) and its team ring a little more (at most 1.6× the bug).
   * Call after `update`.
   */
  setCameraDistance(cameraDistance: number): void {
    const s = Math.min(1.7, Math.max(1, cameraDistance / 50));
    this.root.scale.setScalar(s);
    this.root.position.y = this.groundY + (s - 1) * this.species.radius;
    if (this.ring) this.ring.scale.setScalar(Math.min(1.6, Math.max(1, cameraDistance / 45)));
  }

  /** `teamColor`: a soft ring in the team colour under the bug, so it reads from far away. */
  constructor(
    readonly species: BugSpecies,
    teamColor?: number,
  ) {
    const r = species.radius;
    if (teamColor !== undefined) {
      const ringMat = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false });
      this.materials.push(ringMat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.05, r * 1.6, 32), ringMat);
      ring.quaternion.copy(FLAT);
      ring.position.y = -r + 0.12;
      ring.renderOrder = 5;
      this.root.add(ring);
      this.ring = ring;
    }
    const body = this.material(species.color, 0.45);
    // a faint glow in the team colour: the bug reads from far away and in the dark
    if (teamColor !== undefined) body.emissive.setHex(teamColor).multiplyScalar(0.22);
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
    this.groundY = this.root.position.y;

    // Lean into the ground normal while standing, level out in the air. Smoothed so bumps do not jitter.
    if (bug.grounded) this.target.set(bug.nx, bug.ny, bug.nz);
    else this.target.copy(UP);
    this.up.lerp(this.target, 1 - Math.exp(-dt * 12)).normalize();
    // forward along the surface; on a steep one (climbing), facing into it means heading up it
    this.fwd.set(bug.fx, 0, bug.fz);
    const into = this.fwd.dot(this.up);
    this.fwd.addScaledVector(this.up, -into);
    if (into < 0) this.fwd.addScaledVector(this.ascent.copy(UP).addScaledVector(this.up, -this.up.y), -into / Math.max(1e-6, Math.sqrt(1 - this.up.y * this.up.y)));
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(bug.fx, 0, bug.fz).addScaledVector(this.up, -this.up.dot(this.fwd));
    this.fwd.normalize();
    this.side.crossVectors(this.up, this.fwd);
    this.basis.makeBasis(this.side, this.up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(this.basis);
    // the team ring stays flat on the floor whatever the bug leans into; on a steep surface it lies on it
    if (this.ring) {
      if (bug.grounded && bug.ny < WALKABLE_NY) this.ring.quaternion.copy(FLAT);
      else this.ring.quaternion.copy(this.root.quaternion).invert().multiply(FLAT);
    }

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
    // no fog: a bug reads in the far, dark corners too
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, fog: false });
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
