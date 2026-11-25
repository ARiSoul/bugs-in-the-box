import * as THREE from 'three/webgpu';
import { Bug } from '../../game/bug';
import type { BugSpecies } from '../../game/species';
import { BugView } from '../BugView';
import { dress, type Face } from './heroDress';
import { HeroStage } from './heroStage';
import type { MenuLayer } from './gpuStage';

/** How far the menu's camera stands back, and the board's height. */
const BACK = 14.5;
const LEVEL = -1.35;
const GRAVITY = 46;
const PIECES = 130;
/** Seconds a fighter shows off; from the start of a charge to the clash, and how long the blow hangs. */
const GESTURE = 1.35;
const CHARGE_MEET = 0.6;
const HANG = 0.12;
const COLORS = [0xff5a45, 0x4da8ff];
/** How large each species stands (its legs' reach decides it). */
const SIZE: Record<string, number> = { ant: 1.46, spider: 1.12, cockroach: 1.5, bee: 1.3 };

interface Fighter {
  bug: Bug;
  view: BugView;
  face: Face;
  /** Scales the bug (its view sets its own root's scale). */
  stand: THREE.Group;
  x: number;
  z: number;
  y: number;
  vy: number;
  /** Heading about the vertical (0: towards the viewer, +: to the right). */
  yaw: number;
  landed: boolean;
  /** Seconds into the gesture it makes (-1: none), and until the next one. */
  gesture: number;
  next: number;
  blink: number;
  /** How hard it presses itself to the ground (a landing, a jump to come): 0..1. */
  squash: number;
  leaving: boolean;
}

interface Side {
  home: number;
  fighter: Fighter | null;
  old: Fighter[];
}

/**
 * The fighters of the menus, large, on a circuit board over the picture: they drop in, breathe, blink, look at the pointer,
 * show off, charge at each other when the match starts; at its end the winner jumps under falling pieces, the loser on
 * its back.
 */
export class Heroes {
  readonly stage = new HeroStage(LEVEL);
  private readonly sides: Side[] = [
    { home: -1, fighter: null, old: [] },
    { home: 1, fighter: null, old: [] },
  ];
  /** Every fighter that was made, kept: showing one again costs nothing. */
  private readonly made = new Map<string, { view: BugView; face: Face; stand: THREE.Group }>();
  private readonly key = new THREE.SpotLight(0xfff2e2, 780, 60, 0.75, 0.7);
  private readonly rims: THREE.PointLight[] = [];
  private readonly spark = new THREE.PointLight(0xffc070, 0, 12);
  private readonly pieces: THREE.InstancedMesh;
  private readonly fall = new Float32Array(PIECES * 7);
  private raining = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly look = new THREE.Vector2();
  private time = 0;
  private charging = -1;
  private met = false;
  private shake = 0;
  private gloom = 0;
  /** The pointer, -1..1 of the window, right and up. */
  readonly pointer = new THREE.Vector2();
  /** The pointer is on Play: they crouch. */
  ready = false;
  /** -1: the two face each other; a side: it won. */
  winner = -1;
  /** The moment the two meet; a fighter lands; one of them shows off. */
  onMeet: () => void = () => {};
  onLand: (side: number) => void = () => {};
  onShow: (side: number, species: string) => void = () => {};

