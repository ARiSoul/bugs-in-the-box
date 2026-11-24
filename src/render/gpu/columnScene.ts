import * as THREE from 'three/webgpu';
import { attribute, hash, instanceIndex, max, mix, mx_noise_float, positionLocal, positionView, pow, screenUV, sin, smoothstep, uniform, uv, vec3, positionWorld } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IDLE, type Bug } from '../../game/bug';
import { MARCH_TICKS, PATH_STEP, type Column, type Match } from '../../game/match';
import type { BugView } from '../BugView';
import type { DrawnGround } from '../drawnGround';
import { tautArc } from '../webs';
import type { BowContext } from './bowScene';
import { ColumnCamera } from './columnCamera';
import type { StageFx } from './gpuStage';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
/** Amber of the call, its hot core, the green of the trail's edge. */
const AMBER = new THREE.Color(0xff9a1f);
const HOT = new THREE.Color(0xfff0c8);
const LEAF = new THREE.Color(0xa8e03a);

/** Small ants, in how many lanes the column runs, the ticks between one rank and the next. */
const ANTS = 180;
const LANES = 5;
const RANK_TICKS = 4.1;
/** Length of a small ant (world units). */
const SIZE = 0.74;
/** Seconds an ant leaps; chunks of ground; small ants that stay on the rim (every so many). */
const LEAP = 0.27;
const CHUNKS = 64;
const RIM = 8;
const HOLES = 8;
const MOTES = 80;
const PUFFS = 130;
/** Seconds the scene takes, when the slam and the holes come, when the last ant stands in its rank. */
const SLAM = 1.32;
const OPEN = 1.75;
const READY = 4.5;
/** Seconds the column holds the picture after it went under. */
const AFTER = 4.5;
/** Points of the path laid out before it goes. */
const PREVIEW = 150;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const back = (x: number): number => {
  const t = Math.min(1, Math.max(0, x)) - 1;
  return 1 + t * t * (2.7 * t + 1.7);
};
const rnd = (i: number): number => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A place on the ground: where, its normal. */
interface Spot {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

/**
 * The Ant Column's scene (render only): the ant rears and slams the ground, cracks run out, holes open and its nest
 * pours out and falls in round it; it points, the column charges along the match's path with the view in the middle
 * of it, swarms what it meets and goes under with the ground. It reads the match and never changes it.
 */
export class ColumnScene {
  readonly camera = new ColumnCamera();
  timeScale = 1;

  private readonly root = new THREE.Group();
  private readonly lights = new THREE.Group();
  private readonly time = uniform(0);
  private readonly crackLevel = uniform(0);
  private readonly crackGrow = uniform(0);
  private readonly moteLevel = uniform(0);
  private readonly trailLevel = uniform(0);
  private readonly trailFull = uniform(0);
  private readonly haloLevel = uniform(0);

