import * as THREE from 'three';
import { KILL_Y, TICK_RATE, type Bug } from '../game/bug';
import type { BugSpecies } from '../game/species';

const sphere = new THREE.SphereGeometry(1, 28, 20);
/** Unit cylinder along +Y from y=0 to y=1, so it can be stretched between two points. */
const limb = new THREE.LatheGeometry(
  [[0.001, -0.04], [0.6, -0.032], [0.9, -0.016], [1, 0], [1, 1], [0.9, 1.016], [0.6, 1.032], [0.001, 1.04]].map(([x, y]) => new THREE.Vector2(x, y)),
  9,
);
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/** What the bug is drawn on (render only, see `DrawnGround`): the density field, and the parts drawn over it. */
export interface RestGround {
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT?: number): number;
  /** Distance to what a foot rests on; `offset` is then how far that lies above the density's surface. */
  rest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number;
  readonly offset: number;
}

/** Death on screen: seconds to roll onto the back, of twitching, and of fading to the corpse colours. */
const DEATH_ROLL = 0.5;
const DEATH_TWITCH = 2.2;
const DEATH_FADE = 1.4;
/** A body falls with this gravity (render only) when the ground under it is blown away. */
const CORPSE_GRAVITY = 40;
/** Corpse colours: this much of the way to dull grey, and this dark. */
const CORPSE_GREY = new THREE.Color(0x3a3833);

/** An archer's stance (special attack): all in the view's own frame, in units of the species' radius. */
export interface StandPose {
  /** 0: on all its legs, 1: up on its hind two. */
  weight: number;
  /** How far the body leans back from upright, with the aim (radians, about its x). */
  lean: number;
  /** The face's angle up from level (radians). */
  look: number;
  /** Where the bow's grip and the string's nock are. */
  grip: THREE.Vector3;
  nock: THREE.Vector3;
  /** Sway of the free legs (radians), and how far they spread (0..1). */
  sway: number;
  spread: number;
  /** The free legs folded down and back along the body (0..1). */
  fold: number;
  /** The front two at its head, tying its scarf on (0..1). */
  tie: number;
}

interface Leg {
  /** Its two segments, with their rest lengths and thickness. */
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  knee: THREE.Vector3;
  l1: number;
  l2: number;
  home: THREE.Vector3;
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
export class BugView {
  readonly root = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3();
  private readonly heading = new THREE.Vector3();
  private readonly lastFwd = new THREE.Vector3(0, 0, 1);
  private readonly side = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly target = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private phase = 0;
  /** Everything but the legs: it pitches up when the bug stands. */
  readonly torso = new THREE.Group();
  /** Set by a special attack: the stance it is in (weight 0: none). */
  readonly pose: StandPose = { weight: 0, lean: 0, look: 0, grip: new THREE.Vector3(), nock: new THREE.Vector3(), sway: 0, spread: 0, fold: 0, tie: 0 };
  private posed = false;
  /** The head (eyes, antennae) and the abdomen turn on their own in a stance. */
  readonly head = new THREE.Group();
  private readonly abdomen = new THREE.Group();
  /** The three lumps of its body (abdomen, thorax, head): unit spheres, scaled. */
  readonly lumps: THREE.Mesh[] = [];
  /** It fights off a swarm, sinking under it (0..1); it tumbles, its legs thrown up (0..1). */
  struggle = 0;
  tumble = 0;
  private fight = 0;
  /** Where its body rides when it stands on all its legs (a cockroach is low). */
  readonly restY: number = 0;
  /** A cockroach's wing cases: how far they are open, whether they rub (0..1); its shell is cracked. */
  wings = 0;
  rub = 0;
  cracked = false;
  private readonly cases: THREE.Group[] = [];
  private readonly cracks: THREE.Object3D[] = [];
  private readonly flakes: { mesh: THREE.Mesh; v: THREE.Vector3 }[] = [];
  private crackT = -1;
  /** Held down by a web (0..1, eased): it crouches and pulls. */
  held = 0;
  private heldNow = 0;
  /** The head's middle and radius, and the eyes' material (for what a special attack adds to them). */
  readonly headAt = new THREE.Vector3();
  headRadius = 0;
  readonly eyes: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshStandardMaterial;
  readonly legSkin: THREE.MeshStandardMaterial;
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly t3 = new THREE.Vector3();
  private readonly t4 = new THREE.Vector3();
  /** How far the body is drawn off its place in the simulation, along its up: what is drawn lies that much above the density (smoothed). */
  private lift = 0;
  /** The same, summed over the feet of the last update. */
  private feetOffset = 0;
  /** Colours to fade from when the bug dies. */
  private readonly tints: { m: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }[] = [];
  /** Seconds since death (-1: alive). */
  private deadT = -1;
  /** How far a dead one has lost its colours (0..1). */
  dull = 0;
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
   * 1.7×, lifted so its feet stay on the floor).
   * Call after `update`.
   */
  setCameraDistance(cameraDistance: number): void {
    const s = Math.min(1.7, Math.max(1, cameraDistance / 50));
    this.root.scale.setScalar(s);
    this.root.position.y = this.groundY + (s - 1) * this.species.radius;
  }

