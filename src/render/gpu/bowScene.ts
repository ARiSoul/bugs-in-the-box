import * as THREE from 'three/webgpu';
import { abs, attribute, cameraPosition, dot, float, fract, hash, instanceIndex, max, mix, mx_noise_float, normalize, positionView, positionWorld, pow, sin, screenUV, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { Match } from '../../game/match';
import type { Projectile } from '../../game/projectile';
import type { BugView } from '../BugView';
import type { DrawnGround } from '../drawnGround';
import { GRAND_RINGS, GRAND_SPOKES, levelWeb, tautArc, tautSpoke } from '../webs';
import { BowCamera } from './bowCamera';
import type { StageFx } from './gpuStage';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
/** The colours of the silk's light: its core, its body, its sparks. */
const CORE = new THREE.Color(0xeafcff);
const SILK = new THREE.Color(0x58d8ff);
const GOLD = new THREE.Color(0xffc65a);

const SPARKS = 110;
const STONES = 16;
const THREADS = 7;
const FLAMES = 22;
const FAN = 16;
const RUSH = 46;
const TRAIL = 64;
const RINGS = 7;
const STREAKS = 46;
const STRAND = 72;
/** The bow's half height, how deep its D is, in radii. */
const BOW_HALF = 2.25;
const BOW_DEEP = 0.95;
/** How far the string is drawn, the dart's length, how far beside the bow it lies (radii). */
const DRAW = 1.5;
const DART = 3.6;
const BESIDE = 0.17;
/** Seconds the trail lives after the dart ends, and the burst. */
const AFTER = 4.5;
/** The scene's own time when the bow and the dart are there: it stands and aims from then on. */
const READY = 2.15;
/** Tying the scarf on ends here (the scene's own time), and takes this share of the whole scene. */
const TIED = 0.6;
const TIE_SHARE = 0.46;
const HAND_A = [2.3, -2.2, 2.6];
const HAND_B = [2.0, 0.7, 2.0];
const HAND_C = [2.0, 0.65, 0.1];
const HAND_D = [0.55, 0.5, -1.75];
const HAND_E = [2.6, 0.35, -2.5];

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

export interface BowContext {
  match: Match;
  view: BugView;
  /** Every bug's view, in the order of the match's units. */
  views: BugView[];
  ground: DrawnGround;
  camera: THREE.PerspectiveCamera;
  /** Fraction of the current tick. */
  alpha: number;
  dt: number;
}

interface Ring {
  mesh: THREE.Mesh;
  level: { value: number };
  t: number;
  life: number;
  size: number;
}

/**
 * The Web Bow's scene (render only): while it charges the spider rises on its hind legs; when it lets go of the key
 * its scarf ties itself on, its eyes light, the air round it fills with light and threads, a bow of braided silk grows
 * in its hands, threads gather into a dart, it draws and shoots; the dart leaves a trail and bursts into a web.
 * It reads the match and never changes it; `timeScale` slows the loop for a moment (the match only runs slower).
 */
export class BowScene {
  readonly camera: BowCamera;
  /** How fast the loop should run now. */
  timeScale = 1;

  private readonly root = new THREE.Group();
  /** What only shines: drawn in a pass of its own. */
  private readonly lights = new THREE.Group();
  private readonly time = uniform(0);
  private readonly auraLevel = uniform(0);
  private readonly threadLevel = uniform(0);
  private readonly signLevel = uniform(0);
  private readonly signGrow = uniform(0);
  private readonly bowGlow = uniform(0);
  private readonly dartGlow = uniform(0);
  private readonly sparkLevel = uniform(0);
  private readonly trailLevel = uniform(0);
  private readonly streakLevel = uniform(0);

  private readonly flames: THREE.InstancedMesh;
  private readonly base = new THREE.Vector3();
  private readonly baseQ = new THREE.Quaternion();
  private readonly centre = uniform(new THREE.Vector3());
  private readonly fan: THREE.Mesh[] = [];
  private readonly rush: THREE.InstancedMesh;
  private readonly rushLevel = uniform(0);
  private readonly webLevel = uniform(0);
  private readonly webGrow = uniform(0);
  private glow: THREE.Mesh | null = null;
  private readonly glowMaterial: THREE.Material;
  private focus = 0;
  /** How far the string is drawn (0..1, eased), and how low its light is while it aims. */
  private drawn = 0;
  private calm = 0;
  private readonly threads: THREE.Mesh;
  private sign: THREE.Mesh | null = null;
  private readonly signMaterial: THREE.Material;
  private readonly sparks: THREE.InstancedMesh;
  private readonly stones: THREE.InstancedMesh;
  private readonly strands: THREE.Mesh[] = [];
  private readonly string: THREE.Mesh[] = [];
  private readonly gather: THREE.Mesh[] = [];
  private readonly wraps: THREE.Mesh[] = [];
  private readonly dart = new THREE.Group();
  private readonly dartLights = new THREE.Group();
  private readonly halo: THREE.Mesh;
  private readonly eyeHalos: THREE.Mesh[] = [];
  private readonly eyeLevel = uniform(0);
  readonly targetLight = new THREE.PointLight(0xcfe8ff, 0, 16, 1.5);
  private readonly trail: THREE.Mesh;
  private readonly trailAt: THREE.Vector3[] = [];
  private readonly streaks: THREE.InstancedMesh;
  private readonly rings: Ring[] = [];
  /** (shared by the other special attacks: a light of their own would cost every material) */
  readonly light = new THREE.PointLight(0x9fe8ff, 0, 34, 1.6);
  private readonly scarf = new THREE.Group();
  private readonly band: THREE.Mesh;
  private readonly tails: THREE.Mesh[] = [];
  private readonly held: THREE.Mesh[] = [];
  private scarfOn: BugView | null = null;

  private frames = 0;
  private rise = 0;
  private clock = 0;
  private shooter = -1;
  private shotT = -1;
  private hitT = -1;
  private erupted = false;
  private wasSpecial = false;
  private readonly hit = new THREE.Vector3();
  /** The web the dart became (-1: not yet, or none). */
  private hitWeb = -1;
  private readonly ends: THREE.Vector3[] = [];
  private readonly hub = new THREE.Vector3();
  private readonly webUp = new THREE.Vector3(0, 1, 0);
  private readonly from = new THREE.Vector3();
  /** The bow's place over the match's start of the shot. */
  private readonly off = new THREE.Vector3();
  private joined = false;
  private readonly dartAt = new THREE.Vector3();
  private readonly dartDir = new THREE.Vector3(0, 0, 1);
  private readonly aimWorld = new THREE.Vector3();
  private readonly aimLocal = new THREE.Vector3();
  private readonly bowUp = new THREE.Vector3();
  private readonly bowSide = new THREE.Vector3();
  /** Where the string was let go (the view's frame, radii), and how far the dart has gone since (radii). */
  private readonly letGo = new THREE.Vector3();
  private travel = 0;
  private readonly grip = new THREE.Vector3();
  private readonly nock = new THREE.Vector3();
  private readonly inv = new THREE.Quaternion();
  private readonly dir = new Float64Array(3);
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly lightWant = new THREE.Vector3();
  private readonly tips = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly skinGlow = new THREE.Color();
  private readonly eyeGlow = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly fx: StageFx,
  ) {
    this.camera = new BowCamera();
    scene.add(this.root);
    fx.scene.add(this.lights);
    this.root.add(this.light, this.targetLight);

    // ---- the light round it: tongues of rising light that face the view, torn by noise, soft at every edge
    {
      const id = float(instanceIndex);
      const seed = hash(id.add(17)).toVar();
      const v = uv().y;
      const x = uv().x.sub(0.5).mul(2);
      const bend = mx_noise_float(vec3(seed.mul(40), v.mul(1.6).sub(this.time.mul(1.5)), seed.mul(9))).mul(v.mul(0.7));
      const wide = smoothstep(0, 0.18, v).mul(max(v.oneMinus(), 0)).mul(1.7);
      const across = max(float(1).sub(abs(x.add(bend)).div(max(wide, 0.02))), 0);
      const n = mx_noise_float(vec3(x.mul(1.7).add(seed.mul(30)), v.mul(2.4).sub(this.time.mul(seed.add(1.6))), seed.mul(20)));
      const fine = mx_noise_float(vec3(x.mul(4).add(seed.mul(60)), v.mul(6).sub(this.time.mul(4.2)), seed.mul(50)));
      // (soft at the card's own edges too, and cool: white only in thin cores)
      const card = smoothstep(1, 0.45, abs(x)).mul(smoothstep(0, 0.22, v));
      const body = card.mul(smoothstep(0, 0.85, across)).mul(smoothstep(-0.55, 0.5, n.add(fine.mul(0.35)).sub(v.mul(0.5))));
      const level = body.mul(smoothstep(0, 0.12, v)).mul(smoothstep(1, 0.3, v)).mul(this.auraLevel).mul(seed.mul(0.5).add(0.5)).toVar();
      const tint = mix(vec3(0.05, 0.22, 1.0), vec3(0.75, 0.95, 1), smoothstep(0.95, 1.8, level).mul(smoothstep(0.12, 0.5, v)));
      this.flames = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), this.light3(tint.mul(level).mul(0.6)), FLAMES);
      this.keep(this.flames);
    }

    // ---- threads that wind up round it
    this.threads = new THREE.Mesh(threadGeometry(), this.light3(this.threadLight()));
    this.keep(this.threads);

    // ---- the sign of a web on the ground: its light runs outwards
    {
      const d = attribute('reach', 'float');
      const wave = pow(sin(d.mul(16).sub(this.time.mul(7))).mul(0.5).add(0.5), 4);
      const on = smoothstep(this.signGrow, this.signGrow.sub(0.14), d);
      const edge = smoothstep(0.14, 0, abs(d.sub(this.signGrow)));
      this.signMaterial = this.light3(vec3(SILK.r, SILK.g, SILK.b).mul(on.mul(wave.mul(1.1).add(0.4)).add(edge.mul(2.4))).mul(this.signLevel));
    }

    {
      const d = attribute('reach', 'float');
      const wave = pow(sin(d.mul(13).sub(this.time.mul(11))).mul(0.5).add(0.5), 5);
      const edge = smoothstep(0.16, 0, abs(d.sub(this.webGrow)));
      const on = smoothstep(this.webGrow, this.webGrow.sub(0.1), d);
      this.glowMaterial = this.light3(mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), 0.3).mul(on.mul(wave.mul(0.9).add(0.45)).add(edge.mul(2))).mul(this.webLevel));
    }

    // ---- sparks and stones
    const spark = this.light3(mix(vec3(GOLD.r, GOLD.g, GOLD.b), vec3(CORE.r, CORE.g, CORE.b), 0.35).mul(this.sparkLevel).mul(1.9));
    this.sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), spark, SPARKS);
    this.keep(this.sparks);
    const stone = new THREE.MeshStandardNodeMaterial({ color: 0x3c3a38, roughness: 0.9, metalness: 0 });
    this.stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stone, STONES);
    this.stones.castShadow = true;
    this.keep(this.stones);

    // ---- the bow: three strands of silk braided; its string; the bindings at the grip
    const silk = new THREE.MeshStandardNodeMaterial({ color: 0xc9bd9e, roughness: 0.38, metalness: 0.05 });
    silk.emissiveNode = mix(vec3(GOLD.r, GOLD.g, GOLD.b), vec3(SILK.r, SILK.g, SILK.b), 0.6).mul(this.bowGlow);
    silk.fog = false;
    for (let k = 0; k < 3; k++) {
      const mesh = new THREE.Mesh(tubeGeometry(STRAND, 8), silk);
      mesh.castShadow = true;
      this.keep(mesh);
      this.strands.push(mesh);
    }
    const gripMat = new THREE.MeshStandardNodeMaterial({ color: 0xb3202c, roughness: 0.75, metalness: 0 });
    for (let k = 0; k < 5; k++) {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.034, 8, 20), gripMat);
      this.keep(mesh);
      this.wraps.push(mesh);
    }
    const line = this.light3(vec3(CORE.r, CORE.g, CORE.b).mul(this.bowGlow.mul(0.9).add(0.45)));
    const rod = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    const needle = new THREE.SphereGeometry(0.5, 8, 12).scale(2, 1, 2).translate(0, 0.5, 0);
    for (let k = 0; k < 2; k++) {
      const mesh = new THREE.Mesh(rod, line);
      this.keep(mesh);
      this.string.push(mesh);
    }
    // threads that fly in and gather into the dart
    const pull = this.light3(vec3(SILK.r, SILK.g, SILK.b).mul(this.dartGlow).mul(0.8));
    for (let k = 0; k < 16; k++) {
      const mesh = new THREE.Mesh(needle, pull);
      this.keep(mesh);
      this.gather.push(mesh);
    }

    // ---- the dart: a braided shaft, a long point, three vanes
    const shaft = new THREE.MeshStandardNodeMaterial({ color: 0xf6f1e2, roughness: 0.3, metalness: 0 });
    shaft.emissiveNode = vec3(SILK.r, SILK.g, SILK.b).mul(this.dartGlow.mul(0.55));
    shaft.fog = false;
    const point = new THREE.MeshStandardNodeMaterial({ color: 0x101418, roughness: 0.2, metalness: 0 });
    point.emissiveNode = mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), 0.6).mul(this.dartGlow.mul(1.1));
    point.fog = false;
    for (let k = 0; k < 3; k++) {
      const pts = Array.from({ length: 40 }, (_, i) => {
        const z = -DART + (i / 39) * (DART - 0.5);
        const an = z * 5 + (k * Math.PI * 2) / 3;
        return new THREE.Vector3(Math.cos(an) * 0.045, Math.sin(an) * 0.045, z);
      });
      this.dart.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.034, 6), shaft));
    }
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.75, 5).rotateX(Math.PI / 2).translate(0, 0, -0.22), point);
    this.dart.add(head);
    const vane = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.2, -0.16), new THREE.Vector2(0.23, -0.5), new THREE.Vector2(0.02, -0.38)]);
    const edge = uv();
    const vaneMat = this.light3(vec3(SILK.r, SILK.g, SILK.b).mul(this.dartGlow.mul(0.16).mul(edge.x.mul(0.8).add(0.35))));
    for (let k = 0; k < 3; k++) {
      const g = new THREE.ShapeGeometry(vane).rotateX(Math.PI / 2).rotateZ((k * Math.PI * 2) / 3 + Math.PI / 2).translate(0, 0, -DART + 0.5);
      this.dartLights.add(new THREE.Mesh(g, vaneMat));
    }
    const headLight = this.light3(mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), 0.45).mul(this.dartGlow.mul(0.75)));
    this.dartLights.add(new THREE.Mesh(new THREE.ConeGeometry(0.165, 0.85, 12).rotateX(Math.PI / 2).translate(0, 0, -0.24), headLight));
    const shine = uv().sub(0.5).length().mul(2);
    const glowOf = (level: THREE.Node<'float'>): THREE.MeshBasicNodeMaterial => {
      const core = pow(max(shine.oneMinus(), 0), 3);
      return this.light3(mix(vec3(0.1, 0.45, 1), vec3(CORE.r, CORE.g, CORE.b), core).mul(core).mul(level));
    };
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowOf(this.dartGlow.mul(0.32) as unknown as THREE.Node<'float'>));
    this.keep(this.halo);
    for (let k = 0; k < 2; k++) {
      const m = this.light3(vec3(1, 0.72, 0.25).mul(pow(max(shine.oneMinus(), 0), 2.6)).mul(this.eyeLevel).mul(0.4));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
      this.keep(mesh);
      this.eyeHalos.push(mesh);
    }
    this.dartLights.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 12;
    });
    this.lights.add(this.dartLights);
    this.keep(this.dart);

    // ---- its trail, the rings of force, the streaks of the burst
    this.trail = new THREE.Mesh(ribbonGeometry(TRAIL), this.light3(this.trailLight()));
    this.keep(this.trail);
    for (let k = 0; k < TRAIL; k++) this.trailAt.push(new THREE.Vector3());
    for (let k = 0; k < RINGS; k++) {
      const level = uniform(0);
      const r = uv().sub(0.5).length().mul(2);
      const band = smoothstep(0.6, 0.97, r).mul(smoothstep(1.0, 0.97, r));
      const thin = smoothstep(0.9, 0.96, r).mul(smoothstep(1.0, 0.97, r));
      const torn = smoothstep(-0.25, 0.45, mx_noise_float(vec3(uv().mul(vec2(9, 9)), this.time.mul(1.5).add(k * 3))));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.light3(mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), thin).mul(band.mul(0.3).add(thin.mul(torn).mul(0.9))).mul(level)));
      this.keep(mesh);
      this.rings.push({ mesh, level, t: 1, life: 1, size: 1 });
    }
    this.rush = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4).rotateX(Math.PI / 2), this.light3(vec3(0.5, 0.8, 1).mul(this.rushLevel)), RUSH);
    this.keep(this.rush);
    const spoke = this.light3(mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), 0.5).mul(this.webLevel.mul(1.5)));
    for (let k = 0; k < FAN * 2; k++) {
      const mesh = new THREE.Mesh(rod, spoke);
      this.keep(mesh);
      this.fan.push(mesh);
    }
    this.streaks = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5), this.light3(mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), 0.5).mul(this.streakLevel)), STREAKS);
    this.keep(this.streaks);

    // ---- the scarf: a band round the head, a knot, two tails in the wind of the light
    const cloth = new THREE.MeshStandardNodeMaterial({ color: 0xd01228, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    cloth.emissiveNode = vec3(0.16, 0.008, 0.016);
    this.band = new THREE.Mesh(bandGeometry(), cloth);
    this.band.castShadow = true;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12).scale(1, 0.85, 0.7), cloth);
    knot.position.set(0, 0, -0.98);
    knot.name = 'knot';
    this.scarf.add(this.band, knot);
    for (let k = 0; k < 2; k++) {
      const t = new THREE.Mesh(stripGeometry(18), cloth);
      t.castShadow = true;
      t.frustumCulled = false;
      this.tails.push(t);
      this.scarf.add(t);
    }
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(stripGeometry(10), cloth);
      m.castShadow = true;
      this.keep(m);
      this.held.push(m);
    }
    this.scarf.visible = false;
  }

  /** A new match: nothing of the scene is left. */
  clear(): void {
    this.shooter = -1;
    this.shotT = this.hitT = -1;
    this.rise = 0;
    this.wasSpecial = false;
    this.hideAll();
    this.timeScale = 1;
    this.camera.stop();
    if (this.scarfOn) this.takeOff();
  }

  /** The dart ended at (x, y, z), flying along (dx, dy, dz). */
  onHit(x: number, y: number, z: number): void {
    if (this.shotT < 0) return;
    this.hit.set(x, y, z);
    this.hitT = 0;
    // (the trail reaches what the dart hit)
    for (let i = TRAIL - 1; i > 0; i--) this.trailAt[i].copy(this.trailAt[i - 1]);
    this.trailAt[0].copy(this.hit);
    this.hitWeb = -1;
  }

  /** The dart left the bow. */
  onFire(): void {
    if (this.shooter < 0) return;
    this.shotT = 0;
    this.travel = 0;
    this.joined = false;
    this.hitT = -1;
    this.from.copy(this.dartAt);
    for (const p of this.trailAt) p.copy(this.dartAt).addScaledVector(this.aimWorld, -0.9);
  }

  /** Every frame, after the bugs are placed. */
  update(x: BowContext): void {
    const { match, view, dt, alpha } = x;
    // (drawn out of sight for the first frames, so nothing is compiled in the middle of the scene)
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
    const u = match.activeUnit;
    const bow = match.currentWeapon.kind === 'arrow';
    const special = match.phase === 'special' && bow;
    const stance = match.stance && bow && u.bug.alive;
    const charging = stance && match.charging;
    if ((special || stance) && this.shooter !== u.id) this.begin(u.id, view);
    const mine = this.shooter === u.id;
    if (!mine && this.shooter >= 0) this.end();
    if (this.shooter < 0) return;

    const total = match.currentWeapon.sceneTicks / 60;
    // (the scene's own clock is the match's, so every frame of it is a frame of the match)
    const run = special ? Math.max(0, Math.min(1, 1 - (match.specialTicks - alpha) / 60 / total)) : 1;
    const t = run < TIE_SHARE ? (run / TIE_SHARE) * TIED : TIED + ((run - TIE_SHARE) / (1 - TIE_SHARE)) * (READY - TIED);
    if (special && !this.wasSpecial) {
      this.erupted = false;
      this.camera.start(x.camera, match.units[this.shooter].bug, view, x.ground);
    }
    if (!special && !stance && this.shotT < 0) {
      // (called off)
      this.end();
      return;
    }
    this.wasSpecial = special || this.wasSpecial;
    this.clock += dt;
    this.time.value = this.clock;
    if (this.shotT >= 0) this.shotT += dt;
    if (this.hitT >= 0) this.hitT += dt;

    const b = u.bug;
    const r = b.species.radius;
    const k = 1;
    const up = (stance || special || (this.shotT >= 0 && this.shotT < 1.1)) && b.alive && b.grounded;
    this.rise += ((up ? 1 : 0) - this.rise) * (1 - Math.exp(-dt * (up ? 6 : 5)));
    const gone = this.shotT >= 0 ? Math.min(1, this.shotT / 0.9) : 0;

    // ---- how far each thing has come
    const erupt = ss(0.62, 0.95, t);
    const grow = ss(1.02, 1.62, t);
    const dartIn = ss(1.42, 1.98, t);
    // (the string goes with the dart's tail, until it is where it rests)
    if (this.shotT < 0) this.drawn += ((charging ? 0.12 + 0.88 * match.power : 0) - this.drawn) * (1 - Math.exp(-dt * 22));
    const draw = this.shotT >= 0 ? Math.max(0, this.drawn - this.travel / DRAW) : this.drawn;
    // (it lets go over a quarter of a second, not in one frame)
    this.focus = this.shotT < 0 ? this.drawn : this.drawn * Math.exp(-this.shotT * 9);
    const focus = this.focus;
    const released = this.shotT >= 0 ? Math.exp(-this.shotT * 24) : 1;
    // (standing and aiming, its light is low, so the view is clear)
    this.calm += ((stance ? 1 - 0.45 * this.drawn : 0) - this.calm) * (1 - Math.exp(-dt * 5));
    const power = (0.3 + 0.7 * erupt) * (1 - 0.5 * this.calm);

    // ---- where it stands and aims
    const pos = view.root.position;
    match.aimDirection(u, this.dir);
    this.aimWorld.set(this.dir[0], this.dir[1], this.dir[2]);
    this.inv.copy(view.root.quaternion).invert();
    this.aimLocal.copy(this.aimWorld).applyQuaternion(this.inv);
    // the bow stands across the aim, canted a little
    this.bowUp.set(0.22, 1, 0);
    this.bowUp.addScaledVector(this.aimLocal, -this.bowUp.dot(this.aimLocal)).normalize();
    this.bowSide.crossVectors(this.aimLocal, this.bowUp).normalize();
    const shake = this.shotT >= 0 ? Math.sin(this.shotT * 60) * 0.12 * Math.exp(-this.shotT * 7) : 0;
    const tremble = focus * 0.012 * Math.sin(this.clock * 71);
    this.grip.set(-0.36, 1.62, 0.15).addScaledVector(this.aimLocal, 1.95 + shake);
    this.grip.y += tremble;
    const rest = -BOW_DEEP + 0.02;
    this.nock.copy(this.grip).addScaledVector(this.aimLocal, rest - draw * DRAW);
    if (this.shotT < 0) this.letGo.copy(this.nock);

    // ---- the body
    const pose = view.pose;
    pose.weight = this.rise;
    pose.tie = 0;
    pose.look = Math.asin(Math.max(-1, Math.min(1, this.aimLocal.y))) + 0.35 * erupt * (1 - ss(1.0, 1.4, t)) * k;
    pose.lean = draw * 0.14 - Math.max(-0.3, Math.min(0.5, Math.asin(Math.max(-1, Math.min(1, this.aimLocal.y))))) * 0.35 + erupt * (1 - ss(1.0, 1.5, t)) * 0.3 * k;
    // (before there is a bow its legs reach up and out to call it)
    const call = k ? 1 - ss(0.72, 1.06, t) : 1;
    pose.grip.copy(this.grip).addScaledVector(this.bowSide, -BESIDE).lerp(this.a.set(1.7, 2.55 + 0.2 * erupt, 0.5), call);
    // (the drawing hand comes to the string under the chin, not across the face)
    const q1 = this.a.set(-1.7, 2.55 + 0.2 * erupt, 0.5);
    const q2 = this.b.set(-1.15, 0.75, 1.0);
    const w = 1 - call;
    pose.nock.copy(q1).multiplyScalar(call * call).addScaledVector(q2, 2 * w * call).addScaledVector(this.nock, w * w);
    if (this.shotT >= 0) pose.nock.copy(this.letGo).lerp(this.a.set(-1.75, 2.15, -1.15), back(this.shotT / 0.3));
    // before all that, they tie its scarf on
    const q = Math.min(1, Math.max(0, (t - 0.05) / (TIED - 0.05)));
    pose.tie = ss(0, 0.1, q) * (1 - ss(0.9, 1, q)) * (special ? 1 : 0);
    if (pose.tie > 0) this.tieHands(view, r, q, pose.tie);
    pose.sway = Math.sin(this.clock * 2.4);
    pose.spread = power;
    pose.fold = stance ? 1 : 0;

    // ---- its skin and eyes take light
    const eye = ss(0.56, 0.68, t) * (1 - ss(0.6, 1, gone));
    view.eyes.emissive.copy(this.eyeGlow).lerp(GOLD, eye).multiplyScalar(1 + eye * 3.2);
    view.skin.emissive.copy(this.skinGlow).lerp(SILK, 0.2 * power * (1 - gone) * (0.8 + 0.2 * Math.sin(this.clock * 17)));

    // (so the picture's dimming knows the legs as the fighter's)
    view.legSkin.emissive.copy(view.legSkin.color).multiplyScalar(0.12 * k * (1 - ss(0.5, 1, gone)));

    this.wearScarf(view, ss(0.3, 0.62, q), ss(0.78, 0.92, q), this.shotT >= 0 ? 1 - ss(1.2, 1.7, this.shotT) : 1, power, dt);

    // ---- the bow and the dart, then the view of them: whatever faces the view comes after it
    this.placeHeld(view, r, special && q < 0.86 ? ss(0.02, 0.12, q) : 0, ss(0.3, 0.62, q));
    this.placeBow(view, r, k ? grow : 0, draw, gone, focus);
    this.placeDart(match.projectiles.find((p) => p.weapon.kind === 'arrow'), view, r, dartIn, draw, focus, alpha);
    this.camera.update(x.camera, {
      t: special ? t : total,
      shotT: this.shotT,
      hitT: this.hitT,
      at: pos,
      up: this.b.set(b.nx, b.ny, b.nz),
      radius: r,
      aim: this.aimWorld,
      dart: this.dartAt,
      dartDir: this.dartDir,
      hit: this.hit,
      dt,
      ground: x.ground,
      stance,
      power: charging ? match.power : 0,
    });
    x.camera.updateMatrixWorld();
    if (this.shotT > 0.1) this.dartGlow.value *= 1 - 0.68 * Math.max(0, this.a.copy(this.dartAt).sub(x.camera.position).normalize().dot(this.dartDir));

    // ---- light round it
    const hold = power * (1 - 0.35 * focus) * (1 - gone);
    this.auraLevel.value = k * ss(0.54, 0.72, t) * hold * (0.9 + 0.1 * Math.sin(this.clock * 31)) * (1 + 0.5 * erupt * (1 - ss(0.95, 1.5, t)));
    this.threadLevel.value = k * erupt * (1 - 0.75 * ss(1.3, 1.6, t)) * (1 - focus) * released;
    this.base.copy(pos).addScaledVector(this.a.set(b.nx, b.ny, b.nz), -r);
    this.baseQ.setFromUnitVectors(UP, this.a);
    this.centre.value.copy(pos).addScaledVector(this.a, r);
    this.placeFlames(x.camera, x.ground, r, power * (1 + 0.45 * erupt * (1 - ss(0.95, 1.5, t))), focus);
    this.threads.visible = this.threadLevel.value > 0.005;
    this.threads.position.copy(this.base);
    this.threads.quaternion.copy(this.baseQ);
    this.threads.rotateY(this.clock * 1.4);
    this.threads.scale.setScalar(r);
    this.light.visible = true;
    // (above it, on the view's side: it models the face, and the bow keeps its braid)
    this.lightWant.copy(pos).addScaledVector(this.a.set(b.nx, b.ny, b.nz), r * 3.4).addScaledVector(this.b.copy(x.camera.position).sub(pos).normalize(), r * 2.6);
    let lightGoal = k * (34 + 16 * erupt * (1 - ss(0.9, 1.3, t))) * (1 - gone);
    if (this.hitT >= 0) {
      this.lightWant.copy(this.hit).addScaledVector(UP, 3.6);
      lightGoal = 6 + 16 * Math.exp(-this.hitT * 4);
    } else if (this.shotT > 0.1) {
      this.lightWant.lerp(this.dartAt, ss(0.1, 0.35, this.shotT));
      lightGoal = this.shotT < 0.25 ? Math.max(lightGoal, 30) : 3;
    }
    const ease = 1 - Math.exp(-dt * 14);
    this.light.position.lerp(this.lightWant, t < 0.1 && this.shotT < 0 ? 1 : ease);
    this.light.intensity += (lightGoal - this.light.intensity) * ease;

    this.signLevel.value = k * ss(0.52, 0.72, t) * (1 - gone);
    this.signGrow.value = k * (0.18 * ss(0.5, 0.64, t) + 0.95 * back(ss(0.62, 1.15, t)));
    if (this.sign) this.sign.visible = this.signLevel.value > 0.005;

    if (special && erupt > 0.35 && !this.erupted) {
      this.erupted = true;
      const at = this.base.clone().addScaledVector(this.b.set(b.nx, b.ny, b.nz), 0.35);
      this.ring(at, this.b, 8.5, 0.8);
      this.camera.kick(0.5);
    }
    this.placeSparks((hold * 0.8 + k * erupt * 0.2 * (1 - gone)) * (1 - 0.4 * ss(1.4, 1.6, t)), pos, b, r, x.camera);
    this.placeStones(k * erupt * released, pos, b, r, x.ground, x.camera);
    this.placeHalos(x.camera, view, r);
    this.placeTrail(x.camera);
    this.placeRush(x.camera);
    this.placeBurst(match, x.ground);
    this.placeRings(dt);
    this.eyeLevel.value = eye;

    // ---- the picture: the world dims, the edges close in; a flash at the burst of light, the shot and the hit
    const dim = (special ? 0.62 + 0.38 * ss(0, 0.3, t) : stance ? 0.3 + 0.2 * this.drawn : this.hitT >= 0 ? 0.92 * (1 - ss(2.4, 4.2, this.hitT)) : 0.95 * (1 - ss(2.0, 2.4, this.shotT)) * k) * 0.95;
    this.fx.dim.value = dim;
    // (what is farther than the one the picture is about falls dark)
    const about = this.hitT >= 0 ? this.hit : this.shotT > 0.2 && this.camera.active ? this.dartAt : this.centre.value;
    this.fx.subject.value += (x.camera.position.distanceTo(about) + (this.shotT > 0.2 && this.hitT < 0 ? 5 : 0) - this.fx.subject.value) * (1 - Math.exp(-dt * 10));
    this.fx.vignette.value = Math.min(0.8, dim * 0.8);
    const f1 = special && t > 0.72 ? Math.exp(-(t - 0.72) * 14) * 0.025 : 0;
    const f2 = this.shotT >= 0 ? Math.exp(-this.shotT * 40) * 0.06 : 0;
    const f3 = this.hitT >= 0 ? Math.exp(-this.hitT * 24) * 0.04 : 0;
    this.fx.flash.value = Math.max(f1, f2, f3);
    this.fx.focusBlur.value = this.shotT > 0.14 && this.hitT < 0 ? 0.8 : 0;

    // ---- the one it aims at keeps a light of its own
    const onTarget = special ? 0 : stance ? 0.6 : this.hitT < 0 ? 1 : 1 - ss(3, 4.2, this.hitT);
    this.lightTarget(x, onTarget);

    // ---- slow for a moment as the dart leaves, and as it lands
    this.timeScale = 1;
    if (this.shotT >= 0 && this.shotT < 0.2) this.timeScale = 0.22;
    if (this.hitT >= 0 && this.hitT < 0.4) this.timeScale = 0.3 + this.hitT * 0.9;
    // (and as it comes near a bug)
    if (this.shotT > 0.3 && this.hitT < 0)
      for (const o of match.units)
        if (o !== u && o.bug.alive) {
          this.a.set(o.bug.x, o.bug.y, o.bug.z).sub(this.dartAt);
          if (this.a.length() < 6.5 && this.a.dot(this.dartDir) > 0.8 * this.a.length()) this.timeScale = 0.4;
        }

    this.placeSpot(x.camera, onTarget);
    const flying = match.projectiles.length > 0;
    if (this.shotT >= 0 && !flying && (this.hitT > AFTER || (this.hitT < 0 && this.shotT > 1.4)) && this.shotT > 1.8) this.end();
  }

  private lightTarget(x: BowContext, on: number): void {
    let best: BugView | null = null;
    if (on > 0.01) {
      let score = 0.9;
      const from = x.view.root.position;
      x.match.units.forEach((q, i) => {
        if (q.id === this.shooter || !q.bug.alive) return;
        this.a.set(q.bug.x, q.bug.y, q.bug.z).sub(from);
        const dot = this.a.normalize().dot(this.aimWorld);
        if (dot > score) {
          score = dot;
          best = x.views[i];
        }
      });
    }
    this.target = best;
    if (!best) {
      this.targetLight.intensity *= 0.9;
      return;
    }
    const at = (best as BugView).root.position;
    this.targetLight.position.copy(at).addScaledVector(UP, 3.4).addScaledVector(this.aimWorld, 1.6);
    this.targetLight.intensity = 26 * on;
  }

  /** Keep a soft spot of the picture round the one it aims at from dimming (after the camera has moved). */
  private placeSpot(camera: THREE.PerspectiveCamera, on: number): void {
    const s = this.fx.spot.value;
    const at = this.hitT >= 0 ? this.hit : this.target?.root.position;
    if (!at || on < 0.01) {
      s.z = 0.0001;
      return;
    }
    camera.updateMatrixWorld();
    this.a.copy(at);
    const dist = this.a.distanceTo(camera.position);
    this.fx.spotAt.value = dist;
    this.a.project(camera);
    s.x = this.a.x * 0.5 + 0.5;
    s.y = 0.5 - this.a.y * 0.5;
    s.w = camera.aspect;
    s.z = Math.max(0.0001, ((6.5 * on) / dist / Math.tan((camera.fov * Math.PI) / 360)) * 0.5);
  }

  /** The halo of the dart's head, and those of the eyes, face the view. */
  private placeHalos(camera: THREE.Camera, view: BugView, r: number): void {
    this.dartLights.visible = this.dart.visible;
    this.dartLights.position.copy(this.dart.position);
    this.dartLights.quaternion.copy(this.dart.quaternion);
    this.dartLights.scale.copy(this.dart.scale);
    this.halo.visible = this.dart.visible;
    this.halo.position.copy(this.dart.position).addScaledVector(this.dartDir, -0.3 * r);
    this.halo.quaternion.copy(camera.quaternion);
    this.halo.scale.setScalar(Math.max(0.001, this.dart.scale.x) * 2.1);
    for (let k = 0; k < 2; k++) {
      const h = this.eyeHalos[k];
      h.visible = this.eyeLevel.value > 0.01;
      const hd = view.headRadius;
      h.position.set((k ? 1 : -1) * hd * 0.6, hd * 0.12, hd * 0.95).applyMatrix4(view.head.matrixWorld);
      h.position.addScaledVector(this.b.copy(camera.position).sub(h.position).normalize(), hd * 0.4);
      h.quaternion.copy(camera.quaternion);
      h.scale.setScalar(hd * 1.7);
    }
  }

  private target: BugView | null = null;

  // ---------------------------------------------------------------- beginning and end

  private begin(id: number, view: BugView): void {
    this.light.color.setHex(0x9fe8ff);
    if (this.shooter >= 0) this.end();
    this.shooter = id;
    this.shotT = this.hitT = -1;
    this.wasSpecial = false;
    this.rise = 0;
    this.drawn = this.calm = 0;
    this.erupted = false;
    this.eyeGlow.copy(view.eyes.emissive);
    this.skinGlow.copy(view.skin.emissive);
    this.shooterView = view;
  }
  private shooterView: BugView | null = null;

  private end(): void {
    this.shooter = -1;
    this.shotT = this.hitT = -1;
    this.wasSpecial = false;
    this.timeScale = 1;
    const v = this.shooterView;
    if (v) {
      v.pose.weight = 0;
      v.eyes.emissive.copy(this.eyeGlow);
      v.skin.emissive.copy(this.skinGlow);
      v.legSkin.emissive.setScalar(0);
    }
    this.shooterView = null;
    this.target = null;
    this.takeOff();
    this.hideAll();
    this.camera.stop();
  }

  private takeOff(): void {
    this.scarf.visible = false;
    this.scarf.removeFromParent();
    this.scarfOn = null;
  }

  private hideAll(): void {
    for (const o of [...this.root.children, ...this.lights.children]) o.visible = false;
    this.light.intensity = 0;
    this.light.color.setHex(0x9fe8ff);
    this.targetLight.intensity = 0;
    this.targetLight.visible = true;
    this.fx.spot.value.z = 0.0001;
    // (a light that comes and goes would compile every material again)
    this.light.visible = true;
    for (const g of this.rings) g.t = g.life;
    for (const o of [this.sign, this.glow])
      if (o) {
        o.removeFromParent();
        o.geometry.dispose();
      }
    this.sign = this.glow = null;
    this.fx.dim.value = this.fx.vignette.value = this.fx.flash.value = this.fx.focusBlur.value = 0;
  }

  private warmUp(): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    g.setAttribute('reach', new THREE.Float32BufferAttribute([0, 1, 1], 1));
    this.sign = new THREE.Mesh(g, this.signMaterial);
    this.keep(this.sign);
    this.glow = new THREE.Mesh(g, this.glowMaterial);
    this.keep(this.glow);
    this.glow.visible = true;
    this.root.add(this.scarf);
    this.scarf.visible = true;
    this.sign.visible = true;
  }

  private keep(o: THREE.Object3D): void {
    o.traverse((q) => {
      q.frustumCulled = false;
      // (after the windscreen's glass and every other see-through thing)
      q.renderOrder = 12;
    });
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    (m && m.userData.fx ? this.lights : this.root).add(o);
  }

  /** A web's shape on the ground, taut over what is drawn, with how far out each point is. */
  private webShape(at: THREE.Vector3, n: THREE.Vector3, size: number, ground: DrawnGround): THREE.BufferGeometry {
    const u = new THREE.Vector3(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const pos: number[] = [];
    const reach: number[] = [];
    const spokes = GRAND_SPOKES;
    const rings = GRAND_RINGS;
    const p: THREE.Vector3[][] = [];
    for (let s = 0; s < spokes; s++) p.push(tautSpoke(ground, at, n, u, v, (s / spokes) * Math.PI * 2, size, rings));
    levelWeb(p, n);
    const e = new THREE.Vector3();
    const f = new THREE.Vector3();
    const ribbon = (a: THREE.Vector3, b: THREE.Vector3, w: number): void => {
      e.copy(b).sub(a);
      if (e.lengthSq() < 1e-8) return;
      f.crossVectors(e, n);
      if (f.lengthSq() < 0.1 * e.lengthSq()) f.crossVectors(e, u);
      if (f.lengthSq() < 0.1 * e.lengthSq()) f.crossVectors(e, v);
      f.normalize().multiplyScalar(w);
      const ra = a.distanceTo(at) / size;
      const rb = b.distanceTo(at) / size;
      pos.push(a.x - f.x, a.y - f.y, a.z - f.z, b.x - f.x, b.y - f.y, b.z - f.z, b.x + f.x, b.y + f.y, b.z + f.z);
      pos.push(a.x - f.x, a.y - f.y, a.z - f.z, b.x + f.x, b.y + f.y, b.z + f.z, a.x + f.x, a.y + f.y, a.z + f.z);
      reach.push(ra, rb, rb, ra, rb, ra);
    };
    this.ends.length = 0;
    for (let s = 0; s < spokes; s++) {
      this.ends.push(p[s][p[s].length - 1].clone());
      for (let k = 0; k < rings; k++) {
        if (p[s][k + 1]) ribbon(p[s][k], p[s][k + 1], 0.035);
        if (k > 0 && p[s][k] && p[(s + 1) % spokes][k]) for (const [a, b] of tautArc(ground, p[s][k], p[(s + 1) % spokes][k], p[s][0], n)) ribbon(a, b, 0.027);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('reach', new THREE.Float32BufferAttribute(reach, 1));
    return g;
  }

  // ---------------------------------------------------------------- the pieces

  private wearScarf(view: BugView, on: number, tied: number, off: number, power: number, dt: number): void {
    void dt;
    if (off <= 0) {
      if (this.scarfOn) this.takeOff();
      return;
    }
    if (this.scarfOn !== view) {
      this.scarf.removeFromParent();
      view.head.add(this.scarf);
      // (across the brow, above the eyes; the knot behind)
      this.scarf.position.set(0, view.headRadius * 0.46, -view.headRadius * 0.06);
      this.scarf.rotation.set(-0.2, 0, 0);
      this.scarfOn = view;
    }
    this.scarf.visible = true;
    this.scarf.scale.setScalar(view.headRadius * Math.max(0.01, off));
    const n = (this.band.geometry.index as THREE.BufferAttribute).count;
    // (from the brow round both sides to the back)
    const seg = n / 64;
    const half = Math.round(32 * on);
    this.band.geometry.setDrawRange((32 - half) * seg, 2 * half * seg);
    const knot = this.scarf.getObjectByName('knot');
    if (knot) knot.scale.setScalar(Math.max(0.001, back(tied)));
    // the tails: they stream back, and up with the light
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? 1 : -1;
      const g = this.tails[k].geometry;
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const segs = p.count / 2 - 1;
      for (let i = 0; i <= segs; i++) {
        const s = i / segs;
        const l = s * 4.2 * tied;
        const wave = Math.sin(this.clock * 8 - s * 6.5 + k * 1.1) * 0.42 * s;
        // (they stream back and to one side, one over the other, and lift with the light)
        const lift = power * 0.9 * s * s - 0.35 * s + side * 0.16 * s;
        const cx = -0.2 * side + 1.5 * s * s + 0.5 * s + wave * 0.4;
        const cy = lift + wave * 0.7;
        const cz = -1.0 - l * 0.86;
        const w = 0.3 * (1 - 0.25 * s) * (0.3 + 0.7 * Math.min(1, s * 6));
        const tw = Math.sin(this.clock * 3.4 - s * 4 + k * 2) * 0.55 * s + 0.15;
        const wx = Math.sin(tw) * w;
        const wy = Math.cos(tw) * w;
        p.setXYZ(i * 2, cx - wx, cy - wy, cz);
        p.setXYZ(i * 2 + 1, cx + wx, cy + wy, cz);
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
      this.tails[k].visible = tied > 0.02;
    }
  }

  /** The tongues of light stand round its feet, tall behind it and low before it. */
  private placeFlames(camera: THREE.Camera, ground: DrawnGround, r: number, power: number, focus: number): void {
    this.flames.visible = this.auraLevel.value > 0.005;
    if (!this.flames.visible) return;
    const n = this.c.set(0, 1, 0).applyQuaternion(this.baseQ);
    const to = this.b.copy(camera.position).sub(this.base);
    to.addScaledVector(n, -to.dot(n));
    if (to.lengthSq() < 1e-6) to.set(1, 0, 0);
    to.normalize();
    const side = new THREE.Vector3().crossVectors(n, to);
    this.m.makeBasis(side, n, to);
    this.q.setFromRotationMatrix(this.m);
    for (let i = 0; i < FLAMES; i++) {
      const an = (i / FLAMES) * Math.PI * 2 + rnd(i) * 0.25;
      // (all round behind it, a few at its sides, none before it)
      const toward = Math.min(-0.12, Math.cos(an));
      const rad = r * (0.95 + 0.75 * rnd(i + 5)) ;
      this.a.copy(this.base).addScaledVector(to, toward * rad).addScaledVector(side, Math.sin(an) * rad * 1.15).addScaledVector(n, 1.2 * r);
      const down = ground.raycast(this.a.x, this.a.y, this.a.z, -n.x, -n.y, -n.z, 3 * r);
      this.a.addScaledVector(n, down > 0 ? 0.12 * r - down : -1.15 * r);
      const behind = 0.5 - 0.5 * toward;
      const tall = r * (0.9 + 4.9 * Math.pow(behind, 0.7)) * (0.5 + 0.6 * power) * (0.7 + 0.6 * rnd(i + 9));
      this.s.set(r * (1.1 + 0.7 * rnd(i + 13)), Math.max(0.01, tall), 1);
      this.m.compose(this.a, this.q, this.s);
      this.flames.setMatrixAt(i, this.m);
    }
    this.flames.instanceMatrix.needsUpdate = true;
  }

  /** The front two hands: the scarf stretched before its face, up to the brow, round the head, a knot, a pull. */
  private tieHands(view: BugView, r: number, q: number, weight: number): void {
    view.torso.updateMatrix();
    const c = this.c.copy(view.headAt).applyMatrix4(view.torso.matrix).divideScalar(r);
    const h = view.headRadius / r;
    const steps: [number, number[]][] = [[0, HAND_A], [0.14, HAND_A], [0.3, HAND_B], [0.45, HAND_C], [0.62, HAND_D], [0.8, HAND_D], [0.9, HAND_E], [1.01, HAND_E]];
    let i = 0;
    while (i < steps.length - 2 && q >= steps[i + 1][0]) i++;
    const f = ss(steps[i][0], steps[i + 1][0], q);
    const from = steps[i][1];
    const to = steps[i + 1][1];
    const px = from[0] + (to[0] - from[0]) * f;
    const py = from[1] + (to[1] - from[1]) * f;
    const pz = from[2] + (to[2] - from[2]) * f;
    // (at the knot the hands go round each other)
    const knot = ss(0.6, 0.66, q) * (1 - ss(0.78, 0.82, q));
    const an = q * 70;
    for (const s of [1, -1]) {
      const hand = s > 0 ? view.pose.grip : view.pose.nock;
      this.a.set(c.x + (s * px + knot * Math.cos(an + (s > 0 ? 0 : Math.PI)) * 0.55) * h, c.y + (py + knot * Math.sin(an + (s > 0 ? 0 : Math.PI)) * 0.55) * h, c.z + pz * h);
      hand.lerp(this.a, weight);
    }
  }

  /** The scarf's ends, from the band's ends on the head to the hands that hold them. */
  private placeHeld(view: BugView, r: number, on: number, round: number): void {
    for (let k = 0; k < 2; k++) {
      const m = this.held[k];
      m.visible = on > 0.01 && this.scarfOn === view;
      if (!m.visible) continue;
      const s = k === 0 ? 1 : -1;
      this.scarf.updateWorldMatrix(true, false);
      // (the band runs from the brow, the front, to the back on both sides)
      const an = Math.PI / 2 - s * round * Math.PI * 0.97;
      const end = this.a.set(Math.cos(an) * 0.98, 0, Math.sin(an) * 0.98);
      // (before it lies on the brow it is stretched before the face)
      this.scarf.localToWorld(end);
      const hand = this.b.copy(s > 0 ? view.pose.grip : view.pose.nock).multiplyScalar(r).applyQuaternion(view.root.quaternion).add(view.root.position);
      const other = this.c.copy(s > 0 ? view.pose.nock : view.pose.grip).multiplyScalar(r).applyQuaternion(view.root.quaternion).add(view.root.position);
      const free = 1 - ss(0, 0.06, round);
      const mid = other.add(hand).multiplyScalar(0.5);
      end.lerp(mid, free * (hand.distanceTo(end) > view.headRadius * 3 || free > 0.5 ? 1 : 0) * ss(0, 1, free));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(view.root.quaternion);
      const p = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      const segs = p.count / 2 - 1;
      const w = view.headRadius * 0.2 * on;
      for (let i = 0; i <= segs; i++) {
        const f = i / segs;
        const x = end.x + (hand.x - end.x) * f;
        const y = end.y + (hand.y - end.y) * f;
        const z = end.z + (hand.z - end.z) * f;
        const sag = Math.sin(Math.PI * f) * view.headRadius * 0.12 * (1 + Math.sin(this.clock * 7 + f * 5));
        const ww = w * (1 - 0.25 * f);
        p.setXYZ(i * 2, x - up.x * (ww + sag), y - up.y * (ww + sag), z - up.z * (ww + sag));
        p.setXYZ(i * 2 + 1, x + up.x * (ww - sag), y + up.y * (ww - sag), z + up.z * (ww - sag));
      }
      p.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
  }

  private placeSparks(level: number, pos: THREE.Vector3, b: { nx: number; ny: number; nz: number }, r: number, camera: THREE.Camera): void {
    this.sparkLevel.value = Math.min(1, level * 1.4);
    this.sparks.visible = level > 0.01;
    if (!this.sparks.visible) return;
    const n = this.b.set(b.nx, b.ny, b.nz);
    this.q.setFromUnitVectors(UP, n);
    const base = this.c.copy(pos).addScaledVector(n, -r);
    for (let i = 0; i < SPARKS; i++) {
      const life = 0.7 + rnd(i) * 1.1;
      const f = (this.clock / life + rnd(i + 500)) % 1;
      const an = rnd(i + 900) * Math.PI * 2 + f * (1.5 + 2.5 * rnd(i + 70));
      const rad = r * (1.7 + 2.2 * rnd(i + 300)) * (1 - 0.2 * f);
      // (nor over the one it aims at)
      this.a.set(Math.cos(an) * rad, r * f * (3 + 4 * rnd(i + 40)), Math.sin(an) * rad).applyQuaternion(this.q).add(base);
      // (none between the view and the body)
      const size = r * 0.02 * (0.4 + rnd(i + 11)) * Math.sin(Math.PI * f) * (i / SPARKS < level * 1.3 ? 1 : 0) * this.beside(this.a, camera, r);
      this.s.set(size, size * (3 + 5 * rnd(i + 23)), size);
      this.m.compose(this.a, this.q, this.s);
      this.sparks.setMatrixAt(i, this.m);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  /** 1 away from the line from the view to the body, 0 right before it. */
  private beside(p: THREE.Vector3, camera: THREE.Camera, r: number): number {
    const v = new THREE.Vector3().copy(this.centre.value).sub(camera.position);
    const l = v.length();
    v.divideScalar(l);
    const d = new THREE.Vector3().copy(p).sub(camera.position);
    const along = d.dot(v);
    if (along > l + 0.4 * r) return 1;
    return ss(1.1 * r, 1.9 * r, Math.sqrt(Math.max(0, d.lengthSq() - along * along)));
  }

  private placeStones(level: number, pos: THREE.Vector3, b: { nx: number; ny: number; nz: number }, r: number, ground: DrawnGround, camera: THREE.Camera): void {
    this.stones.visible = level > 0.01;
    if (!this.stones.visible) return;
    const n = this.b.set(b.nx, b.ny, b.nz);
    this.q.setFromUnitVectors(UP, n);
    const rot = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (let i = 0; i < STONES; i++) {
      const an = (i / STONES) * Math.PI * 2 + rnd(i) * 0.6 + this.clock * 0.25;
      const rad = r * (2.6 + 1.5 * rnd(i + 30));
      const h = level * r * (0.4 + 2.6 * rnd(i + 60)) + Math.sin(this.clock * 1.9 + i) * 0.1 * r * level;
      this.a.set(Math.cos(an) * rad, 0, Math.sin(an) * rad).applyQuaternion(this.q).add(pos);
      const t = ground.raycast(this.a.x, this.a.y, this.a.z, -n.x, -n.y, -n.z, 4 * r);
      this.a.addScaledVector(n, (t > 0 ? -t : -r) + h);
      const size = r * (0.05 + 0.08 * rnd(i + 90)) * Math.min(1, level * 2) * this.beside(this.a, camera, r * 1.3);
      rot.setFromEuler(euler.set(this.clock * (0.6 + rnd(i)) + i, this.clock * 0.8 + i * 2, i));
      this.s.set(size, size * (0.7 + 0.5 * rnd(i + 7)), size);
      this.m.compose(this.a, rot, this.s);
      this.stones.setMatrixAt(i, this.m);
    }
    this.stones.instanceMatrix.needsUpdate = true;
  }

  /** A point of the bow's limb: `u` -1..1 from its lower tip to its upper one, in the view's frame (radii). */
  private limb(u: number, draw: number, out: THREE.Vector3): THREE.Vector3 {
    const w = Math.abs(u);
    const h = u * BOW_HALF * (1 - 0.16 * draw * w);
    // a D: full at the grip, the tips drawn back; their last part curls forward a little
    const f = -BOW_DEEP * Math.pow(w, 2.1) - draw * 0.42 * w * w * w + 0.16 * ss(0.84, 1, w);
    return out.copy(this.grip).addScaledVector(this.bowUp, h).addScaledVector(this.aimLocal, f).addScaledVector(this.bowSide, -BESIDE * (1 - w * w));
  }

  private placeBow(view: BugView, r: number, grow: number, draw: number, gone: number, focus: number): void {
    const on = grow > 0.01 && gone < 0.98;
    for (const o of [...this.strands, ...this.wraps]) o.visible = on;
    for (const o of this.string) o.visible = on && grow > 0.9;
    this.bowGlow.value = 0.14 + 0.35 * (1 - ss(0.7, 1, grow)) + 0.06 * focus;
    if (!on) return;
    const q = view.root.quaternion;
    const pos = view.root.position;
    const shrink = 1 - ss(0.55, 1, gone);
    const side = this.c.crossVectors(this.aimLocal, this.bowUp).normalize().clone();
    const along = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const p = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const ring = new THREE.Vector3();
    for (let k = 0; k < 3; k++) {
      const g = this.strands[k].geometry;
      const at = g.getAttribute('position') as THREE.BufferAttribute;
      const nor = g.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i <= STRAND; i++) {
        const u = (-1 + (2 * i) / STRAND) * grow * shrink;
        this.limb(u, draw, p);
        this.limb(Math.min(1, u + 0.02), draw, p2);
        this.limb(Math.max(-1, u - 0.02), draw, n1);
        along.copy(p2).sub(n1).normalize();
        n1.crossVectors(along, side).normalize();
        const w = Math.abs(u);
        const taper = 1 - 0.68 * w;
        const tw = u * 26 + (k * Math.PI * 2) / 3;
        p.addScaledVector(side, Math.cos(tw) * 0.062 * taper * (0.3 + 0.7 * grow)).addScaledVector(n1, Math.sin(tw) * 0.062 * taper * (0.3 + 0.7 * grow));
        // (it begins a thread)
        const thick = (0.075 * taper + 0.008) * (0.25 + 0.75 * grow);
        for (let j = 0; j < 8; j++) {
          const an = (j / 8) * Math.PI * 2;
          ring.copy(side).multiplyScalar(Math.cos(an)).addScaledVector(n1, Math.sin(an)).applyQuaternion(q);
          nor.setXYZ(i * 8 + j, ring.x, ring.y, ring.z);
          p2.copy(p).multiplyScalar(r).applyQuaternion(q).add(pos).addScaledVector(ring, thick * r);
          at.setXYZ(i * 8 + j, p2.x, p2.y, p2.z);
        }
      }
      at.needsUpdate = nor.needsUpdate = true;
    }
    for (let k = 0; k < this.wraps.length; k++) {
      const u = (k - 2) * 0.034;
      this.limb(u, draw, p).multiplyScalar(r).applyQuaternion(q).add(pos);
      this.wraps[k].position.copy(p);
      this.wraps[k].quaternion.setFromUnitVectors(FORWARD, p2.copy(this.bowUp).applyQuaternion(q));
      this.wraps[k].scale.setScalar(Math.max(0.001, r * ss(0.1, 0.4, grow) * shrink));
    }
    // the string, through the nock; after the shot it shakes
    this.limb(1, draw, this.tips[0]);
    this.limb(-1, draw, this.tips[1]);
    const snap = this.shotT >= 0 ? Math.sin(this.shotT * 90) * 0.3 * Math.exp(-this.shotT * 6) : 0;
    const nock = this.a.copy(this.nock);
    if (this.shotT >= 0 && draw <= 0) nock.copy(this.tips[0]).add(this.tips[1]).multiplyScalar(0.5).addScaledVector(this.aimLocal, snap);
    nock.multiplyScalar(r).applyQuaternion(q).add(pos);
    for (let k = 0; k < 2; k++) {
      p.copy(this.tips[k]).multiplyScalar(r).applyQuaternion(q).add(pos);
      rodBetween(this.string[k], p, nock, 0.016 * r * shrink);
    }
  }

  private placeDart(shot: Projectile | undefined, view: BugView, r: number, form: number, draw: number, focus: number, alpha: number): void {
    void draw;
    const q = view.root.quaternion;
    const pos = view.root.position;
    for (const g of this.gather) g.visible = false;
    if (this.shotT < 0) {
      this.dart.visible = form > 0.01;
      this.dartGlow.value = form * (0.7 + 2.4 * focus) + 1.6 * (form > 0 && form < 1 ? 1 - form : 0);
      const at = this.a.copy(this.nock).multiplyScalar(r).applyQuaternion(q).add(pos);
      this.dartDir.copy(this.aimWorld);
      this.dartAt.copy(at).addScaledVector(this.aimWorld, DART * r * Math.max(0.01, form));
      this.dart.position.copy(this.dartAt);
      this.dart.quaternion.setFromUnitVectors(FORWARD, this.aimWorld);
      const girth = r * ss(0, 0.5, form);
      this.dart.scale.set(Math.max(0.001, girth), Math.max(0.001, girth), r * Math.max(0.01, form));
      // threads fly in from all round and wind into it
      if (form > 0.005 && form < 0.995) {
        for (let k = 0; k < this.gather.length; k++) {
          const f = Math.min(1, Math.max(0, form * 1.7 - rnd(k + 3) * 0.7));
          const an = k * 2.39996;
          const dist = (1 - f) * r * (3.4 + 2 * rnd(k));
          const side = this.b.set(Math.cos(an), Math.sin(an), (rnd(k + 8) - 0.5) * 1.4).normalize().applyQuaternion(this.dart.quaternion);
          const seat = this.c.copy(this.dartAt).addScaledVector(this.aimWorld, -r * (0.3 + 2.2 * rnd(k + 15)));
          const tail = new THREE.Vector3().copy(seat).addScaledVector(side, dist + r * 1.3 * (1 - f));
          seat.addScaledVector(side, dist);
          rodBetween(this.gather[k], seat, tail, 0.014 * r);
          this.gather[k].visible = f > 0 && f < 1;
        }
      }
      return;
    }
    this.dart.visible = !!shot;
    this.dartGlow.value = 2.4;
    if (!shot) return;
    this.a.set(shot.px + (shot.x - shot.px) * alpha, shot.py + (shot.y - shot.py) * alpha, shot.pz + (shot.z - shot.pz) * alpha);
    // (it is drawn from the bow, above where the match starts it, and joins its path at once)
    const join = Math.exp(-this.shotT * 3.5);
    if (!this.joined) {
      this.joined = true;
      this.off.copy(this.from).sub(this.a);
    }
    this.c.copy(this.dartAt);
    this.dartAt.copy(this.a).addScaledVector(this.off, join);
    this.dartDir.set(shot.vx, shot.vy, shot.vz).normalize();
    this.c.sub(this.dartAt).negate();
    if (this.shotT > 0.03 && this.c.dot(this.dartDir) > 0.02) this.dartDir.lerp(this.c.normalize(), 0.5).normalize();
    this.travel = this.dartAt.distanceTo(this.from) / r;
    this.dart.position.copy(this.dartAt);
    this.dart.quaternion.setFromUnitVectors(FORWARD, this.dartDir);
    this.dart.rotateZ(this.clock * 22);
    this.dart.scale.setScalar(r);
    for (let i = TRAIL - 1; i > 0; i--) this.trailAt[i].copy(this.trailAt[i - 1]);
    // (from the dart's tail, once it is past the bow)
    this.trailAt[0].copy(this.dartAt).addScaledVector(this.dartDir, -Math.min(DART - 0.4, this.travel + 0.85) * r);
  }

  private placeTrail(camera: THREE.Camera): void {
    const level = this.shotT < 0 ? 0 : this.hitT >= 0 ? Math.max(0, 1 - this.hitT / 0.25) : 1;
    this.trailLevel.value = level;
    this.trail.visible = level > 0.01;
    if (!this.trail.visible) return;
    const p = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const d = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < TRAIL; i++) {
      const q = this.trailAt[i];
      const o = this.trailAt[Math.min(TRAIL - 1, i + 1)];
      d.copy(q).sub(o);
      if (d.lengthSq() < 1e-8) d.copy(this.dartDir);
      s.copy(camera.position).sub(q).cross(d).normalize().multiplyScalar(0.3 * (1 - i / TRAIL));
      p.setXYZ(i * 2, q.x - s.x, q.y - s.y, q.z - s.z);
      p.setXYZ(i * 2 + 1, q.x + s.x, q.y + s.y, q.z + s.z);
    }
    p.needsUpdate = true;
  }

  /** Lines of air rush by while the view flies with the dart. */
  private placeRush(camera: THREE.Camera): void {
    const on = this.shotT > 0.14 && this.hitT < 0 && this.camera.active;
    this.rushLevel.value = on ? 0.5 : 0;
    this.rush.visible = on;
    if (!on) return;
    this.q.setFromUnitVectors(FORWARD, this.dartDir);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    for (let i = 0; i < RUSH; i++) {
      const f = (this.clock * (2.2 + 1.8 * rnd(i)) + rnd(i + 50)) % 1;
      const an = rnd(i + 90) * Math.PI * 2;
      const rad = 1.6 + 3.6 * rnd(i + 130);
      this.a.copy(camera.position).addScaledVector(this.dartDir, 22 - 24 * f).addScaledVector(side, Math.cos(an) * rad).addScaledVector(up, Math.sin(an) * rad);
      this.s.set(1, 1, 1.4 + 2.2 * rnd(i + 7));
      this.m.compose(this.a, this.q, this.s);
      this.rush.setMatrixAt(i, this.m);
    }
    this.rush.instanceMatrix.needsUpdate = true;
  }

  private placeBurst(match: Match, ground: DrawnGround): void {
    const t = this.hitT;
    if (t >= 0 && this.hitWeb < 0) {
      const w = match.webs[match.webs.length - 1];
      this.hitWeb = 0;
      if (w && w.grand && Math.hypot(w.x - this.hit.x, w.y - this.hit.y, w.z - this.hit.z) < 8) {
        this.hitWeb = w.id;
        this.webUp.set(w.nx, w.ny, w.nz);
        const at = new THREE.Vector3(w.x, w.y, w.z);
        if (this.glow) this.glow.removeFromParent();
        this.glow = new THREE.Mesh(this.webShape(at, this.webUp, w.radius, ground), this.glowMaterial);
        this.keep(this.glow);
        this.hub.copy(at);
      }
    }
    // the dart opens: its strands fly out in arcs and come down as the spokes; a light runs out along the rings
    const web = t >= 0 && this.hitWeb > 0;
    this.webLevel.value = web ? Math.max(Math.exp(-Math.max(0, t - 0.5) * 1.1), 0.5 + 0.14 * Math.sin(t * 6)) * ss(0, 0.08, t) * (1 - ss(AFTER - 0.35, AFTER, t)) : 0;
    this.webGrow.value = web ? 1.15 * ss(0.06, 0.55, t) : 0;
    if (this.glow) this.glow.visible = web && t > 0.1 && this.webLevel.value > 0.01;
    for (let k = 0; k < FAN; k++) {
      const a = this.fan[k * 2];
      const b = this.fan[k * 2 + 1];
      const f = ss(0.0, 0.22 + 0.06 * rnd(k), t);
      a.visible = b.visible = web && t < 0.3 && f > 0.01 && k < this.ends.length;
      if (!a.visible) continue;
      const end = this.a.copy(this.hub).lerp(this.ends[k], f).addScaledVector(this.webUp, Math.sin(Math.PI * f) * (1.6 + rnd(k + 3)));
      const mid = this.b.copy(this.hub).lerp(this.ends[k], f * 0.5).addScaledVector(this.webUp, Math.sin(Math.PI * Math.min(1, f * 0.75)) * (1.1 + 0.7 * rnd(k + 3)) * (1 - f * f));
      const thin = 0.032 * (1 - ss(0.14, 0.3, t));
      rodBetween(a, this.hub, mid, thin);
      rodBetween(b, mid, end, thin * 0.8);
    }
    this.streaks.visible = t >= 0 && t < 0.35;
    if (!this.streaks.visible) return;
    this.streakLevel.value = 1.1 * Math.max(0, 1 - t / 0.35);
    for (let k = 0; k < STREAKS; k++) {
      const an = k * 2.39996;
      const y = 1 - (2 * (k + 0.5)) / STREAKS;
      const c = Math.sqrt(1 - y * y);
      this.a.set(Math.cos(an) * c, y, Math.sin(an) * c);
      const far = (2.2 + 2.8 * rnd(k)) * (1 - Math.exp(-t * 11));
      const f = 1 - t / 0.35;
      this.q.setFromUnitVectors(FORWARD, this.a);
      this.b.copy(this.hit).addScaledVector(this.a, 0.3 + far);
      const long = 1.6 * f * (0.5 + rnd(k + 4));
      this.s.set(0.5 * f, 0.5 * f, f < 0.25 ? 0.0001 : Math.max(0.0001, long));
      this.m.compose(this.b, this.q, this.s);
      this.streaks.setMatrixAt(k, this.m);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  private ring(at: THREE.Vector3, n: THREE.Vector3, size: number, life: number): void {
    const g = this.rings.find((q) => q.t >= q.life);
    if (!g) return;
    g.t = 0;
    g.life = life;
    g.size = size;
    g.mesh.position.copy(at);
    if (at === this.grip) g.mesh.position.copy(this.dartAt);
    g.mesh.quaternion.setFromUnitVectors(FORWARD, this.s.copy(n).normalize());
  }

  private placeRings(dt: number): void {
    for (const g of this.rings) {
      if (g.t >= g.life) {
        g.mesh.visible = false;
        continue;
      }
      g.t += dt;
      const k = Math.min(1, g.t / g.life);
      g.mesh.visible = true;
      g.mesh.scale.setScalar(Math.max(0.01, g.size * (1 - Math.pow(1 - k, 3))));
      g.level.value = 0.85 * (1 - k) * (1 - k);
    }
  }

  // ---------------------------------------------------------------- materials

  /** A light that adds to the picture and to the bloom, and hides nothing. */
  private light3(rgb: THREE.Node): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    m.blending = THREE.AdditiveBlending;
    // (what stands before it hides it, softly: no hard edge where it meets a surface)
    const gap = this.fx.depthAt(screenUV).add(positionView.z);
    m.colorNode = (rgb as THREE.Node<'vec3'>).mul(smoothstep(-0.12, 0.5, gap));
    m.fog = false;
    m.userData.fx = true;
    return m;
  }

  private threadLight(): THREE.Node {
    const s = attribute('reach', 'float');
    const phase = attribute('phase', 'float');
    const head = fract(this.time.mul(0.75).add(phase));
    const near = s.sub(head);
    const comet = smoothstep(-0.4, 0, near).mul(smoothstep(0.03, 0, near)).mul(smoothstep(0, 0.12, s)).mul(smoothstep(1, 0.8, s));
    // (faint where it passes before the body)
    const out = normalize(positionWorld.sub(this.centre));
    const before = smoothstep(0.75, 0.2, dot(out, normalize(cameraPosition.sub(this.centre))));
    return mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), comet).mul(comet.mul(1.5).add(0.05)).mul(before).mul(this.threadLevel);
  }

  private trailLight(): THREE.Node {
    const u = uv();
    // (never below zero: at a triangle's edge it would be, and a power of that is no number)
    const across = max(float(1).sub(abs(u.x.sub(0.5)).mul(2)), 0);
    const n = mx_noise_float(vec3(u.x.mul(5), u.y.mul(16).add(this.time.mul(9)), 0));
    const core = pow(across, 9).mul(1.6);
    const halo = pow(across, 1.6).mul(0.16).mul(n.mul(0.5).add(0.75));
    // (gone where it would pass right by the view)
    const fade = pow(max(float(1).sub(u.y), 0), 1.5).mul(smoothstep(2.2, 6, positionView.z.negate()));
    const twist = smoothstep(0.16, 0, abs(u.x.sub(0.5).sub(sin(u.y.mul(60).add(this.time.mul(30))).mul(0.3)))).add(smoothstep(0.16, 0, abs(u.x.sub(0.5).add(sin(u.y.mul(60).add(this.time.mul(30))).mul(0.3)))));
    return mix(vec3(SILK.r, SILK.g, SILK.b), vec3(CORE.r, CORE.g, CORE.b), pow(across, 4)).mul(core.add(halo).add(twist.mul(0.55).mul(smoothstep(0, 0.4, across)))).mul(fade).mul(this.trailLevel);
  }

  /** The bugs' names may show. */
  readonly names = true;

  /** The dart has hit, this many seconds ago (-1: not yet). */
  get hitFor(): number {
    return this.hitT;
  }

  /** Called when the scene proper starts (the sign needs the ground as it is now). */
  prepare(view: BugView, n: THREE.Vector3, ground: DrawnGround): void {
    if (this.sign) {
      this.sign.removeFromParent();
      this.sign.geometry.dispose();
    }
    const r = view.species.radius;
    this.sign = new THREE.Mesh(this.webShape(this.a.copy(view.root.position).addScaledVector(n, -r).clone(), n, r * 5.6, ground), this.signMaterial);
    this.keep(this.sign);
  }
}

// ---------------------------------------------------------------- geometry

function rodBetween(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
  const d = rodDir.copy(b).sub(a);
  const l = d.length();
  m.position.copy(a);
  m.scale.set(radius, Math.max(1e-4, l), radius);
  if (l > 1e-6) m.quaternion.setFromUnitVectors(UP, d.divideScalar(l));
}
const rodDir = new THREE.Vector3();

/** A tube whose rings are placed every frame. */
function tubeGeometry(segs: number, around: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = (segs + 1) * around;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < around; j++) {
      const a = i * around + j;
      const b = i * around + ((j + 1) % around);
      idx.push(a, b, a + around, b, b + around, a + around);
    }
  g.setIndex(idx);
  return g;
}

/** Ribbons that wind up round an upright axis, radii and heights in units. */
function threadGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const reach: number[] = [];
  const phase: number[] = [];
  const idx: number[] = [];
  const segs = 60;
  for (let k = 0; k < THREADS; k++) {
    const base = pos.length / 3;
    const a0 = (k / THREADS) * Math.PI * 2;
    const turns = 1.1 + 0.9 * rnd(k);
    const wide = 2.5 + 0.9 * rnd(k + 20);
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const an = a0 + s * turns * Math.PI * 2;
      const rad = wide * (1 - 0.55 * s) * (0.75 + 0.25 * Math.sin(s * 9 + k));
      const y = 0.1 + s * (4.2 + 1.6 * rnd(k + 40));
      const w = 0.008 + 0.012 * Math.sin(Math.PI * s);
      pos.push(Math.cos(an) * rad, y - w, Math.sin(an) * rad, Math.cos(an) * rad, y + w, Math.sin(an) * rad);
      reach.push(s, s);
      phase.push(rnd(k + 60), rnd(k + 60));
      if (i < segs) {
        const o = base + i * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('reach', new THREE.Float32BufferAttribute(reach, 1));
  g.setAttribute('phase', new THREE.Float32BufferAttribute(phase, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function ribbonGeometry(n: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const nor = new Float32Array(n * 6);
  const tc = new Float32Array(n * 4);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    tc.set([0, i / (n - 1), 1, i / (n - 1)], i * 4);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(tc, 2));
  g.setIndex(idx);
  return g;
}

function stripGeometry(segs: number): THREE.BufferGeometry {
  return ribbonGeometry(segs + 1);
}

/** The band round a head of radius 1 (about y), drawn from its back round both sides to its back again. */
function bandGeometry(): THREE.BufferGeometry {
  const segs = 64;
  const rows = [
    [0.99, -0.17],
    [1.0, -0.11],
    [0.97, 0.0],
    [0.91, 0.12],
    [0.82, 0.19],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const an = -Math.PI / 2 + (i / segs) * Math.PI * 2;
    for (const [rad, y] of rows) pos.push(Math.cos(an) * rad, y + 0.025 * Math.sin(an * 2 + y * 9), Math.sin(an) * rad);
  }
  const n = rows.length;
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
