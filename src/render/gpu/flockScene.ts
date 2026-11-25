import * as THREE from 'three/webgpu';
import { abs, attribute, cross, dFdx, dFdy, floor, normalize, cameraPosition, float, fract, hash, instanceIndex, max, mix, mx_noise_float, normalView, positionGeometry, positionLocal, positionView, positionViewDirection, positionWorld, pow, screenUV, sin, smoothstep, step, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLOCK_TICKS, RING_RADIUS, RINGS } from '../../game/flock';
import type { Match } from '../../game/match';
import type { BugView } from '../BugView';
import type { BowContext } from './bowScene';
import { BURST, CROWN, DANCE, DANCED, FlockCamera, HOME, PAST, READY, RISE } from './flockCamera';
import type { StageFx } from './gpuStage';

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;

const GOLD = new THREE.Color(0xffb020);
const PALE = new THREE.Color(0xfff0b8);
const HONEY = new THREE.Color(0xff8a10);

/** The swarm: as it sets out, and for every ring taken. */
const FIRST = 48;
const MORE = 8;
const SWARM = FIRST + MORE * RINGS;
const SIZE = 0.56;
const GRAINS = 560;
const SHARDS = 64;
const DOTS = 90;
const STREAKS = 36;
/** Points of the track it dances, of what it leaves in the air. */
const TRACK = 240;
const WAKE = 64;
/** The dance: how far its loops reach to the side, and ahead. */
const WIDE = 3.1;
const DEEP = 3;
/** After the hit: the scene is over. */
const AFTER = 5.6;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rnd = (i: number): number => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const TEAM = [new THREE.Vector3(0.75, 0.03, 0.02), new THREE.Vector3(0.03, 0.16, 0.8)];

interface One {
  at: THREE.Vector3;
  v: THREE.Vector3;
  face: THREE.Vector3;
  up: THREE.Vector3;
  size: number;
}
interface Grain {
  at: THREE.Vector3;
  v: THREE.Vector3;
  t: number;
  life: number;
  size: number;
  /** Drawn to the swarm's head. */
  home: boolean;
}

/** A strip through points that faces the view. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly points: THREE.Vector3[];
  count = 0;
  private readonly pos: THREE.BufferAttribute;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(
    private readonly max: number,
    material: THREE.Material,
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const uvs = new Float32Array(max * 4);
    const index: number[] = [];
    for (let i = 0; i < max; i++) {
      uvs.set([i / (max - 1), 0, i / (max - 1), 1], i * 4);
      if (i + 1 < max) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    g.setAttribute('position', this.pos);
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, material);
    this.points = Array.from({ length: max }, () => new THREE.Vector3());
  }

  draw(eye: THREE.Vector3, width: (u: number) => number): void {
    const n = Math.max(1, this.count);
    for (let i = 0; i < this.max; i++) {
      const k = Math.min(i, n - 1);
      const p = this.points[k];
      this.a.copy(this.points[Math.min(n - 1, k + 1)]).sub(this.points[Math.max(0, k - 1)]);
      this.b.copy(eye).sub(p).cross(this.a);
      const l = this.b.length();
      const w = l > 1e-5 && i < n ? width(k / (this.max - 1)) / l : 0;
      this.pos.setXYZ(i * 2, p.x - this.b.x * w, p.y - this.b.y * w, p.z - this.b.z * w);
      this.pos.setXYZ(i * 2 + 1, p.x + this.b.x * w, p.y + this.b.y * w, p.z + this.b.z * w);
    }
    this.pos.needsUpdate = true;
  }
}

/** The border of honeycomb cells (1 on it), and the cell's own part (-1..1 from its middle). */
function comb(p: V2, line: number): F {
  const s = vec2(1, 1.7320508);
  const a = fract(p.div(s)).sub(0.5).mul(s);
  const b = fract(p.div(s).add(0.5)).sub(0.5).mul(s);
  const g = abs(mix(a, b, step(b.dot(b), a.dot(a))));
  const d = max(g.x, g.dot(s.mul(0.5)));
  return smoothstep(0.5 - line * 2, 0.5 - line, d) as unknown as F;
}
/** How far from the middle, by a hexagon's measure. */
function hexOf(p: V2): F {
  const q = abs(p);
  return max(q.y, q.x.mul(0.8660254).add(q.y.mul(0.5))) as unknown as F;
}

/**
 * The Queen's Flight's scene (render only): the bee dances a figure eight, its track rises and becomes a crown, a
 * swarm comes to it; the player flies it through rings of pollen into an enemy, and the swarm whirls round that one;
 * then the bee is home again. It reads the match and never changes it.
 */
export class FlockScene {
  readonly camera = new FlockCamera();
  timeScale = 1;
  /** Seconds into the scene that plays before the aim (-1: it does not play). */
  sceneTime = -1;
  /** How far the bee's wings are out (0..1), and whether it smiles with its eyes. */
  wing = 0;
  glad = false;
  /** Bees of the swarm there are now. */
  private swarm = 0;

  private readonly root = new THREE.Group();
  private readonly lights = new THREE.Group();
  private readonly time = uniform(0);
  private readonly bees: THREE.InstancedMesh;
  private readonly wings: THREE.InstancedMesh;
  private readonly grains: THREE.InstancedMesh;
  private readonly grainLevel: THREE.InstancedBufferAttribute;
  private readonly floor: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly floorLevel = uniform(0);
  private readonly floorAt = uniform(0);
  private readonly floorIn = uniform(new THREE.Vector3());
  /** Where she is on the screen (u, v down), its aspect, how large she is: the lights before her leave her free. */
  private readonly queen = uniform(new THREE.Vector4(0, 0, 1, 0.0001));
  private readonly haloFrom = uniform(new THREE.Vector3());
  private readonly floorX = uniform(new THREE.Vector3(1, 0, 0));
  private readonly floorY = uniform(new THREE.Vector3(0, 1, 0));
  private readonly floorZ = uniform(new THREE.Vector3(0, 0, 1));
  private readonly floorBee = uniform(new THREE.Vector2());
  private readonly star: THREE.Mesh;
  private readonly starLevel = uniform(0);
  private readonly shards: THREE.InstancedMesh;
  private readonly bits: { at: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; t: number; size: number }[] = [];
  private readonly dots: THREE.InstancedMesh;
  private readonly dotLevel: THREE.InstancedBufferAttribute;
  private readonly streaks: THREE.InstancedMesh;
  private readonly streakLevel = uniform(0);
  private readonly arrow: THREE.Mesh;
  private readonly target: THREE.Mesh;
  private readonly targetLevel = uniform(0);
  private readonly foe = new THREE.Vector3(0.3, 0.7, 1);
  private readonly crown = new THREE.Group();
  private readonly crownGlow = uniform(0);
  private readonly glint = uniform(-2);
  private readonly team = new THREE.Vector3(1, 0.1, 0.05);
  private readonly halo: THREE.Mesh;
  private readonly haloLevel = uniform(0);
  private readonly track: Ribbon;
  private readonly trackLevel = uniform(1);
  private readonly trackHead = uniform(1);
  private readonly trackOver = uniform(0);
  private readonly wake: Ribbon[] = [];
  private readonly wakeLevel = uniform(0);
  private readonly rings: { g: THREE.Group; no: THREE.Mesh; film: THREE.Mesh; level: { value: number }; next: { value: number }; torus: THREE.Mesh; t: number; solid: { value: number }; through: { value: number } }[] = [];
  private readonly waves: { mesh: THREE.Mesh; level: { value: number }; t: number; life: number; size: number; flat: boolean }[] = [];
  private readonly ones: One[] = [];
  private readonly dust: Grain[] = [];
  private nextGrain = 0;

  private frames = 0;
  private clock = 0;
  private shooter = -1;
  private view: BugView | null = null;
  private started = false;
  private shotT = -1;
  private hitT = -1;
  private victim: BugView | null = null;
  private room = 1;
  private boost = 0;
  private rise = 0;
  private bank = 0;
  private readonly base = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly side = new THREE.Vector3(1, 0, 0);
  private readonly aim = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(0, 0, 1);
  private readonly hit = new THREE.Vector3();
  private readonly history: THREE.Vector3[] = Array.from({ length: 160 }, () => new THREE.Vector3());
  private historyCount = 0;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly dance = { p: new THREE.Vector3(), yaw: 0, wag: 0 };
  private readonly aimed = new Float64Array(3);
  private lateX: BowContext | null = null;
  private lateT = 0;

