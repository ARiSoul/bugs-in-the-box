import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, float, floor, mix, normalView, positionGeometry, positionViewDirection, pow, smoothstep, step, uniform, uniformArray, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { APART, COLUMNS, DECK_UNDER, PIECE, shifted, SPAN, SPANS, WALL_DEEP } from '../../game/build';
import type { TerrainField } from '../../game/field';
import type { Match, MatchEvent, Unit } from '../../game/match';
import { SMOTHERED } from '../../game/reactions';
import { WEAPONS } from '../../game/weapons';
import type { BuildReply } from '../../workers/build.worker';
import type { BugView } from '../BugView';
import { hexAt, outOf } from './buildModels';
import type { Placing } from '../../input/placing';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

/** Seconds a wall or a bridge takes to grow; a shelter comes, and goes. */
const GROW = 0.9;
const COME = 0.6;
const GO = 0.3;
/** Places along a wall or a bridge whose ground is known. */
const STATIONS = 7;
const FLAKES = 90;
/** What a blast leaves on the ground: how many pieces at most, how long they stay (s). */
const DEBRIS = 220;
const DEBRIS_LIFE = 40;
/** A hole's edge: how uneven (of its radius). */
const JAG = 0.1;
/** How far a hole reaches this way (a unit vector), as a share of its radius: uneven, the same for its cut and its wall. */
const jag = (ux: number, uy: number, uz: number, seed: number): number =>
  1 + JAG * (0.6 * Math.sin(ux * 5.1 + uy * 2.3 + seed) * Math.sin(uz * 4.7 - uy * 3.1 + seed * 1.7) + 0.4 * Math.sin(ux * 11.3 - uz * 9.7 + uy * 7.1 + seed * 2.3));
const FLAMES = 240;
const FLAMES_EACH = 22;
const GHOST: readonly (readonly [number, number, number])[] = [[0.02, 0.22, 1], [1, 0.03, 0.01]];

/** How a bug sits in its shelter (in its radius): how far forward, how large. */
const SEAT: Record<string, readonly [number, number]> = { anthill: [0.62, 0.92], 'silk-funnel': [0.62, 0.62], husk: [0.95, 0.82], 'wax-nest': [0.35, 0.78] };
/** What flies off of each species' work. */
const BITS: Record<string, readonly number[]> = { ant: [0x6b4a2e, 0xb08a55, 0x4a3423], spider: [0xd8d4ca, 0xb9b6ae], cockroach: [0x8a3d12, 0x5a240a, 0xc98a4a], bee: [0xd9942a, 0xb86a10, 0xffc040], husk: [0x8a5a2a, 0x5c3814, 0xb07a40], dust: [0xb8a68c, 0x9c8a70, 0xcdbda2], dirt: [0x5e4a36, 0x3b2f24, 0x80684c, 0x4a3d30], ember: [0xff8a2a, 0x3a2418, 0x1a1210], air: [0xe8f8ff, 0x9fe8ff, 0xffffff] };

/** What each is made of inside: two colours, how rough, how much light comes through. */
// (the light of its own is more than the skin's: inside a hole the sun hardly reaches)
const INSIDE: Record<string, readonly [readonly [number, number, number], readonly [number, number, number], number, number]> = {
  ant: [[0.14, 0.07, 0.03], [0.4, 0.24, 0.11], 0.95, 0.9],
  spider: [[0.42, 0.4, 0.37], [0.78, 0.76, 0.7], 0.6, 1.1],
  cockroach: [[0.03, 0.009, 0.004], [0.36, 0.11, 0.025], 0.3, 0.9],
  bee: [[0.36, 0.12, 0.006], [0.8, 0.56, 0.22], 0.35, 0.9],
};
/** Its skin where a hole cuts it: how thick, and what colour. */
const SKIN: Record<string, readonly [number, readonly [number, number, number]]> = {
  ant: [0, [0, 0, 0]],
  spider: [0.22, [0.9, 0.88, 0.82]],
  cockroach: [0.16, [0.16, 0.035, 0.005]],
  bee: [0.18, [0.36, 0.15, 0.015]],
};
/** A living bridge: the backs of ants, inside it too. */
const ANTS: readonly [readonly [number, number, number], readonly [number, number, number]] = [[0.05, 0.012, 0.006], [0.2, 0.05, 0.02]];

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);

/** Where a wall or a bridge is: the ground along it (places `gap` apart from `first` on), its up and its out; it ends at x0 and x1. */
interface Frame {
  feet: THREE.Vector3[];
  up: THREE.Vector3;
  out: THREE.Vector3;
  first: number;
  gap: number;
  x0: number;
  x1: number;
}

interface Built {
  /** Which one it is of the match's (a hole's wall: its own's; -1: of a match before). */
  id: number;
  /** Per vertex: its slot, and 64 more where a fire over earth reaches. */
  slots: Uint8Array;
  mesh: THREE.Mesh;
  species: string;
  age: number;
  /** It stands on the turntable. */
  turns: boolean;
  middle: THREE.Vector3;
  reach: number;
  /** What it is and where, as it was built (a hole's wall: none). */
  of: { weapon: string; frame: Frame } | null;
}
interface Shelter {
  unit: number;
  species: string;
  mesh: THREE.Mesh;
  t: number;
  gone: number;
  /** What it kept off at first, and how worn it shows (0 whole, 1 cracked, 2 holed). */
  full: number;
  stage: number;
}

function newFrame(): Frame {
  return { feet: Array.from({ length: STATIONS }, () => new THREE.Vector3()), up: new THREE.Vector3(), out: new THREE.Vector3(), first: 0, gap: 1, x0: 0, x1: 1 };
}

/** The frame of the pieces of a wall or a bridge. */
function frameOf(p: readonly number[], wall: boolean, f: Frame): void {
  const n = p.length / PIECE;
  const u = new THREE.Vector3(p[3], p[4], p[5]);
  const v = new THREE.Vector3(p[6], p[7], p[8]).normalize();
  const long = u.length();
  u.divideScalar(long);
  const first = p[10];
  const last = p[(n - 1) * PIECE + 10];
  if (wall) {
    f.up.copy(u);
    f.out.crossVectors(v, u);
    f.first = (-(COLUMNS - 1) / 2) * APART;
    f.gap = APART;
    // (an end that is whole may reach a little farther)
    f.x0 = first === 0 ? -99 : f.first + (first - 0.5) * APART;
    f.x1 = last === COLUMNS - 1 ? 99 : f.first + (last + 0.5) * APART;
    const half = long + p[9] - WALL_DEEP;
    const had = new Array<boolean>(COLUMNS).fill(false);
    for (let i = 0; i < n; i++) {
      const o = i * PIECE;
      f.feet[p[o + 10]].set(p[o], p[o + 1], p[o + 2]).addScaledVector(u, -half).addScaledVector(v, -shifted(p[o + 10], COLUMNS));
      had[p[o + 10]] = true;
    }
    // (a column left out: between its neighbours)
    for (let c = 0; c < COLUMNS; c++) {
      if (had[c]) continue;
      let a = c;
      let b = c;
      while (a >= 0 && !had[a]) a--;
      while (b < COLUMNS && !had[b]) b++;
      if (a >= 0 && b < COLUMNS) f.feet[c].lerpVectors(f.feet[a], f.feet[b], (c - a) / (b - a));
      else {
        const e = a >= 0 ? a : b;
        const d = a >= 0 ? a - 1 : b + 1;
        f.feet[c].copy(f.feet[e]);
        if (had[d]) f.feet[c].addScaledVector(f.feet[e].clone().sub(f.feet[d]), Math.abs(c - e));
      }
    }
  } else {
    f.out.copy(v).negate();
    f.up.crossVectors(f.out, u);
    f.first = 0;
    f.gap = (SPANS * SPAN) / (STATIONS - 1);
    f.x0 = first === 0 ? -99 : first * SPAN;
    f.x1 = last === SPANS - 1 ? 99 : (last + 1) * SPAN;
    const start = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(f.up, p[9] + DECK_UNDER).addScaledVector(u, -(first + 0.5) * SPAN - shifted(first, SPANS));
    for (let i = 0; i < STATIONS; i++) f.feet[i].copy(start).addScaledVector(u, i * f.gap);
  }
}

