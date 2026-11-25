import * as THREE from 'three/webgpu';
import { atan, attribute, cameraPosition, float, hash, instanceIndex, max, mix, positionLocal, positionView, positionWorld, pow, screenUV, sin, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfaceDistance } from '../../game/field';
import { BROOD_COVER, type Brood, type Match } from '../../game/match';
import type { BugView } from '../BugView';
import type { DrawnGround } from '../drawnGround';
import type { BowContext } from './bowScene';
import { BroodCamera } from './broodCamera';
import type { StageFx } from './gpuStage';

const UP = new THREE.Vector3(0, 1, 0);
const AMBER = new THREE.Color(0xffb24a);
const HOT = new THREE.Color(0xfff0d0);

/** Cockroaches of the swarm; their length; the steps of a run; the eyes drawn (two each, then the bugs'). */
const SWARM = 150;
const SIZE = 1.0;
const STEPS = 9;
const BUG_EYES = 64;
const EYES = SWARM * 2 + BUG_EYES;
const RINGS = 6;
/** Seconds into the scene: the lights start to fail, are out; its eyes light up, then all the others. */
const FAIL = 1.3;
const OUT = 2.15;
const LIT = 2.5;
const OTHERS = 3.25;
/** The scene's length; seconds after the light came back: they run, the picture ends. */
const READY = 4.4;
const FLEE = 0.42;
const AFTER = 4.5;
/** How fast they come, and run. */
const COME = 11;
const RUN = 15;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rnd = (i: number): number => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

interface Runner {
  /** Where it comes from, and its way from there to its place (points and normals), once known. */
  start: THREE.Vector3;
  startUp: THREE.Vector3;
  way: THREE.Vector3[];
  ups: THREE.Vector3[];
  long: number;
  laid: boolean;
  /** Its place on the ground round the mark, or on a covered bug (its unit; -1: none). */
  end: THREE.Vector3;
  endUp: THREE.Vector3;
  on: number;
  leaves: number;
  /** Where it is drawn. */
  at: THREE.Vector3;
  stand: THREE.Vector3;
  face: THREE.Vector3;
}

/**
 * The Blackout Swarm's scene (render only): the cockroach rubs its wings, the lights of the place fail, eyes open in
 * the dark; the player marks a spot from above; cockroaches run in from everywhere and cover what is there, and flee
 * when the light comes back. It reads the match and never changes it.
 */
export class BroodScene {
  readonly camera = new BroodCamera();
  timeScale = 1;
  /** Seconds into the scene that plays before the aim, by its own clock (-1: it does not play). */
  sceneTime = -1;
  /** How dark it is now (0..1). */
  dark = 0;
  /** Which way the player moves the view over the ground while marking (-1, 0, 1). */
  pan = 0;

  private readonly root = new THREE.Group();
  private readonly lights = new THREE.Group();
  private readonly time = uniform(0);
  private readonly roaches: THREE.InstancedMesh;
  private readonly going: THREE.InstancedBufferAttribute;
  private readonly eyes: THREE.InstancedMesh;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly ring: THREE.Mesh;
  private readonly ringLevel = uniform(0);
  private readonly ringAt = uniform(new THREE.Vector3());
  private readonly ringX = uniform(new THREE.Vector3(1, 0, 0));
  private readonly ringZ = uniform(new THREE.Vector3(0, 0, 1));
  private readonly ringSize = uniform(6);
  private readonly calls: THREE.Mesh[] = [];
  private readonly callLevel: { value: number }[] = [];
  private readonly runners: Runner[] = [];

  private frames = 0;
  private clock = 0;
  private shooter = -1;
  private view: BugView | null = null;
  private started = false;
  private shotT = -1;
  private hitT = -1;
  private brood: Brood | null = null;
  private coverT = -1;
  private spread = 0;
  private readonly victims: BugView[] = [];
  private readonly base = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly mark = new THREE.Vector3();
  private readonly markUp = new THREE.Vector3(0, 1, 0);
  private readonly subject = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly grad = new Float64Array(3);
  private readonly tone = new THREE.Color();

  /** `light`: the light special attacks share. */
  constructor(
    scene: THREE.Scene,
    private readonly fx: StageFx,
    private readonly light: THREE.PointLight,
  ) {
    scene.add(this.root);
    fx.scene.add(this.lights);

    // ---- the cockroaches: one geometry, its legs run in the vertex shader
    const g = roachGeometry();
    this.going = new THREE.InstancedBufferAttribute(new Float32Array(SWARM), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('going', this.going);
    const skin = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 });
    const beat = sin(this.time.mul(27).add(attribute('limb', 'float')).add(hash(instanceIndex).mul(6.28)));
    skin.positionNode = positionLocal.add(vec3(0, max(beat, 0).mul(0.05), beat.mul(0.13)).mul(attribute('reach', 'float')).mul(attribute('going', 'float')));
    skin.fog = false;
    this.roaches = new THREE.InstancedMesh(g, skin, SWARM);
    this.roaches.castShadow = this.roaches.receiveShadow = true;
    this.keep(this.roaches);
    const vec = (): THREE.Vector3 => new THREE.Vector3();
    for (let i = 0; i < SWARM; i++)
      this.runners.push({ start: vec(), startUp: vec(), way: Array.from({ length: STEPS + 1 }, vec), ups: Array.from({ length: STEPS + 1 }, vec), long: 1, laid: false, end: vec(), endUp: vec(), on: -1, leaves: 0, at: vec(), stand: new THREE.Vector3(0, 1, 0), face: new THREE.Vector3(0, 0, 1) });