  /** `light`: the light special attacks share. */
  constructor(
    scene: THREE.Scene,
    private readonly fx: StageFx,
    private readonly light: THREE.PointLight,
  ) {
    scene.add(this.root);
    fx.scene.add(this.lights);

    // ---- the swarm: bodies, and wings that beat in the vertex shader
    {
      const skin = new THREE.MeshStandardNodeMaterial({ roughness: 0.62 });
      const rim = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 2.6);
      const scarf = uniform(this.team);
      skin.colorNode = mix(attribute('color', 'vec3'), vec3(scarf as unknown as THREE.Node<'vec3'>), attribute('scarf', 'float'));
      skin.emissiveNode = vec3(GOLD.r, GOLD.g, GOLD.b).mul(rim.mul(0.3)).add(attribute('color', 'vec3').mul(0.04));
      skin.fog = false;
      this.bees = new THREE.InstancedMesh(beeGeometry(), skin, SWARM);
      this.bees.castShadow = false;
      this.keep(this.bees);
      // (three ghosts of each wing, one behind the other: a blur)
      const beat = sin(this.time.mul(47).add(hash(instanceIndex).mul(6.28)).add(attribute('ghost', 'float').mul(0.75)));
      const out = abs(positionGeometry.x);
      const edge = smoothstep(0.3, 0.5, uv().sub(0.5).length());
      const film = this.glow(vec3(1, 0.84, 0.52).mul(edge.mul(0.085).add(0.06)), 0, 0.02);
      film.positionNode = positionLocal.add(vec3(0, out.mul(beat.mul(0.7).add(0.25)), out.mul(beat).mul(0.2)));
      this.wings = new THREE.InstancedMesh(wingsGeometry(), film, SWARM);
      this.keep(this.wings);
      for (let i = 0; i < SWARM; i++) this.ones.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), face: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), size: 0 });
    }

    // ---- pollen
    {
      const pg = new THREE.PlaneGeometry(1, 1);
      this.grainLevel = new THREE.InstancedBufferAttribute(new Float32Array(GRAINS), 1).setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('level', this.grainLevel);
      const r = uv().sub(0.5).length().mul(2);
      const core = smoothstep(0.4, 0.1, r);
      const soft = pow(max(r.oneMinus(), 0), 2.4).mul(0.5);
      const l = attribute('level', 'float');
      this.grains = new THREE.InstancedMesh(pg, this.glow(mix(vec3(HONEY.r, HONEY.g, HONEY.b), vec3(PALE.r, PALE.g, PALE.b), core).mul(core.add(soft)).mul(l)), GRAINS);
      this.keep(this.grains);
      for (let i = 0; i < GRAINS; i++) this.dust.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), t: 9, life: 1, size: 0, home: false });
    }

    // ---- the crown, and the light behind it
    {
      const metal = new THREE.MeshStandardNodeMaterial({ color: 0xffa81c, metalness: 1, roughness: 0.2 });
      metal.envMapIntensity = 2.6;
      metal.colorNode = mix(vec3(0.75, 0.2, 0.01), vec3(1, 0.66, 0.16), smoothstep(-0.14, 0.3, positionLocal.y));
      const glint = smoothstep(0.1, 0, abs(positionLocal.x.add(positionLocal.y.mul(0.4)).sub(this.glint)));
      metal.emissiveNode = vec3(0.9, 0.36, 0.02).mul(this.crownGlow.mul(0.55)).add(vec3(1, 0.85, 0.5).mul(glint.mul(0.8)));
      metal.fog = false;
      const jewel = new THREE.MeshStandardNodeMaterial({ color: 0xff5a08, roughness: 0.08, metalness: 0.1, flatShading: true });
      jewel.envMapIntensity = 3;
      const face = abs(normalView.z);
      jewel.emissiveNode = mix(vec3(0.5, 0.06, 0), vec3(1.3, 0.5, 0.05), face.pow(2)).mul(this.crownGlow.mul(0.3).add(0.8));
      jewel.fog = false;
      const [band, gems] = crownGeometry();
      const solid = new THREE.Mesh(band, metal);
      const gem = new THREE.Mesh(gems, jewel);
      this.crown.add(solid, gem);
      solid.castShadow = true;
      solid.frustumCulled = gem.frustumCulled = false;
      this.root.add(this.crown);
      const p = uv().sub(0.5).mul(2) as unknown as V2;
      const r = p.length();
      const rays = pow(abs(sin(atanOf(p).mul(6).add(this.time.mul(0.7)))), 4).mul(0.4).add(0.6);
      this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(vec3(GOLD.r, GOLD.g, GOLD.b).mul(pow(max(r.oneMinus(), 0), 2.2)).mul(rays).mul(smoothstep(-0.2, 1.6, positionWorld.sub(this.haloFrom).dot(this.floorY))).mul(this.haloLevel), 0, 1.6));
      this.keep(this.halo);
    }

    // ---- the track of the dance, and what the swarm leaves in the air
    {
      const u = uv();
      const across = abs(u.y.sub(0.5)).mul(2);
      const core = smoothstep(0.34, 0.1, across);
      const soft = pow(max(across.oneMinus(), 0), 2).mul(0.4);
      const tip = smoothstep(0.14, 0, abs(u.x.sub(this.trackHead)));
      const grain = mx_noise_float(vec3(u.x.mul(70), u.y.mul(5), this.time.mul(1.5))).mul(0.4).add(0.8);
      const color = mix(vec3(HONEY.r, HONEY.g, HONEY.b), vec3(PALE.r, PALE.g, PALE.b), core);
      this.track = new Ribbon(TRACK, this.glowOver(color.mul(core.mul(0.62).add(soft)).mul(grain).mul(tip.mul(1.2).add(0.7)).mul(smoothstep(0, 0.02, u.x)).mul(this.trackLevel)));
      this.keep(this.track.mesh);
      for (let k = 0; k < 1; k++) {
        const flow = mx_noise_float(vec3(u.x.mul(9).sub(this.time.mul(5)).add(k * 7), u.y.mul(3), k)).mul(0.5).add(0.75);
        const c2 = mix(vec3(1, 0.54, 0.07), vec3(1, 0.82, 0.4), core.mul(u.x.oneMinus()));
        const body = k === 0 ? pow(max(across.oneMinus(), 0), 2).mul(0.5).add(smoothstep(0.4, 0.05, across).mul(0.8)) : core.add(soft);
        const w = new Ribbon(WAKE, this.glow(c2.mul(body).mul(flow).mul(pow(u.x.oneMinus(), 1.4)).mul(smoothstep(0, 0.2, u.x)).mul(this.wakeLevel).mul(k === 0 ? 0.8 : 0.9)));
        this.wake.push(w);
        this.keep(w.mesh);
      }
    }

    // ---- cells of a comb on whatever lies there (a ball; what lies behind it is found by its depth)
    {
      const away = positionWorld.sub(cameraPosition);
      const behind = cameraPosition.add(away.mul(this.fx.depthAt(screenUV).div(positionView.z.negate())));
      const off = behind.sub(this.floorIn);
      const p = vec2(off.dot(this.floorX), off.dot(this.floorZ)) as unknown as V2;
      const tall = off.dot(this.floorY);
      const r = p.length();
      const cells = comb(p.mul(1.15) as unknown as V2, 0.04);
      const wave = smoothstep(1.5, 0, abs(r.sub(this.floorAt))).mul(0.8).add(0.16);
      const near = smoothstep(2, 0.2, p.sub(this.floorBee as unknown as THREE.Node<'vec2'>).length());
      const honey = mx_noise_float(vec3(p.mul(0.9), this.time.mul(0.8))).mul(0.5).add(0.6);
      const light = cells.mul(wave.add(near.mul(0.5))).add(near.mul(0.12).mul(honey)).add(wave.mul(0.07).mul(honey));
      const level = smoothstep(0.6, 0.78, abs(normalize(cross(dFdx(behind), dFdy(behind))).dot(this.floorY)));
      const kept = level.mul(smoothstep(7.4, 2.5, r)).mul(smoothstep(0.9, 0.12, tall)).mul(smoothstep(-1.1, -0.35, tall));
      this.floor = new THREE.Mesh(new THREE.SphereGeometry(8, 24, 16), this.glow(vec3(1, 0.46, 0.05).mul(light).mul(kept).mul(this.floorLevel), 1));
      (this.floor.material as THREE.MeshBasicNodeMaterial).side = THREE.BackSide;
      this.keep(this.floor);
    }

    // ---- in the air: a slab of wax for it to lie on
    {
      const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x8a5a14, roughness: 0.8, specularIntensity: 0.15, envMapIntensity: 0.3 });
      const rim = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 2);
      m.emissiveNode = vec3(1, 0.42, 0.05).mul(rim.mul(0.12).add(smoothstep(0.02, -0.12, positionLocal.y).mul(0.3)));
      m.fog = false;
      this.disc = new THREE.Mesh(slabGeometry(), m);
      this.disc.receiveShadow = true;
      this.keep(this.disc);
      this.disc.renderOrder = 0;
    }

    // ---- shards of the comb
    {
      const m = new THREE.MeshStandardNodeMaterial({ color: 0xff8a04, roughness: 0.12, transparent: true, side: THREE.DoubleSide });
      const edge = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 1.6);
      m.opacityNode = edge.mul(0.45).add(0.5);
      m.emissiveNode = mix(vec3(0.5, 0.15, 0.005), vec3(1, 0.62, 0.16), edge).mul(0.75);
      m.fog = false;
      this.shards = new THREE.InstancedMesh(cellGeometry(), m, SHARDS);
      this.keep(this.shards);
      for (let i = 0; i < SHARDS; i++) this.bits.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(), t: 9, size: 0 });
    }
    // ---- the way through the rings, in dots; streaks of speed
    {
      const r = uv().sub(0.5).length().mul(2);
      const dot = smoothstep(0.6, 0.3, r).add(pow(max(r.oneMinus(), 0), 2).mul(0.4));
      const pg = new THREE.PlaneGeometry(1, 1);
      this.dotLevel = new THREE.InstancedBufferAttribute(new Float32Array(DOTS), 1).setUsage(THREE.DynamicDrawUsage);
      pg.setAttribute('level', this.dotLevel);
      this.dots = new THREE.InstancedMesh(pg, this.glow(vec3(1, 0.62, 0.12).mul(dot).mul(attribute('level', 'float')), 0.35), DOTS);
      this.keep(this.dots);
      const u = uv();
      const line = smoothstep(0.5, 0, abs(u.x.sub(0.5))).mul(smoothstep(0, 0.3, u.y)).mul(smoothstep(1, 0.7, u.y));
      this.streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.glow(vec3(1, 0.8, 0.4).mul(line).mul(this.streakLevel)), STREAKS);
      this.keep(this.streaks);
      // (which way the next one is, when it is out of the picture; whom it is for)
      const ap = uv().sub(0.5).mul(2) as unknown as V2;
      const stroke = (at: number): F => abs(ap.x.add(abs(ap.y).mul(0.8)).sub(at)) as unknown as F;
      const bars = smoothstep(0.17, 0.11, stroke(0.45)).add(smoothstep(0.12, 0.07, stroke(-0.05)).mul(0.6)).mul(smoothstep(0.72, 0.64, abs(ap.y)));
      const halo2 = smoothstep(0.5, 0, stroke(0.35)).mul(smoothstep(0.95, 0.3, abs(ap.y))).mul(0.25);
      this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(vec3(1, 0.68, 0.16).mul(bars.mul(1.3).add(halo2)), 1));
      this.keep(this.arrow);
      const p = uv().sub(0.5).mul(2.6) as unknown as V2;
      const h = hexOf(p);
      const gaps = smoothstep(0.1, 0.25, abs(sin(atanOf(p).mul(3))));
      const mark = smoothstep(0.07, 0.03, abs(h.sub(1))).mul(gaps).add(smoothstep(0.25, 0, abs(h.sub(1))).mul(0.25).mul(gaps));
      this.target = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(vec3(uniform(this.foe) as unknown as THREE.Node<'vec3'>).mul(mark).mul(this.targetLevel).mul(this.clearOf()), 0.6));
      this.keep(this.target);
    }

    // ---- the rings
    for (let k = 0; k < RINGS; k++) {
      const level = uniform(0);
      const next = uniform(0);
      const solidLevel = uniform(0);
      const through = uniform(0);
      const p = uv().sub(0.5).mul(2).mul(1.5) as unknown as V2;
      const r = p.length();
      const line = smoothstep(0.1, 0, abs(r.sub(1))).mul(0.55).add(smoothstep(0.025, 0.008, abs(r.sub(1))).mul(0.9));
      const inside = smoothstep(1.02, 0.97, r);
      const cells = comb(p.mul(3.4) as unknown as V2, 0.03).mul(inside).mul(smoothstep(0.25, 1, r));
      const pulse = sin(r.mul(9).sub(this.time.mul(5))).mul(0.5).add(0.5);
      const wave = sin(atanOf(p).mul(8).add(this.time.mul(0.8))).mul(0.5).add(0.5);
      const reach = wave.pow(0.6).mul(0.3).add(1.05);
      const petals = smoothstep(reach, reach.sub(0.14), r).mul(smoothstep(1.0, 1.04, r)).mul(0.55).add(smoothstep(0.035, 0, abs(r.sub(reach))).mul(0.5));
      const all = vec3(GOLD.r, GOLD.g, GOLD.b)
        .mul(line.add(cells.mul(pulse.mul(0.5).add(0.3).mul(next.mul(0.8).add(0.35)))).add(petals.mul(next.mul(0.4).add(0.15))))
        .add(vec3(PALE.r, PALE.g, PALE.b).mul(smoothstep(0.02, 0.005, abs(r.sub(1)))).mul(next.mul(0.8).add(0.2)));
      const film = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(all.mul(level).mul(this.clearOf()), through as unknown as F));
      film.scale.setScalar(RING_RADIUS * 0.92 * 3);
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardNodeMaterial({ color: 0xffa516, roughness: 0.5 });
      mat.emissiveNode = mix(vec3(0.3, 0.12, 0.005), vec3(0.75, 0.42, 0.08), next).mul(solidLevel);
      mat.fog = false;
      const torus = new THREE.Mesh(garland(), mat);
      torus.scale.setScalar(RING_RADIUS * 0.92);
      torus.frustumCulled = false;
      this.root.add(torus);
      this.keep(film);
      const no = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(texture(digit(k + 1)).rgb.mul(vec3(1, 0.86, 0.45)).mul(level).mul(next.mul(0.5).add(0.5)), 0.3));
      this.keep(no);
      this.rings.push({ g, no, film, level, next, torus, t: -1, solid: solidLevel, through });
    }

    // ---- the sting: a white core, rays
    {
      const p = uv().sub(0.5).mul(2) as unknown as V2;
      const r = p.length();
      const an = atanOf(p);
      // (each ray runs out to a point, none as long as the next)
      const cell = an.mul(26 / (Math.PI * 2));
      const long = hash(floor(cell).add(40)).mul(0.62).add(0.36);
      const off = abs(fract(cell).sub(0.5)).mul((Math.PI * 2) / 26).mul(r);
      const thick = max(float(1).sub(r.div(long)), 0).mul(0.02);
      const ray = smoothstep(thick, thick.mul(0.2), off).mul(smoothstep(long, long.mul(0.8), r));
      const core = pow(max(float(1).sub(r.mul(7)), 0), 1.5);
      this.star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(vec3(1, 0.78, 0.36).mul(ray).add(vec3(1, 0.94, 0.75).mul(core.mul(1.1))).mul(this.starLevel)));
      this.keep(this.star);
    }

    // ---- waves: a hexagon that runs out, cells of honeycomb in it
    for (let k = 0; k < 8; k++) {
      const level = uniform(0);
      const p = uv().sub(0.5).mul(3) as unknown as V2;
      const h = hexOf(p);
      const line = smoothstep(0.16, 0, abs(h.sub(0.84))).mul(0.5).add(smoothstep(0.035, 0, abs(h.sub(0.86))));
      const cells = comb(p.mul(7) as unknown as V2, 0.035).mul(smoothstep(0.1, 0.85, h)).mul(smoothstep(0.9, 0.84, h)).mul(0.6);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glow(mix(vec3(HONEY.r, HONEY.g, HONEY.b), vec3(PALE.r, PALE.g, PALE.b), line.mul(0.5)).mul(line.add(cells)).mul(level)));
      this.waves.push({ mesh, level, t: 9, life: 1, size: 1, flat: false });
      this.keep(mesh);
    }
  }

  /** Seconds since it struck (-1: not yet). */
  get hitFor(): number {
    return this.hitT;
  }

  get flies(): boolean {
    return this.shotT >= PAST && this.hitT < 0;
  }

  /** The bugs' names may show. */
  get names(): boolean {
    return this.hitT > 0.5 && this.hitT < HOME - 0.1;
  }

  /** Whether the swarm is at this bug. */
  hurts(v: BugView): boolean {
    return v === this.victim && this.hitT > 0.75 && this.hitT < 2.7;
  }

  /** The names are in the way of the rings. */
  hidesNames(match: Match): boolean {
    const f = match.flock;
    if (this.hitT < 0 && this.shotT < PAST) return true;
    return f !== null && f.rings.filter((r) => !r.taken).length > 1;
  }

  /** It cries out. */
  cries(v: BugView): boolean {
    return v === this.victim && this.hitT >= 0 && this.hitT < 2.3;
  }

  clear(): void {
    if (this.shooter >= 0) this.end();
    this.hideAll();
    this.camera.stop();
  }

  onFire(): void {
    if (this.shooter < 0) return;
    this.shotT = 0;
    this.historyCount = 0;
    this.head.copy(this.at);
    this.camera.kick(0.4);
    this.wave(this.at, 8, 0.85, false);
    for (let i = 0; i < 40; i++) this.grain(this.at, 5, 0.7, false);
  }

  onRing(index: number, x: number, y: number, z: number): void {
    const r = this.rings[index];
    r.t = 0;
    this.boost = 1;
    this.camera.kick(0.35);
    this.a.set(x, y, z);
    for (let i = 0; i < 46; i++) {
      if (this.shotT < PAST) break;
      const g = this.grain(this.a, 3.4, 0.9, true);
      const an = (i / 46) * Math.PI * 2;
      g.at.set(Math.cos(an), Math.sin(an), 0).multiplyScalar(RING_RADIUS * 0.92).applyQuaternion(r.torus.quaternion).add(this.a);
    }
    // (more come out of it)
    for (let i = this.swarm; i < Math.min(SWARM, this.swarm + MORE); i++) {
      const an = i * 2.4;
      this.ones[i].at.set(Math.cos(an), Math.sin(an), 0).multiplyScalar(RING_RADIUS).applyQuaternion(r.torus.quaternion).add(this.a);
      this.ones[i].size = 0;
    }
    this.swarm = Math.min(SWARM, this.swarm + MORE);
  }

  onSting(x: number, y: number, z: number, victim: BugView | null): void {
    if (this.shotT < 0) return;
    this.hitT = 0;
    this.hit.set(x, y, z);
    this.victim = victim;
    // (before the wall, not in it)
    if (!victim) this.hit.addScaledVector(this.dir, -1.8);
    this.camera.kick(1);
    const rich = (this.swarm - FIRST) / (SWARM - FIRST);
    this.wave(this.hit, 13 + 7 * rich, 0.9, true);
    for (let i = 0; i < 130 + 110 * rich; i++) this.grain(this.hit, 9 + 6 * rich, 1.6, false);
    // (the comb breaks: its cells fly)
    for (let i = 0; i < SHARDS; i++) {
      const b = this.bits[i];
      const an = i * 2.39996;
      const y = -0.2 + 1.1 * rnd(i + 12);
      b.v.set(Math.cos(an), y, Math.sin(an)).normalize();
      b.at.copy(this.hit).addScaledVector(b.v, 0.8);
      b.v.multiplyScalar((4 + 9 * rnd(i + 5)) * (0.8 + 0.5 * rich));
      b.axis.set(rnd(i) - 0.5, rnd(i + 1) - 0.5, rnd(i + 2) - 0.5).normalize();
      b.size = i < 30 + 34 * rich ? 0.06 + 0.16 * rnd(i + 9) : 0.0001;
      b.t = 0;
    }
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
    const u = match.activeUnit;
    const mine = match.currentWeapon.kind === 'flock';
    const special = match.phase === 'special' && mine;
    const stance = match.stance && mine && u.bug.alive && match.phase === 'aim';
    if ((special || stance) && this.shooter !== u.id) {
      view.root.userData.side = u.team;
      this.begin(u.id, view);
    }
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
    // (level, unless it hangs on a wall)
    if (!b.grounded || this.up.y > 0.9) this.up.set(0, 1, 0);
    this.fwd.set(b.hx, b.hy, b.hz);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up));
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(b.fx, 0, b.fz);
    this.fwd.normalize();
    this.side.crossVectors(this.up, this.fwd);
    this.at.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.pz + (b.z - b.pz) * alpha);
    this.homeAt.copy(this.at);
    if ((special || this.hitT > HOME) && this.started) this.at.add(this.place);
    this.base.copy(this.at).addScaledVector(this.up, -r);
    if (this.floating && (special || this.hitT > HOME)) {
      this.level();
      this.base.copy(this.at).addScaledVector(this.up, -r);
    }
    const [ax, ay, az] = match.aimDirection(u, this.aimed);
    this.aim.set(ax, ay, az);
    if (!this.started) {
      this.started = true;
      this.camera.start();
      this.measure(x);
      if (special) this.at.add(this.place);
      if (this.floating) this.level();
      this.base.copy(this.at).addScaledVector(this.up, -r);
    }
    this.clock += dt;
    this.time.value = this.clock;
    if (this.shotT >= 0) this.shotT += dt;
    if (this.hitT >= 0) this.hitT += dt;
    this.boost *= Math.exp(-dt * 2.4);

    // ---- the swarm's head
    const f = match.flock;
    if (f) {
      this.head.set(f.px + (f.x - f.px) * alpha, f.py + (f.y - f.py) * alpha, f.pz + (f.z - f.pz) * alpha);
      this.dir.set(f.dx, f.v, f.dz);
      if (this.shotT < 0.16) this.head.lerp(this.at, 1 - this.shotT / 0.16);
      this.remember();
    }
    if (this.hitT >= 0 && this.victim) this.hit.lerp(this.victim.root.position, 1 - Math.exp(-dt * 30));

    // ---- how it holds itself
    this.poseOf(special, t, stance);

    this.camera.update(x.camera, { t, shotT: this.shotT, hitT: this.hitT, stance, at: this.at, up: this.up, fwd: this.fwd, aim: this.aim, radius: r, head: this.head, dir: this.dir, boost: this.boost, room: this.room, hit: this.hit, ring: match.rings.length > 0 ? this.ringAt.set(match.rings[0].x, match.rings[0].y, match.rings[0].z) : null, facing: this.victim ? this.faces(this.victim) : NaN, dt, ground: x.ground });
    x.camera.updateMatrixWorld();
    this.lateX = x;
    this.lateT = t;

    if (this.victim) this.victim.tumble = 0.55 * ss(0, 0.05, this.hitT) * (1 - ss(0.6, 1.3, this.hitT));
    if (this.victim) this.victim.struggle = this.hitT < 2.3 ? ss(0, 0.2, this.hitT) * 0.9 : 0.9 * (1 - ss(2.3, 2.7, this.hitT));

    // ---- the one light
    const ease = 1 - Math.exp(-dt * 9);
    let goal = 0;
    this.light.color.copy(PALE).lerp(GOLD, 0.55);
    const home = this.hitT > HOME;
    if (special || stance || home) {
      this.a.copy(this.at).addScaledVector(this.up, 3.1).addScaledVector(this.b.copy(x.camera.position).sub(this.at).normalize(), 2.2);
      goal = special ? 5 + 6 * Math.exp(-(((t - CROWN) / 0.25) ** 2)) + 0.3 * ss(DANCE, DANCE + 0.3, t) : home ? 7 : stance ? 9 : 0;
    } else if (this.hitT >= 0) {
      this.a.copy(this.hit).addScaledVector(this.up, 3).addScaledVector(this.b.copy(x.camera.position).sub(this.hit).normalize(), 2.5);
      goal = 24 + 50 * Math.exp(-this.hitT * 6);
    } else {
      this.a.copy(this.head).addScaledVector(this.dir, -1.4);
      this.a.y += 2;
      goal = this.shotT < PAST ? 13 : 1.5 * this.boost;
    }
    this.light.position.lerp(this.a, this.shotT >= 0 && !home ? 1 : ease);
    this.light.intensity += (goal - this.light.intensity) * (this.hitT >= 0 && this.hitT < 0.05 ? 1 : ease);

    // ---- the picture
    const dim = special ? 0.6 * ss(0, 0.35, t) * (1 - 0.12 * ss(BURST, BURST + 0.6, t)) : stance ? 0.55 : this.shotT >= 0 && this.shotT < PAST ? 0.3 : home ? 0.6 : this.hitT >= 0 ? (0.5 + 0.35 * Math.exp(-this.hitT * 4)) * (1 - ss(2.2, 3, this.hitT)) : 0;
    this.fx.dim.value += (dim - this.fx.dim.value) * (1 - Math.exp(-dt * 10));
    this.fx.vignette.value = Math.max(this.fx.dim.value * 0.8, this.shotT >= 0 && this.hitT < 0 ? 0.25 : 0);
    // (a pool of light on what the picture is about)
    const pool = special ? ss(0, 0.3, t) : stance ? 0.8 : this.shotT >= 0 && this.shotT < PAST ? 1 : home ? 1 : this.hitT >= 0 ? 0.85 * (1 - ss(2.7, 3.05, this.hitT)) : 0;
    this.fx.poolOn.value += (pool - this.fx.poolOn.value) * (1 - Math.exp(-dt * 14));
    this.fx.poolWarm.value = this.hitT >= 0 && !home ? 0.4 : 1;
    this.a.copy(this.hitT >= 0 && !home ? this.hit : this.shotT >= 0 && this.shotT < PAST ? this.head : this.at);
    this.fx.pool.value.set(this.a.x, this.a.y, this.a.z, special ? 6 + 5 * ss(BURST, BURST + 0.6, t) : home ? 8 : this.hitT >= 0 ? 8 : 9);
    this.fx.flashTint.value.set(1, 0.66, 0.2);
    this.fx.flash.value = 0;
    this.fx.fade.value = this.hitT >= 0 ? ss(AFTER - 0.25, AFTER - 0.03, this.hitT) : 0;
    this.fx.focusBlur.value = special && t > RISE ? 0.3 * ss(RISE, RISE + 0.3, t) * (1 - ss(BURST, BURST + 0.4, t)) : 0;
    this.a.copy(this.hitT >= 0 && !home ? this.hit : this.shotT >= 0 && !home ? this.head : this.at);
    this.fx.subject.value += (x.camera.position.distanceTo(this.a) + 0.8 - this.fx.subject.value) * (1 - Math.exp(-dt * 12));

    this.placeSpot(x.camera, stance ? 0.8 : 0);
    // (a moment held: as the swarm bursts out; as it strikes, then slowly on)
    this.timeScale = this.hitT >= 0 ? (this.hitT < 0.016 ? 0.12 : this.hitT < 0.45 ? 0.3 + 0.5 * this.hitT : 1) : special && t > BURST && t < BURST + 0.14 ? 0.4 : 1;
    if (this.shotT >= 0 && !match.flock && (this.hitT > AFTER || (this.hitT < 0 && this.shotT > 0.6))) this.end();
  }

  /** Where it dances dims less than the rest. */
  private placeSpot(camera: THREE.PerspectiveCamera, on: number): void {
    const s = this.fx.spot.value;
    s.z = 0.0001;
    if (on < 0.01) return;
    const dist = this.at.distanceTo(camera.position);
    this.fx.spotAt.value = dist;
    this.a.copy(this.at).project(camera);
    s.x = this.a.x * 0.5 + 0.5;
    s.y = 0.5 - this.a.y * 0.5;
    s.w = camera.aspect;
    s.z = Math.max(0.0001, ((3.6 * on) / dist / Math.tan((camera.fov * Math.PI) / 360)) * 0.5);
  }

  /** After the bugs are posed for the frame. */
  late(): void {
    const x = this.lateX;
    this.lateX = null;
    if (!x || this.shooter < 0 || !this.view) return;
    // (no other bug in the picture of the scene)
    for (const q of x.views) if (q !== this.view && q.root.visible && (this.sceneTime >= 0 || this.hitT > HOME || (this.shotT >= 0 && this.shotT < PAST && this.hitT < 0))) q.root.visible = false;
    this.placeBee(x, this.lateT);
    this.view.root.updateMatrixWorld(true);
    this.a.copy(this.view.root.position).project(x.camera);
    const far = this.view.root.position.distanceTo(x.camera.position);
    this.queen.value.set(this.a.x * 0.5 + 0.5, 0.5 - this.a.y * 0.5, x.camera.aspect, this.shotT >= 0 ? (1.5 / far / Math.tan((x.camera.fov * Math.PI) / 360)) * 0.5 : 0.0001);
    this.placeTrack(x, this.lateT);
    this.placeFloor(this.lateT);
    this.placeCrown(x, this.lateT);
    this.placeSwarm(x, this.lateT);
    this.placeWake(x);
    this.placeRings(x, this.lateT);
    this.placeGuides(x);
    this.placeShards(x);
    this.placeWaves(x);
    this.placeGrains(x);
  }

  private readonly ringAt = new THREE.Vector3();
  private faces(v: BugView): number {
    this.b.set(0, 0, 1).applyQuaternion(v.root.quaternion);
    return Math.atan2(this.b.x, this.b.z);
  }

  // ---------------------------------------------------------------- beginning and end

  private begin(id: number, view: BugView): void {
    this.shooter = id;
    this.view = view;
    this.started = false;
    this.shotT = this.hitT = -1;
    this.victim = null;
    this.boost = this.bank = this.rise = 0;
    this.swarm = FIRST;
    this.historyCount = 0;
    for (const o of this.ones) o.size = 0;
    for (const g of this.dust) g.t = g.life;
    for (const w of this.waves) w.t = w.life;
    for (const b of this.bits) b.t = 9;
    this.team.copy(TEAM[view.root.userData.side as number] ?? TEAM[0]);
    for (const r of this.rings) r.t = -1;
  }

  private end(): void {
    this.sceneTime = -1;
    if (this.victim) this.victim.struggle = this.victim.tumble = 0;
    this.victim = null;
    const v = this.view;
    if (v) {
      v.torso.rotation.set(0, 0, 0);
      v.torso.position.y = v.restY;
      v.pace = 0;
      v.hover = false;
      v.trail = 0;
    }
    this.view = null;
    this.shooter = -1;
    this.wing = 0;
    this.glad = false;
    this.shotT = this.hitT = -1;
    this.timeScale = 1;
    this.light.intensity = 0;
    const f = this.fx;
    f.flashTint.value.set(0.25, 0.8, 1);
    f.poolOn.value = 0;
    f.spot.value.z = 0.0001;
    f.dim.value = f.vignette.value = f.flash.value = f.focusBlur.value = 0;
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

  // ---------------------------------------------------------------- the bee

  /** Upright, whatever it stands on. */
  private level(): void {
    this.up.set(0, 1, 0);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, 1);
    this.fwd.normalize();
    this.side.crossVectors(this.up, this.fwd);
  }

  /** Where it dances, and how large: a flat place with room, no further than it must be. */
  private measure(x: BowContext): void {
    const home = this.s.copy(this.at);
    let best = -1e9;
    let room = 0.4;
    this.place.set(0, 0, 0);
    for (let k = 0; k < 33; k++) {
      const far = k === 0 ? 0 : 2.2 + 2.4 * ((k - 1) >> 3);
      const an = (k * Math.PI) / 4;
      this.c.copy(this.fwd).multiplyScalar(Math.cos(an) * far).addScaledVector(this.side, Math.sin(an) * far);
      const l = this.c.length();
      // (over what is low)
      const v = this.up;
      if (l > 0.1 && x.ground.raycast(home.x + v.x * 2.2, home.y + v.y * 2.2, home.z + v.z * 2.2, this.c.x / l, this.c.y / l, this.c.z / l, l + 1) >= 0) continue;
      // (at its own height over the ground there)
      const u = this.up;
      this.b.copy(home).add(this.c);
      const h = x.ground.rest(this.b.x + u.x * 1.6, this.b.y + u.y * 1.6, this.b.z + u.z * 1.6, -u.x, -u.y, -u.z, 5.5);
      if (h <= 0) continue;
      this.c.addScaledVector(u, 2.6 - h);
      const r = this.roomAt(x, this.b.copy(home).add(this.c));
      const score = r * 12 - far * 0.3;
      if (score <= best) continue;
      best = score;
      room = r;
      this.place.copy(this.c);
    }
    this.room = room;
    this.floating = false;
    if (room > 0.9) return;
    // (no such place: a comb of light in the air, where nothing is near)
    const f = x.match.field;
    for (let k = 0; k < 48; k++) {
      const high = 3.2 + 2 * (k >> 4);
      const far = k % 16 === 0 ? 0 : 4 * (1 + ((k % 16) >> 3));
      this.tangentOf(((k % 8) * Math.PI) / 4, this.c);
      this.c.multiplyScalar(far);
      this.c.y += high;
      this.b.copy(home).add(this.c);
      const p = this.b;
      if (f.sample(p.x, p.y, p.z) < 1.8 || f.sample(p.x, p.y + 2.5, p.z) < 1.5) continue;
      let free = true;
      for (let n = 0; n < 10 && free; n++) {
        const an = (n / 10) * Math.PI * 2;
        this.a.set(Math.cos(an), 0, Math.sin(an));
        free = x.ground.raycast(p.x, p.y - 0.8, p.z, this.a.x, 0, this.a.z, 6) < 0 && x.ground.raycast(p.x + this.a.x * 5, p.y + 1, p.z + this.a.z * 5, 0, -1, 0, 2.8) < 0 && x.ground.raycast(p.x, p.y + 0.6, p.z, this.a.x, 0, this.a.z, 6) < 0;
      }
      if (!free) continue;
      // (it is seen on its way there: nothing between)
      const l = this.c.length();
      if (x.ground.raycast(home.x, home.y + 1, home.z, this.c.x / l, this.c.y / l, this.c.z / l, l - 1) >= 0) continue;
      this.floating = true;
      this.room = 1;
      this.place.copy(this.c);
      return;
    }
  }

  /** How large it can dance round a place (0.4..1): no wall, no step, no edge. */
  private roomAt(x: BowContext, at: THREE.Vector3): number {
    const u = this.up;
    let wall = WIDE + 1;
    for (let k = 0; k < 8; k++) {
      const an = (k / 8) * Math.PI * 2;
      this.tangentOf(an, this.a);
      const t = x.ground.raycast(at.x + u.x * 0.3, at.y + u.y * 0.3, at.z + u.z * 0.3, this.a.x, this.a.y, this.a.z, wall);
      if (t >= 0) wall = t;
    }
    let room = Math.min(1, Math.max(0.62, (wall - 0.7) / WIDE));
    const d = { p: this.dance.p, yaw: 0, wag: 0 };
    for (let n = 0; n < 6 && room > 0.62; n++) {
      let lost = 0;
      for (let k = 0; k < 14; k++) {
        this.danceAt(k / 14, d);
        this.a.copy(at).addScaledVector(this.side, d.p.x * room).addScaledVector(this.fwd, d.p.z * room);
        const h = x.ground.rest(this.a.x, this.a.y, this.a.z, -u.x, -u.y, -u.z, 2);
        if (h <= 0 || Math.abs(h - 1) > 0.3) lost++;
      }
      if (lost === 0) break;
      room = Math.max(0.62, room * 0.85);
    }
    return room;
  }

  /** Where the dance is after a part of its way (0..1): in the plane it stands on (x: to its side, z: ahead). */
  private danceAt(u: number, out: { p: THREE.Vector3; yaw: number; wag: number }): void {
    // (an eight on its side: across its middle twice, each time straight on, with a waggle)
    const a = Math.min(1, Math.max(0, u)) * Math.PI * 2;
    const x = Math.sin(a);
    out.p.set(x * WIDE, 0, Math.sin(a * 2) * 0.5 * DEEP * (0.75 + 0.25 * ss(0.3, 0.8, Math.abs(x))));
    out.yaw = Math.atan2(Math.cos(a) * WIDE, Math.cos(a * 2) * DEEP);
    out.wag = 1 - ss(0.3, 0.6, Math.abs(x));
  }

  private poseOf(special: boolean, t: number, stance: boolean): void {
    const v = this.view;
    if (!v) return;
    const flying = this.shotT >= 0 && this.hitT < HOME;
    const dancing = special && t > DANCE && t < DANCED;
    const proud = special ? ss(RISE + 0.1, CROWN, t) : stance ? 0.35 : this.hitT > HOME ? 0.5 * ss(HOME + 0.9, HOME + 1.2, this.hitT) : 0;
    this.rise += (proud - this.rise) * 0.25;
    this.wing = flying || (this.hitT > HOME && this.hitT < HOME + 0.85) ? 1 : dancing ? 0.55 : special ? ss(0.05, 0.3, t) * 0.5 + 0.5 * ss(BURST - 0.15, BURST + 0.1, t) : stance ? 0.8 : 0;
    this.glad = special ? t > RISE + 0.3 && t < BURST + 0.15 : this.hitT > HOME + 1.0;
    v.torso.rotation.x = -0.34 * this.rise;
    v.torso.position.y = v.restY + 0.16 * this.rise;
    v.pace = dancing ? 9 : 0;
    v.trail = this.shotT >= 0 && this.hitT < 0 ? 1 : 0;
    v.hover = (special && t > BURST + 0.05 && t < READY - 0.15) || flying || (this.hitT > HOME && this.hitT < HOME + 0.8);
  }

  private lean = 0;
  private readonly turnQ = new THREE.Quaternion();

  private placeBee(x: BowContext, t: number): void {
    const v = this.view as BugView;
    const root = v.root;
    // (its scene is played where there is room)
    if (this.sceneTime >= 0 || this.hitT > HOME) {
      root.position.add(this.place);
      this.m.makeBasis(this.side, this.up, this.fwd);
      root.quaternion.setFromRotationMatrix(this.m);
      if (this.floating) root.position.copy(this.at);
      const h = this.floating ? 0 : x.ground.rest(root.position.x + this.up.x, root.position.y + this.up.y, root.position.z + this.up.z, -this.up.x, -this.up.y, -this.up.z, 3);
      if (h > 0) root.position.addScaledVector(this.up, 2 - h);
    }
    if (this.sceneTime >= 0 && t > DANCE - 0.12 && t < RISE) {
      // (from where it stands to the start of the run, and back at the end)
      const u = this.danceU(t);
      const d = this.dance;
      this.danceAt(u, d);
      const on = t < DANCED + 0.1 ? 1 : 0;
      // (then a hop back off it: there it is)
      const off = ss(DANCED, DANCED + 0.22, t) * (1 - ss(RISE - 0.12, RISE + 0.06, t));
      root.position.addScaledVector(this.fwd, -(DEEP * 0.5 + 1.1) * Math.max(0.75, this.room) * off).addScaledVector(this.up, 0.8 * Math.sin(Math.PI * ss(DANCED, DANCED + 0.24, t)));
      const wag = d.wag * Math.sin(this.clock * 46);
      root.position.addScaledVector(this.side, d.p.x * this.room * on + wag * 0.1).addScaledVector(this.fwd, d.p.z * this.room * on);
      const yaw = d.yaw * on + wag * 0.3;
      this.lean += ((d.wag > 0.5 ? 0 : -0.2 * Math.sign(d.p.x)) - this.lean) * (1 - Math.exp(-x.dt * 8));
      this.turnQ.setFromAxisAngle(this.a.set(0, 1, 0), yaw);
      root.quaternion.multiply(this.turnQ);
      v.torso.rotation.z = -wag * 0.16 + this.lean * on;
      return;
    }
    v.torso.rotation.z = 0;
    if (this.sceneTime >= 0 && t > RISE) {
      // (a hop of joy as the crown comes down on it)
      const h = t - CROWN + 0.05;
      if (h > 0 && h < 0.36) root.position.addScaledVector(this.up, 0.55 * Math.sin((h / 0.36) * Math.PI));
      // (up into the middle of them)
      root.position.addScaledVector(this.up, (0.95 + 0.06 * Math.sin(this.clock * 5)) * ss(BURST, BURST + 0.4, t) * (1 - ss(READY - 0.2, READY, t)));
      return;
    }
    if (this.shotT >= 0 && this.hitT < HOME) {
      let out = this.head;
      if (this.hitT >= 0) {
        const k = this.hitT;
        this.s.set(1, 0, 0).applyQuaternion(x.camera.quaternion).setY(0).normalize();
        this.b.copy(x.camera.position).sub(this.hit).setY(0).normalize();
        if (this.victim) {
          // the sting, from one side; then up behind it
          const u = ss(0.9, 1.9, k);
          this.a.copy(this.hit).addScaledVector(this.s, 2.5 - 0.5 * u).addScaledVector(this.b, -0.9 - 0.2 * u);
          this.a.y += 1.0 + 0.5 * u;
        } else {
          // nobody there: it hangs before the wall, and looks about
          this.a.copy(this.hit).addScaledVector(this.b, 1.6);
          this.a.y += 0.9 + 0.5 * ss(0.5, 1.5, k);
        }
        this.c.copy(this.head).lerp(this.a, ss(0, this.victim ? 0.05 : 0.9, k));
        if (this.victim) {
          this.b.copy(this.hit).sub(this.a);
          this.b.y = 0.45 * ss(0, 0.2, k) * (1 - ss(0.9, 1.4, k));
        } else {
          this.q.setFromAxisAngle(this.s.set(0, 1, 0), 1.25 * Math.sin(k * 3.2) * ss(0.7, 1.1, k) * (1 - ss(2.6, 2.9, k)));
          this.b.applyQuaternion(this.q);
        }
        if (k < 0.05 && this.victim) this.dir.copy(this.b).normalize();
        this.dir.lerp(this.b.normalize(), 1 - Math.exp(-x.dt * 12)).normalize();
        out = this.c;
      }
      const was = this.b.set(0, 0, 1).applyQuaternion(root.quaternion);
      const turn = was.x * this.dir.z - was.z * this.dir.x;
      this.bank += ((this.lastTurn(x.dt) * 0.35 || turn * 0) - this.bank) * (1 - Math.exp(-x.dt * 6));
      root.position.copy(out);
      root.position.y += 0.08 * Math.sin(this.clock * 9);
      this.b.set(0, 1, 0).addScaledVector(this.dir, -this.dir.y).normalize();
      if (this.hitT < 0) v.torso.rotation.x = (-0.4 + 0.5 * Math.max(0, this.dir.y)) * ss(0.8, 0.3, this.shotT);
      if (this.hitT >= 0 && this.victim) v.torso.rotation.x = -0.5 * ss(0, 0.2, this.hitT) * (1 - ss(0.9, 1.4, this.hitT));
      this.a.crossVectors(this.b, this.dir).normalize();
      this.m.makeBasis(this.a, this.b, this.dir);
      root.quaternion.setFromRotationMatrix(this.m);
      this.turnQ.setFromAxisAngle(this.a.set(0, 0, 1), Math.max(-0.4, Math.min(0.4, this.bank * 0.6)));
      root.quaternion.multiply(this.turnQ);
      return;
    }
    if (this.hitT > HOME && this.hitT < HOME + 0.85) {
      // home from above
      const k = (this.hitT - HOME) / 0.85;
      const e = (1 - k) ** 2;
      root.position.addScaledVector(this.up, 1.7 * e).addScaledVector(this.fwd, -2.2 * e).addScaledVector(this.side, 1.2 * e);
    }
  }

  private readonly homeAt = new THREE.Vector3();
  /** How far from where the bee stands its scene is played (a flat place). */
  private readonly place = new THREE.Vector3();
  /** Its scene plays on a comb of light in the air. */
  private floating = false;
  private readonly wasDir = new THREE.Vector3();
  private lastTurn(dt: number): number {
    const w = this.wasDir;
    const turn = (w.x * this.dir.z - w.z * this.dir.x) / Math.max(1e-3, dt);
    w.copy(this.dir);
    return Math.max(-2.5, Math.min(2.5, turn));
  }

  private danceU(t: number): number {
    const u = Math.min(1, Math.max(0, (t - DANCE) / (DANCED - DANCE)));
    return u * u * (3 - 2 * u) * 0.35 + u * 0.65;
  }

  // ---------------------------------------------------------------- track and crown

  private onPlane(p: THREE.Vector3, out: THREE.Vector3, x: BowContext | null): THREE.Vector3 {
    out.copy(this.base).addScaledVector(this.side, p.x * this.room).addScaledVector(this.fwd, p.z * this.room);
    if (x) {
      const n = this.up;
      const h = x.ground.rest(out.x + n.x, out.y + n.y, out.z + n.z, -n.x, -n.y, -n.z, 2.2);
      if (h > 0 && Math.abs(h - 1) < 0.3) out.addScaledVector(n, 1 - h);
    }
    return out.addScaledVector(this.up, 0.09);
  }

  private readonly laid: THREE.Vector3[] = Array.from({ length: TRACK }, () => new THREE.Vector3());
  private laidCount = 0;

  private crownPlace(out: THREE.Vector3): THREE.Vector3 {
    const v = this.view as BugView;
    return out.set(0, v.headRadius * 1.22, -0.07).applyMatrix4(v.head.matrixWorld);
  }

  private placeTrack(x: BowContext, t: number): void {
    const on = this.sceneTime >= 0 && t > DANCE && t < CROWN + 0.18;
    this.track.mesh.visible = on;
    if (!on) {
      this.laidCount = 0;
      return;
    }
    const u = this.danceU(t);
    const want = Math.min(TRACK, Math.floor(u * (TRACK - 1)) + 1);
    const d = { p: this.c, yaw: 0, wag: 0 };
    while (this.laidCount < want) {
      const i = this.laidCount++;
      this.danceAt(i / (TRACK - 1), d);
      // (the waggle shows in the track)
      // (straight across, in zigzag)
      d.p.z += 0.16 * d.wag * Math.sin(i * 0.5);
      this.onPlane(d.p, this.laid[i], x);
    }
    const lift = ss(RISE - 0.05, CROWN, t);
    this.crownPlace(this.b);
    for (let i = 0; i < this.laidCount; i++) {
      const p = this.track.points[i].copy(this.laid[i]);
      if (lift <= 0) continue;
      // up round it, closer and closer, one after the other
      const k = ss(0, 1, (t - RISE + 0.05) / (CROWN - RISE) * 1.5 - 0.14 * (1 - i / TRACK));
      this.a.copy(p).sub(this.b);
      const h = this.a.dot(this.up);
      this.a.addScaledVector(this.up, -h);
      const far = this.a.length();
      this.a.normalize();
      this.turnQ.setFromAxisAngle(this.up, k * k * 7);
      this.a.applyQuaternion(this.turnQ);
      const ring = 0.78 - 0.34 * ss(0.8, 1, (t - RISE) / (CROWN - RISE));
      // (spread evenly, so the ring is whole)
      const even = ss(0.55, 0.85, k);
      if (even > 0) {
        this.tangentOf((i / (TRACK - 1)) * Math.PI * 2.04 + this.clock * 5, this.s);
        this.a.lerp(this.s, even).normalize();
      }
      const tip = -0.4 * k * k * this.a.dot(this.s.copy(x.camera.position).sub(this.b).normalize()) * ring;
      p.copy(this.b).addScaledVector(this.up, tip).addScaledVector(this.a, far + (ring - far) * ss(0, 0.85, k)).addScaledVector(this.up, h * (1 - k * k) + 0.62 * k * k * (1 - ss(0.82, 1, (t - RISE) / (CROWN - RISE))));
    }
    this.trackOver.value = 0.9 * ss(0.7, 0.95, lift);
    this.track.count = this.laidCount;
    this.trackHead.value = lift > 0 ? 2 : u;
    this.trackLevel.value = (1.1 - 0.35 * ss(DANCED - 0.1, DANCED + 0.1, t) + 0.8 * lift) * (1 - ss(CROWN, CROWN + 0.16, t));
    this.track.draw(x.camera.position, () => 0.2 - 0.11 * lift);
    // (sparks off the track)
    if (t < RISE && x.dt > 0) for (let n = 0; n < 3; n++) this.grain(this.laid[Math.max(0, this.laidCount - 1)], 0.9, 0.8, false, 0.11);
    else if (t >= RISE && t < CROWN) for (let n = 0; n < 2; n++) this.grain(this.track.points[Math.floor(Math.random() * this.laidCount)], 0.7, 0.6, false, 0.1);
  }

  private placeFloor(t: number): void {
    const home = this.hitT > HOME;
    const struck = this.hitT >= 0 && !home && this.victim !== null;
    const on = struck || this.sceneTime >= 0 || home || (this.shotT >= 0 && this.shotT < PAST + 0.5);
    this.floor.visible = on;
    this.disc.visible = false;
    // (in the air there is no ground under its light)
    this.floorIn.value.copy(this.base);
    this.floorY.value.copy(this.up);
    if (this.shotT >= PAST && !home) this.floorIn.value.y = -999;
    if (!on) return;
    const beat = (Math.max(0, t) - DANCE) / ((RISE - DANCE) / 4);
    this.floorAt.value = t < RISE ? (beat % 1) * 6.5 : t < CROWN ? 6 * (1 - ss(RISE, CROWN, t)) : (t - CROWN) * 9;
    this.floorLevel.value = this.shotT >= 0 && !home ? 1.8 * Math.exp(-this.shotT * 1.5) : home ? 0.9 * ss(HOME, HOME + 0.4, this.hitT) : (0.5 + 0.45 * ss(DANCE - 0.2, DANCE + 0.3, t)) * ss(0.02, 0.2, t) * (1 - 0.7 * ss(BURST + 0.6, BURST + 1.3, t));
    if (home) this.floorAt.value = ((this.hitT - HOME) * 5) % 8;
    else if (this.shotT >= 0) this.floorAt.value = this.shotT * 16;
    this.floor.position.copy(this.base);
    this.disc.visible = this.floating && (this.sceneTime >= 0 || home);
    this.disc.position.copy(this.base);
    this.disc.scale.setScalar(this.sceneTime >= 0 ? 1 : 0.4 + 0.6 * ss(HOME, HOME + 0.35, this.hitT));
    this.m.makeBasis(this.side, this.up, this.fwd);
    this.disc.quaternion.setFromRotationMatrix(this.m);
    this.floorX.value.copy(this.side);
    this.floorZ.value.copy(this.fwd);
    if (struck) {
      this.floorIn.value.copy(this.hit);
      this.floorIn.value.y -= 1;
      this.floorY.value.set(0, 1, 0);
      this.floor.position.copy(this.floorIn.value);
      this.floorLevel.value = 0.75 * ss(0.5, 1.2, this.hitT);
      this.floorAt.value = (this.hitT * 5) % 8;
    }
    const v = this.view as BugView;
    this.a.copy(v.root.position).sub(this.base);
    this.floorBee.value.set(this.a.dot(this.side), this.a.dot(this.fwd));
  }

  private tangentOf(an: number, out: THREE.Vector3): void {
    out.copy(this.side).multiplyScalar(Math.cos(an)).addScaledVector(this.fwd, Math.sin(an));
  }

  private crowned = false;

  private placeCrown(x: BowContext, t: number): void {
    const v = this.view as BugView;
    const gone = ss(HOME + 1.75, HOME + 2.1, this.hitT);
    const k = this.sceneTime >= 0 ? ss(CROWN - 0.04, CROWN + 0.12, t) : 1 - gone;
    if (gone > 0 && gone < 1) for (let n = 0; n < 8; n++) this.grain(this.crown.position, 4.2, 1.3, false, 0.1).v.y += 1.4;
    const on = k > 0.01;
    this.crown.visible = on;
    this.halo.visible = on || this.sceneTime >= 0;
    if (!on) {
      this.crowned = false;
      // (a haze behind it from the first)
      this.halo.position.copy(v.root.position).addScaledVector(this.up, 1).addScaledVector(this.b.copy(v.root.position).sub(x.camera.position).normalize(), 3);
      this.halo.quaternion.copy(x.camera.quaternion);
      this.halo.scale.setScalar(12);
      this.haloLevel.value = this.sceneTime >= 0 ? 0.2 * ss(0, 0.3, t) : 0.2;
      return;
    }
    if (!this.crowned && this.sceneTime >= 0) {
      this.crowned = true;
      this.crownPlace(this.a);
      // (behind it: a picture frame, not a net over it)
      this.b.copy(this.a).sub(x.camera.position).normalize();
      this.wave(this.c.copy(this.a).addScaledVector(this.b, 1.9), 7, 0.75, false);
      for (let i = 0; i < 60; i++) this.grain(this.a, 3.4, 0.9, false, 0.16);
    }
    this.crownPlace(this.crown.position);
    this.q.setFromAxisAngle(this.a.set(0, 1, 0), this.clock * 0.9);
    v.head.getWorldQuaternion(this.crown.quaternion).multiply(this.q);
    const over = this.sceneTime >= 0 ? 1 + 0.5 * Math.exp(-(((t - CROWN - 0.1) / 0.08) ** 2)) : 1;
    this.crown.scale.setScalar(k * over * v.headRadius * 2.75);
    const flare = this.sceneTime >= 0 ? Math.exp(-Math.max(0, t - CROWN) * 3) : 0;
    this.glint.value = this.sceneTime >= 0 ? -1.2 + 2.4 * ss(CROWN + 0.25, CROWN + 0.75, t) : this.hitT > HOME ? -1.2 + 2.4 * ss(HOME + 0.9, HOME + 1.4, this.hitT) : 2;
    this.crownGlow.value = 0.35 + 0.12 * Math.sin(this.clock * 3) + 1.4 * flare + this.boost;
    this.halo.position.copy(this.crown.position).addScaledVector(this.b.copy(this.crown.position).sub(x.camera.position).normalize(), 3);
    this.halo.quaternion.copy(x.camera.quaternion);
    if (this.hitT >= 0 && this.hitT < HOME && this.victim) {
      this.halo.position.copy(this.hit).addScaledVector(this.b.copy(this.hit).sub(x.camera.position).normalize(), 5);
      this.haloFrom.value.y = -999;
    } else this.haloFrom.value.copy(this.base);
    const big = this.sceneTime >= 0 ? ss(BURST, BURST + 0.3, t) : this.hitT > HOME ? ss(HOME, HOME + 0.6, this.hitT) : 0;
    this.halo.scale.setScalar(3 + 3.4 * flare + 1.6 * this.boost + 11 * big);
    if (this.hitT >= 0 && this.hitT < HOME && this.victim) this.halo.scale.setScalar(24);
    if (this.shotT >= 0 && this.shotT < PAST) this.halo.scale.setScalar(7);
    this.haloLevel.value = (this.hitT >= 0 && this.hitT < HOME ? 0.4 : 0.24) + 1.1 * flare + 0.3 * this.boost + 0.16 * big;
  }

  // ---------------------------------------------------------------- the swarm

  private remember(): void {
    const h = this.history;
    if (this.historyCount > 0 && h[0].distanceTo(this.head) < 0.22) return;
    const last = h.pop() as THREE.Vector3;
    last.copy(this.head);
    h.unshift(last);
    this.historyCount = Math.min(h.length, this.historyCount + 1);
  }

  /** Its way, so far behind its head. */
  private behind(far: number, out: THREE.Vector3): THREE.Vector3 {
    if (far <= 0) return out.copy(this.head).addScaledVector(this.dir, -far);
    let l = far;
    let p = this.head;
    for (let i = 0; i < this.historyCount; i++) {
      const q = this.history[i];
      const d = p.distanceTo(q);
      if (d >= l) return out.lerpVectors(p, q, d > 0 ? l / d : 0);
      l -= d;
      p = q;
    }
    // (before it set out: on, straight back)
    return out.copy(p).addScaledVector(this.dir, -l);
  }

  private placeSwarm(x: BowContext, t: number): void {
    const special = this.sceneTime >= 0;
    const on = (special ? t > BURST - 0.05 : true) && this.hitT < AFTER;
    this.bees.visible = this.wings.visible = on;
    if (!on) return;
    const { dt } = x;
    const stance = !special && this.shotT < 0;
    const v = this.view as BugView;
    const rings = x.match.flock?.rings ?? [];
    const nextRing = rings.find((r) => !r.taken);
    for (let i = 0; i < SWARM; i++) {
      const o = this.ones[i];
      const there = i < this.swarm || special;
      const r0 = rnd(i + 11);
      const r1 = rnd(i + 57);
      const w = (0.7 + 0.8 * r0) * (i % 2 ? 1 : -1);
      const goal = this.a;
      let rate = 6;
      let scale = there ? 1 : 0;
      const home = this.hitT > HOME - 0.2;
      if (home) {
        // in from behind it, a fan over it, and out of the picture
        const k = ss(HOME, HOME + 0.8, this.hitT - 0.3 * r0);
        const u = (i >> 1) / (SWARM / 2);
        const arm = i % 2 ? 1 : -1;
        const an = Math.PI / 2 - arm * (0.35 + u * 3.1 + 0.12 * Math.sin(this.clock * 1.1) + 1.6 * (1 - k));
        const ring = 1.3 + 4.6 * u;
        this.b.set(Math.cos(an) * ring, 2.5 + Math.max(-1.9, Math.sin(an) * ring * 0.75), -0.8 - 1.6 * u - 9 * (1 - k));
        this.b.x += 0.12 * Math.sin(this.clock * 2.3 * w + i);
        this.b.y += 0.12 * Math.sin(this.clock * 2.9 + i * 1.7);
        goal.copy(this.base).addScaledVector(this.side, this.b.x).addScaledVector(this.up, this.b.y + 4 * (1 - k)).addScaledVector(this.fwd, this.b.z);
        const into = u < 0.32 ? ss(HOME + 1.25 + u * 1.6, HOME + 1.75 + u * 1.6, this.hitT) : 0;
        if (into > 0) {
          this.crownPlace(this.c);
          goal.lerp(this.c, into);
          scale *= 1 - ss(0.75, 1, into);
        }
        if (this.hitT < HOME + 0.06 && o.at.distanceTo(goal) > 6) o.at.copy(goal);
        rate = 7;
      } else if (this.hitT >= 0) {
        const k = this.hitT;
        const an = i * 2.39996 + (1 - 2 * (i % 2)) * 0 + k * (7.5 - 2.4 * r0);
        if (this.victim) {
          // a tight ball round it; it bursts open as the harm shows; then up and away
          const open = ss(1.05, 1.5, k);
          const lane = i % 4;
          this.b.copy(x.camera.position).sub(this.hit).setY(0).normalize();
          const behind = Math.atan2(-this.b.x, -this.b.z);
          const u = ((i >> 2) / Math.ceil(this.swarm / 4) + k * (0.11 - 0.015 * lane) * (lane % 2 ? -1 : 1) + 4) % 1;
          const round = behind + (u - 0.5) * Math.PI * 2 * (0.42 + 0.3 * ss(0.3, 0.9, k));
          const wide = (2.9 + 0.5 * lane) * (1 + 0.5 * open) + 0.8 * ss(0.4, 0, k);
          goal.set(Math.sin(round) * wide, 0.25 + 0.5 * lane + 0.25 * Math.sin(round * 3 + i) + 8 * ss(2.2, 3.1, k), Math.cos(round) * wide);
          // (lower before it, higher behind)
          goal.y -= 0.3 * (goal.x * this.b.x + goal.z * this.b.z);
          scale *= ss(0, 0.07, u) * ss(1, 0.93, u);
          goal.add(this.hit);
        } else {
          // all over the place, dizzy, then together again
          const wide = 3.2 * ss(0, 0.5, k) * (1 - 0.5 * ss(1.6, 2.4, k));
          goal.set(Math.sin(an * 0.3 + i) * wide, 0.4 + 2.2 * (r1 - 0.35) + 0.4 * Math.sin(k * 6 + i) + 6 * ss(2.4, 3.1, k), Math.cos(an * 0.3 + i) * wide).add(this.hit);
        }
        if (this.victim) {
          this.b.copy(x.camera.position).sub(this.hit);
          const l = this.b.length();
          this.b.divideScalar(l);
          this.c.copy(goal).sub(this.hit);
          const front = this.c.dot(this.b);
          // (behind, beside and over them)
          if (front > 1.4) goal.addScaledVector(this.b, 1.4 - front);
          this.s.copy(v.root.position);
          const dq = goal.distanceTo(this.s);
          if (dq < 2.2) goal.addScaledVector(this.c.copy(goal).sub(this.s).normalize(), 2.2 - dq).addScaledVector(this.b, -0.5);
          const dv = goal.distanceTo(this.hit);
          if (dv < 2.1) goal.addScaledVector(this.c.copy(goal).sub(this.hit).normalize(), 2.1 - dv);
        }
        // (there at once: the picture cuts)
        if (k < 0.05 && this.victim) o.at.copy(goal);
        rate = k < 1.05 ? 20 : 10;
        scale *= 1 - ss(2.75, 3.05, k);
      } else if (this.shotT >= 0) {
        // a wedge behind it, out to the sides: never between it and the view
        const row = (i >> 1) % 9;
        const layer = Math.floor((i >> 1) / 9);
        const s = i % 2 ? 1 : -1;
        this.behind(0.5 + 0.5 * row + 0.25 * layer + 2.6 * ss(0.9, 0.3, this.shotT), goal);
        this.b.crossVectors(this.dir, this.s.set(0, 1, 0)).normalize();
        this.c.crossVectors(this.b, this.dir);
        const sway = 0.22 * Math.sin(this.clock * 3.1 * w + i * 1.7);
        goal.addScaledVector(this.b, s * (1.5 + 0.28 * row + 0.45 * layer) + sway).addScaledVector(this.c, (-0.75 + 0.62 * ((layer * 2) % 5) * 0.8) * ss(0.2, 0.9, this.shotT) - 0.7 * ss(0.9, 0.3, this.shotT) + 0.25 * Math.cos(this.clock * 3.7 + i * 2.3));
        rate = 15;
      } else {
        // a fan behind it; while it aims, to both sides
        const k = special ? ss(BURST, BURST + 0.32 + 0.75 * r1, t - 0.2 * r0) : 1;
        const s = i % 2 ? 1 : -1;
        const j = Math.floor(i / 2) % 14;
        const open = stance ? 1 : 0;
        const ring = 1.2 + 4.2 * Math.sqrt((i + 0.5) / SWARM) * (0.8 + 0.4 * r0);
        // (out of it in a spiral)
        const an = i * 2.39996 + 2.6 * (1 - k);
        this.b.set(Math.cos(an) * ring, 2.2 + (Math.sin(an) < -0.2 ? -0.35 - 0.8 * r1 : Math.sin(an) * ring * 0.85), -3 + 2.6 * (i % 3) + 0.8 * r1 - (i % 3 === 2 ? 1 : 0));
        // (past the view, some of them)
        if (special && i < 4) {
          const past = ss(BURST + 0.08 + 0.13 * i, BURST + 0.95 + 0.13 * i, t);
          this.c.copy(x.camera.position).sub(this.base);
          this.b.set(this.c.dot(this.side) + (i % 2 ? 1 : -1) * (0.7 + 0.12 * i), this.c.dot(this.up) + 0.5 * (r1 - 0.5), this.c.dot(this.fwd) - 3.6 + 0 * ss(0.7, 1, past)).multiplyScalar(past);
        }
        this.c.set(s * (1.8 + 0.34 * (j % 7)), 0.9 + 0.2 * (j % 7) + (j >= 7 ? 0.75 : 0), -0.1 - 0.3 * (j % 7));
        this.b.lerp(this.c, open);
        this.b.x += 0.25 * Math.sin(this.clock * 2.1 * w + i);
        this.b.y += 0.22 * Math.sin(this.clock * 2.7 + i * 1.7);
        goal.copy(this.base).addScaledVector(this.side, this.b.x * k).addScaledVector(this.up, 0.8 + (this.b.y - 0.8) * k).addScaledVector(this.fwd, this.b.z * k);
        // (not into what stands there)
        this.c.copy(goal).sub(this.at);
        const l = this.c.length();
        if (l > 0.5 && (i + Math.floor(this.clock * 60)) % 12 === 0) {
          this.c.divideScalar(l);
          const hit = x.ground.raycast(this.at.x, this.at.y, this.at.z, this.c.x, this.c.y, this.c.z, l + 0.4);
          this.short[i] = hit >= 0 ? Math.max(0.15, (hit - 0.5) / l) : 1;
        }
        this.c.copy(goal).sub(this.at);
        goal.copy(this.at).addScaledVector(this.c, this.short[i]);
        // (two arms, whole ones only)
        if (stance) scale *= i < 28 && Math.min(this.short[i], this.short[i ^ 1]) > 0.85 ? 1 : 0;
        scale *= special ? k > 0.02 ? Math.min(1, k * 3) : 0 : 1;
        if (special && k < 0.03) o.at.copy(this.at);
        rate = special ? 9 : 5;
      }
      if (o.size < 0.01 && this.shotT < 0) o.at.copy(goal);
      const e = 1 - Math.exp(-dt * rate);
      this.b.copy(o.at);
      o.at.lerp(goal, e);
      this.b.subVectors(o.at, this.b).divideScalar(Math.max(1e-4, dt));
      o.v.lerp(this.b, 1 - Math.exp(-dt * 8));
      if (special && t > BURST + 0.2) {
        this.b.copy(o.at).sub(v.root.position);
        const d = this.b.length();
        if (d < 2.9 && d > 0.01) o.at.addScaledVector(this.b, ((2.9 - d) / d) * (1 - Math.exp(-dt * 12)));
      }
      // (as it sets out: well behind its sting)
      if (this.shotT >= 0 && this.hitT < 0 && this.shotT < 1) scale *= ss(2.6, 4, o.at.distanceTo(v.root.position)) * (this.shotT < PAST && i >= 24 ? 0 : 1);
      // (none in the lens; fewer before the ring it flies to)
      const eye = o.at.distanceTo(x.camera.position);
      scale *= special ? ss(0.5, 1.1, eye) : ss(4, 5.8, eye) * (this.flies && i % 3 === 0 ? ss(5.5, 8, eye) : 1);
      if (nextRing && this.shotT >= 0 && i % 5 < 3) {
        this.b.set(nextRing.x, nextRing.y, nextRing.z).sub(x.camera.position);
        const far = this.b.length();
        this.c.copy(o.at).sub(x.camera.position);
        const cos = this.b.dot(this.c) / (far * Math.max(0.1, eye));
        if (eye < far) scale *= 1 - ss(Math.cos(0.1 + 2.6 / far), Math.cos(1.6 / far), cos);
      }
      o.size += (scale - o.size) * (1 - Math.exp(-dt * 9));
      // ---- it faces the way it flies; waiting, the way the bee does
      const speed = o.v.length();
      const back = this.hitT > HOME;
      this.b.copy(stance || special || back ? this.fwd : this.dir).multiplyScalar(special ? 0.1 + 1.5 * ss(BURST + 0.6, BURST + 1.1, t) : back ? 2.5 : this.hitT >= 0 ? 0 : 1.6);
      if (speed > 0.1 && !stance) this.b.add(o.v);
      // (out of it, each on its own way)
      if (special && t < BURST + 0.75) this.b.copy(o.at).sub(this.at).normalize();
      // (round what it struck: they look at it)
      if (this.hitT >= 0 && this.hitT < 2.2 && this.victim) {
        this.b.copy(this.hit).sub(o.at).normalize();
        this.b.x += 0.9 * (r0 - 0.5);
        this.b.z += 0.9 * (r1 - 0.5);
      }
      this.b.y *= 0.6;
      if (this.b.lengthSq() > 1e-4) o.face.lerp(this.b.normalize(), 1 - Math.exp(-dt * 9)).normalize();
      this.c.set(0, 1, 0).addScaledVector(o.face, -o.face.y).normalize();
      this.a.crossVectors(this.c, o.face).normalize();
      this.m.makeBasis(this.a, this.c, o.face);
      this.q.setFromRotationMatrix(this.m);
      this.m.compose(o.at, this.q, this.s.setScalar(Math.max(0.0001, (o.size < 0.3 ? 0 : o.size) * SIZE * (0.75 + 0.55 * r1))));
      this.bees.setMatrixAt(i, this.m);
      this.m.compose(o.at, this.q, this.s.setScalar(Math.max(0.0001, ss(0.35, 0.9, o.size) * SIZE * (0.75 + 0.55 * r1))));
      this.wings.setMatrixAt(i, this.m);
    }
    // (none before another, as the picture shows them: the one behind steps aside)
    if (special || (this.hitT >= 0 && this.hitT < HOME + 2)) {
      this.b.set(1, 0, 0).applyQuaternion(x.camera.quaternion);
      this.c.set(0, 1, 0).applyQuaternion(x.camera.quaternion);
      x.camera.getWorldDirection(this.s);
      for (let i = 0; i < SWARM; i++) {
        const p = this.a.copy(this.ones[i].at).sub(x.camera.position);
        const z = Math.max(0.5, p.dot(this.s));
        this.flatX[i] = p.dot(this.b) / z;
        this.flatY[i] = p.dot(this.c) / z;
        this.flatZ[i] = z;
      }
      const ease = 1 - Math.exp(-dt * 14);
      for (let i = 0; i < SWARM; i++)
        for (let j = i + 1; j < SWARM; j++) {
          const back = this.flatZ[i] > this.flatZ[j] ? i : j;
          const fore = back === i ? j : i;
          const need = (0.62 / this.flatZ[fore] + 0.62 / this.flatZ[back]) * 0.5;
          const dx = this.flatX[back] - this.flatX[fore];
          const dy = this.flatY[back] - this.flatY[fore];
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= need || d < 1e-5) continue;
          const k = ((need - d) / d) * this.flatZ[back] * ease;
          this.ones[back].at.addScaledVector(this.b, dx * k).addScaledVector(this.c, dy * k);
        }
    }
    // (room between them)
    for (let i = 0; i < SWARM; i++) {
      const p = this.ones[i].at;
      for (let j = i + 1; j < SWARM; j++) {
        const q = this.ones[j].at;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        const dz = p.z - q.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 0.9 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const k = ((0.95 - d) / d) * 0.25;
        p.set(p.x + dx * k, p.y + dy * k, p.z + dz * k);
        q.set(q.x - dx * k, q.y - dy * k, q.z - dz * k);
      }
    }
    if (special && t > BURST && t < BURST + 0.8 && dt > 0) for (let n = 0; n < 7; n++) this.grain(this.ones[Math.floor(Math.random() * SWARM)].at, 0.4, 0.7, false, 0.15);
    this.bees.instanceMatrix.needsUpdate = this.wings.instanceMatrix.needsUpdate = true;
  }
  private readonly flatX = new Float32Array(SWARM);
  private readonly flatY = new Float32Array(SWARM);
  private readonly flatZ = new Float32Array(SWARM);
  private readonly short = new Float32Array(SWARM).fill(1);

  private placeWake(x: BowContext): void {
    const on = this.shotT >= 0 && this.hitT < 1;
    for (const w of this.wake) w.mesh.visible = on;
    if (!on) return;
    this.wakeLevel.value = (0.55 + 0.5 * this.boost) * (this.hitT >= 0 ? 1 - ss(0, 0.16, this.hitT) : ss(0.05, 0.35, this.shotT));
    const rich = this.swarm / SWARM;
    this.wake.forEach((w, k) => {
      w.count = WAKE;
      for (let i = 0; i < WAKE; i++) {
        // (smoothed: the corners of its way do not show)
        this.behind(0.5 + i * 0.28, w.points[i]);
        w.points[i].add(this.behind(0.9 + i * 0.28, this.a)).add(this.behind(1.4 + i * 0.28, this.a)).multiplyScalar(1 / 3);
        // (it sways)
        this.b.crossVectors(this.dir, this.s.set(0, 1, 0)).normalize();
        w.points[i].addScaledVector(this.b, 0.3 * (i / WAKE) * Math.sin(i * 0.2 - this.clock * 4));
        w.points[i].y += 0.22 * (i / WAKE) * Math.cos(i * 0.17 - this.clock * 3.1);
        if (k === 0) continue;
        const an = i * 0.34 - this.clock * 5 + k * Math.PI;
        const wide = 0.75 * Math.min(1, i / 8) * (0.7 + 0.6 * rich);
        this.b.crossVectors(this.dir, this.s.set(0, 1, 0)).normalize();
        w.points[i].addScaledVector(this.b, Math.cos(an) * wide);
        w.points[i].y += Math.sin(an) * wide;
      }
      w.draw(x.camera.position, (u) => (k === 0 ? 0.25 * (1 - u) ** 0.8 : 0.11 * (1 - u)) * (0.75 + 0.5 * rich));
    });
    if (this.hitT < 0 && x.dt > 0) {
      const g = this.grain(this.behind(1 + 3 * Math.random(), this.c), 1, 0.8, false, 0.14);
      g.v.addScaledVector(this.dir, -1);
    }
  }

  // ---------------------------------------------------------------- rings, waves, pollen

  private placeRings(x: BowContext, t: number): void {
    const rings = x.match.flock ? x.match.flock.rings : x.match.rings;
    const show = this.sceneTime >= 0 ? 0 : this.hitT >= 0 ? 0 : 1;
    const next = rings.findIndex((r, i) => !r.taken && !rings.some((q, k) => k > i && q.taken));
    this.rings.forEach((r, i) => {
      const d = rings[i];
      const on = show > 0.01 && (next < 0 || i <= next + (this.shotT >= 0 ? 1 : 0)) && d !== undefined && (!d.taken || (r.t >= 0 && r.t < 0.5));
      const burst = r.t >= 0 && r.t < 0.5;
      if (r.t >= 0) r.t += x.dt;
      // (not between the view and the one that sets out)
      r.film.visible = r.torus.visible = (on || burst) && !(this.shotT >= 0 && this.shotT < PAST && this.hitT < 0);
      const past = rings.some((q, k) => k > i && q.taken);
      const near = r.film.position.distanceTo(x.camera.position);
      r.no.visible = r.film.visible && on && !burst && !past && near > 8 && (i === next || this.shotT < 0);
      if (r.no.visible) {
        // (none on top of another)
        this.c.copy(r.no.position).project(x.camera);
        for (let k = 0; k < i; k++) {
          const q = this.rings[k].no;
          if (q.visible && Math.hypot(q.userData.sx - this.c.x, q.userData.sy - this.c.y) < 0.09) r.no.visible = false;
        }
        r.no.userData.sx = this.c.x;
        r.no.userData.sy = this.c.y;
      }
      if (!r.film.visible) return;
      if (d) {
        this.a.set(d.x, d.y, d.z);
        r.film.position.copy(this.a);
        r.torus.position.copy(this.a);
        r.no.position.copy(this.a).addScaledVector(this.b.set(0, 1, 0).applyQuaternion(x.camera.quaternion), RING_RADIUS * 1.55);
        r.no.quaternion.copy(x.camera.quaternion);
        r.no.scale.setScalar(0.5 + 0.022 * this.a.distanceTo(x.camera.position));
        this.q.setFromUnitVectors(this.b.set(0, 0, 1), this.c.set(d.nx, d.ny, d.nz).normalize());
        r.film.quaternion.copy(this.q);
        r.torus.quaternion.copy(this.q).multiply(this.turnQ.setFromAxisAngle(this.b, this.clock * 0.7 * (i % 2 ? 1 : -1)));
      }
      const u = burst ? r.t / 0.5 : 0;
      const pop = this.sceneTime >= 0 ? ss(0, 0.4, show * 1.6 - i * 0.14) * (1 + 0.25 * Math.sin(Math.PI * ss(0, 1, show))) : 1;
      const breathe = 1 + (i === next ? 0.04 * Math.sin(this.clock * 6) : 0);
      r.torus.scale.setScalar(Math.max(0.001, RING_RADIUS * 0.92 * pop * breathe * (1 + 0.5 * u) * (burst ? 1 - u * u : 1)));
      r.film.scale.setScalar(Math.max(0.001, RING_RADIUS * 0.92 * 3 * pop * breathe * (1 + 1.1 * u)));
      r.next.value += ((i === next || burst ? 1 : 0) - r.next.value) * (1 - Math.exp(-x.dt * 8));
      r.level.value = pop * (i === next ? 1 : past ? 0.15 : 0.75) * (burst ? 1.3 * (1 - u) ** 2 : 1) * (0.35 + 0.65 * ss(1.5, 9, r.film.position.distanceTo(x.camera.position))) * (this.shotT >= 0 ? 0.4 + 0.6 * ss(1, 4.5, r.film.position.distanceTo(this.head)) : 1);
      // (what hides it dims it, but not one that is near)
      r.through.value = 0.75 * ss(9, 15, near);
      // (not burnt out where it is close)
      r.solid.value = (i === next || burst ? 1.1 : 0.6) * ss(1.5, 9, r.film.position.distanceTo(x.camera.position));
    });
  }

  private readonly path: THREE.Vector3[] = Array.from({ length: RINGS + 2 }, () => new THREE.Vector3());

  /** The way on, in dots; an arrow to what is out of the picture; whom it would strike; streaks. */
  private placeGuides(x: BowContext): void {
    const { match, camera } = x;
    const f = match.flock;
    const aiming = this.sceneTime < 0 && this.shotT < 0;
    const flying = f !== null && this.shotT >= PAST;
    const on = aiming || flying;
    this.target.renderOrder = 13;
    this.dots.visible = on;
    this.target.visible = on;
    this.arrow.visible = this.streaks.visible = false;
    if (!on) return;
    const from = f ? this.head : this.at;
    // ---- the nearest enemy
    let foe: BugView | null = null;
    let best = 1e9;
    for (const u of match.units) {
      if (u.team === match.activeUnit.team || !u.bug.alive) continue;
      const d = x.views[u.id].root.position.distanceTo(from);
      if (d >= best) continue;
      best = d;
      foe = x.views[u.id];
      this.tone.setHex(match.teams[u.team].color);
      this.foe.set(this.tone.r, this.tone.g, this.tone.b).multiplyScalar(1.5);
    }
    // ---- its way
    const path = this.path;
    let n = 0;
    path[n++].copy(from);
    const all = f ? f.rings : match.rings;
    for (const r of all) if (!r.taken && n <= RINGS && !all.some((q, k) => k > all.indexOf(r) && q.taken)) path[n++].set(r.x, r.y, r.z);
    const goal = n > 1 ? path[1] : foe ? foe.root.position : from;
    if (foe) path[n++].copy(foe.root.position);
    let long = 0;
    for (let i = 1; i < n; i++) long += path[i].distanceTo(path[i - 1]);
    const gap = Math.max(1.1, long / DOTS);
    const drift = (this.clock * 2.2) % gap;
    let k = 1;
    let done = 0;
    for (let i = 0; i < DOTS; i++) {
      let l = i * gap + drift + 1.6;
      let level = 0;
      if (l < long) {
        while (k < n - 1 && done + path[k].distanceTo(path[k - 1]) < l) done += path[k].distanceTo(path[k++ - 1]);
        const seg = path[k].distanceTo(path[k - 1]) || 1;
        // (round the corners)
        const u = Math.min(1, (l - done) / seg);
        catmull(path[Math.max(0, k - 2)], path[k - 1], path[k], path[Math.min(n - 1, k + 1)], u, this.a);
        l = this.a.distanceTo(camera.position);
        level = (k === 1 ? 0.85 : 0.4) * ss(2.5, 5, l);
      }
      this.m.compose(this.a, camera.quaternion, this.s.setScalar(level > 0.01 ? 0.16 + 0.004 * l : 0.0001));
      this.dots.setMatrixAt(i, this.m);
      this.dotLevel.setX(i, level);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    this.dotLevel.needsUpdate = true;
    // ---- whom
    this.target.visible = foe !== null;
    if (foe) {
      this.target.position.copy(foe.root.position);
      this.target.quaternion.copy(camera.quaternion).multiply(this.turnQ.setFromAxisAngle(this.s.set(0, 0, 1), this.clock * 0.6));
      const d = foe.root.position.distanceTo(camera.position);
      this.target.scale.setScalar((3.4 + 0.035 * d) * (1 + 0.05 * Math.sin(this.clock * 5)));
      // (not on the ring it flies to)
      this.a.copy(foe.root.position).project(camera);
      this.b.copy(goal).project(camera);
      this.targetLevel.value = n > 2 && Math.hypot(this.a.x - this.b.x, this.a.y - this.b.y) < 0.14 ? 0.35 : 1;
    }
    if (!flying) return;
    // ---- an arrow before it, when what is next is out of the picture
    this.a.copy(goal).project(camera);
    const out = this.a.z > 1 || Math.abs(this.a.x) > 0.92 || Math.abs(this.a.y) > 0.78;
    this.arrow.visible = out && this.hitT < 0;
    if (out) {
      // (on an oval round the bee, in the picture's plane)
      this.q.copy(camera.quaternion).invert();
      this.b.copy(goal).sub(this.head).applyQuaternion(this.q);
      const an = Math.atan2(this.b.y, this.b.x);
      this.arrow.position.set(Math.cos(an) * 3.1, Math.sin(an) * 2.3, 0).applyQuaternion(camera.quaternion).add(this.head);
      this.arrow.quaternion.copy(camera.quaternion).multiply(this.turnQ.setFromAxisAngle(this.s.set(0, 0, 1), an));
      this.arrow.scale.setScalar(1.25 + 0.12 * Math.sin(this.clock * 9));
    }
    // ---- streaks past the view
    this.streakLevel.value = 0.1 + 0.55 * this.boost;
    this.streaks.visible = true;
    camera.getWorldDirection(this.c);
    for (let i = 0; i < STREAKS; i++) {
      const an = rnd(i) * Math.PI * 2;
      const far = 2.6 + 3.4 * rnd(i + 90);
      const z = 22 - ((this.clock * (26 + 14 * rnd(i + 40)) + 30 * rnd(i + 70)) % 24);
      this.a.set(Math.cos(an) * far, Math.sin(an) * far, 0).applyQuaternion(camera.quaternion).addScaledVector(this.c, z).add(camera.position);
      // (along the way, its face to the view)
      this.b.copy(this.a).sub(camera.position).cross(this.c).normalize();
      this.s.crossVectors(this.b, this.c);
      this.m.makeBasis(this.b, this.c, this.s);
      this.q.setFromRotationMatrix(this.m);
      this.m.compose(this.a, this.q, this.s.set(0.02, 2.2, 1));
      this.streaks.setMatrixAt(i, this.m);
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }
  private readonly tone = new THREE.Color();

  private placeShards(x: BowContext): void {
    const k = this.hitT;
    this.star.visible = k >= 0 && k < 0.42;
    if (this.star.visible) {
      this.b.copy(x.camera.position).sub(this.hit).normalize();
      this.star.position.copy(this.hit).lerp((this.view as BugView).root.position, this.victim ? 0.55 : 0).addScaledVector(this.b, -0.6);
      this.star.quaternion.copy(x.camera.quaternion);
      this.star.scale.setScalar(8 + 10 * ss(0, 0.3, k));
      this.starLevel.value = (this.victim ? 1.2 : 0.5) * (1 - ss(0.03, 0.3, k));
    }
    let any = false;
    for (let i = 0; i < SHARDS; i++) {
      const b = this.bits[i];
      b.t += x.dt;
      const live = b.t < 1.5;
      any ||= live;
      if (live) {
        b.v.multiplyScalar(Math.exp(-x.dt * 1.3));
        b.v.y -= x.dt * 9;
        b.at.addScaledVector(b.v, x.dt);
      }
      this.q.setFromAxisAngle(b.axis, b.t * 7 + i);
      this.m.compose(b.at, this.q, this.s.setScalar(live ? Math.max(0.0001, b.size * ss(1.5, 1, b.t) * ss(1.3, 2.4, b.at.distanceTo(this.hit) + 0.8 * Math.max(0, this.hit.y - b.at.y))) : 0.0001));
      this.shards.setMatrixAt(i, this.m);
    }
    this.shards.visible = any;
    this.shards.instanceMatrix.needsUpdate = true;
  }

  private wave(at: THREE.Vector3, size: number, life: number, flat: boolean): void {
    const w = this.waves.reduce((p, q) => (q.t / q.life > p.t / p.life ? q : p));
    w.t = 0;
    w.life = life;
    w.size = size;
    w.flat = flat;
    w.mesh.position.copy(at);
  }

  private placeWaves(x: BowContext): void {
    for (const w of this.waves) {
      w.t += x.dt;
      const u = w.t / w.life;
      w.mesh.visible = u < 1;
      if (!w.mesh.visible) continue;
      if (w.flat) w.mesh.quaternion.setFromAxisAngle(this.a.set(1, 0, 0), -Math.PI / 2);
      else w.mesh.quaternion.copy(x.camera.quaternion);
      w.mesh.scale.setScalar(1.5 * w.size * (0.12 + 0.88 * (1 - (1 - u) ** 3)));
      w.level.value = 1.5 * (1 - u) ** 2;
    }
  }

  private grain(at: THREE.Vector3, speed: number, life: number, home: boolean, size = 0.2): Grain {
    const g = this.dust[this.nextGrain];
    this.nextGrain = (this.nextGrain + 1) % GRAINS;
    g.at.copy(at);
    const y = Math.random() * 2 - 1;
    const an = Math.random() * Math.PI * 2;
    const c = Math.sqrt(1 - y * y);
    g.v.set(Math.cos(an) * c, y, Math.sin(an) * c).multiplyScalar(speed * (0.25 + 0.75 * Math.random()));
    g.t = 0;
    g.life = life * (0.5 + 0.5 * Math.random());
    g.size = size * (0.5 + Math.random());
    g.home = home;
    return g;
  }

  private placeGrains(x: BowContext): void {
    this.grains.visible = true;
    const drag = Math.exp(-x.dt * 2.4);
    for (let i = 0; i < GRAINS; i++) {
      const g = this.dust[i];
      g.t += x.dt;
      const u = g.t / g.life;
      const live = u < 1;
      if (live) {
        g.v.multiplyScalar(drag);
        g.v.y -= x.dt * 0.6;
        if (g.home) g.at.lerp(this.head, 1 - Math.exp(-x.dt * 9 * u));
        g.at.addScaledVector(g.v, x.dt);
      }
      this.m.compose(g.at, x.camera.quaternion, this.s.setScalar(live ? g.size * (1 - u * 0.5) : 0.0001));
      this.grains.setMatrixAt(i, this.m);
      this.grainLevel.setX(i, live ? 1.4 * Math.min(1, u * 12) * (1 - u) * (0.75 + 0.25 * Math.sin(g.t * 22 + i)) : 0);
    }
    this.grains.instanceMatrix.needsUpdate = true;
    this.grainLevel.needsUpdate = true;
  }

  private clearOf(): F {
    const q = this.queen;
    const d = vec2(screenUV.x.sub(q.x).mul(q.z), screenUV.y.sub(q.y)).length();
    return smoothstep(q.w.mul(0.7), q.w.mul(1.25), d).mul(0.88).add(0.12) as unknown as F;
  }

  /** The same, but in the air it is seen whole. */
  private glowOver(rgb: THREE.Node): THREE.MeshBasicNodeMaterial {
    const m = this.glow(rgb, 1);
    const gap = this.fx.depthAt(screenUV).add(positionView.z);
    m.colorNode = (rgb as THREE.Node<'vec3'>).mul(max(smoothstep(-0.3, 0.1, gap), this.trackOver));
    return m;
  }

  /** A light that adds to the picture and to the bloom; `through`: how much of it shows behind what stands before it. */
  private glow(rgb: THREE.Node, through: number | F = 0, soft = 0.3): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    m.blending = THREE.AdditiveBlending;
    const gap = this.fx.depthAt(screenUV).add(positionView.z);
    m.colorNode = (rgb as THREE.Node<'vec3'>).mul(max(smoothstep(-soft, 0.1, gap), through));
    m.fog = false;
    m.userData.fx = true;
    return m;
  }

  /** For the HUD: how much time the flight has left (0..1). */
  static left(match: Match): number {
    return match.flock ? match.flock.left / FLOCK_TICKS : 0;
  }
}

