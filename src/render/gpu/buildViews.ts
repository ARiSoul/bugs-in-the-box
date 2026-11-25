import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, float, floor, mix, normalView, positionGeometry, positionViewDirection, pow, smoothstep, uniform, uniformArray } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { APART, COLUMNS, DECK_UNDER, PIECE, shifted, SPAN, SPANS, WALL_DEEP } from '../../game/build';
import type { Match, MatchEvent, Unit } from '../../game/match';
import { WEAPONS } from '../../game/weapons';
import type { BuildReply } from '../../workers/build.worker';
import type { BugView } from '../BugView';
import { outOf } from './buildModels';
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
const GHOST: readonly (readonly [number, number, number])[] = [[0.02, 0.22, 1], [1, 0.03, 0.01]];

/** How a bug sits in its shelter (in its radius): how far forward, how large. */
const SEAT: Record<string, readonly [number, number]> = { anthill: [0.62, 0.92], 'silk-funnel': [0.62, 0.62], husk: [0.95, 0.82], 'wax-nest': [0.35, 0.78] };
/** What flies off of each species' work. */
const BITS: Record<string, readonly number[]> = { ant: [0x6b4a2e, 0xb08a55, 0x4a3423], spider: [0xd8d4ca, 0xb9b6ae], cockroach: [0x8a3d12, 0x5a240a, 0xc98a4a], bee: [0xd9942a, 0xb86a10, 0xffc040] };

