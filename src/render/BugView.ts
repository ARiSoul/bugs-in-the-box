import * as THREE from 'three';
import { KILL_Y, TICK_RATE, WALKABLE_NY, type Bug } from '../game/bug';
import type { BugSpecies } from '../game/species';

const sphere = new THREE.SphereGeometry(1, 16, 12);
/** Unit cylinder along +Y from y=0 to y=1, so it can be stretched between two points. */
const limb = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** What a dead bug's body needs to fall onto the terrain below it (render only: the density field). */
export interface CorpseGround {
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number;
}

/** Death on screen: seconds to roll onto the back, of twitching, and of fading to the corpse colours. */
const DEATH_ROLL = 0.5;
const DEATH_TWITCH = 2.2;
const DEATH_FADE = 1.4;
/** A body falls with this gravity (render only) when the ground under it is blown away. */
const CORPSE_GRAVITY = 40;
/** Corpse colours: this much of the way to dull grey, and this dark. */
const CORPSE_GREY = new THREE.Color(0x3a3833);

interface Leg {
  pivot: THREE.Object3D;
  /** +1 on the bug's left (+x local), -1 on its right. */
  side: number;
  /** 0 or PI: tripod gait, alternate legs move together. */
  offset: number;
  /** The foot, in the pivot's frame, at rest. */
  foot: THREE.Vector3;
  /** Turned about the leg's hinge to rest the foot on the ground under it (smoothed). */
  bend: number;
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
  private readonly foot = new THREE.Vector3();
  private phase = 0;
  private ring: THREE.Mesh | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;
  /** Colours to fade from when the bug dies. */
  private readonly tints: { m: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }[] = [];
  /** Seconds since death (-1: alive). */
  private deadT = -1;
  /** Fell out of the world: nothing left to show. */
  private gone = false;
  /** The body: centre at rest, falling speed, orientation at death, the side it rolls to. */
  private readonly corpse = new THREE.Vector3();
  private corpseVy = 0;
  private readonly deathQ = new THREE.Quaternion();
  private readonly roll = new THREE.Quaternion();
  private rollSide = 1;
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
      this.ringMaterial = ringMat;
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
        this.legs.push({ pivot, side: s, offset: (i + (s > 0 ? 0 : 1)) % 2 ? Math.PI : 0, foot, bend: 0 });
      }
    }
  }

  /**
   * Place the view between the previous and the current tick (`alpha` in [0,1]) and animate it.
   * `dt` is the frame time in seconds (render smoothing only).
   */
  update(bug: Bug, alpha: number, dt: number, ground?: CorpseGround): void {
    if (!bug.alive) {
      this.updateDead(bug, dt, ground);
      return;
    }
    this.root.visible = true;
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
      const bend = bug.grounded && ground ? this.bendToGround(leg, ground) : 0;
      leg.bend += (bend - leg.bend) * (1 - Math.exp(-dt * 25));
      leg.pivot.rotation.z = leg.side * (leg.bend + (bug.grounded ? Math.max(0, Math.cos(a)) * swingAmp * 0.5 : 0.35));
    }
  }

  /**
   * How far a leg turns about its hinge so its foot rests on the ground under it (a key's top on one side, the
   * gap beside it on the other). Reads the density field, like the simulation.
   */
  private bendToGround(leg: Leg, ground: CorpseGround): number {
    const r = this.species.radius;
    const scale = this.root.scale.x;
    const yaw = leg.pivot.rotation.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const p = leg.pivot.position;
    const f = leg.foot;
    // (the foot at rest, in the world; the far-away lift included, see setCameraDistance)
    const at = this.foot.set(p.x + f.x * c + f.z * s, p.y + f.y, p.z + f.z * c - f.x * s).multiplyScalar(scale).applyQuaternion(this.root.quaternion).add(this.root.position);
    at.y += (scale - 1) * r;
    const above = 0.9 * r * scale;
    const t = ground.raycast(at.x + this.up.x * above, at.y + this.up.y * above, at.z + this.up.z * above, -this.up.x, -this.up.y, -this.up.z, 2.2 * r * scale);
    // (nothing under it, or a wall over it: the leg stays as it is)
    if (t <= 0) return 0;
    const dy = (above - t) / scale;
    const reach = Math.abs(f.x);
    const long = Math.sqrt(reach * reach + f.y * f.y);
    const bend = Math.asin(Math.min(0.95, Math.max(-0.99, (f.y + dy) / long))) - Math.asin(f.y / long);
    return Math.min(0.9, Math.max(-0.6, bend));
  }

  /**
   * A dead bug rolls onto its back with a little hop, kicks its legs, curls them up and goes dull; the body
   * stays where it died (and falls if the ground under it is blown away). One that fell out of the world
   * is just gone.
   */
  private updateDead(bug: Bug, dt: number, ground?: CorpseGround): void {
    const r = this.species.radius;
    if (this.deadT < 0) {
      this.deadT = 0;
      this.gone = bug.y <= KILL_Y;
      this.corpse.set(bug.x, bug.y, bug.z);
      this.corpseVy = 0;
      this.fwd.set(bug.fx, 0, bug.fz).normalize();
      this.side.crossVectors(UP, this.fwd);
      this.basis.makeBasis(this.side, UP, this.fwd);
      this.deathQ.setFromRotationMatrix(this.basis);
      this.rollSide = Math.random() < 0.5 ? -1 : 1; // render only
      for (const tint of this.tints) {
        tint.color.copy(tint.m.color);
        tint.emissive.copy(tint.m.emissive);
      }
    }
    if (this.gone) {
      this.root.visible = false;
      return;
    }
    this.deadT += dt;
    const t = this.deadT;

    // the body falls (render only) while there is air under it
    if (ground) {
      const below = ground.raycast(this.corpse.x, this.corpse.y, this.corpse.z, 0, -1, 0, 80);
      if (below < 0 || below > r + 0.05) {
        this.corpseVy += CORPSE_GRAVITY * dt;
        const drop = this.corpseVy * dt;
        this.corpse.y -= below < 0 ? drop : Math.min(drop, below - r);
        if (this.corpse.y < KILL_Y) {
          this.gone = true;
          this.root.visible = false;
          return;
        }
      } else this.corpseVy = 0;
    }

    // roll onto the back with a hop, then lie a little lower (the legs up)
    const u = Math.min(1, t / DEATH_ROLL);
    const e = u * u * (3 - 2 * u);
    this.roll.setFromAxisAngle(FORWARD, this.rollSide * Math.PI * e);
    this.root.quaternion.copy(this.deathQ).multiply(this.roll);
    this.root.position.set(this.corpse.x, this.corpse.y + Math.sin(Math.PI * u) * r * 1.1 - r * 0.3 * e, this.corpse.z);
    this.groundY = this.root.position.y;
    this.root.visible = true;

    // the legs kick, slower and weaker, then stay curled over the belly
    const kick = t < DEATH_TWITCH ? Math.sin(t * 26) * 0.45 * (1 - t / DEATH_TWITCH) : 0;
    for (const leg of this.legs) {
      leg.pivot.rotation.y = leg.side * kick * (leg.offset ? 0.6 : -0.6);
      leg.pivot.rotation.z = -leg.side * (1.1 * e) + kick * 0.5;
    }

    // dull colours; the team ring fades away
    const f = Math.min(1, t / DEATH_FADE);
    for (const tint of this.tints) {
      tint.m.color.copy(tint.color).lerp(CORPSE_GREY, f * 0.6);
      tint.m.emissive.copy(tint.emissive).multiplyScalar(1 - f);
    }
    if (this.ring && this.ringMaterial) {
      this.ringMaterial.opacity = 0.85 * (1 - f);
      this.ring.visible = f < 1;
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
    this.tints.push({ m, color: new THREE.Color(), emissive: new THREE.Color() });
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