/** Between two points, round their corners. */
function catmull(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, q: THREE.Vector3, u: number, out: THREE.Vector3): void {
  const one = (w: number, x: number, y: number, z: number): number => 0.5 * (2 * x + (y - w) * u + (2 * w - 5 * x + 4 * y - z) * u * u + (3 * x - w - 3 * y + z) * u * u * u);
  out.set(one(p.x, a.x, b.x, q.x), one(p.y, a.y, b.y, q.y), one(p.z, a.z, b.z, q.z));
}

/** A number, white on black. */
function digit(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 96, 96);
  g.fillStyle = '#fff';
  g.font = "800 78px Bahnschrift, 'Segoe UI', sans-serif";
  g.textAlign = 'center';
  g.fillText(String(n), 48, 75);
  return new THREE.CanvasTexture(c);
}

/** The angle of a point round the middle. */
function atanOf(p: V2): F {
  return p.y.atan(p.x) as unknown as F;
}

// ---------------------------------------------------------------- shapes

function painted(g: THREE.BufferGeometry, color: (p: THREE.Vector3) => THREE.Color, scarf = 0): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const pos = out.getAttribute('position');
  const c = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const q = color(p.fromBufferAttribute(pos, i));
    c.set([q.r, q.g, q.b], i * 3);
  }
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  out.setAttribute('scarf', new THREE.BufferAttribute(new Float32Array(pos.count).fill(scarf), 1));
  out.deleteAttribute('uv');
  return out;
}