    // ---- eyes
    {
      const pg = new THREE.PlaneGeometry(1, 1);
      this.tint = new THREE.InstancedBufferAttribute(new Float32Array(EYES * 3), 3).setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('tint', this.tint);
      const r = uv().sub(0.5).length().mul(2);
      const core = smoothstep(0.34, 0.16, r);
      const halo = pow(max(r.oneMinus(), 0), 2.8).mul(0.45);
      this.eyes = new THREE.InstancedMesh(pg, this.glow(attribute('tint', 'vec3').mul(halo).add(mix(attribute('tint', 'vec3'), vec3(1, 1, 1), 0.35).mul(core))), EYES);
      this.keep(this.eyes);
    }

    // ---- the ring round the mark: drawn on whatever the view shows there (a ball; what lies behind it is found by its depth)
    {
      const away = positionWorld.sub(cameraPosition);
      const behind = cameraPosition.add(away.mul(this.fx.depthAt(screenUV).div(positionView.z.negate())));
      const off = behind.sub(this.ringAt);
      const side = off.dot(this.ringX);
      const along = off.dot(this.ringZ);
      const r = off.length().div(this.ringSize);
      const an = atan(side, along).mul(24 / (Math.PI * 2)).add(this.time.mul(0.8));
      const dash = smoothstep(0.3, 0.4, sin(an.mul(Math.PI * 2)).mul(0.5).add(0.5));
      const line = smoothstep(0.035, 0.015, r.sub(0.98).abs());
      const inner = smoothstep(0.02, 0.008, r.sub(0.9).abs()).mul(0.35);
      const core = smoothstep(0.05, 0.02, r.sub(0.09).abs());
      const fill = smoothstep(1, 0.96, r).mul(0.02);
      const beatR = sin(this.time.mul(4)).mul(0.15).add(0.85);
      this.ring = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.glow(vec3(AMBER.r, AMBER.g, AMBER.b).mul(line.mul(dash.mul(0.9).add(0.2)).add(inner).add(core).add(fill)).mul(beatR).mul(this.ringLevel), true));
      (this.ring.material as THREE.MeshBasicNodeMaterial).side = THREE.BackSide;
      this.keep(this.ring);
    }

    // ---- the call: thin rings that run out from its wings
    for (let k = 0; k < RINGS; k++) {
      const level = uniform(0);
      const r = uv().sub(0.5).length().mul(2);
      const band = smoothstep(0.07, 0, r.sub(0.9).abs()).add(smoothstep(0.02, 0, r.sub(0.82).abs()).mul(0.5));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(vec3(AMBER.r, AMBER.g, AMBER.b).mul(band).mul(level)));
      this.calls.push(mesh);
      this.callLevel.push(level);
      this.keep(mesh);
    }
  }

  /** Seconds since the light came back (-1: not yet). */
  get hitFor(): number {
    return this.hitT;
  }

  /** The bugs' names may show. */
  get names(): boolean {
    return this.hitT > FLEE && this.hitT < 3.3;
  }

  clear(): void {
    if (this.shooter >= 0) this.end();
    this.hideAll();
    this.camera.stop();
    this.dark = this.fx.black.value = 0;
  }

  /** The swarm is called to the mark. */
  onFire(match: Match, ground: DrawnGround): void {
    if (this.shooter < 0 || !match.brood) return;
    this.brood = match.brood;
    this.shotT = 0;
    const { at } = match.brood;
    this.mark.set(at.x, at.y, at.z);
    this.markUp.set(at.nx, at.ny, at.nz);
    this.subject.copy(this.mark);
    // everywhere round it: rays out from over it, most of them low; where they end, one comes out
    const n = this.markUp;
    this.tangent(n, 0, this.b);
    let found = 0;
    for (let i = 0; i < SWARM * 2 && found < SWARM; i++) {
      const an = i * 2.39996;
      const el = rnd(i) < 0.72 ? -0.12 + 0.3 * rnd(i + 40) : 0.2 + 1.2 * rnd(i + 80);
      this.tangent(n, an, this.d);
      this.d.multiplyScalar(Math.cos(el)).addScaledVector(n, Math.sin(el));
      this.a.copy(this.mark).addScaledVector(n, 2.2);
      const far = 11 + 9 * rnd(i + 7);
      let t = ground.raycast(this.a.x, this.a.y, this.a.z, this.d.x, this.d.y, this.d.z, far);
      const p = this.runners[found];
      if (t >= 0 && t < 5) continue;
      if (t >= 0) p.start.copy(this.a).addScaledVector(this.d, t);
      else {
        // (nothing there: the ground under the end of it)
        this.a.addScaledVector(this.d, far);
        t = ground.raycast(this.a.x, this.a.y, this.a.z, -n.x, -n.y, -n.z, 14);
        if (t < 0) continue;
        p.start.copy(this.a).addScaledVector(n, -t);
      }
      surfaceDistance(match.field, p.start.x, p.start.y, p.start.z, this.grad);
      p.startUp.set(this.grad[0], this.grad[1], this.grad[2]);
      if (p.startUp.lengthSq() < 0.2) continue;
      p.startUp.normalize();
      found++;
    }
    const radius = match.coverRadius;
    for (let i = 0; i < SWARM; i++) {
      const p = this.runners[i];
      if (i >= found && found > 0) {
        const o = this.runners[i % found];
        p.start.copy(o.start).addScaledVector(this.tangent(o.startUp, i, this.b), 0.6);
        p.startUp.copy(o.startUp);
      } else if (found === 0) {
        p.start.copy(this.mark).addScaledVector(this.tangent(n, i * 2.4, this.b), radius);
        p.startUp.copy(n);
      }
      // its place round the mark: the ground there
      const rad = radius * 0.95 * Math.sqrt((i + 0.5) / SWARM);
      this.tangent(n, i * 2.39996, this.b);
      p.end.copy(this.mark).addScaledVector(this.b, rad);
      p.endUp.copy(n);
      if (!this.snap(p.end, n, ground, 3)) p.end.copy(this.mark).addScaledVector(this.b, rad * 0.15);
      p.on = -1;
      p.laid = false;
      p.leaves = 0.1 + 0.55 * rnd(i + 3);
      p.at.copy(p.start);
      p.stand.copy(p.startUp);
      p.face.copy(p.end).sub(p.start);
    }
  }

  /** They are over it: whom they cover. */
  onCover(units: readonly number[], views: readonly BugView[]): void {
    if (this.shotT < 0) return;
    this.coverT = 0;
    this.victims.length = 0;
    if (units.length === 0) return;
    for (const u of units) this.victims.push(views[u]);
    // (the one nearest the mark is what the picture is about)
    this.victims.sort((p, q) => p.root.position.distanceToSquared(this.mark) - q.root.position.distanceToSquared(this.mark));
    this.runners.forEach((p, i) => {
      if (rnd(i + 900) < 0.6) p.on = i % this.victims.length;
    });
  }

  /** The light is back. */
  onLights(): void {
    if (this.shotT < 0) return;
    this.hitT = 0;
    this.camera.kick(0.5);
    for (const p of this.runners) p.leaves = FLEE + 0.5 * rnd(p.at.x * 13 + p.at.z * 7) * (p.on >= 0 ? 1.3 : 0.8);
  }

  // ---------------------------------------------------------------- every frame

  update(x: BowContext): void {
    const { match, view, dt, alpha } = x;
    if (this.frames < 100) {
      this.frames++;
      if (this.frames < 90) {
        this.root.position.set(0, -600, 0);
        this.lights.position.set(0, -600, 0);
        for (const o of [...this.root.children, ...this.lights.children]) o.visible = true;
        return;
      }
      if (this.frames === 90) {
        this.root.position.set(0, 0, 0);
        this.lights.position.set(0, 0, 0);
        this.hideAll();
      }
    }
    if (this.shooter < 0 && this.dark > 0) {
      this.dark *= Math.exp(-dt * 6);
      if (this.dark < 0.005) this.dark = 0;
      this.fx.black.value = this.dark;
    }
    const u = match.activeUnit;
    const mine = match.currentWeapon.kind === 'brood';
    const special = match.phase === 'special' && mine;
    const stance = match.stance && mine && u.bug.alive;
    if ((special || stance) && this.shooter !== u.id) this.begin(u.id, view);
    if (this.shooter >= 0 && this.shooter !== u.id) this.end();
    if (this.shooter < 0) return;
    if (!special && !stance && this.shotT < 0) {
      this.end();
      return;
    }
    const total = match.currentWeapon.sceneTicks / 60;
    const t = special ? Math.max(0, (READY * Math.min(total, total - (match.specialTicks - alpha) / 60)) / total) : READY;
    this.sceneTime = special ? t : -1;
    const b = u.bug;
    const r = b.species.radius;
    this.up.set(b.nx, b.ny, b.nz);
    this.fwd.set(b.hx, b.hy, b.hz).addScaledVector(this.up, -(b.hx * b.nx + b.hy * b.ny + b.hz * b.nz)).normalize();
    this.base.copy(view.root.position).addScaledVector(this.up, -r);
    if (!this.started) {
      this.started = true;
      this.camera.start();
    }
    this.seek(x.ground);
    this.clock += dt;
    this.time.value = this.clock;
    if (this.shotT >= 0) this.shotT += dt;
    if (this.hitT >= 0) this.hitT += dt;
    if (this.coverT >= 0) this.coverT += dt;
    const come = this.brood ? (match.brood ? match.brood.ticks + alpha : 1e3) / 60 : -1;

    // ---- the caller: its wings open and rub, its front rises
    const last = this.hitT > 3.3 ? ss(3.3, 3.7, this.hitT) : 0;
    const rub = special ? ss(0.2, 0.45, t) * (1 - ss(2.0, 2.4, t)) : 0;
    const open = special ? Math.max(rub, 0.35 * ss(LIT, LIT + 0.3, t)) : stance ? 0.35 : this.hitT >= 0 ? 0.35 * (1 - last) : 0.75;
    this.spread += (open - this.spread) * (1 - Math.exp(-dt * 12));
    view.wings = this.spread;
    view.rub = rub + (this.shotT >= 0 && this.shotT < 0.6 ? 1 : 0);
    view.torso.rotation.x = -0.3 * Math.max(rub, special ? ss(LIT, LIT + 0.4, t) : 0.6) * (1 - 0.5 * last);
    view.torso.position.y = view.restY + 0.1 * r * Math.max(rub, 0.5);

    // ---- how dark it is
    let dark = 1;
    if (special) dark = t < FAIL ? 0.16 * ss(0.3, 1, t) : t > OUT ? 1 : flicker(t - FAIL, OUT - FAIL);
    if (this.hitT >= 0) dark = this.hitT < 0.05 ? 0 : this.hitT < 0.1 ? 0.75 : this.hitT < 0.14 ? 0 : this.hitT < 0.19 ? 0.45 : 0;
    this.dark = dark;
    this.fx.black.value = dark;

    // ---- the mark
    if (stance && match.mark) {
      this.mark.set(match.mark.x, match.mark.y, match.mark.z);
      this.markUp.set(match.mark.nx, match.mark.ny, match.mark.nz);
    }
    if (this.shotT >= 0) {
      const v = this.victims[0];
      this.subject.lerp(v ? v.root.position : this.mark, v ? 1 - Math.exp(-dt * 4) : 1);
    } else this.subject.copy(this.mark);
    const marking = stance && match.mark !== null;
    this.ringLevel.value += ((marking ? 1.1 : this.shotT >= 0 && this.shotT < 0.5 ? 2 * (1 - this.shotT * 2) : 0) - this.ringLevel.value) * (1 - Math.exp(-dt * 14));
    this.ring.visible = this.ringLevel.value > 0.02 && (marking || this.shotT >= 0);
    if (marking) this.layRing(match.coverRadius);

    // ---- the view, then whatever faces it
    this.camera.update(x.camera, {
      t,
      shotT: this.shotT,
      hitT: this.hitT,
      stance,
      at: view.root.position,
      up: this.up,
      fwd: this.fwd,
      radius: r,
      mark: this.mark,
      markUp: this.markUp,
      subject: this.subject,
      covered: this.coverT >= 0,
      pan: this.pan,
      dt,
      ground: x.ground,
    });
    x.camera.updateMatrixWorld();
    this.placeCalls(x.camera, r, special ? t : -1);
    this.lateX = x;
    this.lateT = t;
    this.lateCome = come;

    // ---- whom they cover
    const grip = this.coverT >= 0 && this.hitT < FLEE ? ss(0, 0.4, this.coverT) : this.hitT >= 0 ? 1 - ss(FLEE, FLEE + 0.7, this.hitT) : 0;
    for (const v of this.victims) v.struggle = grip * 0.8;

    // ---- the one light
    const ease = 1 - Math.exp(-dt * 9);
    let goal = 0;
    this.a.copy(view.root.position).addScaledVector(this.up, r * 2.6).addScaledVector(this.b.copy(x.camera.position).sub(view.root.position).normalize(), r * 2.4);
    if (special) goal = t < FAIL ? 7 : t < OUT ? 4 : 0;
    this.light.color.copy(HOT).lerp(AMBER, 0.4);
    if (this.hitT >= 0 && this.hitT < 3.4) {
      this.a.copy(this.subject).addScaledVector(this.markUp, 5);
      goal = 8 + 60 * Math.exp(-this.hitT * 7);
      this.light.color.copy(HOT);
    } else if (this.hitT >= 3.4) goal = 9;
    this.light.position.lerp(this.a, this.hitT >= 0 && this.hitT < 0.1 ? 1 : ease);
    this.light.intensity += (goal - this.light.intensity) * (this.hitT >= 0 && this.hitT < 0.05 ? 1 : ease);

    // ---- the picture
    const dim = special ? (t < FAIL ? 0.5 * ss(0, 0.3, t) : 0) : this.hitT >= 3.4 ? 0.6 : this.hitT >= 0 ? 0.3 * ss(0.3, 1, this.hitT) : 0;
    this.fx.dim.value += (dim - this.fx.dim.value) * (1 - Math.exp(-dt * 12));
    this.fx.vignette.value = Math.max(this.fx.dim.value * 0.75, dark * (stance ? 0.35 : 0.6));
    this.fx.flash.value = 0;
    this.fx.fade.value = this.hitT >= 0 ? ss(AFTER - 0.25, AFTER - 0.03, this.hitT) : 0;
    this.fx.focusBlur.value = 0;
    this.fx.subject.value += (x.camera.position.distanceTo(this.shotT >= 0 && this.hitT < 3.4 ? this.subject : view.root.position) + 1 - this.fx.subject.value) * (1 - Math.exp(-dt * 10));
    this.fx.reveal.value = stance ? 0.16 : this.shotT >= 0 && this.hitT < 0 ? 0.1 + 0.16 * ss(1.2, 2.4, this.shotT) : 0;
    this.placeSpot(x.camera, marking || this.shotT >= 0 ? 1 : 0, match.coverRadius);

    this.timeScale = this.hitT >= 0 && this.hitT < 0.3 ? 0.3 + this.hitT : 1;
    if (this.shotT >= 0 && !match.brood && (this.hitT > AFTER || (this.hitT < 0 && this.shotT > 0.6))) this.end();
  }

  private lateX: BowContext | null = null;
  private lateT = 0;
  private lateCome = -1;

  /** After the bugs are posed for the frame: the swarm, on them and round them, and all the eyes. */
  late(): void {
    const x = this.lateX;
    this.lateX = null;
    if (!x || this.shooter < 0) return;
    for (const v of this.victims) v.root.updateMatrixWorld(true);
    this.placeSwarm(x, this.lateCome);
    this.placeEyes(x, this.lateT);
  }

  // ---------------------------------------------------------------- beginning and end

  private begin(id: number, view: BugView): void {
    this.shooter = id;
    this.view = view;
    this.started = false;
    this.shotT = this.hitT = this.coverT = -1;
    this.brood = null;
    this.victims.length = 0;
    this.spread = 0;
    this.ringLevel.value = 0;
    this.seeking = false;
  }

  private end(): void {
    this.sceneTime = -1;
    for (const v of this.victims) v.struggle = 0;
    this.victims.length = 0;
    const v = this.view;
    if (v) {
      v.wings = v.rub = 0;
      v.torso.rotation.x = 0;
      v.torso.position.y = v.restY;
    }
    this.view = null;
    this.shooter = -1;
    this.shotT = this.hitT = this.coverT = -1;
    this.brood = null;
    this.timeScale = 1;
    this.light.intensity = 0;
    const f = this.fx;
    f.dim.value = f.vignette.value = f.flash.value = f.focusBlur.value = f.reveal.value = 0;
    f.spot.value.z = 0.0001;
    this.hideAll();
    this.camera.stop();
  }

  private hideAll(): void {
    for (const o of [...this.root.children, ...this.lights.children]) o.visible = false;
  }

  private keep(o: THREE.Mesh): void {
    o.frustumCulled = false;
    o.renderOrder = 12;
    ((o.material as THREE.Material).userData.fx ? this.lights : this.root).add(o);
  }

  // ---------------------------------------------------------------- the swarm

  /** Its way from where it starts to its place, over what is drawn between. */
  private lay(p: Runner, ground: DrawnGround): void {
    p.laid = true;
    p.long = 0;
    for (let k = 0; k <= STEPS; k++) {
      const f = k / STEPS;
      const n = p.ups[k].copy(p.startUp).lerp(p.endUp, ss(0.05, 0.6, f));
      if (n.lengthSq() < 0.01) n.copy(p.endUp);
      n.normalize();
      const q = p.way[k].lerpVectors(p.start, p.end, f);
      if (k > 0 && k < STEPS) this.snap(q, n, ground, 3);
      if (k > 0) p.long += q.distanceTo(p.way[k - 1]);
    }
    p.long = Math.max(0.5, p.long);
  }

  /** Where it is, `f` of its way on. */
  private along(p: Runner, f: number, out: THREE.Vector3, n: THREE.Vector3, face: THREE.Vector3): void {
    const k = Math.min(STEPS - 1, Math.max(0, Math.floor(f * STEPS)));
    const u = Math.min(1, Math.max(0, f * STEPS - k));
    out.lerpVectors(p.way[k], p.way[k + 1], u);
    n.lerpVectors(p.ups[k], p.ups[k + 1], u).normalize();
    face.subVectors(p.way[k + 1], p.way[k]);
  }

  private placeSwarm(x: BowContext, come: number): void {
    this.roaches.visible = come >= 0;
    if (!this.roaches.visible) return;
    const cover = BROOD_COVER / 60;
    const turn = 1 - Math.exp(-x.dt * 14);
    for (let i = 0; i < SWARM; i++) {
      const p = this.runners[i];
      const q = this.a;
      const n = this.b;
      const f = this.c;
      let size = SIZE * (0.75 + 0.5 * rnd(i + 33));
      let go = 0;
      if (this.hitT >= p.leaves) {
        // it runs from the light, the way it came
        if (!p.laid) this.lay(p, x.ground);
        const k = ((this.hitT - p.leaves) * RUN * (0.8 + 0.4 * rnd(i + 5))) / p.long;
        this.along(p, Math.max(0, 1 - k), q, n, f);
        this.snap(q, n, x.ground, 1.2);
        f.negate();
        if (k < 0.12) q.lerp(p.at, Math.exp(-x.dt * 16));
        size *= 1 - ss(0.86, 1, k);
        go = 1.2;
      } else {
        const leave = p.leaves * (this.hitT >= 0 ? 0 : 1);
        if (come > leave && !p.laid) this.lay(p, x.ground);
        // (they arrive one after the other, all of them by the time they bite)
        const need = Math.min(p.long / COME, cover + 0.3 - leave);
        const k = this.hitT >= 0 ? 1 : p.laid ? Math.max(0, (come - leave) / need) : 0;
        size *= this.hitT >= 0 ? 1 : ss(0, 0.18, come - leave + 0.02);
        if (k < 1) {
          this.along(p, k, q, n, f);
          if (p.laid) this.snap(q, n, x.ground, 1.2);
          go = p.laid ? 1 : 0;
        } else {
          q.copy(p.end);
          n.copy(p.endUp);
          f.copy(p.end).sub(p.way[STEPS - 1]);
          // (round and round the place; still in the sudden light)
          const still = this.hitT >= 0 ? 0 : 1;
          const an = this.clock * 1.7 * (i % 2 ? 1 : -1) * still + i;
          this.tangent(n, an, this.d);
          q.addScaledVector(this.d, 0.35 * still);
          f.crossVectors(n, this.d).multiplyScalar(i % 2 ? -1 : 1);
          this.snap(q, n, x.ground, 1.5);
          go = 0.8 * still;
        }
        if (p.on >= 0 && this.coverT >= 0 && this.victims[p.on]) {
          // up onto the bug
          const k2 = ss(0, 1, (this.coverT - 0.5 * rnd(i + 71)) / 0.4);
          if (k2 > 0) {
            this.seat(this.victims[p.on], i, this.d, this.e, this.s);
            q.lerp(this.d, k2);
            n.lerp(this.e, k2).normalize();
            f.lerp(this.s, k2);
            go = this.hitT >= 0 ? 0 : 0.9;
            size *= 1 - 0.28 * k2;
          }
        }
      }
      p.at.copy(q);
      p.stand.lerp(n, turn).normalize();
      f.addScaledVector(p.stand, -f.dot(p.stand));
      if (f.lengthSq() > 1e-6) p.face.lerp(f.normalize(), turn);
      p.face.addScaledVector(p.stand, -p.face.dot(p.stand));
      if (p.face.lengthSq() < 1e-6) this.tangent(p.stand, i, p.face);
      p.face.normalize();
      this.d.crossVectors(p.stand, p.face);
      this.m.makeBasis(this.d, p.stand, p.face);
      this.q.setFromRotationMatrix(this.m);
      this.m.compose(p.at, this.q, this.s.setScalar(Math.max(0.0001, size)));
      this.roaches.setMatrixAt(i, this.m);
      this.going.setX(i, go);
    }
    this.roaches.instanceMatrix.needsUpdate = true;
    this.going.needsUpdate = true;
  }

  private readonly seatU = new THREE.Vector3();
  private readonly seatAxis = new THREE.Vector3();

  /** A seat on the bug: on a lump of its body, or a leg; it crawls about there until the light is back. */
  private seat(view: BugView, i: number, p: THREE.Vector3, n: THREE.Vector3, f: THREE.Vector3): void {
    const part = rnd(i + 7);
    const t = this.hitT >= 0 ? this.clock - this.hitT : this.clock;
    const w = (0.5 + 0.5 * rnd(i + 21)) * (i % 2 ? 1 : -1);
    if (part < 0.2) {
      view.legPoint(i % view.legCount, 0.25 + 0.6 * rnd(i + 8) + 0.06 * Math.sin(t * w + i), p, f);
      n.set(0, 1, 0).applyQuaternion(view.root.quaternion).addScaledVector(f, -n.dot(f));
      if (n.lengthSq() < 0.01) n.copy(this.markUp);
      n.normalize();
      p.addScaledVector(n, view.species.radius * 0.05 + 0.01);
      return;
    }
    const lump = view.lumps[part < 0.72 ? 0 : part < 0.88 ? 1 : 2];
    const y = 1 - 1.5 * ((i * 0.61803) % 1);
    const an = i * 2.39996;
    const c = Math.sqrt(Math.max(0, 1 - y * y));
    const u = this.seatU.set(Math.cos(an) * c, y, Math.sin(an) * c);
    const axis = this.seatAxis.set(rnd(i + 300) - 0.5, rnd(i + 301) - 0.5, rnd(i + 302) - 0.5).normalize();
    this.q.setFromAxisAngle(axis, t * 0.7 * w);
    u.applyQuaternion(this.q);
    if (u.y < -0.35) u.y = -0.35;
    u.normalize();
    const s = lump.scale;
    p.copy(u).applyMatrix4(lump.matrixWorld);
    const parent = (lump.parent as THREE.Object3D).matrixWorld;
    n.set(u.x / s.x, u.y / s.y, u.z / s.z).normalize().transformDirection(parent);
    f.crossVectors(axis, u).multiplyScalar(w > 0 ? 1 : -1).transformDirection(parent);
    // (some on top of others)
    p.addScaledVector(n, 0.12 * rnd(i + 55));
  }

  /** Onto what is drawn under it; false: nothing there. */
  private snap(p: THREE.Vector3, n: THREE.Vector3, ground: DrawnGround, by: number): boolean {
    const h = ground.rest(p.x + n.x * by, p.y + n.y * by, p.z + n.z * by, -n.x, -n.y, -n.z, by * 2.2);
    if (h <= 0) return false;
    p.addScaledVector(n, by + 0.02 - h);
    return true;
  }

  // ---------------------------------------------------------------- lights

  /** Every eye in the dark: the caller's, the other bugs', the swarm's. */
  private placeEyes(x: BowContext, t: number): void {
    this.eyes.visible = this.dark > 0.02 || this.hitT >= 0;
    if (!this.eyes.visible) return;
    const cam = x.camera;
    const special = this.sceneTime >= 0;
    const shown = this.hitT >= 0 ? 0 : 1;
    let i = 0;
    const put = (p: THREE.Vector3, size: number, level: number): void => {
      if (i >= EYES) return;
      this.m.compose(p, cam.quaternion, this.s.setScalar(level > 0.01 ? size : 0.0001));
      this.eyes.setMatrixAt(i, this.m);
      this.tint.setXYZ(i, this.tone.r * level, this.tone.g * level, this.tone.b * level);
      i++;
    };
    // ---- the swarm's: waiting in the dark round the caller, or on their way
    this.tone.copy(AMBER);
    for (let k = 0; k < SWARM; k++) {
      const p = this.runners[k];
      let level = 0;
      if (this.shotT >= 0) {
        level = shown * ss(0, 0.2, this.shotT - 0.1 * rnd(k)) * (this.coverT >= 0 ? 0.55 : 0.9);
        this.d.crossVectors(p.stand, p.face);
        this.a.copy(p.at).addScaledVector(p.face, 0.36).addScaledVector(p.stand, 0.24);
      } else {
        const w = this.waiting[k];
        if (!w) continue;
        const opens = OTHERS + 0.9 * rnd(k + 17);
        const blink = Math.sin(this.clock * (0.5 + rnd(k)) + k * 2) > 0.985 ? 0 : 1;
        level = (special ? ss(opens, opens + 0.12, t) : 0.75) * blink * 0.8;
        this.a.copy(w.p);
        this.d.copy(w.s);
      }
      const dist = this.a.distanceTo(cam.position);
      const size = Math.max(0.22, dist * 0.008);
      const apart = Math.max(0.1, dist * 0.0032);
      for (const s of [-1, 1]) put(this.b.copy(this.a).addScaledVector(this.d, s * apart), size, level);
    }
    // ---- the bugs': in their team's colour (what lies behind them does not hide them, walls do)
    const match = x.match;
    for (const u of match.units) {
      if (!u.bug.alive) continue;
      const v = x.views[u.id];
      const own = u.id === this.shooter;
      let level = shown * this.dark;
      if (special) level = own ? ss(LIT, LIT + 0.1, t) : ss(OTHERS, OTHERS + 0.5, t);
      if (this.coverT >= 0 && this.victims.includes(v)) level *= 0.7;
      if (own) this.tone.copy(AMBER);
      else this.tone.setHex(match.teams[u.team].color);
      v.head.updateWorldMatrix(true, false);
      const hd = v.headRadius;
      const dist = v.root.position.distanceTo(cam.position);
      const close = dist < 12;
      const size = Math.max(hd * 1.5, dist * 0.016);
      this.d.set(1, 0, 0).applyQuaternion(cam.quaternion);
      for (const s of [-1, 1]) {
        if (close) this.a.set(s * hd * 0.6, hd * 0.15, hd * 0.85).applyMatrix4(v.head.matrixWorld);
        else this.a.copy(v.root.position).addScaledVector(this.e.set(0, 1, 0), 0.3).addScaledVector(this.d, s * Math.max(hd * 0.7, dist * 0.008));
        this.a.addScaledVector(this.e.copy(cam.position).sub(this.a).normalize(), close ? hd * 0.3 : v.species.radius * 1.3);
        put(this.a, size, level);
      }
    }
    while (i < EYES) put(this.base, 0.0001, 0);
    this.eyes.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
  }

  /** Where pairs of eyes wait in the dark round the caller: on what is drawn there. */
  private readonly waiting: ({ p: THREE.Vector3; s: THREE.Vector3 } | null)[] = new Array<null>(SWARM).fill(null);

  /** Look for those places, a few at a time, while the scene plays. */
  private seek(ground: DrawnGround): void {
    if (this.shotT >= 0) return;
    if (!this.seeking) {
      this.seeking = true;
      this.sought = 0;
      this.waiting.fill(null);
    }
    for (let n = 0; n < 4 && this.sought < SWARM; n++) {
      const i = this.sought++;
      if (rnd(i + 1) > 0.75) continue;
      const an = i * 2.39996;
      const el = -0.5 + 1.3 * rnd(i + 60);
      this.tangent(this.up, an, this.d);
      this.d.multiplyScalar(Math.cos(el)).addScaledVector(this.up, Math.sin(el));
      this.a.copy(this.base).addScaledVector(this.up, 3);
      const t = ground.raycast(this.a.x, this.a.y, this.a.z, this.d.x, this.d.y, this.d.z, 34);
      if (t < 4) continue;
      const p = this.a.clone().addScaledVector(this.d, t - 0.35);
      this.waiting[i] = { p, s: new THREE.Vector3().crossVectors(this.d, UP).normalize() };
    }
  }
  private seeking = false;
  private sought = 0;

  private layRing(radius: number): void {
    this.ringAt.value.copy(this.mark);
    this.ringSize.value = radius;
    this.tangent(this.markUp, 0, this.ringX.value);
    this.ringZ.value.crossVectors(this.markUp, this.ringX.value);
    this.ring.position.copy(this.mark);
    this.ring.scale.setScalar(radius * 1.6);
  }

  /** Rings run out from its wings while it rubs them. */
  private placeCalls(camera: THREE.Camera, r: number, t: number): void {
    for (let k = 0; k < RINGS; k++) {
      const mesh = this.calls[k];
      const start = 0.35 + k * 0.26;
      const u = t < 0 ? -1 : (t - start) / 0.75;
      mesh.visible = u > 0 && u < 1;
      if (!mesh.visible) continue;
      mesh.position.copy(this.base).addScaledVector(this.up, 1.3 * r).addScaledVector(this.fwd, -0.5 * r);
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.setScalar(r * (1.5 + 15 * u));
      this.callLevel[k].value = 0.42 * (1 - u) ** 1.6 * ss(0, 0.1, u);
    }
  }

  /** The marked spot is a little less dark than the rest (after the camera has moved). */
  private placeSpot(camera: THREE.PerspectiveCamera, on: number, radius: number): void {
    const s = this.fx.spot.value;
    if (on < 0.01 || this.hitT >= 0) {
      s.z = 0.0001;
      return;
    }
    this.a.copy(this.shotT >= 0 ? this.subject : this.mark);
    const dist = this.a.distanceTo(camera.position);
    this.fx.spotAt.value = dist;
    this.a.project(camera);
    s.x = this.a.x * 0.5 + 0.5;
    s.y = 0.5 - this.a.y * 0.5;
    s.w = camera.aspect;
    s.z = this.a.z > 1 ? 0.0001 : Math.max(0.0001, ((radius * 1.5) / dist / Math.tan((camera.fov * Math.PI) / 360)) * 0.5);
  }

  private tangent(n: THREE.Vector3, an: number, out: THREE.Vector3): THREE.Vector3 {
    this.e.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    out.crossVectors(n, this.e);
    const c = Math.cos(an);
    const s = Math.sin(an);
    return out.multiplyScalar(s).addScaledVector(this.e, c);
  }

  /** A light that adds to the picture and to the bloom, hidden softly by what stands before it. */
  private glow(rgb: THREE.Node, onGround = false): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    m.blending = THREE.AdditiveBlending;
    const gap = this.fx.depthAt(screenUV).add(positionView.z);
    m.colorNode = (rgb as THREE.Node<'vec3'>).mul(onGround ? float(1) : smoothstep(-0.3, 0.1, gap));
    m.fog = false;
    m.userData.fx = true;
    return m;
  }
}