  private readonly ants: THREE.InstancedMesh;
  private readonly going: THREE.InstancedBufferAttribute;
  private readonly holes: THREE.Group[] = [];
  private readonly motes: THREE.InstancedMesh;
  private readonly puffs: THREE.InstancedMesh;
  private readonly puffDense: THREE.InstancedBufferAttribute;
  private readonly puffAge: THREE.InstancedBufferAttribute;
  private readonly clods: THREE.InstancedMesh;
  private readonly halos: THREE.Mesh[] = [];
  private crack: THREE.Mesh | null = null;
  private readonly crackMaterial: THREE.Material;
  private readonly trail: THREE.Mesh;
  private readonly waveAt = uniform(0);
  private readonly waveLevel = uniform(0);
  private readonly waveMaterial: THREE.Material;
  private wave: THREE.Mesh | null = null;
  private waveT = -1;
  private readonly burst: THREE.Mesh;
  private readonly burstLevel = uniform(0);
  private readonly chunks: THREE.InstancedMesh;
  private readonly chunkV: { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private crack2: THREE.Mesh | null = null;
  private readonly crack2Level = uniform(0);
  private readonly crack2Grow = uniform(0);
  private readonly crack2Material: THREE.Material;
  private readonly digs: Spot[] = [];
  private readonly rims: Spot[] = [];
  private victimView: BugView | null = null;
  private stopTick = 0;
  private readonly noRank: boolean[] = new Array<boolean>(ANTS).fill(false);

  private frames = 0;
  private clock = 0;
  private shooter = -1;
  private view: BugView | null = null;
  private rise = 0;
  private started = false;
  private slammed = false;
  private shotT = -1;
  private swarmT = -1;
  private fallT = -1;
  /** The column being shown (the match lets go of it when it goes under). */
  private column: Column | null = null;
  private pathTicks = 0;
  private readonly fallAt = new THREE.Vector3();
  private readonly fallUp = new THREE.Vector3(0, 1, 0);
  private readonly base = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly side = new THREE.Vector3(1, 0, 0);
  private readonly ranks: Spot[] = [];
  private readonly mouths: Spot[] = [];
  /** Where each small ant was last drawn, and which way. */
  private readonly at: THREE.Vector3[] = [];
  private readonly face: THREE.Vector3[] = [];
  private readonly stand: THREE.Vector3[] = [];
  private readonly puffList: { p: THREE.Vector3; v: THREE.Vector3; t: number; life: number; size: number; dense: number }[] = [];
  private previewKey = '';
  private readonly fill = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly headUp = new THREE.Vector3(0, 1, 0);
  private readonly headDir = new THREE.Vector3(0, 0, 1);
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly eyeGlow = new THREE.Color();
  private readonly skinGlow = new THREE.Color();

  /** `light`, `targetLight`: the lights special attacks share. */
  constructor(
    scene: THREE.Scene,
    private readonly fx: StageFx,
    private readonly light: THREE.PointLight,
    private readonly targetLight: THREE.PointLight,
  ) {
    scene.add(this.root);
    fx.scene.add(this.lights);

    // ---- the small ants: one geometry, its legs run in the vertex shader
    const g = antGeometry();
    this.going = new THREE.InstancedBufferAttribute(new Float32Array(ANTS), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('going', this.going);
    const ant = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
    const limb = attribute('limb', 'float');
    const reach = attribute('reach', 'float');
    const go = attribute('going', 'float');
    const beat = sin(this.time.mul(21).add(limb).add(hash(instanceIndex).mul(6.28)));
    ant.positionNode = positionLocal.add(vec3(0, max(beat, 0).mul(0.06), beat.mul(0.13)).mul(reach).mul(go));
    // (a little light of its own: the picture's dimming knows it by that)
    ant.emissiveNode = attribute('color', 'vec3').mul(0.1);
    ant.fog = false;
    this.ants = new THREE.InstancedMesh(g, ant, ANTS);
    this.ants.castShadow = true;
    this.ants.receiveShadow = true;
    this.keep(this.ants);
    for (let i = 0; i < ANTS; i++) {
      this.at.push(new THREE.Vector3());
      this.face.push(new THREE.Vector3(0, 0, 1));
      this.stand.push(new THREE.Vector3(0, 1, 0));
      this.ranks.push({ p: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0) });
    }

    // ---- the holes they come out of: a dark mouth, a rim of crumbs
    const dark = new THREE.MeshBasicNodeMaterial({ color: 0x020101, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    dark.fog = false;
    const soil = new THREE.MeshStandardNodeMaterial({ color: 0x4a3521, roughness: 0.95, metalness: 0 });
    for (let k = 0; k < HOLES; k++) {
      const h = new THREE.Group();
      h.add(new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), dark));
      for (let i = 0; i < 46; i++) {
        const an = rnd(k * 70 + i) * Math.PI * 2;
        const rad = 0.6 + 0.42 * rnd(k * 70 + i + 900) ** 1.6;
        const size = 0.06 + 0.11 * rnd(k * 70 + i + 1800);
        const c = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), soil);
        c.position.set(Math.cos(an) * rad, Math.sin(an) * rad, size * 0.35 + (0.2 * Math.max(0, 1 - Math.abs(rad - 0.72) * 4)) * rnd(i));
        c.rotation.set(i, i * 2, k);
        c.castShadow = true;
        h.add(c);
      }
      this.keep(h);
      this.holes.push(h);
    }
    const rubble = new THREE.MeshStandardNodeMaterial({ color: 0x2a2826, roughness: 0.9, metalness: 0 });
    rubble.emissiveNode = vec3(0.012, 0.009, 0.006);
    this.chunks = new THREE.InstancedMesh(shardGeometry(), rubble, CHUNKS);
    this.chunks.castShadow = true;
    this.keep(this.chunks);
    for (let k = 0; k < CHUNKS; k++) this.chunkV.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), spin: new THREE.Vector3() });
    this.clods = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), soil, 60);
    this.clods.castShadow = true;
    this.keep(this.clods);

    // ---- cracks in the ground: amber runs out along them and beats
    {
      const r = attribute('reach', 'float');
      const on = smoothstep(this.crackGrow, this.crackGrow.sub(0.08), r);
      const edge = smoothstep(0.1, 0, this.crackGrow.sub(r).abs());
      const beatC = pow(sin(r.mul(9).sub(this.time.mul(6))).mul(0.5).add(0.5), 3);
      this.crackMaterial = this.light3(mix(vec3(AMBER.r, AMBER.g, AMBER.b), vec3(HOT.r, HOT.g, HOT.b), edge).mul(on.mul(beatC.mul(0.9).add(0.35)).add(edge.mul(1.8))).mul(this.crackLevel), true);
      const on2 = smoothstep(this.crack2Grow, this.crack2Grow.sub(0.08), r);
      const edge2 = smoothstep(0.1, 0, this.crack2Grow.sub(r).abs());
      this.crack2Material = this.light3(mix(vec3(AMBER.r, AMBER.g, AMBER.b), vec3(HOT.r, HOT.g, HOT.b), edge2).mul(on2.mul(beatC.mul(0.9).add(0.5)).add(edge2.mul(1.5))).mul(this.crack2Level), true);
    }

    // ---- the wave that runs over the ground: a torn band on a sheet laid on it
    {
      const r = attribute('reach', 'float');
      const n = mx_noise_float(positionWorld.mul(1.7));
      const band = smoothstep(0.1, 0, r.sub(this.waveAt).abs()).mul(smoothstep(-0.2, 0.35, n));
      const thin = smoothstep(0.022, 0, r.sub(this.waveAt).abs()).mul(smoothstep(-0.35, 0.1, n));
      this.waveMaterial = this.light3(mix(vec3(AMBER.r, AMBER.g, AMBER.b), vec3(HOT.r, HOT.g, HOT.b), thin).mul(band.mul(0.1).add(thin.mul(1.1))).mul(this.waveLevel), true);
    }
    {
      const s = uv().sub(0.5).length().mul(2);
      const core = pow(max(s.oneMinus(), 0), 2.2);
      this.burst = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.light3(mix(vec3(AMBER.r, AMBER.g, AMBER.b), vec3(1, 1, 1), core).mul(core).mul(this.burstLevel)));
      this.keep(this.burst);
    }

    // ---- the trail laid out before the column: chevrons that run
    {
      const u = uv();
      const across = u.x.sub(0.5).abs().mul(2);
      const run = u.y.mul(40).sub(this.time.mul(3.2)).add(across.mul(0.9));
      const chevron = smoothstep(0.35, 0.75, sin(run.mul(3.14159)).mul(0.5).add(0.5)).mul(smoothstep(1, 0.7, across));
      const rim = smoothstep(0.78, 0.9, across).mul(smoothstep(1, 0.93, across));
      const full = smoothstep(this.trailFull.add(0.01), this.trailFull.sub(0.01), u.y);
      const fade = smoothstep(1, 0.8, u.y).mul(smoothstep(0, 0.03, u.y));
      const tint = mix(vec3(AMBER.r, AMBER.g, AMBER.b).mul(0.55), vec3(AMBER.r, AMBER.g, AMBER.b).mul(1.5), full);
      this.trail = new THREE.Mesh(stripGeometry(PREVIEW), this.light3(tint.mul(chevron.mul(0.5).add(rim.mul(0.7))).mul(full.mul(0.7).add(0.6)).mul(fade).mul(this.trailLevel)));
      this.keep(this.trail);
    }

    // ---- motes of the call, puffs of dust
    this.motes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), this.light3(mix(vec3(AMBER.r, AMBER.g, AMBER.b), vec3(LEAF.r, LEAF.g, LEAF.b), smoothstep(0.82, 0.9, hash(instanceIndex))).mul(this.moteLevel).mul(1.7)), MOTES);
    this.keep(this.motes);
    {
      const pg = new THREE.PlaneGeometry(1, 1);
      this.puffAge = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('age', this.puffAge);
      this.puffDense = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS).fill(0.34), 1).setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('dense', this.puffDense);
      const age = attribute('age', 'float');
      const r = uv().sub(0.5).length().mul(2);
      const n = mx_noise_float(vec3(uv().mul(3.2), hash(instanceIndex).mul(50).add(age.mul(0.7))));
      const body = smoothstep(1, 0.15, r.add(n.mul(0.35)));
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      m.colorNode = vec3(0.12, 0.09, 0.06).mul(n.mul(0.5).add(0.85));
      const gap = this.fx.depthAt(screenUV).add(positionView.z);
      m.opacityNode = body.mul(age.oneMinus()).mul(smoothstep(0, 0.12, age)).mul(attribute('dense', 'float')).mul(smoothstep(0, 0.9, gap));
      m.fog = false;
      m.depthTest = false;
      m.userData.fx = true;
      this.puffs = new THREE.InstancedMesh(pg, m, PUFFS);
      this.keep(this.puffs);
    }
    // ---- the lights at its antennae and eyes
    for (let k = 0; k < 4; k++) {
      const s = uv().sub(0.5).length().mul(2);
      const core = pow(max(s.oneMinus(), 0), 2.6);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.light3(mix(vec3(AMBER.r, AMBER.g, AMBER.b), vec3(HOT.r, HOT.g, HOT.b), core).mul(core).mul(this.haloLevel).mul(k < 2 ? 0.55 : 0.3)));
      this.keep(mesh);
      this.halos.push(mesh);
    }
  }

  /** Seconds since the column went under (-1: not yet). */
  get hitFor(): number {
    return this.fallT;
  }

  /** The bugs' names may show (not over the last picture). */
  get names(): boolean {
    return this.fallT < 3.4;
  }

  /** The column has an enemy in its grip. */
  get swarming(): boolean {
    return this.swarmT >= 0;
  }

  clear(): void {
    if (this.shooter >= 0) this.end();
    this.hideAll();
    this.camera.stop();
  }

  /** The column sets out. */
  onFire(): void {
    if (this.shooter < 0) return;
    this.shotT = 0;
    this.pathTicks = 0;
    this.waveT = 0;
  }

  onSwarm(): void {
    if (this.shotT < 0) return;
    this.swarmT = 0;
    this.stopTick = this.pathTicks;
  }

  /** It digs the ground away at (x, y, z). */
  onCollapse(x: number, y: number, z: number): void {
    if (this.shotT < 0) return;
    this.fallT = 0;
    if (this.swarmT < 0) this.stopTick = this.pathTicks;
    this.fallAt.set(x, y, z);
    this.fallUp.copy(this.headUp);
    this.fresh = true;
    this.camera.kick(0.9);
    this.burstLevel.value = 1.6;
    this.burst.position.copy(this.fallAt).addScaledVector(this.fallUp, 0.6);
    this.burst.scale.setScalar(5);
    // the ground goes: a dense cloud first, then what is left of it blown outwards; clumps of it fly and fall
    for (let i = 0; i < 34; i++) {
      const an = rnd(i) * Math.PI * 2;
      this.tangent(this.fallUp, an, this.b);
      this.a.copy(this.fallAt).addScaledVector(this.b, 3.6 * Math.sqrt(rnd(i + 50))).addScaledVector(this.fallUp, 1.1 + 0.6 * rnd(i + 77));
      this.puff(this.a, this.b.multiplyScalar(1 + 2 * rnd(i + 3)).addScaledVector(this.fallUp, 1.2 * rnd(i + 8)), 0.55 + 0.35 * rnd(i + 20), 1.7 + 1.3 * rnd(i + 70), 0.6);
    }
    for (let i = 0; i < 56; i++) {
      const an = rnd(i + 5) * Math.PI * 2;
      this.tangent(this.fallUp, an, this.b);
      this.a.copy(this.fallAt).addScaledVector(this.b, 3.3).addScaledVector(this.fallUp, 0.4);
      this.puff(this.a, this.b.multiplyScalar(4 + 5 * rnd(i + 50)).addScaledVector(this.fallUp, 0.4 + 2.2 * rnd(i + 90)), 1.1 + 1.2 * rnd(i + 21), 0.9 + 1.1 * rnd(i + 71), 0.3);
    }
    this.chunkV.forEach((q, i) => {
      const out = i % 2 === 0;
      const an = rnd(i + 11) * Math.PI * 2;
      this.tangent(this.fallUp, an, q.v);
      q.p.copy(this.fallAt).addScaledVector(q.v, 3.5 * Math.sqrt(rnd(i + 12))).addScaledVector(this.fallUp, 0.2);
      q.v.multiplyScalar(out ? 2.5 + 4.5 * rnd(i + 13) : -0.6).addScaledVector(this.fallUp, out ? 2.5 + 5 * rnd(i + 14) : 0.4);
      q.spin.set(rnd(i + 15) - 0.5, rnd(i + 16) - 0.5, rnd(i + 17) - 0.5).normalize();
    });
  }
  /** The hole is new: where they dig in and who stays on its rim is still to be found. */
  private fresh = false;

  // ---------------------------------------------------------------- every frame

  update(x: BowContext): void {
    const { match, view, dt, alpha } = x;
    if (this.frames < 100) {
      this.frames++;
      if (this.frames < 90) {
        this.root.position.set(0, -600, 0);
        this.lights.position.set(0, -600, 0);
        for (const o of [...this.root.children, ...this.lights.children]) o.visible = true;
        if (this.frames === 1) this.warmUp();
        return;
      }
      if (this.frames === 90) {
        this.root.position.set(0, 0, 0);
        this.lights.position.set(0, 0, 0);
        this.hideAll();
      }
    }
    if (this.shooter < 0) this.fx.fade.value *= Math.exp(-dt * 7);
    const u = match.activeUnit;
    const mine = match.currentWeapon.kind === 'column';
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
    const b = u.bug;
    const r = b.species.radius;
    this.up.set(b.nx, b.ny, b.nz);
    this.fwd.set(b.hx, b.hy, b.hz).addScaledVector(this.up, -(b.hx * b.nx + b.hy * b.ny + b.hz * b.nz)).normalize();
    this.side.crossVectors(this.up, this.fwd);
    this.base.copy(view.root.position).addScaledVector(this.up, -r);
    if (special && !this.started) {
      this.started = true;
      this.prepare(x.ground, r);
      this.camera.start();
    }
    this.clock += dt;
    this.time.value = this.clock;
    if (this.shotT >= 0) this.shotT += dt;
    if (this.swarmT >= 0) this.swarmT += dt;
    if (this.fallT >= 0) this.fallT += dt;
    if (match.column) this.column = match.column;
    const col = this.shotT >= 0 ? this.column : null;
    if (col) this.follow(col, match, alpha);

    // ---- the commander: rears, slams, stands again and points
    const pose = view.pose;
    const gone = this.shotT >= 0 ? ss(0.9, 1.6, this.shotT) : 0;
    const leave = this.fallT >= AFTER - 0.03 ? 1 : 0;
    const wanted = special ? (t < 0.15 ? 0 : t < SLAM - 0.14 ? 1 : t < 3.25 ? 0 : 1) : leave > 0.1 ? 0 : 1;
    const speed = special && t > SLAM - 0.14 && t < SLAM + 0.3 ? 34 : 7;
    this.rise += (wanted - this.rise) * (1 - Math.exp(-dt * speed));
    const charge = stance && match.charging ? match.power : 0;
    pose.weight = this.rise;
    pose.tie = 1;
    pose.fold = 0;
    pose.sway = Math.sin(this.clock * 2);
    pose.spread = 0.5;
    const rear = special ? 1 - ss(3.2, 3.5, t) : 0;
    const down = this.fallT >= 0 ? ss(0.5, 2, this.fallT) : 0;
    pose.lean = 0.35 * rear * ss(0.4, 1.0, t) + 0.14 * charge - 0.22 * Math.min(1, this.shotT >= 0 ? back(this.shotT / 0.2) : 0) * (1 - down);
    pose.look = 0.3 * rear;
    // (arms up before the slam; then one hand forward, the other raised; it draws back with the charge, and swings)
    const swing = this.shotT >= 0 ? back(this.shotT / 0.2) : 0;
    pose.grip.set(0.75, 2.35 + 0.25 * Math.sin(this.clock * 3), 0.3).lerp(this.a.set(2.4, 1.0, -2.6), Math.min(1, swing)).lerp(this.a.set(1.5, 3.6, 0.5), down).lerp(this.a.set(0.95, 2.7, 0.75), rear);
    pose.nock.set(-0.5, 1.9 + 0.75 * charge, 1.45 - 2.1 * charge).lerp(this.a.set(-1.5, 2.05, 3.6), swing).lerp(this.a.set(-1.5, 0.5, 0.2), down).lerp(this.a.set(-0.95, 2.7, 0.75), rear);
    const lit = special ? ss(1.4, 1.9, t) : 1 - leave;
    view.eyes.emissive.copy(this.eyeGlow).lerp(AMBER, lit).multiplyScalar(1 + lit * 3);
    view.skin.emissive.copy(this.skinGlow).lerp(AMBER, 0.06 * lit);
    view.legSkin.emissive.setScalar(0.03 * (1 - leave));

    // ---- the ground
    if (special && t > SLAM && !this.slammed) {
      this.slammed = true;
      this.camera.kick(0.8);
      this.waveT = 0;
      this.burstLevel.value = 2.2;
      this.burst.position.copy(this.base).addScaledVector(this.fwd, 1.0 * r).addScaledVector(this.up, 0.3);
      this.burst.scale.setScalar(3.4 * r);
      for (let i = 0; i < 40; i++) {
        const an = (i / 40) * Math.PI * 2;
        this.puff(this.a.copy(this.base).addScaledVector(this.tangent(this.up, an, this.b), 1.1), this.b.multiplyScalar(4.5 + 3 * rnd(i)).addScaledVector(this.up, 0.5 + 0.8 * rnd(i + 9)), 0.8 + 0.6 * rnd(i + 3), 0.6 + 0.7 * rnd(i + 5), 0.26);
      }
      for (let i = 0; i < 24; i++) {
        const q = this.clodV[i];
        q.t = 0;
        q.p.copy(this.base).addScaledVector(this.tangent(this.up, i * 2.4, q.v), 0.9 * r).addScaledVector(this.up, 0.1);
        q.v.multiplyScalar(1.6 + 2 * rnd(i + 4)).addScaledVector(this.up, 3 + 2.8 * rnd(i + 6));
      }
    }
    this.crackLevel.value = ss(SLAM, SLAM + 0.05, t) * (1 - gone) * (stance ? 0.45 : 1);
    this.crackGrow.value = t > SLAM ? 0.16 + 1.14 * ss(SLAM, SLAM + 0.8, t) : 0;
    this.waveT = this.waveT >= 0 ? this.waveT + dt : -1;
    const wk = this.waveT >= 0 ? Math.min(1, this.waveT / 0.9) : 1;
    this.waveAt.value = 1 - (1 - wk) ** 2.2;
    this.waveLevel.value = (1 - wk) ** 1.5;
    if (this.wave) this.wave.visible = wk < 1;
    this.burstLevel.value *= Math.exp(-dt * 11);
    this.burst.visible = this.burstLevel.value > 0.02;
    this.placeUnder(col, x, r);
    if (this.crack) this.crack.visible = this.crackLevel.value > 0.01;
    this.placeHoles(t, gone);

    // ---- the view of it all, then whatever faces the view
    this.camera.update(x.camera, {
      t,
      shotT: this.shotT,
      swarmT: this.swarmT,
      fallT: this.fallT,
      stance,
      power: charge,
      at: view.root.position,
      up: this.up,
      fwd: this.fwd,
      radius: r,
      head: this.head,
      headUp: this.headUp,
      headDir: this.headDir,
      fall: this.fallAt,
      dt,
      ground: x.ground,
    });
    x.camera.updateMatrixWorld();

    this.burst.quaternion.copy(x.camera.quaternion);
    this.lateT = t;
    this.lateX = x;
    this.lateCol = col;
    this.placeChunks(dt, x.ground);
    this.lightTarget(x, col);
    this.placeTrail(match, u.bug, stance, charge, x.ground, match.column && this.swarmT < 0 ? match.column : null);
    this.moteLevel.value = lit * (stance ? 0.6 : 1);
    this.placeMotes(view, r, lit);
    this.haloLevel.value = lit * (special && t < 3.4 ? 0.55 + 0.6 * Math.max(0, Math.sin(this.clock * 7)) ** 3 : 0.8 + 0.2 * Math.sin(this.clock * 9));
    this.placeHalos(x.camera, view, r, lit);
    this.placePuffs(x.camera, dt);
    this.placeClods(dt);
    // ---- the one light
    const ease = 1 - Math.exp(-dt * 10);
    let goal = special ? 8 + 34 * ss(SLAM, SLAM + 0.1, t) * Math.exp(-Math.max(0, t - SLAM) * 1.3) + 14 * lit : stance ? 15 : 0;
    this.a.copy(view.root.position).addScaledVector(this.up, r * 3).addScaledVector(this.b.copy(x.camera.position).sub(view.root.position).normalize(), r * 2);
    if (col) {
      this.a.copy(this.head).addScaledVector(this.headUp, 3.4);
      goal = this.fallT >= 3.5 ? 14 : this.fallT >= 0 ? 7 + 15 * Math.exp(-this.fallT * 1.1) : this.swarmT >= 0 ? 16 : 30;
      // (two, low on opposite sides: from below, and no hot spot on what lies in the middle)
      if (this.fallT >= 0) {
        this.tangent(this.fallUp, 0.8, this.d);
        this.a.copy(this.fallAt).addScaledVector(this.fallUp, -1.7).addScaledVector(this.d, 2.3);
        this.fill.copy(this.fallAt).addScaledVector(this.fallUp, -1.7).addScaledVector(this.d, -2.3);
      }
      if (this.fallT >= 3.5) this.a.copy(view.root.position).addScaledVector(this.up, r * 3).addScaledVector(this.b.copy(x.camera.position).sub(view.root.position).normalize(), r * 2);
    }
    this.light.color.copy(HOT).lerp(AMBER, this.fallT >= 0 && this.fallT < 3.5 ? 0.8 : col && this.swarmT < 0 ? 0.6 : 0.15);
    this.light.position.lerp(this.a, t < 0.1 || (this.fallT >= 0 && this.fallT < 0.1) || (this.fallT >= 3.5 && this.fallT < 3.6) ? 1 : ease);
    this.light.intensity += (goal - this.light.intensity) * ease;

    // ---- the picture
    const dim = special ? 0.62 + 0.3 * ss(0, 0.5, t) : stance ? 0.5 : this.fallT >= 3.5 ? 0.93 : this.fallT >= 0 ? 0.8 : this.swarmT >= 0 ? 0.88 : this.shotT < 0.75 ? 0.93 : 0.88;
    // (at the cut to the release it is dark at once)
    this.fx.dim.value += (dim * 0.95 - this.fx.dim.value) * ((this.shotT >= 0 && this.shotT < 0.06) || (special && t < 0.06) || (this.fallT >= 3.5 && this.fallT < 3.6) ? 1 : 1 - Math.exp(-dt * 12));
    this.fx.fade.value = this.fallT >= 0 ? ss(AFTER - 0.25, AFTER - 0.03, this.fallT) : 0;
    this.fx.vignette.value = this.fx.dim.value * 0.75;
    this.fx.flash.value = 0;
    this.fx.focusBlur.value = this.shotT > 0.5 && this.swarmT < 0 && this.fallT < 0 ? 0.55 : 0;
    const about = this.fallT >= 0 ? this.fallAt : col ? this.head : view.root.position;
    this.fx.subject.value += (x.camera.position.distanceTo(about) + (col && this.swarmT < 0 && this.fallT < 0 ? 6 : 1) - this.fx.subject.value) * (1 - Math.exp(-dt * 10));

    this.timeScale = 1;
    if (this.fallT >= 0 && this.fallT < 0.5) this.timeScale = 0.35 + this.fallT * 1.1;
    if (special && t > SLAM && t < SLAM + 0.03) this.timeScale = 0.2;

    if (this.shotT >= 0 && !match.column && (this.fallT > AFTER || (this.fallT < 0 && this.shotT > 0.6))) this.end();
  }

  private lateT = 0;
  private lateX: BowContext | null = null;
  private lateCol: Column | null = null;

  /** After the bugs are posed for the frame: the small ants, on them and round them. */
  late(): void {
    const x = this.lateX;
    this.lateX = null;
    if (x && this.shooter >= 0) this.placeAnts(x.match, x.views, this.lateT, this.lateCol, x.ground, x.dt);
  }

  // ---------------------------------------------------------------- beginning and end

  private begin(id: number, view: BugView): void {
    this.shooter = id;
    this.view = view;
    this.started = this.slammed = false;
    this.shotT = this.swarmT = this.fallT = -1;
    this.column = null;
    this.rise = 0;
    this.previewKey = '';
    this.eyeGlow.copy(view.eyes.emissive);
    this.skinGlow.copy(view.skin.emissive);
    this.puffList.length = 0;
    this.victimView = null;
    this.waveT = -1;
    this.digs.length = this.rims.length = 0;
  }

  private end(): void {
    if (this.victimView) this.victimView.struggle = this.victimView.tumble = 0;
    this.victimView = null;
    this.targetLight.intensity = 0;
    this.targetLight.color.setHex(0xcfe8ff);
    this.fx.spot.value.z = 0.0001;
    const v = this.view;
    if (v) {
      v.pose.weight = 0;
      v.pose.tie = 0;
      v.eyes.emissive.copy(this.eyeGlow);
      v.skin.emissive.copy(this.skinGlow);
      v.legSkin.emissive.setScalar(0);
    }
    this.view = null;
    this.shooter = -1;
    this.shotT = this.swarmT = this.fallT = -1;
    this.column = null;
    this.timeScale = 1;
    this.light.intensity = 0;
    const f = this.fx;
    f.dim.value = f.vignette.value = f.flash.value = f.focusBlur.value = 0;
    this.hideAll();
    this.camera.stop();
  }

  private hideAll(): void {
    for (const o of [...this.root.children, ...this.lights.children]) o.visible = false;
    for (const o of [this.crack, this.crack2, this.wave])
      if (o) {
        o.removeFromParent();
        o.geometry.dispose();
      }
    this.crack = this.crack2 = this.wave = null;
  }

  private warmUp(): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('reach', new THREE.Float32BufferAttribute([0, 1, 1], 1));
    this.crack = new THREE.Mesh(g, this.crackMaterial);
    this.keep(this.crack);
    this.crack.visible = true;
    this.crack2 = new THREE.Mesh(g.clone(), this.crack2Material);
    this.keep(this.crack2);
    this.wave = new THREE.Mesh(g.clone(), this.waveMaterial);
    this.keep(this.wave);
  }

  private keep(o: THREE.Object3D): void {
    o.traverse((q) => {
      q.frustumCulled = false;
      q.renderOrder = 12;
    });
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    (m && m.userData.fx ? this.lights : this.root).add(o);
  }

  /** Where the holes open and where each small ant falls in (on the ground as it is now); the cracks. */
  private prepare(ground: DrawnGround, r: number): void {
    const spot = (along: number, out: number): Spot | null => {
      const p = new THREE.Vector3().copy(this.base).addScaledVector(this.fwd, along).addScaledVector(this.side, out);
      const n = this.up.clone();
      const t = ground.rest(p.x + n.x * 2.4, p.y + n.y * 2.4, p.z + n.z * 2.4, -n.x, -n.y, -n.z, 5.2);
      if (t <= 0) return null;
      p.addScaledVector(n, 2.4 - t);
      return { p, n };
    };
    this.mouths.length = 0;
    for (let k = 0; k < HOLES * 4 && this.mouths.length < HOLES; k++) {
      const an = k * 2.39996 + 0.6;
      const rad = r * (3.4 + 2.6 * rnd(k + 4));
      const s = spot(Math.cos(an) * rad, Math.sin(an) * rad);
      if (s && this.mouths.every((o) => o.p.distanceTo(s.p) > 1.9)) this.mouths.push(s);
    }
    if (this.mouths.length === 0) this.mouths.push({ p: this.base.clone(), n: this.up.clone() });
    // ranks: blocks at both sides of it and behind, a lane before it left free
    let i = 0;
    for (let row = 0; row < 40 && i < ANTS; row++)
      for (let k = 0; k < 12 && i < ANTS; k++) {
        const wing = k < 6 ? -1 : 1;
        const out = wing * r * (2.1 + (k % 6) * 0.92);
        const along = r * (2.2 - row * 1.15);
        const s = spot(along + (rnd(i) - 0.5) * 0.14, out + (rnd(i + 400) - 0.5) * 0.14);
        // (no ground there: it has no place in the ranks, it waits by its hole)
        if (!s && row < 30) continue;
        const q = s ?? this.mouths[i % this.mouths.length];
        this.noRank[i] = !s;
        this.ranks[i].p.copy(q.p);
        this.ranks[i].n.copy(q.n);
        i++;
      }
    for (; i < ANTS; i++) {
      this.noRank[i] = true;
      const q = this.mouths[i % this.mouths.length];
      this.ranks[i].p.copy(q.p);
      this.ranks[i].n.copy(q.n);
    }
    for (let k = 0; k < ANTS; k++) {
      const q = this.mouths[k % this.mouths.length];
      this.at[k].copy(q.p);
      this.stand[k].copy(q.n);
      this.face[k].copy(this.fwd);
    }
    if (this.crack) {
      this.crack.removeFromParent();
      this.crack.geometry.dispose();
    }
    this.crack = new THREE.Mesh(this.crackGeometry(this.base.clone(), this.up.clone(), r * 8, 9, ground, this.mouths), this.crackMaterial);
    this.keep(this.crack);
    if (this.wave) {
      this.wave.removeFromParent();
      this.wave.geometry.dispose();
    }
    this.wave = new THREE.Mesh(this.sheet(r * 9, ground), this.waveMaterial);
    this.keep(this.wave);
    this.wave.visible = false;
    // clods rest by the mouths until they jump
    this.clodV.length = 0;
    for (let k = 0; k < 60; k++) this.clodV.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: -1 });
  }

  /** Cracks: forked lines from under it outwards, on what is drawn. */
  private crackGeometry(mid: THREE.Vector3, n: THREE.Vector3, size: number, rays: number, ground: DrawnGround, holes: readonly Spot[]): THREE.BufferGeometry {
    const pos: number[] = [];
    const reach: number[] = [];
    const e = new THREE.Vector3();
    const f = new THREE.Vector3();
    const u = this.tangent(n, 0, new THREE.Vector3()).clone();
    const v = new THREE.Vector3().crossVectors(n, u);
    const ribbon = (a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, wa: number, wb: number): void => {
      e.copy(b).sub(a);
      if (e.lengthSq() < 1e-8) return;
      f.crossVectors(e, n);
      if (f.lengthSq() < 0.1 * e.lengthSq()) f.crossVectors(e, u);
      f.normalize();
      pos.push(a.x - f.x * wa, a.y - f.y * wa, a.z - f.z * wa, b.x - f.x * wb, b.y - f.y * wb, b.z - f.z * wb, b.x + f.x * wb, b.y + f.y * wb, b.z + f.z * wb);
      pos.push(a.x - f.x * wa, a.y - f.y * wa, a.z - f.z * wa, b.x + f.x * wb, b.y + f.y * wb, b.z + f.z * wb, a.x + f.x * wa, a.y + f.y * wa, a.z + f.z * wa);
      reach.push(ra, rb, rb, ra, rb, ra);
    };
    const walk = (p0: THREE.Vector3, angle: number, d0: number, len: number, w: number, seed: number, fork: number): void => {
      let a = p0.clone();
      let an = angle;
      let d = d0;
      const steps = Math.ceil(len / 0.55);
      for (let k = 0; k < steps; k++) {
        an += (rnd(seed + k * 3.1) - 0.5) * 0.95;
        const q = a.clone().addScaledVector(u, Math.cos(an) * 0.55).addScaledVector(v, Math.sin(an) * 0.55);
        const t = ground.rest(q.x + n.x * 2, q.y + n.y * 2, q.z + n.z * 2, -n.x, -n.y, -n.z, 4.4);
        if (t <= 0) return;
        q.addScaledVector(n, 2 - t + 0.13);
        if (holes.some((o) => o.p.distanceTo(q) < 1.0)) return;
        if (Math.abs(this.a.copy(q).sub(a).dot(n)) > 1.3) return;
        const d1 = d + 0.55;
        const w0 = w * (1 - k / steps);
        const w1 = w * (1 - (k + 1) / steps);
        const bits = tautArc(ground, a, q, a, n).filter(([s0, s1]) => Math.abs(this.s.copy(s1).sub(s0).dot(n)) < 0.2);
        bits.forEach(([s0, s1], j) => ribbon(s0, s1, (d + (0.55 * j) / bits.length) / size, (d + (0.55 * (j + 1)) / bits.length) / size, w0 + ((w1 - w0) * j) / bits.length, w0 + ((w1 - w0) * (j + 1)) / bits.length));
        a = q;
        d = d1;
        if (fork > 0 && rnd(seed + k * 7.7 + 5) < 0.3) walk(a, an + (rnd(seed + k) < 0.5 ? -0.9 : 0.9), d, (len - k * 0.55) * 0.55, w1 * 0.85, seed + k * 13 + 100, fork - 1);
        if (d > size) return;
      }
    };
    for (let k = 0; k < rays; k++) {
      const an = (k / rays) * Math.PI * 2 + rnd(k) * 0.4;
      const p0 = mid.clone().addScaledVector(u, Math.cos(an) * 0.35).addScaledVector(v, Math.sin(an) * 0.35).addScaledVector(n, 0.09);
      walk(p0, an, 0.9, size * (0.6 + 0.4 * rnd(k + 30)), 0.05, k * 37, 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('reach', new THREE.Float32BufferAttribute(reach, 1));
    return g;
  }

  /** A sheet laid on the ground round it, none where the ground ends: what runs over it is drawn in its shader. */
  private sheet(size: number, ground: DrawnGround): THREE.BufferGeometry {
    const rows = 22;
    const cols = 72;
    const p: (THREE.Vector3 | null)[][] = [];
    for (let i = 0; i <= rows; i++) {
      const row: (THREE.Vector3 | null)[] = [];
      for (let k = 0; k <= cols; k++) {
        const an = (k / cols) * Math.PI * 2;
        const d = 0.4 + (i / rows) * (size - 0.4);
        const q = new THREE.Vector3().copy(this.base).addScaledVector(this.side, Math.cos(an) * d).addScaledVector(this.fwd, Math.sin(an) * d);
        const t = ground.rest(q.x + this.up.x * 2, q.y + this.up.y * 2, q.z + this.up.z * 2, -this.up.x, -this.up.y, -this.up.z, 4.6);
        row.push(t > 0 ? q.addScaledVector(this.up, 2 - t + 0.14) : null);
      }
      p.push(row);
    }
    // (over a narrow gap it stays level with its neighbours)
    const h = (q: THREE.Vector3): number => q.dot(this.up);
    for (let pass = 0; pass < 3; pass++)
      for (let i = 1; i < rows; i++)
        for (let k = 0; k <= cols; k++) {
          const q = p[i][k];
          const a = p[i - 1][k];
          const b = p[i + 1][k];
          if (q && a && b) q.addScaledVector(this.up, Math.max(0, (h(a) + h(b)) / 2 - h(q)));
        }
    const pos: number[] = [];
    const reach: number[] = [];
    for (let i = 0; i < rows; i++)
      for (let k = 0; k < cols; k++) {
        const q = [p[i][k], p[i][k + 1], p[i + 1][k], p[i + 1][k + 1]];
        if (q.some((o) => !o)) continue;
        const hs = q.map((o) => h(o as THREE.Vector3));
        if (Math.max(...hs) - Math.min(...hs) > 1.1) continue;
        for (const j of [0, 2, 1, 1, 2, 3]) {
          const o = q[j] as THREE.Vector3;
          pos.push(o.x, o.y, o.z);
          reach.push((i + (j > 1 ? 1 : 0)) / rows);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('reach', new THREE.Float32BufferAttribute(reach, 1));
    return g;
  }

  /** Under the victim, shortly before the ground goes: cracks; afterwards the same light in the hole, fading. */
  private placeUnder(col: Column | null, x: BowContext, r: number): void {
    const victim = col && col.victim >= 0 ? x.views[col.victim] : null;
    if (victim !== this.victimView) {
      if (this.victimView) this.victimView.struggle = this.victimView.tumble = 0;
      this.victimView = victim;
    }
    if (victim) {
      const cover = this.swarmT >= 0 ? ss(0.2, 1.4, this.swarmT) : 0;
      victim.struggle = this.fallT >= 0 ? Math.max(0, 1 - this.fallT * 1.2) : cover * (0.75 + 0.6 * ss(2.5, 3.1, this.swarmT));
      victim.tumble = this.fallT >= 0 ? ss(0, 0.12, this.fallT) * (1 - ss(0.5, 1.5, this.fallT)) : 0;
    }
    if (!this.crack2 && this.swarmT > 2.15 && this.fallT < 0) {
      const c = x.match.units[col ? Math.max(0, col.victim) : 0].bug;
      const n = new THREE.Vector3(c.nx, c.ny, c.nz);
      const at = new THREE.Vector3(c.x, c.y, c.z).addScaledVector(n, -c.species.radius);
      this.crack2 = new THREE.Mesh(this.crackGeometry(at, n, 4.4, 9, x.ground, []), this.crack2Material);
      this.keep(this.crack2);
    }
    void r;
    this.crack2Grow.value = 1.3 * ss(2.2, 2.95, this.swarmT);
    this.crack2Level.value = this.fallT >= 0 ? 1.5 * Math.max(0, 1 - this.fallT / 2.8) : ss(2.2, 2.35, this.swarmT);
    if (this.fallT >= 0) this.crack2Grow.value = 0.25 + 1.05 * ss(0, 0.8, this.fallT);
    if (this.crack2) this.crack2.visible = this.crack2Level.value > 0.01;
    // (the ground jumps under it)
    if (this.swarmT > 2.25 && this.fallT < 0 && Math.floor(this.clock * 14) !== Math.floor((this.clock - x.dt) * 14)) {
      const an = rnd(Math.floor(this.clock * 14)) * Math.PI * 2;
      this.tangent(this.headUp, an, this.b);
      this.puff(this.a.copy(this.head).addScaledVector(this.headDir, 1.2).addScaledVector(this.b, 1 + 2.2 * rnd(Math.floor(this.clock * 31))).addScaledVector(this.headUp, 0.1), this.d.copy(this.headUp).multiplyScalar(1.3), 0.6, 0.5, 0.3);
      this.camera.kick(0.12);
    }
    if (this.fresh) {
      this.fresh = false;
      this.findHole(x.ground);
      // the light in the cracks goes on, down the walls of the hole
      if (this.crack2) {
        this.crack2.removeFromParent();
        this.crack2.geometry.dispose();
      }
      this.crack2 = new THREE.Mesh(this.wallCracks(x.ground), this.crack2Material);
      this.keep(this.crack2);
    }
  }

  /** Cracks from the rim of the new hole down its walls. */
  private wallCracks(ground: DrawnGround): THREE.BufferGeometry {
    const pos: number[] = [];
    const reach: number[] = [];
    const o = new THREE.Vector3().copy(this.fallAt).addScaledVector(this.fallUp, -0.35);
    const e = new THREE.Vector3();
    const f = new THREE.Vector3();
    for (let k = 0; k < 11; k++) {
      let an = (k / 11) * Math.PI * 2 + rnd(k) * 0.3;
      let last: THREE.Vector3 | null = null;
      for (let i = 0; i <= 14; i++) {
        const down = 0.06 + (i / 14) * (1.15 + 0.3 * rnd(k + 4));
        an += (rnd(k * 20 + i) - 0.5) * 0.2;
        const d = this.tangent(this.fallUp, an, new THREE.Vector3()).multiplyScalar(Math.cos(down)).addScaledVector(this.fallUp, -Math.sin(down));
        const t = ground.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 6);
        if (t < 0.5) {
          last = null;
          continue;
        }
        const q = o.clone().addScaledVector(d, t - 0.1);
        if (last) {
          e.copy(q).sub(last);
          f.crossVectors(e, d).normalize();
          const wa = 0.06 * (1 - (i - 1) / 14);
          const wb = 0.06 * (1 - i / 14);
          const l = last;
          pos.push(l.x - f.x * wa, l.y - f.y * wa, l.z - f.z * wa, q.x - f.x * wb, q.y - f.y * wb, q.z - f.z * wb, q.x + f.x * wb, q.y + f.y * wb, q.z + f.z * wb);
          pos.push(l.x - f.x * wa, l.y - f.y * wa, l.z - f.z * wa, q.x + f.x * wb, q.y + f.y * wb, q.z + f.z * wb, l.x + f.x * wa, l.y + f.y * wa, l.z + f.z * wa);
          reach.push((i - 1) / 14, i / 14, i / 14, (i - 1) / 14, i / 14, (i - 1) / 14);
        }
        last = q;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('reach', new THREE.Float32BufferAttribute(reach, 1));
    return g;
  }

  /** The new hole: where on its floor and walls they dig in, and places on its rim. */
  private findHole(ground: DrawnGround): void {
    this.digs.length = this.rims.length = 0;
    const o = new THREE.Vector3().copy(this.fallAt).addScaledVector(this.fallUp, -0.8);
    for (let k = 0; k < 60 && this.digs.length < HOLES; k++) {
      const d = this.tangent(this.fallUp, k * 2.39996, new THREE.Vector3()).multiplyScalar(0.35 + 0.75 * rnd(k)).addScaledVector(this.fallUp, -1).normalize();
      const t = ground.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 6);
      if (t < 1) continue;
      const p = o.clone().addScaledVector(d, t);
      if (this.digs.every((q) => q.p.distanceTo(p) > 1.25)) this.digs.push({ p, n: d.multiplyScalar(-1) });
    }
    if (this.digs.length === 0) this.digs.push({ p: o.clone().addScaledVector(this.fallUp, -2), n: this.fallUp.clone() });
    for (let k = 0; k < 40; k++) {
      const d = this.tangent(this.fallUp, (k / 40) * Math.PI * 2, new THREE.Vector3());
      const p = new THREE.Vector3().copy(this.fallAt).addScaledVector(d, 4.1 + 0.8 * rnd(k));
      const n = this.fallUp;
      const t = ground.rest(p.x + n.x * 2, p.y + n.y * 2, p.z + n.z * 2, -n.x, -n.y, -n.z, 3);
      if (t > 0) this.rims.push({ p: p.addScaledVector(n, 2 - t), n: d.multiplyScalar(-1) });
    }
  }

  /** Clumps of the ground: some fly out, some fall in. */
  private placeChunks(dt: number, ground: DrawnGround): void {
    this.chunks.visible = this.fallT >= 0 && this.fallT < 3.4;
    if (!this.chunks.visible) return;
    this.chunkV.forEach((q, i) => {
      q.v.addScaledVector(this.fallUp, -13 * dt);
      const l = q.v.length() * dt;
      const t = l > 1e-5 ? ground.raycast(q.p.x, q.p.y, q.p.z, (q.v.x * dt) / l, (q.v.y * dt) / l, (q.v.z * dt) / l, l + 0.1) : -1;
      if (t >= 0) {
        if (t > 0 || this.fallT > 0.3) q.v.multiplyScalar(0);
        else q.p.addScaledVector(q.v, dt);
      } else q.p.addScaledVector(q.v, dt);
      const size = (0.06 + 0.17 * rnd(i + 41) ** 3.2) * (1 - ss(2.9, 3.4, this.fallT));
      this.q.setFromAxisAngle(q.spin, i + (q.v.lengthSq() > 0.01 ? this.clock * 7 : 0));
      this.m.compose(q.p, this.q, this.s.set(size, size * (0.35 + 0.35 * rnd(i)), size * (0.55 + 0.4 * rnd(i + 3))));
      this.chunks.setMatrixAt(i, this.m);
    });
    this.chunks.instanceMatrix.needsUpdate = true;
  }

  /** The enemy the column runs at keeps a light of its own, on the spot and on the screen. */
  private lightTarget(x: BowContext, col: Column | null): void {
    const spot = this.fx.spot.value;
    let best: BugView | null = null;
    if (col && this.fallT < 0) {
      if (col.victim >= 0) best = x.views[col.victim];
      else {
        let near = 34;
        x.match.units.forEach((u, i) => {
          if (!u.bug.alive || u.team === x.match.units[this.shooter].team) return;
          this.d.set(u.bug.x, u.bug.y, u.bug.z).sub(this.head);
          const l = this.d.length();
          if (l < near && this.d.dot(this.headDir) > 0.35 * l) {
            near = l;
            best = x.views[i];
          }
        });
      }
    }
    this.targetLight.color.copy(HOT);
    if (this.fallT >= 0 && this.fallT < 3.5) {
      this.targetLight.color.copy(AMBER);
      this.targetLight.position.copy(this.fill);
      this.targetLight.intensity = this.light.intensity;
      spot.z = 0.0001;
      return;
    }
    if (!best || this.swarmT >= 0) {
      this.targetLight.intensity *= 0.9;
      spot.z = 0.0001;
      return;
    }
    const at = (best as BugView).root.position;
    this.targetLight.position.copy(at).addScaledVector(this.headUp, 3.6);
    this.targetLight.intensity += (20 - this.targetLight.intensity) * 0.1;
    this.d.copy(at);
    const dist = this.d.distanceTo(x.camera.position);
    this.fx.spotAt.value = dist;
    this.d.project(x.camera);
    spot.x = this.d.x * 0.5 + 0.5;
    spot.y = 0.5 - this.d.y * 0.5;
    spot.w = x.camera.aspect;
    spot.z = this.d.z < 1 ? (6.5 / dist / Math.tan((x.camera.fov * Math.PI) / 360)) * 0.5 : 0.0001;
  }

  // ---------------------------------------------------------------- the pieces

  /** A direction in the plane across `n`. */
  private tangent(n: THREE.Vector3, an: number, out: THREE.Vector3): THREE.Vector3 {
    const ux = this.s.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    out.copy(ux).multiplyScalar(Math.cos(an));
    return out.addScaledVector(ux.cross(n), -Math.sin(an));
  }

  /** The head of the column, between two ticks. */
  private follow(col: Column, match: Match, alpha: number): void {
    const n = col.path.length / PATH_STEP;
    this.pathTicks = match.column && this.swarmT < 0 ? Math.max(0, n - 1 + alpha) : this.pathTicks + 0;
    if (n < 1) {
      this.head.copy(this.base);
      this.headUp.copy(this.up);
      this.headDir.copy(this.fwd);
      return;
    }
    this.pathAt(col, this.pathTicks, this.head, this.headUp, this.headDir);
  }

  /** A place on the column's path (on the surface), its normal and heading. */
  private pathAt(col: Column, tick: number, p: THREE.Vector3, n: THREE.Vector3, d: THREE.Vector3): void {
    const last = col.path.length / PATH_STEP - 1;
    if (last < 0) {
      p.copy(this.base);
      n.copy(this.up);
      d.copy(this.fwd);
      return;
    }
    const i = Math.max(0, Math.min(last, Math.floor(tick)));
    const j = Math.min(last, i + 1);
    const f = Math.max(0, Math.min(1, tick - i));
    const a = i * PATH_STEP;
    const b = j * PATH_STEP;
    const q = col.path;
    const mixAt = (k: number): number => q[a + k] + (q[b + k] - q[a + k]) * f;
    n.set(mixAt(3), mixAt(4), mixAt(5)).normalize();
    d.set(mixAt(6), mixAt(7), mixAt(8)).normalize();
    p.set(mixAt(0), mixAt(1), mixAt(2)).addScaledVector(n, -0.7);
  }

  private placeHoles(t: number, gone: number): void {
    for (let k = 0; k < HOLES; k++) {
      const h = this.holes[k];
      if (this.fallT >= 0) {
        // down in the new hole, small ones
        const s = this.digs[k];
        const open = s ? back((this.fallT - 1.0 - k * 0.07) / 0.35) * 0.55 : 0;
        h.visible = !!s && this.fallT > 1.0 + k * 0.07;
        if (!h.visible || !s) continue;
        h.position.copy(s.p).addScaledVector(s.n, 0.04);
        h.quaternion.setFromUnitVectors(FORWARD, s.n);
        h.scale.setScalar(Math.max(0.01, open));
        continue;
      }
      const s = this.mouths[k];
      const open = s ? back((t - OPEN - k * 0.09) / 0.4) * (1 - ss(0.9, 1, gone)) : 0;
      h.visible = !!s && t > OPEN + k * 0.09 && open > 0.01;
      if (!h.visible || !s) continue;
      h.position.copy(s.p).addScaledVector(s.n, 0.03);
      h.quaternion.setFromUnitVectors(FORWARD, s.n);
      h.scale.setScalar(Math.max(0.01, open));
      // it breaks open: dust and clods
      if (!this.opened[k]) {
        this.opened[k] = true;
        for (let i = 0; i < 6; i++) this.puff(this.a.copy(s.p).addScaledVector(s.n, 0.3), this.tangent(s.n, i + k, this.b).multiplyScalar(0.9).addScaledVector(s.n, 1.4 + rnd(i + k)), 0.9, 0.9 + 0.5 * rnd(i));
        for (let i = 0; i < 7; i++) {
          const c = this.clodV[(k * 7 + i) % 60];
          if (!c) continue;
          c.t = 0;
          c.p.copy(s.p).addScaledVector(s.n, 0.1);
          this.tangent(s.n, i * 0.9 + k, c.v).multiplyScalar(1 + 1.8 * rnd(i + k * 9)).addScaledVector(s.n, 3.2 + 2.4 * rnd(i + k * 5));
        }
      }
    }
    if (t < OPEN) this.opened.fill(false);
  }
  private readonly opened: boolean[] = new Array<boolean>(HOLES).fill(false);
  private readonly clodV: { p: THREE.Vector3; v: THREE.Vector3; t: number }[] = [];

  private placeClods(dt: number): void {
    this.clods.visible = this.clodV.some((c) => c.t >= 0 && c.t < 1.2);
    if (!this.clods.visible) return;
    for (let i = 0; i < 60; i++) {
      const c = this.clodV[i];
      let size = 0;
      if (c && c.t >= 0 && c.t < 1.2) {
        c.t += dt;
        c.v.addScaledVector(this.up, -11 * dt);
        c.p.addScaledVector(c.v, dt);
        size = (0.05 + 0.09 * rnd(i)) * (1 - ss(0.8, 1.2, c.t));
      }
      this.m.compose(c ? c.p : this.base, this.q.setFromAxisAngle(this.b.set(rnd(i), rnd(i + 1), rnd(i + 2)).normalize(), this.clock * 9 + i), this.s.setScalar(Math.max(0.0001, size)));
      this.clods.setMatrixAt(i, this.m);
    }
    this.clods.instanceMatrix.needsUpdate = true;
  }

  /** Every small ant: out of its hole to its rank; along the path; a leap onto the victim; down into the ground. */
  private placeAnts(match: Match, views: BugView[], t: number, col: Column | null, ground: DrawnGround, dt: number): void {
    this.ants.visible = t > OPEN;
    if (!this.ants.visible) return;
    const victim = col && col.victim >= 0 ? views[col.victim] : null;
    if (victim) victim.root.updateMatrixWorld(true);
    const turn = 1 - Math.exp(-dt * 14);
    const charged = match.charging ? match.power : 0;
    // how long it has been since the head stopped, going on with the march meanwhile
    const since = this.swarmT >= 0 ? this.swarmT + 0 : this.fallT >= 0 ? this.fallT : -1;
    for (let i = 0; i < ANTS; i++) {
      const p = this.a;
      const n = this.b;
      const f = this.c;
      let size = SIZE * (0.88 + 0.24 * rnd(i + 33));
      let go = 0;
      const rank = this.ranks[i];
      const mouth = this.mouths[i % this.mouths.length];
      if (!col || this.shotT < 0) {
        // out of the hole, then a run to its place
        const start = OPEN + 0.25 + (i / ANTS) * 1.55 + rnd(i) * 0.25;
        const dist = mouth.p.distanceTo(rank.p);
        const run = Math.max(0.35, dist / 7);
        const out = ss(start - 0.15, start + 0.1, t);
        size *= out * (this.noRank[i] ? 0 : 1);
        const k = Math.min(1, Math.max(0, (t - start) / run));
        p.lerpVectors(mouth.p, rank.p, k * k * (3 - 2 * k));
        n.copy(rank.n);
        if (k > 0 && k < 1) {
          this.snap(p, n, ground);
          go = 1;
          f.copy(rank.p).sub(mouth.p);
        } else f.copy(this.fwd);
        if (k <= 0) p.addScaledVector(n, -0.5 * (1 - out));
        // drawn up, they stamp with the charge, and lean forward
        if (k >= 1) {
          go = 0.1 + 0.7 * charged;
          p.addScaledVector(n, Math.max(0, Math.sin(this.clock * 26 + i * 1.7)) * 0.09 * charged);
          n.addScaledVector(this.fwd, 0.22 * charged).normalize();
        }
      } else {
        const lane = (i % LANES) - (LANES - 1) / 2;
        const delay = Math.floor(i / LANES) * RANK_TICKS + rnd(i + 60) * 1.8;
        const end = this.stopTick - 4 - rnd(i + 80) * 9;
        const tick = since >= 0 ? this.stopTick - delay + since * 60 : this.pathTicks - delay;
        const late = since >= 0 ? (tick - end) / 60 : -1;
        if (late < 0 || !victim) {
          this.onPath(col, late >= 0 ? end : tick, i, lane, rank, p, n, f, ground);
          go = late >= 0 && !victim ? 0.4 : 1;
          if (tick > 0 && late < 0 && i % 9 === 0 && Math.floor(this.clock * 7 + i) !== Math.floor((this.clock - dt) * 7 + i)) this.puff(this.d.copy(p).addScaledVector(n, 0.15), this.s.copy(n).multiplyScalar(0.7).addScaledVector(f, -0.6), 0.55, 0.55 + 0.4 * rnd(i), 0.22);
        } else {
          go = this.arrive(col, victim, i, lane, end, late, rank, p, n, f, ground);
        }
        if (this.fallT >= 0) size *= this.goUnder(i, p, n, f, ground);
        if (this.noRank[i] && this.shotT < 0.4) size *= ss(0.1, 0.4, this.shotT);
      }
      this.at[i].copy(p);
      // (in the air, and on a body, it lies as it is at once)
      const snapTurn = this.direct[i] ? 1 : since >= 0 ? 1 - Math.exp(-dt * 11) : turn;
      this.direct[i] = false;
      this.stand[i].lerp(n, snapTurn);
      if (this.stand[i].lengthSq() < 1e-4) this.stand[i].copy(n);
      this.stand[i].normalize();
      f.addScaledVector(this.stand[i], -f.dot(this.stand[i]));
      if (f.lengthSq() > 1e-6) this.face[i].lerp(f.normalize(), snapTurn);
      const z = this.face[i].addScaledVector(this.stand[i], -this.face[i].dot(this.stand[i]));
      if (z.lengthSq() < 1e-6) z.copy(this.fwd).addScaledVector(this.stand[i], -this.fwd.dot(this.stand[i]));
      if (z.lengthSq() < 1e-6) z.copy(this.side);
      z.normalize();
      this.d.crossVectors(this.stand[i], z);
      this.m.makeBasis(this.d, this.stand[i], z);
      this.q.setFromRotationMatrix(this.m);
      this.m.compose(this.at[i], this.q, this.s.setScalar(Math.max(0.0001, size)));
      this.ants.setMatrixAt(i, this.m);
      this.going.setX(i, go);
    }
    this.ants.instanceMatrix.needsUpdate = true;
    this.going.needsUpdate = true;
  }

  private readonly leapFrom = new THREE.Vector3();
  private readonly leapUp = new THREE.Vector3();
  private readonly leapDir = new THREE.Vector3();
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly e3 = new THREE.Vector3();
  private readonly q2 = new THREE.Quaternion();

  /** Onto what is drawn under it. */
  private snap(p: THREE.Vector3, n: THREE.Vector3, ground: DrawnGround): void {
    const h = ground.rest(p.x + n.x * 1.6, p.y + n.y * 1.6, p.z + n.z * 1.6, -n.x, -n.y, -n.z, 4);
    if (h > 0) p.addScaledVector(n, 1.63 - h);
  }

  /** A place in the marching column, or on the way to it. */
  private onPath(col: Column, tick: number, i: number, lane: number, rank: Spot, p: THREE.Vector3, n: THREE.Vector3, f: THREE.Vector3, ground: DrawnGround): void {
    if (tick < 0) {
      const wait = Math.max(0, 1 + tick / 26);
      this.pathAt(col, 0, this.e1, n, f);
      p.copy(rank.p).lerp(this.e1, wait * wait);
      n.copy(rank.n);
      if (wait > 0) this.snap(p, n, ground);
      f.copy(this.e1).sub(rank.p);
      if (wait <= 0) f.copy(this.fwd);
      return;
    }
    this.pathAt(col, tick, p, n, f);
    const s = this.e1.crossVectors(n, f);
    p.addScaledVector(s, lane * 0.62 * (1 + 0.2 * Math.sin(tick * 0.045 + i)) + Math.sin(tick * 0.21 + i * 2.1) * 0.12);
    this.snap(p, n, ground);
  }

  private readonly direct: boolean[] = new Array<boolean>(ANTS).fill(false);
  private readonly e4 = new THREE.Vector3();
  private readonly e5 = new THREE.Vector3();
  private readonly e6 = new THREE.Vector3();

  /** From the end of the path onto the victim: most run to a foot and climb the leg; some leap. How its legs go. */
  private arrive(col: Column, victim: BugView, i: number, lane: number, end: number, late: number, rank: Spot, p: THREE.Vector3, n: THREE.Vector3, f: THREE.Vector3, ground: DrawnGround): number {
    this.seat(victim, i, p, n, f);
    const seatP = this.e4.copy(p);
    const seatN = this.e5.copy(n);
    const from = this.leapFrom;
    this.onPath(col, end, i, lane, rank, from, this.leapUp, this.leapDir, ground);
    const up = this.headUp;
    if (rnd(i + 11) < 0.26) {
      // a run round to where it takes off, then the leap
      const centre = victim.root.position;
      const an = (rnd(i + 12) - 0.5) * 2.1;
      const away = this.e6.copy(this.headDir).negate().applyAxisAngle(up, an);
      const to = this.e3.copy(centre).addScaledVector(away, victim.species.radius * 1.3 + 0.5 + 0.9 * rnd(i + 13)).addScaledVector(up, -victim.species.radius * 0.6).clone();
      const run = Math.max(0.06, from.distanceTo(to) / 15);
      this.snap(to, up, ground);
      if (late < run) {
        p.lerpVectors(from, to, late / run);
        n.copy(up);
        this.snap(p, n, ground);
        f.copy(to).sub(from);
        return 1.3;
      }
      const k = (late - run) / LEAP;
      if (k < 1) {
        this.arc(to, seatP, k, 0.4 + 0.6 * rnd(i + 5), p, f);
        n.copy(up).lerp(seatN, ss(0.7, 1, k)).normalize();
        this.direct[i] = true;
        return 0;
      }
      return 0.7;
    }
    // to a foot, up that leg, over to its place
    const legs = victim.legCount;
    const leg = (i * 5 + (lane > 0 ? 1 : 0)) % legs;
    const foot = this.e6;
    victim.legPoint(leg, 0.04, foot, f);
    const run = Math.max(0.08, from.distanceTo(foot) / 11);
    if (late < run) {
      p.lerpVectors(from, foot, late / run);
      n.copy(up);
      this.snap(p, n, ground);
      f.copy(foot).sub(from);
      return 1.2;
    }
    const climb = (late - run) / 0.5;
    if (climb < 1) {
      this.onLeg(victim, leg, 0.06 + 0.88 * climb, i, p, n, f);
      this.direct[i] = true;
      return 1;
    }
    const over = (late - run - 0.5) / 0.35;
    if (over < 1) {
      victim.legPoint(leg, 0.94, foot, f);
      const k = ss(0, 1, over);
      f.copy(seatP).sub(foot);
      p.lerpVectors(foot, seatP, k);
      // (over the body's bulge, not through it)
      p.addScaledVector(seatN, Math.sin(Math.PI * k) * 0.22);
      n.copy(up).lerp(seatN, k).normalize();
      return 1;
    }
    return 0.7;
  }

  /** On leg `leg`, `f01` of the way up it; its feet on it, its back up or outwards. */
  private onLeg(view: BugView, leg: number, f01: number, i: number, p: THREE.Vector3, n: THREE.Vector3, f: THREE.Vector3): void {
    view.legPoint(leg, f01, p, f);
    n.set(0, 1, 0).applyQuaternion(view.root.quaternion);
    this.e3.crossVectors(f, n);
    n.addScaledVector(f, -n.dot(f));
    if (n.lengthSq() < 0.01) n.copy(this.e3);
    n.normalize().addScaledVector(this.e3.normalize(), i % 3 === 0 ? 0 : i % 3 === 1 ? 0.9 : -0.9).normalize();
    p.addScaledVector(n, view.species.radius * 0.05 + 0.01);
  }

  /** A seat on the victim: on one of its body's lumps, or on a leg; it crawls about there. */
  private seat(view: BugView, i: number, p: THREE.Vector3, n: THREE.Vector3, f: THREE.Vector3): void {
    const part = rnd(i + 7);
    const w = (0.5 + 0.5 * rnd(i + 21)) * (i % 2 ? 1 : -1);
    this.direct[i] = true;
    if (part < 0.28) {
      // up and down a leg
      const leg = i % view.legCount;
      const place = ((i / view.legCount) * 0.61803) % 1;
      const wander = Math.sin(this.clock * 0.9 * w + i * 1.3);
      this.onLeg(view, leg, Math.min(0.92, Math.max(0.15, 0.15 + 0.77 * place + 0.06 * wander)), i, p, n, f);
      if (Math.cos(this.clock * 0.9 * w + i * 1.3) * w < 0) f.negate();
      this.direct[i] = true;
      return;
    }
    const lump = view.lumps[part < 0.65 ? 0 : part < 0.85 ? 1 : 2];
    // an even spread of places, each turning slowly about an axis of its own
    const y = 1 - 2 * ((i * 0.61803) % 1);
    const an = i * 2.39996;
    const c = Math.sqrt(1 - y * y);
    const u = this.e1.set(Math.cos(an) * c, y, Math.sin(an) * c);
    const axis = this.e2.set(rnd(i + 300) - 0.5, rnd(i + 301) - 0.5, rnd(i + 302) - 0.5).normalize();
    this.q2.setFromAxisAngle(axis, this.clock * 0.8 * w);
    u.applyQuaternion(this.q2);
    // (none right under it)
    if (u.y < -0.6) u.y = -0.6;
    u.normalize();
    const s = lump.scale;
    p.copy(u).applyMatrix4(lump.matrixWorld);
    n.set(u.x / s.x, u.y / s.y, u.z / s.z).normalize().transformDirection((lump.parent as THREE.Object3D).matrixWorld);
    f.crossVectors(axis, u).multiplyScalar(w > 0 ? 1 : -1).transformDirection((lump.parent as THREE.Object3D).matrixWorld);
  }

  /** A leap from `a` to `b`, `k` of it done. */
  private arc(a: THREE.Vector3, b: THREE.Vector3, k: number, high: number, out: THREE.Vector3, f: THREE.Vector3): void {
    const up = this.fallT >= 0 ? this.fallUp : this.headUp;
    this.e3.copy(b).sub(a);
    f.copy(this.e3).addScaledVector(up, high * Math.PI * Math.cos(Math.PI * k));
    out.copy(a).addScaledVector(this.e3, k).addScaledVector(up, Math.sin(Math.PI * k) * high);
  }

  /** After the ground went: they leave the victim one after the other, and dig in; some stay on the rim. Its size (0: gone). */
  private goUnder(i: number, p: THREE.Vector3, n: THREE.Vector3, f: THREE.Vector3, ground: DrawnGround): number {
    const rim = i % RIM === 0 && this.rims.length > 0;
    const start = rim ? 0.4 + 0.5 * rnd(i) : 0.85 + 1.35 * rnd(i + 2);
    const k = (this.fallT - start) / 0.5;
    if (k <= 0) return 1;
    const to = this.e1;
    if (rim) {
      const s = this.rims[(Math.floor(i / RIM) * 7) % this.rims.length];
      to.copy(s.p);
      this.leapUp.copy(this.fallUp);
      this.leapDir.copy(s.n);
    } else {
      const s = this.digs[i % this.digs.length];
      const an = i * 2.4;
      this.tangent(s.n, an, this.leapDir);
      to.copy(s.p).addScaledVector(this.leapDir, 0.22 + 0.2 * rnd(i + 9));
      this.leapUp.copy(s.n);
      this.leapDir.negate();
    }
    void ground;
    if (k < 1) {
      this.leapFrom.copy(p);
      this.e2.copy(to);
      this.arc(this.leapFrom, this.e2, k, 0.8, p, f);
      n.lerp(this.leapUp, k).normalize();
      return 1;
    }
    p.copy(to);
    n.copy(this.leapUp);
    f.copy(this.leapDir);
    if (rim) return 1;
    // head first into the ground
    const sink = ss(0, 0.55, (k - 1) * 0.5);
    p.addScaledVector(this.leapDir, 0.3 * sink).addScaledVector(n, -1.0 * sink);
    n.addScaledVector(this.leapDir, -0.9 * sink).normalize();
    return sink >= 0.98 ? 0 : 1;
  }

  /** The path it would take straight on, laid out before it; the charged part of it bright. */
  private placeTrail(match: Match, bug: Bug, stance: boolean, charge: number, ground: DrawnGround, march: Column | null): void {
    // (on the march: a short piece before the head, where it goes if it is not steered)
    const on = stance || (march !== null && this.shotT > 0.75);
    this.trailLevel.value += ((stance ? 1 : on ? 0.7 : 0) - this.trailLevel.value) * 0.12;
    this.trail.visible = this.trailLevel.value > 0.02 && on;
    if (!on) return;
    this.trailFull.value = march ? 2 : match.charging ? charge : -0.1;
    const key = [bug.x, bug.y, bug.z, bug.fx, bug.fz].map((v) => v.toFixed(3)).join();
    if (key === this.previewKey && !march) return;
    this.previewKey = key;
    const h = match.columnHead(march ? { ...match.activeUnit, bug: march.head } : match.activeUnit);
    const p = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const every = (march ? 75 : MARCH_TICKS) / PREVIEW;
    let tick = 0;
    let dead = false;
    for (let i = 0; i < PREVIEW; i++) {
      for (; tick < i * every && !dead; tick++) {
        h.step(match.field, { ...IDLE, move: 1 });
        if (!h.alive || h.airTicks > 30) dead = true;
      }
      const n = this.b.set(h.nx, h.ny, h.nz);
      const q = this.a.set(h.x, h.y, h.z).addScaledVector(n, -0.7);
      const s = this.d.set(h.hx, h.hy, h.hz).cross(n).normalize();
      // (the highest ground across the ribbon)
      let top = -0.5;
      for (const out of [-1.05, -0.5, 0, 0.5, 1.05]) {
        const e = this.c.copy(q).addScaledVector(s, out);
        const t = ground.rest(e.x + n.x * 1.5, e.y + n.y * 1.5, e.z + n.z * 1.5, -n.x, -n.y, -n.z, 2.4);
        if (t > 0) top = Math.max(top, 1.5 - t);
      }
      this.laid[i] = { x: q.x, y: q.y, z: q.z, nx: n.x, ny: n.y, nz: n.z, sx: s.x, sy: s.y, sz: s.z, h: Math.min(0.9, top) };
    }
    // level over the gaps: the highest nearby, then smoothed
    const reachBy = Math.max(1, Math.round(1.1 / ((12 / 60) * every)));
    for (let i = 0; i < PREVIEW; i++) {
      let top = -9;
      for (let k = Math.max(0, i - reachBy); k <= Math.min(PREVIEW - 1, i + reachBy); k++) top = Math.max(top, this.laid[k].h);
      this.level[i] = top;
    }
    for (let i = 0; i < PREVIEW; i++) {
      let sum = 0;
      let w = 0;
      for (let k = Math.max(0, i - reachBy); k <= Math.min(PREVIEW - 1, i + reachBy); k++) {
        sum += this.level[k];
        w++;
      }
      const o = this.laid[i];
      const up = sum / w + 0.14;
      for (let k = 0; k < 2; k++) {
        const out = k ? 1.05 : -1.05;
        p.setXYZ(i * 2 + k, o.x + o.sx * out + o.nx * up, o.y + o.sy * out + o.ny * up, o.z + o.sz * out + o.nz * up);
      }
    }
    p.needsUpdate = true;
  }

  private readonly laid: { x: number; y: number; z: number; nx: number; ny: number; nz: number; sx: number; sy: number; sz: number; h: number }[] = [];
  private readonly level: number[] = [];

  private placeMotes(view: BugView, r: number, lit: number): void {
    this.motes.visible = lit > 0.01;
    if (!this.motes.visible) return;
    this.q.setFromUnitVectors(UP, this.up);
    for (let i = 0; i < MOTES; i++) {
      const life = 1.1 + rnd(i) * 1.6;
      const f = (this.clock / life + rnd(i + 500)) % 1;
      const an = rnd(i + 900) * Math.PI * 2 + f * 3.4;
      const rad = r * (1.2 + 3.4 * rnd(i + 300)) * (1 - 0.55 * f);
      this.a.set(Math.cos(an) * rad, r * f * (3.4 + 2.4 * rnd(i + 40)), Math.sin(an) * rad).applyQuaternion(this.q).add(this.base);
      const size = r * 0.015 * (0.5 + rnd(i + 11)) * Math.sin(Math.PI * f) * lit;
      this.s.set(size, size * 2.6, size);
      this.m.compose(this.a, this.q, this.s);
      this.motes.setMatrixAt(i, this.m);
    }
    this.motes.instanceMatrix.needsUpdate = true;
    void view;
  }

  private placeHalos(camera: THREE.Camera, view: BugView, r: number, lit: number): void {
    view.head.updateWorldMatrix(true, false);
    const hd = view.headRadius;
    const len = view.species.antennae * r;
    for (let k = 0; k < 4; k++) {
      const h = this.halos[k];
      const s = k % 2 ? 1 : -1;
      h.visible = lit > 0.01;
      if (k < 2) {
        // the tips of its antennae
        this.a.set(s * 0.35, 0.55, 0.75).normalize().multiplyScalar(len);
        h.position.set(s * hd * 0.35, hd * 0.6, hd * 0.5).add(this.a);
      } else h.position.set(s * hd * 0.6, hd * 0.12, hd * 0.95);
      h.position.applyMatrix4(view.head.matrixWorld);
      h.position.addScaledVector(this.b.copy(camera.position).sub(h.position).normalize(), hd * 0.4);
      h.quaternion.copy(camera.quaternion);
      h.scale.setScalar(k < 2 ? r * 1.3 : hd * 1.4);
    }
  }

  private puff(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, dense = 0.34): void {
    if (this.puffList.length >= PUFFS) this.puffList.shift();
    this.puffList.push({ p: p.clone(), v: v.clone(), t: 0, life, size, dense });
  }

  private placePuffs(camera: THREE.Camera, dt: number): void {
    for (let i = this.puffList.length - 1; i >= 0; i--) {
      const q = this.puffList[i];
      q.t += dt;
      q.v.multiplyScalar(Math.exp(-dt * 2.6));
      q.p.addScaledVector(q.v, dt);
      if (q.t >= q.life) this.puffList.splice(i, 1);
    }
    this.puffs.visible = this.puffList.length > 0;
    if (!this.puffs.visible) return;
    for (let i = 0; i < PUFFS; i++) {
      const q = this.puffList[i];
      const k = q ? q.t / q.life : 1;
      this.m.compose(q ? q.p : this.base, camera.quaternion, this.s.setScalar(q ? q.size * (0.5 + 1.1 * Math.sqrt(k)) : 0.0001));
      this.puffs.setMatrixAt(i, this.m);
      this.puffAge.setX(i, k);
      this.puffDense.setX(i, q ? q.dense : 0);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    this.puffAge.needsUpdate = this.puffDense.needsUpdate = true;
  }

  /** A light that adds to the picture and to the bloom, hidden softly by what stands before it. */
  private light3(rgb: THREE.Node, onGround = false): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    m.blending = THREE.AdditiveBlending;
    const gap = this.fx.depthAt(screenUV).add(positionView.z);
    // (what lies on the ground is only hidden by what stands well before it)
    m.colorNode = (rgb as THREE.Node<'vec3'>).mul(onGround ? smoothstep(-0.55, -0.2, gap) : smoothstep(-0.12, 0.35, gap));
    m.fog = false;
    m.userData.fx = true;
    return m;
  }
}

// ---------------------------------------------------------------- geometry

/** A small ant, its feet at y = 0, about one unit long along +z; `limb` and `reach` say how its legs run. */
function antGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.Color(0x7a2413);
  const dark = new THREE.Color(0x2a0d06);
  const add = (g: THREE.BufferGeometry, color: THREE.Color, limb: number, reachOf: (x: number, y: number, z: number) => number): void => {
    const p = g.getAttribute('position');
    const n = p.count;
    const c = new Float32Array(n * 3);
    const l = new Float32Array(n).fill(limb);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      c.set([color.r, color.g, color.b], i * 3);
      r[i] = reachOf(p.getX(i), p.getY(i), p.getZ(i));
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('limb', new THREE.BufferAttribute(l, 1));
    g.setAttribute('reach', new THREE.BufferAttribute(r, 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const ball = (x: number, y: number, z: number, a: number, b: number, c: number, color: THREE.Color): void =>
    add(new THREE.SphereGeometry(1, 12, 9).scale(a, b, c).translate(x, y, z), color, 0, () => 0);
  ball(0, 0.24, -0.32, 0.15, 0.13, 0.23, body);
  ball(0, 0.21, -0.03, 0.085, 0.08, 0.13, body);
  ball(0, 0.24, 0.2, 0.12, 0.105, 0.13, body);
  for (const s of [-1, 1]) ball(s * 0.085, 0.28, 0.27, 0.035, 0.035, 0.035, dark);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, w: number, limb: number, leg: boolean): void => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(w * 0.7, w, d.length(), 5, 1).translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())).translate(a.x, a.y, a.z);
    add(g, dark, limb, (x) => (leg ? Math.min(1, Math.max(0, (Math.abs(x) - 0.07) / 0.3)) : 0));
  };
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = 0.06 - k * 0.09;
      const out = (1 - k) * 0.17;
      const hip = new THREE.Vector3(s * 0.06, 0.2, z);
      const knee = new THREE.Vector3(s * 0.23, 0.31, z + out * 0.5);
      const foot = new THREE.Vector3(s * 0.4, 0, z + out);
      const beat = (k + (s > 0 ? 0 : 1)) % 2 ? Math.PI : 0;
      rod(hip, knee, 0.022, beat, true);
      rod(knee, foot, 0.018, beat, true);
    }
    rod(new THREE.Vector3(s * 0.04, 0.31, 0.28), new THREE.Vector3(s * 0.14, 0.42, 0.5), 0.013, 0, false);
    // mandibles
    rod(new THREE.Vector3(s * 0.05, 0.2, 0.31), new THREE.Vector3(s * 0.02, 0.18, 0.42), 0.024, 0, false);
  }
  return mergeGeometries(parts);
}

/** A piece of broken ground: a box, its corners knocked about. */
function shardGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = (p.getX(i) > 0 ? 1 : 0) + (p.getY(i) > 0 ? 2 : 0) + (p.getZ(i) > 0 ? 4 : 0);
    p.setXYZ(i, p.getX(i) * (0.55 + 0.6 * rnd(k)), p.getY(i) * (0.5 + 0.7 * rnd(k + 10)), p.getZ(i) * (0.5 + 0.6 * rnd(k + 20)));
  }
  g.computeVertexNormals();
  return g;
}

function stripGeometry(n: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const tc = new Float32Array(n * 4);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    tc.set([0, i / (n - 1), 1, i / (n - 1)], i * 4);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(tc, 2));
  g.setIndex(idx);
  return g;
}