/** A small round bee, about one unit long along +z: a furry chest, a banded abdomen, large dark eyes. */
function beeGeometry(): THREE.BufferGeometry {
  const yellow = new THREE.Color(0xf09a08);
  const cream = new THREE.Color(0xffd070);
  const black = new THREE.Color(0x1c0f06);
  const tip = new THREE.Color();
  const face = (p: THREE.Vector3): THREE.Color => tip.copy(yellow).lerp(cream, ss(0.14, 0.02, p.y) * ss(0.32, 0.4, p.z)).lerp(black, 0.9 * ss(0.1, 0.15, p.y) * ss(0.42, 0.34, p.z));
  const parts: THREE.BufferGeometry[] = [];
  const ball = (x: number, y: number, z: number, a: number, b: number, c: number, color: (p: THREE.Vector3) => THREE.Color, n = 22): void => {
    parts.push(painted(new THREE.SphereGeometry(1, n, Math.round(n * 0.7)).scale(a, b, c).translate(x, y, z), color));
  };
  const band = (p: THREE.Vector3): THREE.Color => tip.copy(p.z < -0.475 || Math.sin((p.z + 0.02) * 33) > 0.05 ? black : yellow);
  parts.push(
    painted(
      new THREE.SphereGeometry(1, 30, 22).scale(0.215, 0.2, 0.28).translate(0, -0.02, -0.25),
      band,
    ),
  );
  // (a scarf in its team's colour)
  parts.push(painted(new THREE.TorusGeometry(0.15, 0.045, 10, 30).scale(1, 1, 0.9).rotateX(0.15).translate(0, 0.0, 0.215), () => yellow, 1));
  parts.push(painted(new THREE.SphereGeometry(0.034, 10, 8).scale(1, 1.6, 0.6).translate(0.1, -0.17, 0.22), () => yellow, 1));
  ball(0, 0.03, 0.06, 0.2, 0.195, 0.21, () => yellow);
  ball(0, 0.02, 0.31, 0.175, 0.165, 0.15, (p) => face(p));
  // (a smile)
  parts.push(painted(new THREE.TorusGeometry(0.05, 0.008, 6, 18, Math.PI).rotateZ(Math.PI).rotateX(0.35).translate(0, -0.035, 0.452), () => black));
  for (const s of [-1, 1]) {
    ball(s * 0.12, 0.045, 0.375, 0.07, 0.085, 0.075, () => black, 16);
    ball(s * 0.135, 0.085, 0.437, 0.02, 0.022, 0.012, () => new THREE.Color(0xffffff), 8);
  }
  const rod = (a: THREE.Vector3, b: THREE.Vector3, w: number): void => {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(w * 0.6, w, d.length(), 6, 1).translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z);
    parts.push(painted(g, () => black));
  };
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  for (const s of [-1, 1]) {
    rod(v(s * 0.06, 0.16, 0.36), v(s * 0.1, 0.28, 0.44), 0.014);
    rod(v(s * 0.1, 0.28, 0.44), v(s * 0.17, 0.28, 0.56), 0.012);
    for (let k = 0; k < 3; k++) {
      const z = 0.16 - k * 0.12;
      rod(v(s * 0.1, -0.1, z), v(s * 0.2, -0.19, z - 0.05), 0.022);
      rod(v(s * 0.2, -0.19, z - 0.05), v(s * 0.17, -0.31, z - 0.12), 0.017);
    }
  }
  parts.push(painted(new THREE.ConeGeometry(0.02, 0.11, 8).rotateX(-Math.PI / 2).translate(0, -0.03, -0.57), () => black));
  // ---- fur
  const one = new THREE.ConeGeometry(0.0055, 1, 3, 1, true).translate(0, 0.5, 0);
  const n = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const coat = (x: number, y: number, z: number, a: number, b: number, c: number, count: number, long: number, color: (p: THREE.Vector3) => THREE.Color): void => {
    for (let i = 0; i < count; i++) {
      const yy = 1 - (2 * (i + 0.5)) / count;
      const an = i * 2.39996;
      const r = Math.sqrt(1 - yy * yy);
      const d = v(Math.cos(an) * r, yy, Math.sin(an) * r);
      const p = v(d.x * a + x, d.y * b + y, d.z * c + z);
      n.set(d.x / a, d.y / b, d.z / c).normalize();
      n.z -= 1.5;
      q.setFromUnitVectors(v(0, 1, 0), n.normalize());
      m.compose(p, q, v(1, long * (0.7 + 0.6 * rnd(i)), 1));
      const col = color(p).clone();
      parts.push(painted(one.clone().applyMatrix4(m), () => col));
    }
  };
  coat(0, 0.03, 0.06, 0.195, 0.19, 0.205, 620, 0.085, (p) => tip.copy(yellow).lerp(cream, 0.6 * ss(0.05, 0.2, p.y)));
  coat(0, -0.02, -0.25, 0.21, 0.195, 0.27, 560, 0.05, band);
  coat(0, 0.02, 0.31, 0.172, 0.162, 0.145, 300, 0.04, face);
  return mergeGeometries(parts);
}

function wingsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const ghost of [0, 1, 2])
   for (const s of [-1, 1])
    for (const fore of [1, 0]) {
      const g = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
      const pos = g.getAttribute('position');
      const l = fore ? 0.29 : 0.19;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * l + l * 0.95;
        pos.setXYZ(i, s * (x + 0.06), 0.17, pos.getZ(i) * (fore ? 0.12 : 0.1) * (0.5 + x) + (fore ? 0.06 : -0.1) - x * 0.25);
      }
      const o = g.toNonIndexed();
      o.setAttribute('ghost', new THREE.BufferAttribute(new Float32Array(o.getAttribute('position').count).fill(ghost), 1));
      parts.push(o);
    }
  return mergeGeometries(parts);
}

/** A slab of comb: six sides, a thick soft rim, honey that drips off it. */
function slabGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry): void => {
    const o = g.index ? g.toNonIndexed() : g;
    o.deleteAttribute('uv');
    parts.push(o);
  };
  add(new THREE.CylinderGeometry(5.4, 5.2, 0.5, 6).translate(0, -0.25, 0));
  const corner = (k: number): THREE.Vector3 => new THREE.Vector3(Math.sin((k * Math.PI) / 3) * 5.4, -0.24, Math.cos((k * Math.PI) / 3) * 5.4);
  for (let k = 0; k < 6; k++) {
    const a = corner(k);
    const b = corner(k + 1);
    const d = b.clone().sub(a);
    const g = new THREE.CapsuleGeometry(0.3, d.length(), 8, 16).translate(0, d.length() / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z);
    add(g);
    for (let j = 0; j < 3; j++) {
      const p = a.clone().lerp(b, 0.16 + 0.3 * j + 0.1 * rnd(k * 3 + j));
      const l = 0.3 + 0.9 * rnd(k * 7 + j);
      add(new THREE.CapsuleGeometry(0.1 + 0.08 * rnd(k + j), l, 6, 12).translate(p.x, p.y - l / 2 - 0.1, p.z));
    }
  }
  return mergeGeometries(parts);
}