  /** `teamColor`: a faint glow in the team colour, so the bug reads from far away. */
  constructor(
    readonly species: BugSpecies,
    teamColor?: number,
  ) {
    const r = species.radius;
    this.root.add(this.torso);
    this.torso.add(this.head, this.abdomen);
    const body = this.material(species.color, 0.45);
    this.skin = body;
    // a faint glow in the team colour: the bug reads from far away and in the dark
    if (teamColor !== undefined) body.emissive.setHex(teamColor).multiplyScalar(species.shell ? 0.07 : 0.22);
    if (species.shell) this.restY = -0.3 * r;
    this.torso.position.y = this.restY;
    const dark = this.material(species.accent, 0.6);
    this.legSkin = dark;
    const eye = this.material(0x050505, 0.2);
    this.eyes = eye;
    const len = species.bodyLength * r;

    const thoraxR = 0.3 * r;
    const thorax = this.part(body, 0, -0.05 * r, 0, thoraxR * 1.1, thoraxR, thoraxR * 1.3);
    const ab = species.abdomen * r;
    // (it hangs from the waist, just behind the thorax)
    this.abdomen.position.set(0, 0, -thoraxR * 0.8);
    const abdomen = this.part(body, 0, 0.08 * r, -(thoraxR * 0.2 + ab * 0.85), ab * (species.shell ? 0.88 : 0.8), ab * (species.shell ? 0.4 : 0.68), ab * (species.shell ? 1.12 : 1), this.abdomen);
    const hd = species.head * r;
    // (a cockroach's is tucked under its shield)
    const headZ = thoraxR * 1.2 + hd * (species.shell ? 0.75 : 0.8);
    const headY = (species.shell ? -0.06 : 0.02) * r;
    this.head.position.set(0, headY, headZ);
    this.lumps.push(abdomen, thorax, this.part(body, 0, 0, 0, hd, hd * 0.9, hd, this.head));
    this.headAt.set(0, headY, headZ);
    this.headRadius = hd;
    for (const s of [-1, 1]) {
      this.part(eye, s * hd * 0.55, 0.15 * hd - 0.02 * r, hd * 0.6, hd * 0.28, hd * 0.28, hd * 0.28, this.head);
      if (species.antennae > 0) {
        const base = new THREE.Vector3(s * hd * 0.35, hd * 0.6, hd * 0.5);
        const tip = base.clone().add(new THREE.Vector3(s * 0.35, 0.55, 0.75).normalize().multiplyScalar(species.antennae * r));
        if (species.shell) {
          // (long, swept forward and out)
          const mid = base.clone().add(new THREE.Vector3(s * 0.5, 0.42, 0.75).normalize().multiplyScalar(species.antennae * 0.5 * r));
          const end = mid.clone().add(new THREE.Vector3(s * 0.75, 0.12, 0.65).normalize().multiplyScalar(species.antennae * 0.65 * r));
          this.head.add(this.limb(dark, base, mid, 0.026 * r), this.limb(dark, mid, end, 0.018 * r));
        } else this.head.add(this.limb(dark, base, tip, 0.035 * r));
      }
    }

    if (species.shell) this.armour(body, ab, thoraxR, hd, r);

    const perSide = Math.max(1, Math.floor(species.legs / 2));
    const reach = species.legLength * r;
    for (let i = 0; i < perSide; i++) {
      const z = perSide === 1 ? 0 : (0.5 - i / (perSide - 1)) * Math.min(len * 0.35, thoraxR * 2.4);
      for (const s of [1, -1]) {
        const pivot = new THREE.Object3D();
        // (the hips lie close together, inside the thorax; the feet stand apart)
        const inset = z * 0.5;
        pivot.position.set(s * thoraxR * 0.72, -0.1 * r + this.restY, z - inset);
        const splay = (z / (thoraxR * 1.2)) * 0.6 * reach;
        const knee = new THREE.Vector3(s * reach * 0.5, 0.35 * r, splay * 0.5 + inset * 0.5);
        const foot = new THREE.Vector3(s * reach, -0.9 * r - this.restY, splay + inset);
        const upper = this.limb(dark, new THREE.Vector3(), knee, (species.shell ? 0.085 : 0.06) * r);
        const lower = this.limb(dark, knee, foot, 0.045 * r);
        pivot.add(upper, lower);
        this.root.add(pivot);
        this.legs.push({ upper, lower, knee, l1: knee.length(), l2: knee.distanceTo(foot), home: pivot.position.clone(), pivot, side: s, offset: (i + (s > 0 ? 0 : 1)) % 2 ? Math.PI : 0, foot, bend: 0 });
      }
    }
  }