/** The lights fail: on and off, off a little longer each time. */
function flicker(t: number, total: number): number {
  const u = t / total;
  const steps: [number, number][] = [[0, 0.75], [0.07, 0.16], [0.2, 0.85], [0.28, 0.25], [0.46, 0.95], [0.6, 0.5], [0.64, 0.95], [0.74, 0.7], [0.78, 1]];
  let v = 0.16;
  for (const [at, level] of steps) if (u >= at) v = level;
  return v;
}

/** A small cockroach, its feet at y = 0, about one unit long along +z; `limb` and `reach` say how its legs run. */
function roachGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const shell = new THREE.Color(0x6a2e10);
  const edge = new THREE.Color(0xa8662a);
  const dark = new THREE.Color(0x2c1408);
  const add = (g: THREE.BufferGeometry, color: THREE.Color, limb: number, reachOf: (x: number) => number): void => {
    const p = g.getAttribute('position');
    const n = p.count;
    const c = new Float32Array(n * 3);
    const l = new Float32Array(n).fill(limb);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      c.set([color.r, color.g, color.b], i * 3);
      r[i] = reachOf(p.getX(i));
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('limb', new THREE.BufferAttribute(l, 1));
    g.setAttribute('reach', new THREE.BufferAttribute(r, 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const ball = (x: number, y: number, z: number, a: number, b: number, c: number, color: THREE.Color): void => add(new THREE.SphereGeometry(1, 12, 8).scale(a, b, c).translate(x, y, z), color, 0, () => 0);
  ball(0, 0.12, -0.1, 0.17, 0.075, 0.36, dark);
  for (const s of [-1, 1]) ball(s * 0.075, 0.15, -0.14, 0.115, 0.07, 0.37, shell);
  ball(0, 0.16, 0.22, 0.165, 0.07, 0.13, edge);
  ball(0, 0.175, 0.22, 0.1, 0.07, 0.085, shell);
  ball(0, 0.13, 0.34, 0.075, 0.06, 0.07, dark);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, w: number, limb: number, leg: boolean): void => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(w * 0.6, w, d.length(), 5, 1).translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())).translate(a.x, a.y, a.z);
    add(g, dark, limb, (x) => (leg ? Math.min(1, Math.max(0, (Math.abs(x) - 0.1) / 0.25)) : 0));
  };
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = 0.18 - k * 0.16;
      const out = (0.7 - k) * 0.2;
      const beat = (k + (s > 0 ? 0 : 1)) % 2 ? Math.PI : 0;
      const knee = new THREE.Vector3(s * 0.28, 0.17, z + out * 0.4);
      rod(new THREE.Vector3(s * 0.1, 0.1, z), knee, 0.022, beat, true);
      rod(knee, new THREE.Vector3(s * 0.4, 0, z + out), 0.016, beat, true);
    }
    rod(new THREE.Vector3(s * 0.04, 0.16, 0.38), new THREE.Vector3(s * 0.2, 0.24, 0.62), 0.011, 0, false);
    rod(new THREE.Vector3(s * 0.2, 0.24, 0.62), new THREE.Vector3(s * 0.38, 0.2, 0.84), 0.008, 0, false);
  }
  return mergeGeometries(parts);
}