/** A cell of wax and honey: a hexagon, its edges cut off. */
function cellGeometry(): THREE.BufferGeometry {
  const parts = [new THREE.CylinderGeometry(0.8, 1, 0.14, 6, 1).translate(0, 0.14, 0), new THREE.CylinderGeometry(1, 1, 0.14, 6, 1, true), new THREE.CylinderGeometry(1, 0.8, 0.14, 6, 1).translate(0, -0.14, 0)];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/** A crown, one unit across: a band, points with balls; its jewels apart. */
function crownGeometry(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const parts: THREE.BufferGeometry[] = [];
  const gems: THREE.BufferGeometry[] = [];
  const add = (to: THREE.BufferGeometry[], g: THREE.BufferGeometry): void => {
    const o = g.index ? g.toNonIndexed() : g;
    o.deleteAttribute('uv');
    to.push(o);
  };
  // (the band: thick, a rim above and below; the points are cut out of one sheet bent round)
  add(parts, new THREE.TorusGeometry(0.4, 0.035, 12, 60).rotateX(Math.PI / 2).translate(0, -0.1, 0));
  const N = 7;
  const seg = 140;
  const pos: number[] = [];
  const index: number[] = [];
  for (const inner of [0, 1])
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * N;
      const k = Math.abs((u % 1) - 0.5) * 2;
      const h = 0.1 + 0.3 * k ** 1.7;
      const an = (i / seg) * Math.PI * 2;
      for (const top of [0, 1]) {
        const r = 0.4 + top * h * 0.24 - inner * 0.035;
        pos.push(Math.cos(an) * r, -0.1 + top * h, Math.sin(an) * r);
      }
    }
  const row = (seg + 1) * 2;
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    index.push(row + a, row + a + 2, row + a + 1, row + a + 1, row + a + 2, row + a + 3);
    index.push(a + 1, row + a + 1, a + 3, row + a + 1, row + a + 3, a + 3);
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.setIndex(index);
  sheet.computeVertexNormals();
  add(parts, sheet.toNonIndexed());
  for (let i = 0; i < N; i++) {
    const an = (i / N) * Math.PI * 2;
    add(parts, new THREE.SphereGeometry(0.052, 14, 10).translate(Math.cos(an) * 0.505, 0.33, Math.sin(an) * 0.505));
    const mid = ((i + 0.5) / N) * Math.PI * 2;
    const gem = new THREE.CylinderGeometry(0.022, 0.062, 0.045, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6);
    add(parts, new THREE.TorusGeometry(0.064, 0.013, 8, 24).rotateY(Math.PI / 2 - mid).translate(Math.cos(mid) * 0.41, -0.02, Math.sin(mid) * 0.41));
    add(gems, gem.lookAt(new THREE.Vector3(0, 0, 1)).rotateY(Math.PI / 2 - mid).translate(Math.cos(mid) * 0.415, -0.02, Math.sin(mid) * 0.415));
  }
  return [mergeGeometries(parts), mergeGeometries(gems)];
}

/** A ring of pollen: a braid of two strands with clumps of grains on it, radius one. */
function garland(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry): void => {
    const o = g.index ? g.toNonIndexed() : g;
    o.deleteAttribute('uv');
    parts.push(o);
  };
  for (const k of [0, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 90; i++) {
      const an = (i / 90) * Math.PI * 2;
      const w = an * 12 + k * Math.PI;
      const r = 1 + 0.028 * Math.cos(w);
      pts.push(new THREE.Vector3(Math.cos(an) * r, Math.sin(an) * r, 0.028 * Math.sin(w)));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 180, 0.018, 6, true));
  }
  for (let i = 0; i < 12; i++) {
    const an = (i / 12) * Math.PI * 2;
    for (let j = 0; j < 9; j++) {
      const s = j === 0 ? 0.062 : 0.028;
      const d = j === 0 ? 0 : 0.062;
      const y = 1 - (2 * j) / 9;
      const c = Math.sqrt(Math.max(0, 1 - y * y));
      add(new THREE.IcosahedronGeometry(s, 1).translate(Math.cos(an) + Math.cos(j * 2.4) * c * d, Math.sin(an) + y * d, Math.sin(j * 2.4) * c * d));
    }
  }
  return mergeGeometries(parts);
}