  /** A cockroach's armour: a shield over its neck, two wing cases that open and rub, the cracks of a broken shell. */
  private armour(body: THREE.MeshStandardMaterial, ab: number, thoraxR: number, hd: number, r: number): void {
    const pale = this.material(0xc98a4a, 0.4);
    const glaze = this.material(this.species.color, 0.28);
    glaze.emissive.copy(body.emissive);
    const wing = this.material(0xd8a868, 0.5);
    wing.transparent = true;
    wing.opacity = 0.5;
    wing.side = THREE.DoubleSide;
    const scar = this.material(0xffe2b0, 0.8);
    scar.emissive.setHex(0x3a2410);
    // (the shield: a pale rim, a dark plate on it)
    this.part(pale, 0, 0.15 * r, thoraxR * 1.15, hd * 1.95, hd * 0.55, hd * 1.4);
    this.part(glaze, 0, 0.2 * r, thoraxR * 1.1, hd * 1.5, hd * 0.52, hd * 1.05);
    const long = ab * 1.36;
    for (const s of [1, -1]) {
      const g = new THREE.Group();
      g.position.set(s * 0.05 * r, 0.16 * r, 0.24 * r);
      this.abdomen.add(g);
      this.cases.push(g);
      const shell = this.part(glaze, s * ab * 0.36, 0.03 * r, -long * 0.82, ab * 0.58, ab * 0.34, long, g);
      const film = this.part(wing, s * ab * 0.44, -0.06 * r, -long * 0.82, ab * 0.62, 0.012 * r, long * 1.05, g);
      film.castShadow = false;
      // the cracks lie on the case: short straight pieces from point to point of it
      const crack = new THREE.Group();
      const on = (a: number, z: number): THREE.Vector3 => {
        const c = Math.sqrt(Math.max(0, 1 - z * z));
        return new THREE.Vector3(Math.sin(a) * c * shell.scale.x, Math.cos(a) * c * shell.scale.y, z * shell.scale.z).multiplyScalar(1.01).add(shell.position);
      };
      const lines: [number, number][][] =
        s > 0
          ? [[[-0.9, 0.55], [-0.3, 0.42], [-0.1, 0.2], [0.45, 0.12], [0.6, -0.15], [1.2, -0.2]], [[-0.1, 0.2], [-0.35, -0.05], [-0.1, -0.3], [-0.3, -0.5]], [[0.45, 0.12], [0.75, 0.4], [1.2, 0.42]]]
          : [[[0.9, 0.3], [0.4, 0.2], [0.2, -0.05], [-0.3, -0.1], [-0.6, -0.35]], [[0.2, -0.05], [0.35, -0.3], [0.1, -0.55]], [[-0.3, -0.1], [-0.6, 0.15], [-1.1, 0.12]]];
      for (const line of lines)
        for (let k = 0; k + 1 < line.length; k++) {
          // (bent over the case in a few steps)
          for (let j = 0; j < 3; j++) {
            const at = (f: number): THREE.Vector3 => on(line[k][0] + (line[k + 1][0] - line[k][0]) * f, line[k][1] + (line[k + 1][1] - line[k][1]) * f);
            crack.add(this.limb(scar, at(j / 3), at((j + 1) / 3), 0.022 * r));
          }
        }
      crack.visible = false;
      g.add(crack);
      this.cracks.push(crack);
    }
    // (bits of it that fly when it breaks)
    for (let k = 0; k < 14; k++) {
      const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry((0.07 + 0.07 * ((k * 0.618) % 1)) * r, 0), k % 3 ? glaze : pale);
      mesh.visible = false;
      mesh.castShadow = true;
      this.root.add(mesh);
      this.flakes.push({ mesh, v: new THREE.Vector3() });
    }
    // (what climbs on it climbs on the cases)
    const cover = this.part(body, 0, 0.14 * r, -ab * 0.95, ab * 0.95, ab * 0.5, ab * 1.35, this.abdomen);
    cover.visible = false;
    this.lumps[0] = cover;
  }

  private moveArmour(dt: number): void {
    const shake = this.rub * Math.sin(performance.now() * 0.055) * 0.11;
    this.cases.forEach((g, i) => {
      const s = i ? -1 : 1;
      g.rotation.set(0.34 * this.wings + shake * 0.5 * s, -s * (0.5 * this.wings) + shake, s * 0.24 * this.wings);
    });
    for (const c of this.cracks) c.visible = this.cracked;
    if (this.cracked && this.crackT < 0) {
      this.crackT = 0;
      this.flakes.forEach((f, k) => {
        const an = k * 2.4;
        f.mesh.position.set(Math.cos(an) * 0.4, 0.55, Math.sin(an) * 0.6 - 0.5).multiplyScalar(this.species.radius);
        f.v.set(Math.cos(an) * (2 + (k % 4)), 4 + (k % 5), Math.sin(an) * (2 + (k % 3)));
      });
    } else if (!this.cracked) this.crackT = -1;
    if (this.crackT < 0) return;
    this.crackT += dt;
    for (const f of this.flakes) {
      f.mesh.visible = this.crackT < 0.9;
      if (!f.mesh.visible) continue;
      f.v.y -= 18 * dt;
      f.mesh.position.addScaledVector(f.v, dt);
      f.mesh.rotation.x += dt * 13;
      f.mesh.rotation.y += dt * 9;
      f.mesh.scale.setScalar(Math.min(1, (0.9 - this.crackT) * 4));
    }
  }

  /**
   * Place the view between the previous and the current tick (`alpha` in [0,1]) and animate it.
   * `dt` is the frame time in seconds (render smoothing only).
   */
  update(bug: Bug, alpha: number, dt: number, ground?: RestGround): void {
    if (!bug.alive) {
      this.updateDead(bug, dt, ground);
      return;
    }
    this.root.visible = true;
    this.dull = 0;
    this.root.position.set(
      bug.px + (bug.x - bug.px) * alpha,
      bug.py + (bug.y - bug.py) * alpha,
      bug.pz + (bug.z - bug.pz) * alpha,
    );

    // Lean into the ground normal while standing, level out in the air. Smoothed so bumps do not jitter.
    if (bug.grounded) this.target.set(bug.nx, bug.ny, bug.nz);
    else this.target.copy(UP);
    this.up.lerp(this.target, 1 - Math.exp(-dt * 12)).normalize();
    // forward along the surface, as the simulation heads (eased with the lean)
    this.heading.set(bug.hx, bug.hy, bug.hz);
    this.fwd.copy(this.heading).addScaledVector(this.up, -this.heading.dot(this.up));
    if (this.fwd.lengthSq() < 1e-4) this.fwd.copy(this.lastFwd).addScaledVector(this.up, -this.lastFwd.dot(this.up));
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(bug.fx, 0, bug.fz);
    this.fwd.normalize();
    this.lastFwd.copy(this.fwd);
    this.side.crossVectors(this.up, this.fwd);
    this.basis.makeBasis(this.side, this.up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(this.basis);
    // the body rides at its height over what is drawn under it
    let lift = 0;
    if (bug.grounded && ground) {
      const { x, y, z } = this.root.position;
      ground.rest(x, y, z, -this.up.x, -this.up.y, -this.up.z, this.species.radius + 1);
      lift = Math.max(ground.offset, this.feetOffset / this.legs.length);
    }
    this.heldNow += (this.held - this.heldNow) * (1 - Math.exp(-dt * 9));
    if (this.heldNow > 0.01) lift -= this.species.radius * (0.42 + 0.035 * Math.sin(this.phase * 3 + performance.now() * 0.021)) * this.heldNow;
    this.fight += dt;
    lift -= this.species.radius * 0.38 * this.struggle;
    this.lift += (lift - this.lift) * (1 - Math.exp(-dt * 14));
    this.root.position.addScaledVector(this.up, this.lift);
    if (this.struggle > 0.01) {
      const a = 0.07 * this.species.radius * this.struggle;
      this.root.position.x += Math.sin(this.fight * 57) * a;
      this.root.position.z += Math.sin(this.fight * 49 + 1) * a;
    }
    this.groundY = this.root.position.y;

    // Walk cycle driven by the actual speed along the surface (up a wall too); legs tuck in while airborne.
    const dx = bug.x - bug.px;
    const dz = bug.z - bug.pz;
    const dy = bug.grounded ? bug.y - bug.py : 0;
    const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) * TICK_RATE;
    this.phase += speed * dt * 2.2;
    const swingAmp = bug.grounded ? Math.min(1, speed / 2) * 0.45 : 0;
    this.feetOffset = 0;
    for (const leg of this.legs) {
      const a = this.phase + leg.offset;
      leg.pivot.rotation.y = leg.side * Math.sin(a) * swingAmp;
      const bend = bug.grounded && ground ? this.bendToGround(leg, ground) : 0;
      leg.bend += (bend - leg.bend) * (1 - Math.exp(-dt * 25));
      leg.pivot.rotation.z = leg.side * (leg.bend + (bug.grounded ? Math.max(0, Math.cos(a)) * swingAmp * 0.5 : 0.35));
    }
    if (this.struggle > 0.01) {
      // two legs at a time are torn loose, and stamped down again
      this.legs.forEach((leg, i) => {
        const beat = Math.sin(this.fight * 13 + (i % 4) * 1.6 + Math.floor(i / 4));
        leg.pivot.rotation.z += leg.side * Math.max(0, beat) * 0.42 * this.struggle;
        leg.pivot.rotation.y += Math.max(0, beat) * 0.3 * this.struggle * (i % 2 ? 1 : -1);
      });
      this.roll.setFromEuler(this.wild.set(Math.sin(this.fight * 31) * 0.07 * this.struggle, 0, Math.sin(this.fight * 37 + 2) * 0.09 * this.struggle));
      this.root.quaternion.multiply(this.roll);
    }
    if (this.tumble > 0.01) {
      this.roll.setFromEuler(this.wild.set(0.42 * this.tumble * Math.sin(this.fight * 5), 0.5 * this.tumble, 0.5 * this.tumble * Math.cos(this.fight * 4)));
      this.root.quaternion.multiply(this.roll);
      for (const leg of this.legs) leg.pivot.rotation.z += leg.side * (0.75 + 0.3 * Math.sin(this.fight * 21 + leg.offset)) * this.tumble;
    }
    if (this.cases.length > 0) this.moveArmour(dt);
    if (this.pose.weight > 0.001) this.stand(ground);
    else if (this.posed) this.unpose();
  }

  private readonly wild = new THREE.Euler();

  /** A place on leg `i`, `f` from its foot (0) to its hip (1), in the world, and the way along it. */
  legPoint(i: number, f: number, p: THREE.Vector3, along: THREE.Vector3): void {
    const leg = this.legs[i % this.legs.length];
    leg.pivot.updateWorldMatrix(true, true);
    const low = f < 0.6;
    const m = low ? leg.lower : leg.upper;
    const y = low ? 1 - f / 0.6 : 1 - (f - 0.6) / 0.4;
    p.set(0, y, 0).applyMatrix4(m.matrixWorld);
    along.set(0, y - 0.1, 0).applyMatrix4(m.matrixWorld).sub(p).normalize();
  }

  get legCount(): number {
    return this.legs.length;
  }

  /** The stance: the body upright over the hind legs, the front two at the bow, the others spread. */
  private stand(ground?: RestGround): void {
    this.posed = true;
    const r = this.species.radius;
    const w = this.pose.weight;
    const { grip, nock, sway, spread } = this.pose;
    this.torso.rotation.x = (-1.2 - this.pose.lean) * w;
    this.torso.position.set(0, 1.28 * r * w, -0.1 * r * w);
    // the face looks where the bow aims; the abdomen swings back, a counterweight
    this.head.rotation.x = (1.2 + this.pose.lean - this.pose.look) * w;
    this.head.position.copy(this.headAt);
    this.head.position.z += 0.05 * r * w;
    this.abdomen.rotation.x = 0.62 * w;
    this.torso.updateMatrix();
    const n = this.legs.length;
    for (let i = 0; i < n; i++) {
      const leg = this.legs[i];
      const s = leg.side;
      // where the foot is now, on all legs
      const rest = this.t1.copy(leg.foot).applyQuaternion(leg.pivot.quaternion).add(leg.home);
      // where the stance has it, and which way its knee points
      const goal = this.t2;
      const pole = this.t3;
      const pair = Math.floor(i / 2);
      const back = n / 2 - 1;
      if (pair === back) {
        goal.set(s * 1.02 * r, -r, (s > 0 ? 0.62 : -0.6) * r);
        if (ground) {
          const at = this.foot.copy(goal);
          at.y += 1.2 * r;
          at.applyQuaternion(this.root.quaternion).add(this.root.position);
          const t = ground.rest(at.x, at.y, at.z, -this.up.x, -this.up.y, -this.up.z, 2.6 * r);
          if (t > 0) goal.y += 1.2 * r - t;
        }
        pole.set(s * 1.3, 0.25, 0.45);
      } else if (pair === 0) {
        goal.copy(s > 0 ? grip : nock).multiplyScalar(r);
        if (s > 0) pole.set(0.8, -0.5, -0.2);
        else pole.set(-1, 0.2, -0.6);
        // (its elbows out to the sides, the same on both)
        pole.lerp(this.foot.set(s * 1.2, 0.05, 0.1), this.pose.tie);
      } else if (pair === 1 && s > 0) {
        // (a second hand on the bow, under the first)
        goal.copy(grip).multiplyScalar(r);
        goal.y -= 0.34 * r;
        pole.set(0.9, -0.6, 0.2);
        // (while that hand ties the scarf, this one is spread like its fellow)
        goal.lerp(this.foot.set(s * (1.45 + 0.3 * spread) * r, 2.35 * r, (-1.15 - 0.2 * spread) * r), this.pose.tie);
        pole.lerp(this.foot.set(s * 1.1, 0.5, -0.5), this.pose.tie);
      } else {
        // (a fan behind it, like wings)
        const a = sway * 0.6 + pair * 1.3;
        goal.set(s * (1.45 + 0.3 * spread) * r, (pair === 1 ? 2.35 : 1.15) * r + Math.sin(a) * 0.1 * r, (-1.15 - 0.2 * spread) * r);
        pole.set(s * 1.1, pair === 1 ? 0.5 : 0.9, -0.5);
      }
      const hip = this.t4.copy(leg.home).applyMatrix4(this.torso.matrix);
      hip.lerpVectors(leg.home, hip, w);
      goal.lerpVectors(rest, goal, w);
      leg.pivot.position.copy(hip);
      // (over its shoulder, the near ones fold out of the picture)
      leg.pivot.visible = !(this.pose.fold > 0.5 && s < 0 && pair !== 0 && pair !== back);
      leg.pivot.rotation.set(0, 0, 0);
      this.bendTo(leg, goal.sub(hip), pole);
    }
  }

  /** After the body was moved by hand (`torso`, once `update` is done): the hips stay on it, the feet where they are. */
  carryLegs(): void {
    this.posed = true;
    this.torso.updateMatrix();
    for (const leg of this.legs) {
      const to = this.t2.copy(leg.foot).applyQuaternion(leg.pivot.quaternion).add(leg.home);
      const pole = this.t3.copy(leg.knee).applyQuaternion(leg.pivot.quaternion);
      const hip = this.t4.copy(leg.home);
      hip.y -= this.restY;
      hip.applyMatrix4(this.torso.matrix);
      leg.pivot.position.copy(hip);
      leg.pivot.rotation.set(0, 0, 0);
      this.bendTo(leg, to.sub(hip), pole);
    }
  }

  /** Two segments from the hip (the pivot's origin) to `to`, the knee towards `pole`. */
  private bendTo(leg: Leg, to: THREE.Vector3, pole: THREE.Vector3): void {
    const reach = leg.l1 + leg.l2;
    const d = Math.min(reach * 0.999, Math.max(Math.abs(leg.l1 - leg.l2) * 1.02, to.length()));
    to.setLength(d);
    const dir = this.foot.copy(to).divideScalar(d);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(0, 1, 0).addScaledVector(dir, -dir.y);
    pole.normalize();
    const a = (leg.l1 * leg.l1 - leg.l2 * leg.l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, leg.l1 * leg.l1 - a * a));
    const knee = dir.multiplyScalar(a).addScaledVector(pole, h);
    leg.upper.position.set(0, 0, 0);
    leg.upper.quaternion.setFromUnitVectors(UP, pole.copy(knee).normalize());
    leg.upper.scale.y = knee.length();
    leg.lower.position.copy(knee);
    to.sub(knee);
    leg.lower.scale.y = to.length();
    leg.lower.quaternion.setFromUnitVectors(UP, to.normalize());
  }

  /** Back on all its legs. */
  private unpose(): void {
    this.posed = false;
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.head.position.copy(this.headAt);
    this.abdomen.rotation.set(0, 0, 0);
    this.torso.position.set(0, this.restY, 0);
    for (const leg of this.legs) {
      leg.pivot.position.copy(leg.home);
      leg.pivot.visible = true;
      this.bendSegment(leg.upper, this.t1.set(0, 0, 0), leg.knee);
      this.bendSegment(leg.lower, leg.knee, leg.foot);
    }
  }

  private bendSegment(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    m.position.copy(from);
    const d = this.t2.copy(to).sub(from);
    m.scale.y = d.length();
    m.quaternion.setFromUnitVectors(UP, d.normalize());
  }

  /**
   * How far a leg turns about its hinge so its foot rests on the ground under it (a key's top on one side, the
   * gap beside it on the other), as it is drawn.
   */
  private bendToGround(leg: Leg, ground: RestGround): number {
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
    const t = ground.rest(at.x + this.up.x * above, at.y + this.up.y * above, at.z + this.up.z * above, -this.up.x, -this.up.y, -this.up.z, 2.2 * r * scale);
    // (nothing under it, or a wall over it: the leg stays as it is)
    if (t <= 0) return 0;
    this.feetOffset += ground.offset;
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
  private updateDead(bug: Bug, dt: number, ground?: RestGround): void {
    const r = this.species.radius;
    if (this.posed) this.unpose();
    for (const f of this.flakes) f.mesh.visible = false;
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

    // (it lies on what is drawn)
    ground?.rest(this.corpse.x, this.corpse.y, this.corpse.z, 0, -1, 0, r + 1);
    this.lift += ((ground?.offset ?? 0) - this.lift) * (1 - Math.exp(-dt * 14));

    // roll onto the back with a hop, then lie a little lower (the legs up)
    const u = Math.min(1, t / DEATH_ROLL);
    const e = u * u * (3 - 2 * u);
    this.roll.setFromAxisAngle(FORWARD, this.rollSide * Math.PI * e);
    this.root.quaternion.copy(this.deathQ).multiply(this.roll);
    this.root.position.set(this.corpse.x, this.corpse.y + this.lift + Math.sin(Math.PI * u) * r * 1.1 - r * 0.3 * e, this.corpse.z);
    this.groundY = this.root.position.y;
    this.root.visible = true;

    // the legs kick, slower and weaker, then stay curled over the belly
    const kick = t < DEATH_TWITCH ? Math.sin(t * 26) * 0.45 * (1 - t / DEATH_TWITCH) : 0;
    for (const leg of this.legs) {
      leg.pivot.rotation.y = leg.side * kick * (leg.offset ? 0.6 : -0.6);
      leg.pivot.rotation.z = -leg.side * (1.1 * e) + kick * 0.5;
    }

    // dull colours
    const f = Math.min(1, t / DEATH_FADE);
    this.dull = f;
    for (const tint of this.tints) {
      tint.m.color.copy(tint.color).lerp(CORPSE_GREY, f * 0.6);
      tint.m.emissive.copy(tint.emissive).multiplyScalar(1 - f);
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

  private part(m: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, parent: THREE.Object3D = this.torso): THREE.Mesh {
    const mesh = new THREE.Mesh(sphere, m);
    mesh.castShadow = true;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
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