/** What bugs build and where they hide: where it would go, how it grows, what a blast leaves of it. Reads the match, never changes it. */
export class BuildViews {
  /** All of it (nobody stands on it: it is no drawn ground). */
  readonly root = new THREE.Group();
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly models = new Map<string, THREE.BufferGeometry>();
  private readonly asked = new Set<string>();
  private worker: Worker | null = null;
  private readonly ghost: THREE.Mesh;
  private readonly ghostColor = uniform(new THREE.Vector3());
  private readonly ghostBeat = uniform(0);
  private readonly ghostFeet = uniformArray(Array.from({ length: STATIONS }, () => new THREE.Vector3()), 'vec3');
  private readonly ghostUp = uniform(new THREE.Vector3(0, 1, 0));
  private readonly ghostOut = uniform(new THREE.Vector3(0, 0, 1));
  private readonly ghostEnds = uniform(new THREE.Vector4());
  private readonly ghostFrame = newFrame();
  /** How far from the bug it may be put; the spot under the pointer. */
  private readonly ring: THREE.Mesh;
  private readonly spot: THREE.Mesh;
  private readonly built: Built[] = [];
  /** What was built before its model was made. */
  private waiting: { weapon: string; frame: Frame; turns: boolean; id: number }[] = [];
  private readonly blasts: number[] = [];
  private readonly worn: { id: number; at: readonly [number, number, number, number] }[] = [];
  private readonly lost: { id: number; slot: number; upper: boolean; at: THREE.Vector3 }[] = [];
  private readonly fires: { build: number; slot: number; at: THREE.Vector3; high: number; t: number; out: boolean }[] = [];
  private readonly flames: THREE.InstancedMesh;
  private turned = 0;
  private readonly shelters: Shelter[] = [];
  private readonly flakes: THREE.InstancedMesh;
  /** What lies on the ground after a blast. */
  private readonly debris: THREE.InstancedMesh;
  private readonly pieces: { at: THREE.Vector3; v: THREE.Vector3; t: number; size: number; still: boolean; strand: boolean; plate: boolean }[] = [];
  private nextPiece = 0;
  private field: TerrainField | null = null;
  private readonly bits: { at: THREE.Vector3; v: THREE.Vector3; t: number; life: number; size: number }[] = [];
  private nextBit = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    // ---- one material for all of it: what a vertex is of is in `look` (how rough, how much light at its rim, when it grows)
    // (a rim light below 0 is a dark shell: it gives back little of what is round it, so it stays dark under its gloss)
    {
      // (light comes through silk, thin shell and wax: a scattering of each light seen from behind; `look.x` keeps which, as
      // `rough + 2 * lit`)
      const m = new THREE.MeshSSSNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const look = attribute('look', 'vec3') as unknown as V3;
      const lit = floor(look.x.mul(0.5)) as unknown as F;
      const rim = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 2) as unknown as F;
      const grown = uniform(1).onObjectUpdate(({ object }) => (object?.userData.grown as number | undefined) ?? 1) as unknown as F;
      const base = attribute('color', 'vec3') as unknown as V3;
      m.roughnessNode = look.x.sub(lit.mul(2));
      // (silk 0.9, a shed skin 1.8 (a live shell does not: it looked like plastic), wax 1.2)
      const through = step(0.5, lit).mul(0.9).add(step(1.5, lit).mul(0.9)).sub(step(2.5, lit).mul(0.6)) as unknown as F;
      m.thicknessColorNode = base.mul(through);
      m.thicknessDistortionNode = float(0.2);
      m.thicknessAmbientNode = float(0.12);
      m.thicknessAttenuationNode = float(0.9);
      m.thicknessPowerNode = float(2.5);
      m.thicknessScaleNode = float(3);
      m.maskNode = look.z.lessThan(grown);
      // (what has just come is warm for a moment)
      const fresh = smoothstep(0.12, 0, grown.sub(look.z)).mul(smoothstep(1.2, 1, grown));
      m.aoNode = mix(float(0.22), float(1), step(0, look.y));
      m.emissiveNode = base.mul(abs(look.y)).mul(rim.mul(1.6).add(0.12)).add(base.mul(fresh).mul(1.4));
      this.material = m;
    }
    // ---- where it would go: the model itself, bent over the ground it would stand on
    {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const ends = this.ghostEnds;
      const x = clamp(positionGeometry.x, ends.x, ends.y);
      const st = x.sub(ends.z).div(ends.w);
      const i = clamp(floor(st), 0, STATIONS - 2);
      const a = this.ghostFeet.element(i.toInt()) as unknown as V3;
      const b = this.ghostFeet.element(i.toInt().add(1)) as unknown as V3;
      m.positionNode = mix(a, b, st.sub(i)).add(this.ghostUp.mul(positionGeometry.y)).add(this.ghostOut.mul(positionGeometry.z));
      const l = attribute('color', 'vec3') as unknown as V3;
      const bright = l.x.add(l.y).add(l.z);
      m.colorNode = this.ghostColor.mul(bright.mul(0.9).add(0.35));
      m.opacityNode = float(0.34).mul(this.ghostBeat.mul(0.35).add(0.8));
      m.fog = false;
      this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), m);
      this.ghost.frustumCulled = false;
      this.ghost.visible = false;
      this.ghost.renderOrder = 6;
      this.root.add(this.ghost);
    }
    {
      const dashes: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 48; k++) dashes.push(new THREE.RingGeometry(0.985, 1, 3, 1, (k / 48) * Math.PI * 2, (Math.PI * 2 * 0.6) / 48).rotateX(-Math.PI / 2));
      this.ring = new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshBasicNodeMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
      this.spot = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
      for (const o of [this.ring, this.spot]) {
        o.frustumCulled = false;
        o.renderOrder = 7;
        o.visible = false;
        this.root.add(o);
      }
    }
    {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const high = positionGeometry.y;
      m.colorNode = mix(vec3(2.6, 1.15, 0.16), vec3(1.5, 0.16, 0.01), smoothstep(-0.2, 1, high));
      m.opacityNode = smoothstep(1.05, 0.1, high).mul(smoothstep(0, 0.55, abs(normalView.dot(positionViewDirection)))).mul(0.75);
      m.fog = false;
      this.flames = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), m, FLAMES);
      this.flames.frustumCulled = false;
      this.flames.count = 0;
      this.flames.renderOrder = 7;
      this.root.add(this.flames);
    }
    const g = new THREE.IcosahedronGeometry(1, 0);
    this.flakes = new THREE.InstancedMesh(g, new THREE.MeshStandardNodeMaterial({ roughness: 0.7 }), FLAKES);
    this.flakes.frustumCulled = false;
    this.flakes.castShadow = true;
    for (let i = 0; i < FLAKES; i++) {
      this.flakes.setColorAt(i, new THREE.Color(0xffffff));
      this.bits.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), t: 9, life: 1, size: 0 });
    }
    this.root.add(this.flakes);
    this.debris = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 }), DEBRIS);
    this.debris.frustumCulled = false;
    this.debris.castShadow = this.debris.receiveShadow = true;
    for (let i = 0; i < DEBRIS; i++) {
      this.debris.setColorAt(i, new THREE.Color(0xffffff));
      this.debris.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.pieces.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), t: DEBRIS_LIFE, size: 0, still: false, strand: false, plate: false });
    }
    this.debris.visible = false;
    this.root.add(this.debris);
    // (both materials are drawn once from the start, too small to see: none is compiled when it is first needed)
    const speck = new THREE.BufferGeometry();
    for (const [k, n] of [['position', 3], ['normal', 3], ['color', 3], ['look', 3]] as const) speck.setAttribute(k, new THREE.BufferAttribute(new Float32Array(3 * n), n));
    speck.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    for (const m of [this.material, this.ghost.material as THREE.Material]) {
      const o = new THREE.Mesh(speck, m);
      o.position.y = -500;
      o.frustumCulled = false;
      o.castShadow = m === this.material;
      this.root.add(o);
    }
  }

  // ---------------------------------------------------------------- models

  /** Make the models these species need (a worker does). */
  private ask(species: readonly string[]): void {
    for (const w of WEAPONS) {
      if (w.start === undefined || !w.species || !species.includes(w.species) || this.asked.has(w.id)) continue;
      this.asked.add(w.id);
      if (!this.worker) {
        this.worker = new Worker(new URL('../../workers/build.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<BuildReply>) => this.take(e.data);
      }
      this.worker.postMessage(w.id);
    }
  }

  private take({ id, model }: BuildReply): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(model.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(model.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(model.color, 3));
    g.setAttribute('look', new THREE.BufferAttribute(model.look, 3));
    g.setIndex(new THREE.BufferAttribute(model.index, 1));
    this.models.set(id, g);
    const now = this.waiting.filter((q) => q.weapon === id);
    this.waiting = this.waiting.filter((q) => q.weapon !== id);
    for (const q of now) this.put(id, q.frame, q.turns, q.id);
  }

  /** All that was asked for is there (the captures wait for it). */
  get ready(): boolean {
    return this.models.size === this.asked.size;
  }

  // ---------------------------------------------------------------- the match

  /** A new map: nothing is built on it. */
  raze(): void {
    for (const b of this.built) this.remove(b.mesh);
    this.built.length = 0;
    this.waiting = [];
  }

  /** A new match: nobody hides. */
  clear(species: readonly string[]): void {
    for (const b of this.built) b.id = -1;
    for (const s of this.shelters) this.remove(s.mesh);
    this.shelters.length = 0;
    this.ghost.visible = this.ring.visible = this.spot.visible = false;
    for (const b of this.bits) b.t = b.life;
    for (const p of this.pieces) p.t = DEBRIS_LIFE;
    this.blasts.length = this.worn.length = this.lost.length = this.fires.length = 0;
    this.turned = 0;
    this.ask(species);
  }

  private remove(mesh: THREE.Mesh): void {
    this.root.remove(mesh);
    mesh.geometry.dispose();
  }

  on(e: MatchEvent, match: Match): void {
    if (e.type === 'built') {
      const frame = newFrame();
      const w = WEAPONS.find((q) => q.id === e.weapon);
      frameOf(e.pieces, w?.kind === 'wall', frame);
      const tt = match.options.turntable;
      const [x, y, z] = e.pieces;
      const turns = tt !== undefined && Math.hypot(x - tt.x, z - tt.z) < tt.radius && y > tt.surface - 2;
      if (this.models.has(e.weapon)) this.put(e.weapon, frame, turns, e.build);
      else this.waiting.push({ weapon: e.weapon, frame, turns, id: e.build });
    } else if (e.type === 'worn') this.worn.push({ id: e.build, at: [e.x, e.y, e.z, e.radius] });
    else if (e.type === 'burning') this.fires.push({ build: e.build, slot: e.slot, at: new THREE.Vector3(e.x, e.y, e.z), high: e.high, t: 0, out: false });
    else if (e.type === 'fireOut') {
      for (const f of this.fires) if (f.build === e.build && f.slot === e.slot) f.out = true;
    } else if (e.type === 'pieceGone') this.lost.push({ id: e.build, slot: e.slot, upper: e.upper, at: new THREE.Vector3(e.x, e.y, e.z) });
    else if (e.type === 'regrown') this.grow(e.build, e.gone);
    else if (e.type === 'explosion') this.blasts.push(e.x, e.y, e.z, e.radius);
    else if (e.type === 'dig') {
      const l = Math.hypot(e.x2 - e.x1, e.y2 - e.y1, e.z2 - e.z1);
      const n = Math.max(1, Math.ceil(l / (e.radius * 0.5)));
      for (let i = 0; i <= n; i++) this.blasts.push(e.x1 + ((e.x2 - e.x1) * i) / n, e.y1 + ((e.y2 - e.y1) * i) / n, e.z1 + ((e.z2 - e.z1) * i) / n, e.radius);
    } else if (e.type === 'burrow') {
      // (what is built on its way goes; earth thrown up out of the hole it goes into)
      const p = e.path;
      for (let k = 0; k + 3 < p.length; k += 3) {
        const l = Math.hypot(p[k + 3] - p[k], p[k + 4] - p[k + 1], p[k + 5] - p[k + 2]);
        const n = Math.max(1, Math.ceil(l / (e.radius * 0.5)));
        for (let i = 0; i <= n; i++) this.blasts.push(p[k] + ((p[k + 3] - p[k]) * i) / n, p[k + 1] + ((p[k + 4] - p[k + 1]) * i) / n, p[k + 2] + ((p[k + 5] - p[k + 2]) * i) / n, e.radius);
      }
      this.spoil(this.p.set(p[3] * 0.4 + p[0] * 0.6, p[4] * 0.4 + p[1] * 0.6, p[5] * 0.4 + p[2] * 0.6), 26, 10);
    } else if (e.type === 'emerge') this.spoil(this.p.set(e.x, e.y, e.z), 70, 22, 9.5);
    else if (e.type === 'hide') this.hide(match.units[e.unit], e.weapon);
    else if (e.type === 'bared') {
      const s = this.shelters.find((q) => q.unit === e.unit && q.gone < 0);
      if (!s) return;
      s.gone = 0;
      const r = match.units[e.unit].bug.species.radius;
      this.p.copy(s.mesh.position).addScaledVector(this.s.copy(UP).applyQuaternion(s.mesh.quaternion), r);
      // (a cockroach's shelter is its shed skin: its own colour)
      const bits = s.species === 'cockroach' ? 'husk' : s.species;
      for (let k = 0; k < (e.broken ? 40 : 10); k++) this.bit(this.p, bits, e.broken ? 11 : 5, r * 1.6, 0.17);
      // (broken, it comes apart its own way: earth, torn silk, shell plates, lumps of wax and honey)
      if (e.broken) for (let k = 0; k < (s.species === 'spider' ? 20 : 28); k++) this.drop(this.p.x, this.p.y, this.p.z, r * 1.4, bits, s.species === 'cockroach' || (s.species === 'bee' && k % 2 === 0), s.species === 'ant' ? 0.4 : 1);
    } else if (e.type === 'caught') {
      for (let k = 0; k < 14; k++) this.bit(this.p.set(e.x, e.y, e.z), 'spider', 4, 0.3, 0.08);
    }
  }

  /** A puff of air behind a bug that bursts. */
  trail(at: THREE.Vector3): void {
    this.bit(at, 'air', 0.6, 0.5, 0.09);
  }

  /** What a blast throws out of the ground: lumps of it, of its colour, that fall round the crater and lie there a while. */
  rubble(
    x: number,
    y: number,
    z: number,
    r: number,
    rgb: readonly [number, number, number],
    outside: readonly [number, number, number] = rgb,
    layer: readonly [number, number, number] = rgb,
  ): void {
    const n = Math.round(12 + r * 4);
    for (let k = 0; k < n; k++) {
      const i = this.nextPiece % DEBRIS;
      // (two or three big chunks, the rest small)
      const big = k < 3 + (r > 5 ? 1 : 0);
      this.drop(x, y, z, r * 0.8, 'dirt', big || k % 2 === 0, (big ? 1.6 + 0.6 * Math.random() : 0.6 + 1.4 * Math.random() ** 2) * Math.min(1.6, r / 4));
      const p = this.pieces[i];
      // (most fall near the rim; some fly far)
      p.v.multiplyScalar((k % 4 === 0 ? 1 + r * 0.12 : 0.45 + r * 0.05) * (big ? 0.5 : 1));
      // (in the light they look paler than the walls they broke from: darker, and far apart)
      // (a third of them the outside of what it was, its finish; the rest its broken inside, which the key light makes look
      // paler than the walls it broke from: darker)
      // (the big ones are shards of its broken inside)
      // (lying flat, they face the key light the walls are turned from: darker still; one in five a bit of its layers)
      const own = !big && k % 3 === 0;
      const lined = !big && !own && k % 5 === 1;
      const c = own ? outside : lined ? layer : rgb;
      const k2 = own ? 0.3 + 0.2 * Math.random() : lined ? 0.35 + 0.2 * Math.random() : 0.2 + 0.2 * Math.random();
      this.debris.setColorAt(i, this.c3.setRGB(c[0] * k2, c[1] * k2, c[2] * k2));
    }
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }
  private readonly c3 = new THREE.Color();
  private readonly sunk = new THREE.Vector3();

  /** A puff of dust off the ground (an ant going under it). */
  dust(x: number, y: number, z: number, n: number): void {
    for (let k = 0; k < n * 6; k++) this.bit(this.s.set(x, y + 0.1, z), 'dust', 1.6 + n * 0.8, 0.7, 0.15 + 0.04 * n);
  }

  /** Earth thrown up out of a hole: a spray, and clods that fall round it and stay a while. */
  private spoil(at: THREE.Vector3, spray: number, clods: number, speed = 6.5): void {
    const { x, y, z } = at;
    for (let k = 0; k < spray; k++) this.bit(this.s.set(x, y, z), 'dirt', speed, 0.9, 0.12 + 0.06 * (k % 3));
    for (let k = 0; k < clods; k++) this.drop(x, y + 0.3, z, 1.2, 'dirt', false, 0.65);
  }

  private bit(at: THREE.Vector3, species: string, speed: number, spread: number, size: number): void {
    const i = this.nextBit++ % FLAKES;
    const b = this.bits[i];
    b.v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5);
    b.at.copy(at).addScaledVector(b.v, spread);
    b.v.y += 0.35;
    b.v.normalize().multiplyScalar(speed * (0.35 + 0.65 * Math.random()));
    b.t = 0;
    b.life = 0.6 + 0.7 * Math.random();
    b.size = size * (0.5 + Math.random());
    const c = BITS[species];
    this.flakes.setColorAt(i, new THREE.Color(c[i % c.length]));
    if (this.flakes.instanceColor) this.flakes.instanceColor.needsUpdate = true;
  }

  /** A piece of what a blast broke: out of the hole, down to the ground, where it stays a while. */
  private drop(x: number, y: number, z: number, r: number, species: string, plate = false, scale = 1): void {
    const i = this.nextPiece++ % DEBRIS;
    const p = this.pieces[i];
    p.v.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5);
    p.at.set(x, y, z).addScaledVector(p.v, r * 0.9);
    p.v.normalize().multiplyScalar(2 + 4 * Math.random());
    p.t = 0;
    // (silk breaks into tufts of thread that drift down; the rest into chunks)
    p.strand = species === 'spider';
    p.plate = plate;
    p.size = p.strand ? 0.12 + 0.16 * Math.random() : plate ? 0.14 + 0.16 * Math.random() : 0.07 + 0.2 * Math.random() ** 2;
    p.size *= scale;
    if (p.strand) p.v.multiplyScalar(0.45);
    p.still = false;
    const c = BITS[species];
    this.debris.setColorAt(i, new THREE.Color(c[(i * 7) % c.length]).multiplyScalar(0.75 + 0.3 * Math.random()));
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }

  private settle(dt: number): void {
    let n = 0;
    let moved = false;
    this.pieces.forEach((p, i) => {
      if (p.t >= DEBRIS_LIFE) {
        if (p.size > 0) {
          p.size = 0;
          this.debris.setMatrixAt(i, this.m.makeScale(0, 0, 0));
          moved = true;
        }
        return;
      }
      p.t += dt;
      n++;
      if (!p.still) {
        p.v.y -= (p.strand ? 6 : 20) * dt;
        if (p.strand) p.v.multiplyScalar(1 - 2.5 * dt);
        const ox = p.at.x;
        const oy = p.at.y;
        const oz = p.at.z;
        p.at.addScaledVector(p.v, dt);
        // (on something solid: it stops there, at the surface)
        if (this.field && this.field.sample(p.at.x, p.at.y - p.size * 0.5, p.at.z) < 0) {
          p.at.set(ox, oy, oz);
          if (p.v.y < 0 && Math.abs(p.v.y) < 3) p.still = true;
          p.v.set(p.v.x * 0.35, -p.v.y * 0.25, p.v.z * 0.35);
        }
        moved = true;
      }
      const k = p.size * Math.min(1, (DEBRIS_LIFE - p.t) * 0.5);
      if (p.t > DEBRIS_LIFE - 2) moved = true;
      if (!moved) return;
      // (at rest a piece lies flat, a little tilted, part sunk into what it fell on)
      const rest = p.still && !p.strand;
      this.q.setFromEuler(rest ? this.e.set(0.25 * Math.sin(i * 1.7), i * 2.3, 0.25 * Math.cos(i * 0.9)) : this.e.set(i * 1.7, i * 2.3, i * 0.9));
      if (p.strand) this.q.setFromEuler(this.e.set(i * 0.31, i * 2.3, 1.45 + i * 0.07));
      this.sunk.copy(p.at);
      if (rest) this.sunk.y -= k * (p.plate ? 0.08 : 0.3);
      this.debris.setMatrixAt(i, this.m.compose(this.sunk, this.q, p.strand ? this.s.set(k * 2.4, k * 0.09, k * 0.09) : p.plate ? this.s.set(k * 1.3, k * 0.11, k) : this.s.set(k, k * 0.6, k * 0.85)));
    });
    this.debris.visible = n > 0;
    if (moved) this.debris.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- walls and bridges

  /** Put one up: its model, bent over the ground it stands on. */
  private put(weapon: string, f: Frame, turns: boolean, id: number): void {
    const model = this.models.get(weapon) as THREE.BufferGeometry;
    const p = (model.getAttribute('position') as THREE.BufferAttribute).array;
    const n = (model.getAttribute('normal') as THREE.BufferAttribute).array;
    const pos = new Float32Array(p.length);
    const nor = new Float32Array(p.length);
    const side = new THREE.Vector3().crossVectors(f.up, f.out);
    const { up, out } = f;
    const slots = new Uint8Array(p.length / 3);
    const wall = WEAPONS.find((w) => w.id === weapon)?.kind === 'wall';
    for (let k = 0; k < p.length; k += 3) {
      const x = Math.min(f.x1, Math.max(f.x0, p[k]));
      const st = (x - f.first) / f.gap;
      const slot = wall ? Math.min(COLUMNS - 1, Math.max(0, Math.round(st))) : Math.min(SPANS - 1, Math.max(0, Math.floor(x / SPAN)));
      slots[k / 3] = slot + (p[k + 1] > SMOTHERED - 0.2 ? 64 : 0);
      const i = Math.min(STATIONS - 2, Math.max(0, Math.floor(st)));
      const t = st - i;
      const a = f.feet[i];
      const b = f.feet[i + 1];
      const y = p[k + 1];
      const z = p[k + 2];
      pos[k] = a.x + (b.x - a.x) * t + up.x * y + out.x * z;
      pos[k + 1] = a.y + (b.y - a.y) * t + up.y * y + out.y * z;
      pos[k + 2] = a.z + (b.z - a.z) * t + up.z * y + out.z * z;
      // (the cut end of one that ends early)
      const c = x === p[k] ? n[k] : p[k] > x ? 1 : -1;
      const d = x === p[k] ? n[k + 1] : 0;
      const e = x === p[k] ? n[k + 2] : 0;
      nor[k] = side.x * c + up.x * d + out.x * e;
      nor[k + 1] = side.y * c + up.y * d + out.y * e;
      nor[k + 2] = side.z * c + up.z * d + out.z * e;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', model.getAttribute('color').clone());
    g.setAttribute('look', model.getAttribute('look').clone());
    g.setIndex((model.getIndex() as THREE.BufferAttribute).clone());
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.grown = 0;
    this.root.add(mesh);
    const s = g.boundingSphere as THREE.Sphere;
    const species = WEAPONS.find((w) => w.id === weapon)?.species ?? 'ant';
    this.built.push({ id, slots, mesh, species, age: 0, turns, middle: s.center.clone(), reach: s.radius, of: { weapon, frame: f } });
    for (let k = 0; k < 24; k++) this.bit(f.feet[k % STATIONS], species, 5, 0.8, 0.1);
  }

  /** Blow a sphere out of what stands: its triangles there are gone, those at its edge end at it. */
  private blow(x: number, y: number, z: number, r: number, only = -1): void {
    for (const b of [...this.built]) {
      if (only >= 0 && b.id !== only) continue;
      b.mesh.updateMatrixWorld();
      const c = b.mesh.worldToLocal(this.p.set(x, y, z));
      if (c.distanceTo(b.middle) > r + b.reach) continue;
      const g = b.mesh.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const index = g.getIndex() as THREE.BufferAttribute;
      const p = pos.array;
      const idx = index.array;
      const inside = new Uint8Array(pos.count);
      const seed = x * 1.31 + z * 0.73 + y * 0.37;
      let hit = 0;
      for (let k = 0; k < pos.count; k++) {
        const dx = p[k * 3] - c.x;
        const dy = p[k * 3 + 1] - c.y;
        const dz = p[k * 3 + 2] - c.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < r * jag(dx / (d || 1), dy / (d || 1), dz / (d || 1), seed)) {
          inside[k] = 1;
          hit++;
        }
      }
      if (hit === 0) continue;
      // (silk round a hole sags: nothing holds it up there now)
      if (b.species === 'spider' && b.of) {
        const dn = new THREE.Vector3().copy(b.of.frame.up).applyQuaternion(this.q.copy(b.mesh.quaternion).invert());
        for (let k = 0; k < pos.count; k++) {
          if (inside[k]) continue;
          const dx = p[k * 3] - c.x;
          const dy = p[k * 3 + 1] - c.y;
          const dz = p[k * 3 + 2] - c.z;
          const t = 1 - (Math.sqrt(dx * dx + dy * dy + dz * dz) - r) / (r * 0.7);
          if (t <= 0) continue;
          const drop = r * 0.28 * t * t;
          p[k * 3] -= dn.x * drop;
          p[k * 3 + 1] -= dn.y * drop;
          p[k * 3 + 2] -= dn.z * drop;
        }
      }
      let n = 0;
      const moved: number[] = [];
      for (let k = 0; k < idx.length; k += 3) {
        const i = idx[k];
        const j = idx[k + 1];
        const l = idx[k + 2];
        if (inside[i] && inside[j] && inside[l]) continue;
        // (silk frays: what the blast touched is gone, not drawn up to its edge)
        // (and shell breaks in chips, not up to a smooth edge)
        if ((b.species === 'spider' || b.species === 'cockroach') && (inside[i] || inside[j] || inside[l])) continue;
        for (const v of [i, j, l])
          if (inside[v] === 1) {
            inside[v] = 2;
            moved.push(v);
          }
        idx[n] = i;
        idx[n + 1] = j;
        idx[n + 2] = l;
        n += 3;
      }
      // (to the sphere along its own surface, not off it: a thin sheet keeps a clean edge)
      const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
      for (const v of moved) {
        let dx = p[v * 3] - c.x;
        let dy = p[v * 3 + 1] - c.y;
        let dz = p[v * 3 + 2] - c.z;
        const d0 = Math.hypot(dx, dy, dz) || 1;
        const rr = r * jag(dx / d0, dy / d0, dz / d0, seed);
        let h = 0;
        if (nor) {
          const nx = nor.getX(v);
          const ny = nor.getY(v);
          const nz = nor.getZ(v);
          h = dx * nx + dy * ny + dz * nz;
          if (Math.abs(h) < rr * 0.9) {
            dx -= h * nx;
            dy -= h * ny;
            dz -= h * nz;
            const l = Math.hypot(dx, dy, dz) || 1;
            const k = Math.sqrt(rr * rr - h * h) / l;
            p[v * 3] = c.x + dx * k + h * nx;
            p[v * 3 + 1] = c.y + dy * k + h * ny;
            p[v * 3 + 2] = c.z + dz * k + h * nz;
            continue;
          }
        }
        const l = Math.hypot(dx, dy, dz) || 1;
        p[v * 3] = c.x + (dx / l) * rr;
        p[v * 3 + 1] = c.y + (dy / l) * rr;
        p[v * 3 + 2] = c.z + (dz / l) * rr;
      }
      // (what is left over at the end: nothing)
      for (let k = n; k < idx.length; k++) idx[k] = 0;
      g.setDrawRange(0, n);
      pos.needsUpdate = true;
      index.needsUpdate = true;
      this.line(b, c.x, c.y, c.z, r, seed);
      // (and pieces of it, that fall and stay)
      if (b.of) for (let k = 0; k < 16; k++) this.drop(x, y, z, r, b.species);
      for (let k = 0; k < 22; k++) this.bit(this.s.set(x, y, z), b.species, 10, r * 0.7, 0.16);
    }
  }

  /** A piece is gone (burnt): its triangles with it (over earth, its upper part). */
  private lose(id: number, slot: number, upper: boolean, at: THREE.Vector3): void {
    for (const b of this.built) {
      if (b.id !== id) continue;
      const idx = (b.mesh.geometry.getIndex() as THREE.BufferAttribute).array;
      const s = b.slots;
      const out = (v: number): boolean => (s[v] & 63) === slot && (!upper || s[v] >= 64);
      let n = 0;
      for (let k = 0; k < idx.length; k += 3) {
        if (out(idx[k]) && out(idx[k + 1]) && out(idx[k + 2])) continue;
        idx[n] = idx[k];
        idx[n + 1] = idx[k + 1];
        idx[n + 2] = idx[k + 2];
        n += 3;
      }
      for (let k = n; k < idx.length; k++) idx[k] = 0;
      b.mesh.geometry.setDrawRange(0, n);
      (b.mesh.geometry.getIndex() as THREE.BufferAttribute).needsUpdate = true;
      for (let k = 0; k < 16; k++) this.bit(at, b.species, 5, 1.2, 0.13);
    }
  }

  /** It closed a gap: whole again, but for the slots that are still gone. */
  private grow(id: number, gone: readonly number[]): void {
    const was = this.built.find((b) => b.id === id && b.of);
    if (!was?.of) return;
    // (the walls of its holes too)
    for (let k = this.built.length - 1; k >= 0; k--)
      if (this.built[k].id === id) {
        this.remove(this.built[k].mesh);
        this.built.splice(k, 1);
      }
    this.put(was.of.weapon, was.of.frame, was.turns, id);
    const now = this.built[this.built.length - 1];
    now.mesh.position.copy(was.mesh.position);
    now.mesh.quaternion.copy(was.mesh.quaternion);
    now.age = GROW;
    for (const s of gone) this.lose(id, s, false, now.middle);
  }

  /** The wall of a hole: what is inside shows there. */
  private line(b: Built, x: number, y: number, z: number, r: number, seed: number): void {
    if (!b.of) return;
    const { weapon, frame: f } = b.of;
    // (a mat of ants has no inside: the hole is just where they were)
    if (weapon === 'living-bridge') return;
    // (fine enough for a comb's cells and a shell's layers to show)
    const W = 112;
    const H = 80;
    const at: number[] = [];
    const deep: number[] = [];
    const high: number[] = [];
    const locals: number[] = [];
    const capSlots: number[] = [];
    const isWall = WEAPONS.find((w) => w.id === weapon)?.kind === 'wall';
    const side = this.a.crossVectors(f.up, f.out);
    const start = f.feet[0];
    const span = f.feet[STATIONS - 1];
    for (let j = 0; j <= H; j++)
      for (let i = 0; i <= W; i++) {
        const u = (i / W) * Math.PI * 2;
        const v = (j / H) * Math.PI;
        const rough = Math.sin(u * 9 + v * 5) * Math.sin(v * 8) * 0.5 + Math.sin(u * 17 - v * 13) * 0.3;
        const ux = Math.cos(u) * Math.sin(v);
        const uy = Math.cos(v);
        const uz = Math.sin(u) * Math.sin(v);
        // (into its frame: along it by the way from its first place to its last, as the model was put)
        const local = (k: number): [number, number, number] => {
          const px = x + ux * k;
          const py = y + uy * k;
          const pz = z + uz * k;
          const along = (px - start.x) * side.x + (py - start.y) * side.y + (pz - start.z) * side.z;
          const whole = (span.x - start.x) * side.x + (span.y - start.y) * side.y + (span.z - start.z) * side.z;
          const st = Math.min(STATIONS - 1, Math.max(0, (along / whole) * (STATIONS - 1)));
          const n = Math.min(STATIONS - 2, Math.floor(st));
          const t = st - n;
          const p = f.feet[n];
          const q = f.feet[n + 1];
          const dx = px - p.x - (q.x - p.x) * t;
          const dy = py - p.y - (q.y - p.y) * t;
          const dz = pz - p.z - (q.z - p.z) * t;
          return [f.first + (along / whole) * (STATIONS - 1) * f.gap, dx * f.up.x + dy * f.up.y + dz * f.up.z, dx * f.out.x + dy * f.out.y + dz * f.out.z];
        };
        const reach = r * jag(ux, uy, uz, seed);
        const l = local(reach);
        const d = outOf(weapon, l[0], l[1], l[2]);
        // (it meets the skin at the sphere itself; inside it is uneven)
        // (shell breaks in chips: its cut steps, not smooth)
        const dent = Math.min(0.14, Math.max(0, -d) * 0.22) * (0.55 + 0.45 * rough);
        let k = reach * (1 - (b.species === 'cockroach' ? Math.round(dent * 30) / 30 : dent));
        if (b.species === 'ant') {
          // (stakes break in splinters)
          k -= reach * 0.11 * Math.max(0, Math.sin(u * 17 + v * 5)) ** 4 * (0.5 + 0.5 * Math.abs(Math.sin(v * 23 - u * 5)));
        }
        if (b.species === 'bee') {
          // (each cell a pit: its honey lies deeper than its wax walls)
          const px = x + ux * reach;
          const py = y + uy * reach;
          const pz = z + uz * reach;
          const h = isWall ? hexAt(px * side.x + pz * side.z, py, 0.5) : hexAt(px * side.x + pz * side.z, px * f.out.x + py * f.out.y + pz * f.out.z, 0.5);
          k += 0.16 * (1 - ss(0.3, 0.38, h[2]));
        }
        at.push(x + ux * k, y + uy * k, z + uz * k);
        deep.push(d);
        high.push(l[1]);
        locals.push(l[0]);
      }
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const look: number[] = [];
    const living = weapon === 'living-bridge';
    const [c0, c1, rough, glow] = living ? [ANTS[0], ANTS[1], 0.75, 0.35] : INSIDE[b.species];
    const [thick, skin] = living ? [0, [0, 0, 0] as const] : SKIN[b.species];
    const side3 = side.clone();
    const p3 = new THREE.Vector3();
    const n3 = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    /** Where it comes out at the skin (and its slot): loose threads go from there. */
    const rim: number[] = [];
    /** Triangles of what of (i, j, k) is inside: cut where it comes out. */
    const tri = (ids: readonly number[]): void => {
      const poly: number[][] = [];
      for (let n = 0; n < 3; n++) {
        const i = ids[n];
        const j = ids[(n + 1) % 3];
        const a = deep[i];
        const c = deep[j];
        if (a <= 0) poly.push([at[i * 3], at[i * 3 + 1], at[i * 3 + 2], a, high[i]]);
        if (a <= 0 !== c <= 0) {
          const t = a / (a - c);
          const q = [0, 1, 2].map((k) => at[i * 3 + k] + (at[j * 3 + k] - at[i * 3 + k]) * t).concat([0, high[i] + (high[j] - high[i]) * t]);
          poly.push(q);
          rim.push(q[0], q[1], q[2], locals[i]);
        }
      }
      // (silk is threads: a hole in it is open, only threads cross it)
      if (poly.length < 3 || b.species === 'spider') return;
      const lx = locals[ids[0]];
      const slot = isWall ? Math.min(COLUMNS - 1, Math.max(0, Math.round((lx - f.first) / f.gap))) : Math.min(SPANS - 1, Math.max(0, Math.floor(lx / SPAN)));
      e1.set(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1], poly[1][2] - poly[0][2]);
      e2.set(poly[2][0] - poly[0][0], poly[2][1] - poly[0][1], poly[2][2] - poly[0][2]);
      n3.crossVectors(e1, e2).normalize();
      p3.set(x - poly[0][0], y - poly[0][1], z - poly[0][2]).normalize();
      // (its winding must face where its normal does: both sides are drawn, and the back one is lit as from behind)
      const flip = n3.dot(p3) < 0;
      if (flip) n3.negate();
      if (n3.lengthSq() < 0.5) n3.copy(p3);
      n3.lerp(p3, 0.45).normalize();
      const put = (q: readonly number[]): void => {
        pos.push(q[0], q[1], q[2]);
        nor.push(n3.x, n3.y, n3.z);
        const g = Math.sin(q[0] * 7.1 + q[1] * 11.3) * Math.sin(q[1] * 5.7 + q[2] * 9.1) * 0.5 + 0.5;
        // (an ant's wall: wood above, soil under it; the rest lighter towards the skin)
        const w = b.species === 'ant' ? ss(1.9, 2.6, q[4] + g * 0.4) * 0.75 + 0.25 * g : g * 0.6 + 0.4 * Math.min(1, Math.max(0, 1 + q[3] * 2));
        // (broken stakes side by side)
        const core = Math.abs(Math.sin((q[0] * side3.x + q[2] * side3.z) * 6.5));
        // (each cut through: dark bark, then rings, pale at its heart)
        const stakes = b.species === 'ant' ? 0.8 * (0.45 + 0.7 * ss(0.15, 0.45, core) * (0.85 + 0.15 * Math.sin(core * 26 + g * 2)) + 0.5 * ss(0.85, 1, core)) * (0.8 + 0.4 * g) : 1;
        let s = (0.75 + 0.35 * Math.min(1, Math.max(0, 1 + q[3]))) * stakes;
        // (an ant's earth: pebbles in it, damp and darker deep in)
        if (b.species === 'ant' && q[4] < 2.2) s *= (0.65 + 0.55 * (((Math.sin(Math.floor(q[0] * 5) * 12.99 + Math.floor(q[1] * 5) * 78.23 + Math.floor(q[2] * 5) * 37.72) * 43758.5) % 1 + 1) % 1)) * (0.75 + 0.25 * Math.min(1, Math.max(0, 1 + q[3] * 1.5)));
        let blend = w;
        let shine = glow;
        let rg = rough;
        if (b.species === 'bee') {
          // (broken cells: wax walls, honey in them)
          // (a bridge's cut is seen from above: its cells lie across it)
          const h = isWall ? hexAt(q[0] * side3.x + q[2] * side3.z, q[1], 0.5) : hexAt(q[0] * side3.x + q[2] * side3.z, q[0] * f.out.x + q[1] * f.out.y + q[2] * f.out.z, 0.5);
          const wall = ss(0.35, 0.39, h[2]);
          // (wax walls pale; in the cells, wet honey, deeper to their middles)
          blend = 0.05 + 0.9 * wall;
          s *= 1 - 0.35 * (1 - wall) * ss(0.33, 0.05, h[2]);
          shine = glow * (1 - 0.7 * wall);
          rg = 0.1 + 0.6 * wall;
        } else if (b.species === 'cockroach') {
          // (layer on layer of shell, dark between them)
          const layer = 0.5 + 0.5 * Math.sin(-q[3] * 38 + g * 1.2 + q[4] * 0.6);
          blend = ss(0.46, 0.54, layer) * 0.96 + 0.04 * g;
          rg = 0.25 + 0.45 * (1 - layer);
          shine = glow * (0.4 + 0.6 * layer);
        } else if (living) {
          // (round backs, one by one)
          const a = Math.sin(q[0] * 3.1 + q[2] * 1.7) * Math.sin(q[1] * 3.7 - q[2] * 2.3);
          blend = ss(0.1, 0.7, a) * 0.8 + 0.2 * g;
          rg = 0.6 + 0.3 * (1 - blend);
        }
        // (where it cuts the skin: the skin's thickness, as a rim)
        const edge = thick > 0 ? ss(-thick, -thick * 0.35, q[3]) : 0;
        if (edge > 0) s = s * (1 - edge) + edge;
        // (and with no skin, a lighter lip where the light still reaches)
        else s *= 1 + 0.35 * ss(-0.35, -0.03, q[3]);
        for (let k = 0; k < 3; k++) col.push(((c0[k] + (c1[k] - c0[k]) * blend) * (1 - edge) + skin[k] * edge) * s);
        look.push(rg, shine * (1 - 0.6 * edge), 0);
        capSlots.push(slot + (q[4] > SMOTHERED - 0.2 ? 64 : 0));
      };
      for (let n = 1; n + 1 < poly.length; n++) {
        put(poly[0]);
        put(poly[flip ? n + 1 : n]);
        put(poly[flip ? n : n + 1]);
      }
    };
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const a = i + j * (W + 1);
        tri([a, a + 1, a + W + 1]);
        tri([a + 1, a + W + 2, a + W + 1]);
      }
    // (silk: loose threads across the hole, some broken and hanging)
    if (b.species === 'spider' && rim.length >= 8) {
      const n = rim.length / 4;
      const dn = f.up;
      for (let k = 0; k < 13; k++) {
        const i = Math.floor(Math.random() * n) * 4;
        const a = [rim[i], rim[i + 1], rim[i + 2]];
        let e: number[];
        if (k < 3) {
          // (across, to the far side)
          let best = 0;
          let j = i;
          for (let m = 0; m < 6; m++) {
            const o = Math.floor(Math.random() * n) * 4;
            const d2 = (rim[o] - a[0]) ** 2 + (rim[o + 1] - a[1]) ** 2 + (rim[o + 2] - a[2]) ** 2;
            if (d2 > best) {
              best = d2;
              j = o;
            }
          }
          e = [rim[j], rim[j + 1], rim[j + 2]];
        } else {
          // (broken: towards the middle, and down)
          const t = 0.2 + 0.35 * Math.random();
          const fall = r * (0.5 + 0.9 * Math.random());
          e = [a[0] + (x - a[0]) * t - dn.x * fall, a[1] + (y - a[1]) * t - dn.y * fall, a[2] + (z - a[2]) * t - dn.z * fall];
        }
        const lx = rim[i + 3];
        const slot = isWall ? Math.min(COLUMNS - 1, Math.max(0, Math.round((lx - f.first) / f.gap))) : Math.min(SPANS - 1, Math.max(0, Math.floor(lx / SPAN)));
        const len = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
        if (len < 0.3) continue;
        const sag = len * (0.15 + 0.2 * Math.random());
        const w = 0.006 + 0.008 * Math.random();
        const tone = 0.8 + 0.25 * Math.random();
        const S = 8;
        const pt = (t: number): number[] => {
          const h = 4 * t * (1 - t) * sag;
          return [a[0] + (e[0] - a[0]) * t - dn.x * h, a[1] + (e[1] - a[1]) * t - dn.y * h, a[2] + (e[2] - a[2]) * t - dn.z * h];
        };
        // (two thin ribbons, crossed: a thread from any side)
        e1.set(e[0] - a[0], e[1] - a[1], e[2] - a[2]).normalize();
        for (const side of [e2.crossVectors(e1, dn).normalize().clone(), dn.clone()]) {
          if (side.lengthSq() < 0.5) continue;
          n3.crossVectors(e1, side).normalize();
          for (let s = 0; s < S; s++) {
            const p0 = pt(s / S);
            const p1 = pt((s + 1) / S);
            const quad = [
              [p0[0] - side.x * w, p0[1] - side.y * w, p0[2] - side.z * w],
              [p0[0] + side.x * w, p0[1] + side.y * w, p0[2] + side.z * w],
              [p1[0] + side.x * w, p1[1] + side.y * w, p1[2] + side.z * w],
              [p1[0] - side.x * w, p1[1] - side.y * w, p1[2] - side.z * w],
            ];
            for (const v of [0, 1, 2, 0, 2, 3]) {
              pos.push(quad[v][0], quad[v][1], quad[v][2]);
              nor.push(n3.x, n3.y, n3.z);
              for (let c = 0; c < 3; c++) col.push(skin[c] * tone);
              look.push(0.45, 0.6, 0);
              capSlots.push(slot);
            }
          }
        }
      }
    }
    // (honey: it runs out of broken cells and hangs in drops)
    if (b.species === 'bee' && rim.length >= 8) {
      const n = rim.length / 4;
      const dn = f.up;
      for (let k = 0; k < 14; k++) {
        const i = Math.floor(Math.random() * n) * 4;
        const a = [rim[i], rim[i + 1], rim[i + 2]];
        // (only where it can hang: not on the top of it)
        if ((a[0] - x) * dn.x + (a[1] - y) * dn.y + (a[2] - z) * dn.z > r * 0.3) continue;
        const l = r * (0.3 + 0.7 * Math.random());
        const lx = rim[i + 3];
        const slot = isWall ? Math.min(COLUMNS - 1, Math.max(0, Math.round((lx - f.first) / f.gap))) : Math.min(SPANS - 1, Math.max(0, Math.floor(lx / SPAN)));
        e1.set(1, 0, 0).cross(dn).normalize();
        if (e1.lengthSq() < 0.5) e1.set(0, 0, 1);
        const S = 6;
        for (const side of [e1.clone(), e2.crossVectors(dn, e1).normalize().clone()]) {
          n3.crossVectors(side, dn).normalize();
          for (let s = 0; s < S; s++) {
            const t0 = s / S;
            const t1 = (s + 1) / S;
            // (thin as it runs, a round drop at its end)
            const w0 = 0.03 + 0.05 * Math.max(0, t0 - 0.6) * (1 - t0) * 25;
            const w1 = 0.03 + 0.05 * Math.max(0, t1 - 0.6) * (1 - t1) * 25;
            const quad = [
              [a[0] - side.x * w0 - dn.x * l * t0, a[1] - side.y * w0 - dn.y * l * t0, a[2] - side.z * w0 - dn.z * l * t0],
              [a[0] + side.x * w0 - dn.x * l * t0, a[1] + side.y * w0 - dn.y * l * t0, a[2] + side.z * w0 - dn.z * l * t0],
              [a[0] + side.x * w1 - dn.x * l * t1, a[1] + side.y * w1 - dn.y * l * t1, a[2] + side.z * w1 - dn.z * l * t1],
              [a[0] - side.x * w1 - dn.x * l * t1, a[1] - side.y * w1 - dn.y * l * t1, a[2] - side.z * w1 - dn.z * l * t1],
            ];
            for (const v of [0, 1, 2, 0, 2, 3]) {
              pos.push(quad[v][0], quad[v][1], quad[v][2]);
              nor.push(n3.x, n3.y, n3.z);
              col.push(0.62, 0.27, 0.02);
              look.push(0.08, 0.9, 0);
              capSlots.push(slot);
            }
          }
        }
      }
    }
    if (pos.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('look', new THREE.BufferAttribute(new Float32Array(look), 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: pos.length / 3 }, (_, k) => k), 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.copy(b.mesh.position);
    mesh.quaternion.copy(b.mesh.quaternion);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.grown = 1.3;
    this.root.add(mesh);
    const s = g.boundingSphere as THREE.Sphere;
    this.built.push({ id: b.id, slots: Uint8Array.from(capSlots), mesh, species: b.species, age: GROW, turns: b.turns, middle: s.center.clone(), reach: s.radius, of: null });
  }

  // ---------------------------------------------------------------- shelters

  private hide(u: Unit, weapon: string): void {
    const g = this.models.get(weapon);
    if (!g) return;
    // (its own copy: wear shows on it)
    const mesh = new THREE.Mesh(g.clone(), this.material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.grown = 0;
    this.root.add(mesh);
    this.shelters.push({ unit: u.id, species: u.bug.species.id, mesh, t: 0, gone: -1, full: Math.max(1, u.coverLeft), stage: 0 });
  }

  /** Cracks in it: dark lines that branch over it, and the whole of it a little duller. */
  private crack(s: Shelter): void {
    const g = s.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let c = 0; c < 4; c++) {
      // (from a place on it high enough to be seen)
      let at = 0;
      for (let tries = 0; tries < 20; tries++) {
        at = Math.floor(Math.random() * pos.count);
        if (pos.getY(at) > 0.6) break;
      }
      const cx = pos.getX(at);
      const cy = pos.getY(at);
      const cz = pos.getZ(at);
      n.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      t.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(n).normalize();
      const R = 1.4 + Math.random();
      for (let k = 0; k < pos.count; k++) {
        const dx = pos.getX(k) - cx;
        const dy = pos.getY(k) - cy;
        const dz = pos.getZ(k) - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > R) continue;
        const along = dx * t.x + dy * t.y + dz * t.z;
        const off = dx * n.x + dy * n.y + dz * n.z + 0.18 * Math.sin(along * 7 + c) + 0.08 * Math.sin(along * 19);
        const w = 0.05 + 0.07 * (1 - d / R);
        if (Math.abs(off) >= w) continue;
        // (shell whitens where it is strained; earth, silk and wax open dark)
        if (s.species === 'cockroach') col.setXYZ(k, Math.min(1, col.getX(k) * 2.2 + 0.08), Math.min(1, col.getY(k) * 2.6 + 0.06), Math.min(1, col.getZ(k) * 3 + 0.03));
        else col.setXYZ(k, col.getX(k) * 0.2, col.getY(k) * 0.19, col.getZ(k) * 0.19);
      }
    }
    for (let k = 0; k < col.count; k++) col.setXYZ(k, col.getX(k) * 0.88, col.getY(k) * 0.86, col.getZ(k) * 0.85);
    col.needsUpdate = true;
  }

  /** Holes in it: pieces gone, scorched round, and fallen. */
  private hole(s: Shelter): void {
    const g = s.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const index = g.getIndex() as THREE.BufferAttribute;
    const idx = index.array;
    const gone = new Uint8Array(pos.count);
    s.mesh.updateMatrixWorld();
    for (let h = 0; h < 3; h++) {
      let at = 0;
      for (let tries = 0; tries < 30; tries++) {
        at = Math.floor(Math.random() * pos.count);
        if (pos.getY(at) > 0.8) break;
      }
      const cx = pos.getX(at);
      const cy = pos.getY(at);
      const cz = pos.getZ(at);
      const r = 0.45 + 0.35 * Math.random();
      const seed = Math.random() * 9;
      for (let k = 0; k < pos.count; k++) {
        const dx = pos.getX(k) - cx;
        const dy = pos.getY(k) - cy;
        const dz = pos.getZ(k) - cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const rr = r * jag(dx / (d || 1), dy / (d || 1), dz / (d || 1), seed);
        if (d < rr) gone[k] = 1;
        else if (d < rr * 1.6) {
          const k2 = 0.35 + 0.65 * ((d - rr) / (rr * 0.6));
          col.setXYZ(k, col.getX(k) * k2, col.getY(k) * k2, col.getZ(k) * k2);
        }
      }
      this.p.set(cx, cy, cz).applyMatrix4(s.mesh.matrixWorld);
      for (let k = 0; k < 6; k++) this.drop(this.p.x, this.p.y, this.p.z, 0.3, s.species === 'cockroach' ? 'husk' : s.species, s.species === 'cockroach', s.species === 'ant' ? 0.4 : 1);
    }
    let n = 0;
    for (let k = 0; k < idx.length; k += 3) {
      if (gone[idx[k]] || gone[idx[k + 1]] || gone[idx[k + 2]]) continue;
      idx[n] = idx[k];
      idx[n + 1] = idx[k + 1];
      idx[n + 2] = idx[k + 2];
      n += 3;
    }
    for (let k = n; k < idx.length; k++) idx[k] = 0;
    g.setDrawRange(0, n);
    index.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Before the bugs are posed: how each one sits. */
  pose(match: Match, views: readonly BugView[]): void {
    match.units.forEach((u, i) => {
      const seat = u.bug.alive && u.cover ? SEAT[u.cover.id] : undefined;
      views[i].seated = seat !== undefined;
      if (seat) [views[i].seatOut, views[i].seatSize] = seat;
    });
  }

  private placeShelter(s: Shelter, u: Unit, view: BugView): void {
    const b = u.bug;
    const r = b.species.radius;
    // (on the ground under it, along its normal)
    if (s.gone < 0) {
      this.p.set(b.nx, b.ny, b.nz);
      this.a.set(b.hx, b.hy, b.hz);
      this.a.addScaledVector(this.p, -this.a.dot(this.p)).normalize();
      this.s.crossVectors(this.p, this.a);
      s.mesh.quaternion.setFromRotationMatrix(this.m.makeBasis(this.s, this.p, this.a));
      s.mesh.position.copy(view.restPoint).addScaledVector(this.p, -r);
    }
    s.mesh.userData.grown = ss(0, COME, s.t) * 1.3;
    const go = s.gone < 0 ? 1 : 1 - s.gone / GO;
    s.mesh.scale.setScalar(Math.max(0.01, r * (s.species === 'spider' ? 1.3 : 1) * (0.55 + 0.45 * go)));
    if (s.gone >= 0) s.mesh.position.addScaledVector(this.s.set(0, 1, 0).applyQuaternion(s.mesh.quaternion), -s.gone * 0.16);
  }

  // ---------------------------------------------------------------- every frame

  /** `placing`: what the player is placing (null: nobody is). */
  update(match: Match, views: readonly BugView[], placing: Placing | null, dt: number, time: number): void {
    this.field = match.field;
    this.showGhost(match, placing, time);
    this.turn(match);
    for (let k = 0; k < this.blasts.length; k += 4) this.blow(this.blasts[k], this.blasts[k + 1], this.blasts[k + 2], this.blasts[k + 3]);
    this.blasts.length = 0;
    for (const w of this.worn) this.blow(w.at[0], w.at[1], w.at[2], w.at[3], w.id);
    this.worn.length = 0;
    for (const l of this.lost) this.lose(l.id, l.slot, l.upper, l.at);
    this.lost.length = 0;
    this.burn(dt, time);
    for (const b of this.built) {
      b.age += dt;
      b.mesh.userData.grown = Math.min(1.3, (b.age / GROW) * 1.3);
    }
    for (let i = this.shelters.length - 1; i >= 0; i--) {
      const s = this.shelters[i];
      s.t += dt;
      if (s.gone >= 0) s.gone += dt;
      if (s.gone < 0) {
        // (how worn it is shows: cracked at two thirds, holed at one)
        const u = match.units[s.unit];
        const left = u.cover ? u.coverLeft / s.full : 1;
        const stage = left <= 1 / 3 ? 2 : left <= 2 / 3 ? 1 : 0;
        while (s.stage < stage) {
          s.stage++;
          if (s.stage === 1) this.crack(s);
          else this.hole(s);
        }
      }
      if (s.gone > GO) {
        this.remove(s.mesh);
        this.shelters.splice(i, 1);
        continue;
      }
      this.placeShelter(s, match.units[s.unit], views[s.unit]);
    }
    let n = 0;
    this.bits.forEach((b, i) => {
      if (b.t < b.life) {
        b.t += dt;
        b.v.y -= 20 * dt;
        b.at.addScaledVector(b.v, dt);
        n++;
      }
      const k = b.t < b.life ? b.size * Math.min(1, (1 - b.t / b.life) * 3) : 0;
      this.q.setFromEuler(this.e.set(i + b.t * 9, i * 2 + b.t * 7, i));
      this.flakes.setMatrixAt(i, this.m.compose(b.at, this.q, this.s.set(k, k * 0.45, k * 0.8)));
    });
    this.settle(dt);
    this.flakes.visible = n > 0;
    if (n > 0) this.flakes.instanceMatrix.needsUpdate = true;
  }

  /** Flames on what burns, until its fire is out. */
  private burn(dt: number, time: number): void {
    let n = 0;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += f.out ? -dt * 2.5 : dt;
      if (f.out && f.t > 0.6) f.t = 0.6;
      if (f.out && f.t <= 0) {
        this.fires.splice(i, 1);
        continue;
      }
      const on = Math.min(1, f.t / 0.6);
      for (let k = 0; k < FLAMES_EACH && n < FLAMES; k++) {
        const a = k * 2.4 + i;
        const p = (time * (0.9 + 0.25 * Math.sin(k * 7.1)) + k * 0.37 + i * 0.21) % 1;
        const r = 0.9 * Math.sqrt((k + 0.5) / FLAMES_EACH);
        this.p.set(f.at.x + Math.cos(a) * r, f.at.y + f.high * (k / FLAMES_EACH - 0.3) + p * 1.5, f.at.z + Math.sin(a) * r);
        const s = on * (0.42 + 0.2 * Math.sin(k * 3.3)) * Math.sin(Math.PI * Math.min(1, p * 1.15 + 0.08));
        this.q.setFromEuler(this.e.set(0.25 * Math.sin(time * 9 + k), a + time, 0.25 * Math.cos(time * 8 + k * 2)));
        this.flames.setMatrixAt(n++, this.m.compose(this.p, this.q, this.s.set(s * 0.7, s * 1.7, s * 0.7)));
      }
      if (Math.random() < dt * 5) this.bit(f.at, 'ember', 3, 0.8, 0.06);
    }
    this.flames.count = n;
    this.flames.visible = n > 0;
    if (n > 0) this.flames.instanceMatrix.needsUpdate = true;
  }

  /** What stands on a turntable goes round with it. */
  private turn(match: Match): void {
    const tt = match.options.turntable;
    const by = match.turntableTurns - this.turned;
    this.turned = match.turntableTurns;
    if (!tt || by <= 0) return;
    const a = (-by * Math.PI) / 2;
    const axis = this.p.set(tt.x, 0, tt.z);
    for (const b of this.built) {
      if (!b.turns) continue;
      b.mesh.position.sub(axis).applyAxisAngle(UP, a).add(axis);
      b.mesh.quaternion.premultiply(this.q.setFromAxisAngle(UP, a));
    }
  }

  private showGhost(match: Match, placing: Placing | null, time: number): void {
    const s = placing?.shown ?? null;
    const u = match.activeUnit;
    const b = u.bug;
    const model = s ? this.models.get(s.w.id) : undefined;
    const going = match.going;
    this.ghost.visible = model !== undefined;
    this.ring.visible = this.spot.visible = false;
    if (going) {
      // (where it is going to hide)
      const g = this.models.get(going.w.id);
      if (!g) return;
      this.ghost.geometry = g;
      this.ghost.visible = true;
      this.ghostShelter(b.x, b.z, going.x, going.y, going.z, b.species.radius);
      this.ghostColor.value.set(...GHOST[0]);
      return;
    }
    if (!s || !model) return;
    // (a bridge's near end: the rest of it comes with its far one)
    const ok = s.why === '' || (s.w.kind === 'bridge' && !placing?.first && (s.why === 'no room' || s.why === 'nothing to bridge'));
    this.ghostBeat.value = 0.5 + 0.5 * Math.sin(time * 5);
    this.ghostColor.value.set(...GHOST[ok ? 0 : 1]);
    this.ghost.geometry = model;
    const [x, y, z, fx, fy, fz] = s.place;
    const f = this.ghostFrame;
    if (s.w.kind === 'shelter') this.ghostShelter(b.x, b.z, x, y, z, b.species.radius);
    else if (s.pieces.length > 0) {
      frameOf(s.pieces, s.w.kind === 'wall', f);
      this.setGhost();
    } else {
      // (no room for it: where it would be, flat)
      const l = Math.hypot(fx, fz) || 1;
      f.up.set(0, 1, 0);
      if (s.w.kind === 'wall') {
        f.out.set(fx / l, 0, fz / l);
        f.first = (-(COLUMNS - 1) / 2) * APART;
        f.gap = APART;
      } else {
        f.out.set(-fz / l, 0, fx / l);
        f.first = 0;
        f.gap = (SPANS * SPAN) / (STATIONS - 1);
      }
      this.a.crossVectors(f.up, f.out);
      f.feet.forEach((v, i) => v.set(x, y + (s.w.kind === 'bridge' ? 0.7 : 0), z).addScaledVector(this.a, f.first + i * f.gap));
      f.x0 = -99;
      f.x1 = s.w.kind === 'wall' ? 99 : Math.max(2, Math.hypot(fx, fy, fz));
      this.setGhost();
    }
    // ---- how far it may be, and the spot itself
    this.ring.visible = !(s.w.kind === 'bridge' && placing?.first);
    this.ring.position.set(b.x - b.nx * (b.species.radius - 0.12), b.y - b.ny * (b.species.radius - 0.12), b.z - b.nz * (b.species.radius - 0.12));
    this.ring.quaternion.setFromUnitVectors(UP, this.p.set(b.nx, b.ny, b.nz));
    this.ring.scale.setScalar(s.w.reach);
    this.spot.visible = true;
    this.spot.position.set(x, y + 0.12, z);
    (this.spot.material as THREE.MeshBasicNodeMaterial).color.setHex(ok ? 0x5cc8ff : 0xff5a45);
  }

  /** The ghost is a shelter, for a bug of this radius that comes from (bx, bz). */
  private ghostShelter(bx: number, bz: number, x: number, y: number, z: number, r: number): void {
    const f = this.ghostFrame;
    const l = Math.hypot(x - bx, z - bz);
    f.up.set(0, r, 0);
    f.out.set(l > 0.5 ? ((x - bx) / l) * r : 0, 0, l > 0.5 ? ((z - bz) / l) * r : r);
    this.a.set(f.out.z, 0, -f.out.x);
    f.first = -6;
    f.gap = 2;
    f.feet.forEach((v, i) => v.set(x, y, z).addScaledVector(this.a, f.first + i * f.gap));
    f.x0 = -99;
    f.x1 = 99;
    this.setGhost();
  }

  private setGhost(): void {
    const f = this.ghostFrame;
    f.feet.forEach((v, i) => (this.ghostFeet.array[i] as THREE.Vector3).copy(v));
    this.ghostUp.value.copy(f.up);
    this.ghostOut.value.copy(f.out);
    this.ghostEnds.value.set(f.x0, f.x1, f.first, f.gap);
  }
}