/** What each is made of inside: two colours, how rough, how much light comes through. */
const INSIDE: Record<string, readonly [readonly [number, number, number], readonly [number, number, number], number, number]> = {
  ant: [[0.12, 0.06, 0.025], [0.34, 0.2, 0.09], 0.95, 0.05],
  spider: [[0.3, 0.29, 0.27], [0.52, 0.5, 0.46], 0.7, 0.1],
  cockroach: [[0.16, 0.04, 0.009], [0.46, 0.14, 0.025], 0.8, 0.3],
  bee: [[0.4, 0.15, 0.015], [0.7, 0.3, 0.035], 0.8, 0.4],
};

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
  private waiting: { weapon: string; frame: Frame; turns: boolean }[] = [];
  private readonly blasts: number[] = [];
  private turned = 0;
  private readonly shelters: Shelter[] = [];
  private readonly flakes: THREE.InstancedMesh;
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
    {
      const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const look = attribute('look', 'vec3') as unknown as V3;
      const rim = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 2) as unknown as F;
      const grown = uniform(1).onObjectUpdate(({ object }) => (object?.userData.grown as number | undefined) ?? 1) as unknown as F;
      const base = attribute('color', 'vec3') as unknown as V3;
      m.roughnessNode = look.x;
      m.maskNode = look.z.lessThan(grown);
      // (what has just come is warm for a moment)
      const fresh = smoothstep(0.12, 0, grown.sub(look.z)).mul(smoothstep(1.2, 1, grown));
      m.emissiveNode = base.mul(look.y).mul(rim.mul(1.6).add(0.12)).add(base.mul(fresh).mul(1.4));
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
    const g = new THREE.IcosahedronGeometry(1, 0);
    this.flakes = new THREE.InstancedMesh(g, new THREE.MeshStandardNodeMaterial({ roughness: 0.7 }), FLAKES);
    this.flakes.frustumCulled = false;
    this.flakes.castShadow = true;
    for (let i = 0; i < FLAKES; i++) {
      this.flakes.setColorAt(i, new THREE.Color(0xffffff));
      this.bits.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), t: 9, life: 1, size: 0 });
    }
    this.root.add(this.flakes);
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
    for (const q of now) this.put(id, q.frame, q.turns);
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
    for (const s of this.shelters) this.root.remove(s.mesh);
    this.shelters.length = 0;
    this.ghost.visible = this.ring.visible = this.spot.visible = false;
    for (const b of this.bits) b.t = b.life;
    this.blasts.length = 0;
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
      if (this.models.has(e.weapon)) this.put(e.weapon, frame, turns);
      else this.waiting.push({ weapon: e.weapon, frame, turns });
    } else if (e.type === 'explosion') this.blasts.push(e.x, e.y, e.z, e.radius);
    else if (e.type === 'dig') {
      const l = Math.hypot(e.x2 - e.x1, e.y2 - e.y1, e.z2 - e.z1);
      const n = Math.max(1, Math.ceil(l / (e.radius * 0.5)));
      for (let i = 0; i <= n; i++) this.blasts.push(e.x1 + ((e.x2 - e.x1) * i) / n, e.y1 + ((e.y2 - e.y1) * i) / n, e.z1 + ((e.z2 - e.z1) * i) / n, e.radius);
    } else if (e.type === 'hide') this.hide(match.units[e.unit], e.weapon);
    else if (e.type === 'bared') {
      const s = this.shelters.find((q) => q.unit === e.unit && q.gone < 0);
      if (!s) return;
      s.gone = 0;
      const r = match.units[e.unit].bug.species.radius;
      this.p.copy(s.mesh.position).addScaledVector(this.s.copy(UP).applyQuaternion(s.mesh.quaternion), r);
      for (let k = 0; k < (e.broken ? 40 : 10); k++) this.bit(this.p, s.species, e.broken ? 11 : 5, r * 1.6, 0.17);
    } else if (e.type === 'caught') {
      for (let k = 0; k < 14; k++) this.bit(this.p.set(e.x, e.y, e.z), 'spider', 4, 0.3, 0.08);
    }
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

  // ---------------------------------------------------------------- walls and bridges

  /** Put one up: its model, bent over the ground it stands on. */
  private put(weapon: string, f: Frame, turns: boolean): void {
    const model = this.models.get(weapon) as THREE.BufferGeometry;
    const p = (model.getAttribute('position') as THREE.BufferAttribute).array;
    const n = (model.getAttribute('normal') as THREE.BufferAttribute).array;
    const pos = new Float32Array(p.length);
    const nor = new Float32Array(p.length);
    const side = new THREE.Vector3().crossVectors(f.up, f.out);
    const { up, out } = f;
    for (let k = 0; k < p.length; k += 3) {
      const x = Math.min(f.x1, Math.max(f.x0, p[k]));
      const st = (x - f.first) / f.gap;
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
    this.built.push({ mesh, species, age: 0, turns, middle: s.center.clone(), reach: s.radius, of: { weapon, frame: f } });
    for (let k = 0; k < 24; k++) this.bit(f.feet[k % STATIONS], species, 5, 0.8, 0.1);
  }

  /** Blow a sphere out of what stands: its triangles there are gone, those at its edge end at it. */
  private blow(x: number, y: number, z: number, r: number): void {
    for (const b of [...this.built]) {
      b.mesh.updateMatrixWorld();
      const c = b.mesh.worldToLocal(this.p.set(x, y, z));
      if (c.distanceTo(b.middle) > r + b.reach) continue;
      const g = b.mesh.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const index = g.getIndex() as THREE.BufferAttribute;
      const p = pos.array;
      const idx = index.array;
      const inside = new Uint8Array(pos.count);
      let hit = 0;
      for (let k = 0; k < pos.count; k++) {
        const dx = p[k * 3] - c.x;
        const dy = p[k * 3 + 1] - c.y;
        const dz = p[k * 3 + 2] - c.z;
        if (dx * dx + dy * dy + dz * dz < r * r) {
          inside[k] = 1;
          hit++;
        }
      }
      if (hit === 0) continue;
      let n = 0;
      const moved: number[] = [];
      for (let k = 0; k < idx.length; k += 3) {
        const i = idx[k];
        const j = idx[k + 1];
        const l = idx[k + 2];
        if (inside[i] && inside[j] && inside[l]) continue;
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
      for (const v of moved) {
        const dx = p[v * 3] - c.x;
        const dy = p[v * 3 + 1] - c.y;
        const dz = p[v * 3 + 2] - c.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        p[v * 3] = c.x + (dx / l) * r;
        p[v * 3 + 1] = c.y + (dy / l) * r;
        p[v * 3 + 2] = c.z + (dz / l) * r;
      }
      // (what is left over at the end: nothing)
      for (let k = n; k < idx.length; k++) idx[k] = 0;
      g.setDrawRange(0, n);
      pos.needsUpdate = true;
      index.needsUpdate = true;
      this.line(b, c.x, c.y, c.z, r);
      for (let k = 0; k < 22; k++) this.bit(this.s.set(x, y, z), b.species, 10, r * 0.7, 0.16);
    }
  }

  /** The wall of a hole: what is inside shows there. */
  private line(b: Built, x: number, y: number, z: number, r: number): void {
    if (!b.of) return;
    const { weapon, frame: f } = b.of;
    const W = 56;
    const H = 40;
    const at: number[] = [];
    const deep: number[] = [];
    const high: number[] = [];
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
        const l = local(r);
        const d = outOf(weapon, l[0], l[1], l[2]);
        // (it meets the skin at the sphere itself; inside it is uneven)
        const k = r * (1 - Math.min(0.14, Math.max(0, -d) * 0.22) * (0.55 + 0.45 * rough));
        at.push(x + ux * k, y + uy * k, z + uz * k);
        deep.push(d);
        high.push(l[1]);
      }
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const look: number[] = [];
    const [c0, c1, rough, glow] = INSIDE[b.species];
    const side3 = side.clone();
    const p3 = new THREE.Vector3();
    const n3 = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
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
          poly.push([0, 1, 2].map((k) => at[i * 3 + k] + (at[j * 3 + k] - at[i * 3 + k]) * t).concat([0, high[i] + (high[j] - high[i]) * t]));
        }
      }
      if (poly.length < 3) return;
      e1.set(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1], poly[1][2] - poly[0][2]);
      e2.set(poly[2][0] - poly[0][0], poly[2][1] - poly[0][1], poly[2][2] - poly[0][2]);
      n3.crossVectors(e1, e2).normalize();
      p3.set(x - poly[0][0], y - poly[0][1], z - poly[0][2]).normalize();
      if (n3.dot(p3) < 0) n3.negate();
      if (n3.lengthSq() < 0.5) n3.copy(p3);
      n3.lerp(p3, 0.45).normalize();
      const put = (q: readonly number[]): void => {
        pos.push(q[0], q[1], q[2]);
        nor.push(n3.x, n3.y, n3.z);
        const g = Math.sin(q[0] * 7.1 + q[1] * 11.3) * Math.sin(q[1] * 5.7 + q[2] * 9.1) * 0.5 + 0.5;
        // (an ant's wall: wood above, soil under it; the rest lighter towards the skin)
        const w = b.species === 'ant' ? ss(1.9, 2.6, q[4] + g * 0.4) * 0.75 + 0.25 * g : g * 0.6 + 0.4 * Math.min(1, Math.max(0, 1 + q[3] * 2));
        // (broken stakes side by side)
        const stakes = b.species === 'ant' ? 0.62 + 0.5 * Math.abs(Math.sin((q[0] * side3.x + q[2] * side3.z) * 6.5)) * (0.7 + 0.6 * g) : 1;
        const s = (0.75 + 0.35 * Math.min(1, Math.max(0, 1 + q[3]))) * stakes;
        for (let k = 0; k < 3; k++) col.push((c0[k] + (c1[k] - c0[k]) * w) * s);
        look.push(rough, glow, 0);
      };
      for (let n = 1; n + 1 < poly.length; n++) {
        put(poly[0]);
        put(poly[n]);
        put(poly[n + 1]);
      }
    };
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const a = i + j * (W + 1);
        tri([a, a + 1, a + W + 1]);
        tri([a + 1, a + W + 2, a + W + 1]);
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
    this.built.push({ mesh, species: b.species, age: GROW, turns: b.turns, middle: s.center.clone(), reach: s.radius, of: null });
  }

  // ---------------------------------------------------------------- shelters

  private hide(u: Unit, weapon: string): void {
    const g = this.models.get(weapon);
    if (!g) return;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.grown = 0;
    this.root.add(mesh);
    this.shelters.push({ unit: u.id, species: u.bug.species.id, mesh, t: 0, gone: -1 });
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
    this.showGhost(match, placing, time);
    this.turn(match);
    for (let k = 0; k < this.blasts.length; k += 4) this.blow(this.blasts[k], this.blasts[k + 1], this.blasts[k + 2], this.blasts[k + 3]);
    this.blasts.length = 0;
    for (const b of this.built) {
      b.age += dt;
      b.mesh.userData.grown = Math.min(1.3, (b.age / GROW) * 1.3);
    }
    for (let i = this.shelters.length - 1; i >= 0; i--) {
      const s = this.shelters[i];
      s.t += dt;
      if (s.gone >= 0) s.gone += dt;
      if (s.gone > GO) {
        this.root.remove(s.mesh);
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
    this.flakes.visible = n > 0;
    if (n > 0) this.flakes.instanceMatrix.needsUpdate = true;
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