  constructor(private readonly layer: MenuLayer) {
    const { scene } = layer;
    this.stage.setMap('pc-case');
    scene.add(this.stage.root, new THREE.HemisphereLight(0xb4c8ff, 0x1c1410, 0.45));
    this.key.position.set(0, 10, 9);
    this.key.target.position.set(0, -0.5, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.radius = 4;
    scene.add(this.key, this.key.target, this.spark);
    // (a rim of the team's colour from behind each)
    for (const [x, c] of [[-5.5, 0xff5a3c], [5.5, 0x4a9fff]] as const) {
      const rim = new THREE.PointLight(c, 170, 40);
      rim.position.set(x, 3.4, -5);
      this.rims.push(rim);
      scene.add(rim);
    }
    this.spark.position.set(0, 0.4, 0.4);
    this.pieces = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.05, 0.09), new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.4 }), PIECES);
    this.pieces.frustumCulled = false;
    this.pieces.visible = false;
    for (let i = 0; i < PIECES; i++) this.pieces.setColorAt(i, new THREE.Color(0xffffff));
    scene.add(this.pieces);
  }

  /** The fighter of a side from now on: the one there leaps out, the new one drops in. */
  set(side: number, species: BugSpecies, delay = 0): void {
    const s = this.sides[side];
    if (s.fighter) {
      s.fighter.leaving = true;
      s.fighter.vy = 24;
      s.fighter.y = 0.01;
      s.old.push(s.fighter);
    }
    const bug = new Bug(species);
    bug.grounded = true;
    const { view, face, stand } = this.make(side, species);
    // (picked again while it was still on its way out)
    s.old = s.old.filter((o) => o.stand !== stand);
    stand.visible = true;
    s.fighter = { bug, view, face, stand, x: this.place(side), z: this.depth(side), y: 9 + delay * 30, vy: -6, yaw: -s.home * 0.95, landed: false, gesture: -1, next: this.time + 2 + side * 1.9, blink: 2 + Math.random() * 3, squash: 0, leaving: false };
    // (the rival takes a look at it)
    const rival = this.sides[1 - side].fighter;
    if (rival) rival.next = Math.min(rival.next, this.time + 0.95);
  }

  private make(side: number, species: BugSpecies): { view: BugView; face: Face; stand: THREE.Group } {
    const key = `${side}${species.id}`;
    let k = this.made.get(key);
    if (!k) {
      const view = new BugView(species);
      const stand = new THREE.Group();
      stand.add(view.root);
      view.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
      });
      k = { view, face: dress(view, side), stand };
      this.made.set(key, k);
      this.layer.scene.add(stand);
    }
    return k;
  }

  /** Make every fighter now, all in view, so their shaders can be made ahead (`MenuLayer.warm`); then `rest`. */
  warm(species: readonly BugSpecies[], map: string): void {
    for (const s of species)
      for (const i of [0, 1]) {
        this.make(i, s).stand.visible = true;
        this.make(i, s).stand.position.set(i * 4 - 2, 0, 0);
      }
    this.stage.setMap(map);
    this.pieces.visible = true;
  }

  rest(map: string): void {
    for (const k of this.made.values()) k.stand.visible = false;
    this.pieces.visible = false;
    this.stage.setMap(map);
  }

  /** A fighter shows off (the pointer is on it, or it was just picked). */
  show(side: number): void {
    const f = this.sides[side].fighter;
    if (!f || f.gesture >= 0 || f.y > 0 || this.charging >= 0 || this.winner >= 0) return;
    f.gesture = 0;
    this.onShow(side, f.bug.species.id);
  }

  /** They run at each other. */
  charge(): void {
    this.charging = 0;
    this.met = false;
  }

  /** Everything gone (the menu closes). */
  clear(): void {
    for (const s of this.sides) {
      for (const f of [...s.old, s.fighter]) f && this.drop(f);
      s.old.length = 0;
      s.fighter = null;
    }
    this.charging = -1;
    this.raining = this.shake = this.gloom = 0;
    this.pieces.visible = false;
    this.winner = -1;
    this.ready = false;
  }

  /** The end of a match: `winner` (a side) drops into the middle, the other lies on its back behind. */
  celebrate(winner: number): void {
    this.winner = winner;
    this.raining = 0.001;
    const c = new THREE.Color();
    for (let i = 0; i < PIECES; i++) {
      const o = i * 7;
      this.fall[o] = (Math.random() * 2 - 1) * 9;
      this.fall[o + 1] = 6 + Math.random() * 12;
      this.fall[o + 2] = -3.5 + Math.random() * 5;
      this.fall[o + 3] = 1.8 + Math.random() * 1.8;
      for (let k = 4; k < 7; k++) this.fall[o + k] = (Math.random() * 2 - 1) * 4;
      const t = i % 5;
      c.setHex(t < 2 ? COLORS[winner] : t === 2 ? 0xffc46b : t === 3 ? 0xe9e4d6 : 0x2f9e6a);
      this.pieces.setColorAt(i, c);
    }
    if (this.pieces.instanceColor) this.pieces.instanceColor.needsUpdate = true;
    const w = this.sides[winner].fighter;
    if (w) {
      w.x = this.place(winner);
      w.z = this.depth(winner);
      w.y = 11;
    }
    const l = this.sides[1 - winner].fighter;
    if (l) {
      l.x = this.place(1 - winner);
      l.z = this.depth(1 - winner);
      l.y = 0;
      l.yaw = this.sides[1 - winner].home * -2.2;
      l.landed = true;
      l.bug.health = 0;
    }
  }

  private place(side: number): number {
    const cam = this.layer.camera;
    const half = Math.tan((cam.fov * Math.PI) / 360) * BACK * cam.aspect;
    const home = this.sides[side].home;
    if (this.winner === side) return 0;
    if (this.winner >= 0) return home * half * 0.74;
    return home * (Math.min(2.95, half * 0.41) + (this.sides[side].fighter?.bug.species.shell ? 0.3 : 0));
  }

  private depth(side: number): number {
    return this.winner === side ? 0.9 : this.winner >= 0 ? -2.2 : 0;
  }

  update(dtReal: number): void {
    // (the blow hangs for a moment)
    let dt = dtReal;
    if (this.charging >= 0) {
      const was = this.charging;
      this.charging += dtReal;
      if (this.charging > CHARGE_MEET && this.charging < CHARGE_MEET + HANG) dt = dtReal * 0.06;
      if (was < CHARGE_MEET && this.charging >= CHARGE_MEET) {
        this.shake = 0.5;
        this.stage.ring(0, 0, 0xffd9a0, 1.6);
        this.stage.burst(0, 0.1, 0.5);
        this.spark.intensity = 900;
      }
      if (!this.met && this.charging >= CHARGE_MEET + HANG) {
        this.met = true;
        this.onMeet();
        return;
      }
    }
    this.time += dt;
    this.stage.update(dt);
    this.stage.seam.value = this.layer.seam.value;
    this.stage.aspect.value = this.layer.camera.aspect;
    this.shake *= Math.exp(-dtReal * 7);
    this.gloom = Math.max(0, this.gloom - dt * 0.9);
    this.spark.intensity = Math.max(0, this.spark.intensity * Math.exp(-dtReal * 5) - 0.1) + (Math.random() < dtReal * 1.6 && this.winner < 0 ? 60 : 0);
    const cam = this.layer.camera;
    this.look.lerp(this.pointer, 1 - Math.exp(-dt * 5));
    // (low, so they loom; it leans a little with the pointer)
    const sx = Math.sin(this.time * 71) * this.shake;
    const sy = Math.sin(this.time * 83 + 1) * this.shake;
    cam.position.set(this.look.x * 0.7 + sx * 0.3, 1.35 + this.look.y * 0.22 + sy * 0.3, BACK - (this.ready ? 0.35 : 0));
    cam.lookAt(sx * 0.2, 0.0 + sy * 0.2, 0);
    const dark = this.gloom > 0 ? 1 - Math.min(1, this.gloom * 2.4) * 0.92 * (Math.sin(this.time * 47) > 0.75 ? 0.5 : 1) : 1;
    this.key.intensity = 780 * dark;
    for (const [i, r] of this.rims.entries()) r.intensity = (i ? 165 : 170) * (0.4 + 0.6 * dark);
    this.stage.power.forEach((p, i) => {
      const lost = this.winner >= 0 && this.winner !== i;
      p.value += ((lost ? 0.12 : this.ready || this.charging >= 0 ? 2.4 : 1) * dark - p.value) * (1 - Math.exp(-dtReal * 8));
    });
    this.sides.forEach((s, i) => {
      if (s.fighter) this.move(s, s.fighter, dt, i);
      for (let k = s.old.length - 1; k >= 0; k--) {
        const f = s.old[k];
        this.move(s, f, dt, i);
        if (f.y > 10) {
          this.drop(f);
          s.old.splice(k, 1);
        }
      }
    });
    if (this.raining > 0) this.rain(dt);
  }

  private move(s: Side, f: Fighter, dt: number, side: number): void {
    const b = f.bug;
    const r = b.species.radius;
    const won = this.winner === side;
    const size = ((SIZE[b.species.id] ?? 1.3) * (won ? 1.3 : this.winner >= 0 ? 0.78 : 1)) / r;
    const rush = this.charging >= 0 && !f.leaving;
    let v = 0;
    let toYaw = -s.home * 0.98 + this.look.x * 0.14 + Math.sin(this.time * 0.5 + side * 2) * 0.06;
    if (rush) {
      // (a crouch back, then a run)
      const t = this.charging;
      const back = t < 0.26;
      const to = back ? this.place(side) + s.home * 0.55 : s.home * 1.45;
      const d = to - f.x;
      v = Math.min(back ? 2.6 : 16, Math.abs(d) * 14);
      f.x += Math.sign(d) * Math.min(Math.abs(d), v * dt);
      toYaw = (-s.home * Math.PI) / 2;
    } else if (!f.leaving && f.landed) {
      const px = this.place(side);
      f.x += (px - f.x) * (1 - Math.exp(-dt * 5));
      f.z += (this.depth(side) - f.z) * (1 - Math.exp(-dt * 5));
    }
    if (won) toYaw = Math.sin(this.time * 0.8) * 0.45;
    if (b.health > 0) f.yaw += Math.atan2(Math.sin(toYaw - f.yaw), Math.cos(toYaw - f.yaw)) * (1 - Math.exp(-dt * (rush ? 14 : 4)));
    if (f.y > 0 || f.vy !== 0) {
      f.vy -= GRAVITY * dt * (f.leaving ? 0.2 : 1);
      f.y = Math.max(0, f.y + f.vy * dt);
      if (f.y === 0 && f.vy < 0) {
        const hard = Math.min(1, -f.vy / 22);
        f.squash = hard;
        if (!f.landed) {
          f.landed = true;
          this.shake = Math.max(this.shake, 0.4);
          this.stage.ring(f.x, f.z, COLORS[side]);
          this.pieces.visible = this.raining > 0;
          this.onLand(side);
        }
        f.vy = 0;
      }
    }
    f.squash *= Math.exp(-dt * 7);
    this.gesture(f, dt, side);
    b.alive = b.health > 0;
    b.hx = b.fx = Math.sin(f.yaw);
    b.hz = b.fz = Math.cos(f.yaw);
    b.hy = 0;
    b.grounded = f.y <= 0.01 || this.winner === side;
    // (in the bug's own scale; what it walks this tick drives its legs)
    b.x = b.z = 0;
    b.y = f.y / size;
    b.px = (-b.fx * v) / size / 60;
    b.pz = (-b.fz * v) / size / 60;
    b.py = b.y;
    f.stand.scale.setScalar(size);
    f.stand.position.set(f.x, LEVEL + (b.alive ? 0.9 : 0.5) * r * size, f.z);
    const t = f.view;
    const u = f.gesture < 0 ? 0 : Math.min(1, f.gesture / GESTURE);
    const g = f.gesture < 0 ? 0 : Math.min(1, Math.sin(Math.PI * u) * 1.6);
    if (b.species.shell) t.wings = t.rub = Math.max(g, rush ? 0.8 : 0, won && f.y > 0 ? 1 : 0);
    t.update(b, 1, dt);
    if (!b.alive) return;
    // breath, a look at the pointer, a rear-up, jaws, lids
    const crouch = Math.max(f.squash, this.ready && !rush && this.winner < 0 ? 0.55 + 0.06 * Math.sin(this.time * 23) : 0);
    const breath = Math.sin(this.time * 2.1 + side * 1.4);
    t.torso.position.y = t.restY + (0.04 * breath + 0.26 * g - 0.34 * crouch) * r;
    t.torso.rotation.x = -0.42 * g + 0.06 + 0.1 * crouch - (rush ? 0.05 : 0);
    t.torso.rotation.z = rush ? Math.sin(this.time * 31) * 0.05 : Math.sin(this.time * 1.1 + side) * 0.015 + g * Math.sin(this.time * 26) * 0.03;
    const to = THREE.MathUtils.clamp(Math.atan2(this.look.x * 7 - f.x, 9) - f.yaw, -0.8, 0.8);
    t.head.rotation.y = rush ? 0 : to * 0.8 + Math.sin(this.time * 1.3 + side) * 0.08;
    t.head.rotation.x = -this.look.y * 0.25 + Math.max(0, Math.sin(this.time * 0.9 + side * 3)) * 0.07 + 0.2 * g;
    t.head.rotation.z = Math.sin(this.time * 7.3 + side * 2) * 0.015;
    // (a cockroach's feelers: back, and on its own side)
    if (b.species.shell) t.head.rotation.x += 0.12;
    t.carryLegs();
    f.face.wingsTo?.(Math.max(g, rush ? 1 : 0, f.y > 0.02 ? 1 : 0, won ? 0.6 : 0), Math.max(g, rush || f.y > 0.02 ? 1 : 0), this.time);
    f.blink -= dt;
    if (f.blink < -0.2) f.blink = 1.6 + Math.random() * 3.5;
    const squint = crouch * 0.3;
    f.face.blink(Math.max(squint, f.blink < 0 ? Math.sin(Math.PI * Math.min(1, -f.blink / 0.16)) : 0));
    f.face.jaws(Math.max(g * (0.75 + 0.25 * Math.sin(this.time * 30)), rush ? 1 : 0, 0.12 + 0.12 * Math.sin(this.time * 1.7 + side * 2)));
  }

  private gesture(f: Fighter, dt: number, side: number): void {
    if (f.leaving || !f.landed || this.charging >= 0 || f.bug.health <= 0) return;
    if (this.winner === side) {
      if (f.y <= 0 && this.time > f.next) {
        f.vy = 7;
        f.y = 0.001;
        f.next = this.time + 0.85 + Math.random() * 0.4;
      }
      return;
    }
    if (f.gesture >= 0) {
      const was = f.gesture;
      f.gesture += dt;
      const kind = f.bug.species.id;
      // an ant hops, a spider drums its feet, a cockroach takes the lights
      if (kind === 'bee' && f.gesture > 0.2 && f.gesture < 0.95) f.vy = 2.2 + GRAVITY * dt;
      if (kind === 'ant' && was < 0.42 && f.gesture >= 0.42) f.vy = 6.5;
      if (kind === 'spider' && Math.floor(was * 8) !== Math.floor(f.gesture * 8) && f.gesture < 0.9) {
        f.squash = 0.35;
        this.stage.ring(f.x, f.z, COLORS[side], 0.8);
      }
      if (f.bug.species.shell && was < 0.35 && f.gesture >= 0.35) this.gloom = 1;
      if (f.gesture > GESTURE) {
        f.gesture = -1;
        f.next = this.time + 4.5 + Math.random() * 4;
      }
    } else if (this.time > f.next && !this.ready) this.show(side);
  }

  private rain(dt: number): void {
    this.raining += dt;
    for (let i = 0; i < PIECES; i++) {
      const o = i * 7;
      const p = this.fall;
      p[o + 1] -= p[o + 3] * dt;
      if (p[o + 1] < LEVEL) p[o + 1] = 6 + Math.random() * 3;
      const t = this.raining;
      this.v.set(p[o] + Math.sin(t * 1.3 + i) * 0.35, p[o + 1], p[o + 2]);
      this.q.setFromEuler(this.e.set(p[o + 4] * t, p[o + 5] * t, p[o + 6] * t));
      this.pieces.setMatrixAt(i, this.m.compose(this.v, this.q, this.s.setScalar(0.8 + (i % 3) * 0.3)));
    }
    this.pieces.instanceMatrix.needsUpdate = true;
  }

  private drop(f: Fighter): void {
    f.stand.visible = false;
  }
}
