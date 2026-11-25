import * as THREE from 'three/webgpu';
import { abs, attribute, bumpMap, color, float, floor, fract, mix, mx_noise_float, normalView, positionGeometry, positionViewDirection, smoothstep, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BugView } from '../BugView';
import { coat, ellipsoid, FEMUR, FOOT, fur, hairs, shape, ss, tube } from './beeModel';
import { own, ownColor } from './heroDress';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;
const f = (n: unknown): F => n as F;
const c3 = (n: unknown): V3 => n as V3;
const tint = (c: THREE.ColorRepresentation): V3 => c3(color(new THREE.Color(c)));
const rgb = (c: number): THREE.Color => new THREE.Color(c);
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);
const BALL = new THREE.SphereGeometry(1, 32, 24);

/** Each team's colours on a face: the shell, its shade, its light, the eyes' ring, the limbs, the pale of the muzzle. */
export const HUE = [
  { shell: 0xa01810, deep: 0x480806, light: 0xc83a20, iris: 0xa32c12, limb: 0x2a0806, pale: 0xffdfb0, edge: 0xffb27a, blush: 0xf0606e },
  { shell: 0x0e44ac, deep: 0x081c50, light: 0x2c80f0, iris: 0x1a55b4, limb: 0x081430, pale: 0xa8ccf4, edge: 0x9ad4ff, blush: 0xff8fae },
];

export interface FaceParts {
  blink(shut: number): void;
  open(k: number): void;
  cry(on: boolean): void;
  sway(seconds: number, lively: number): void;
  coats: THREE.InstancedMesh[];
  small: THREE.Object3D[];
}

interface EyeSpec {
  x: number;
  y: number;
  z: number;
  r: [number, number, number];
  turn: [number, number, number];
  /** It has lids and the big lights. */
  main: boolean;
}

interface HeadSpec {
  r: [number, number, number];
  /** How much narrower the chin is, how flat the front. */
  taper: number;
  flat: number;
  muzzle: { y: number; sx: number; sy: number; h: number };
  smile: { y: number; w: number; lift: number; thick: number; tilt?: number };
  eyes: EyeSpec[];
}

/** A head: its shape, the face's front at a place, the smile on it. */
class HeadShape {
  readonly geometry: THREE.BufferGeometry;
  private readonly sockets: { m: THREE.Matrix4; r: [number, number, number] }[] = [];

  constructor(readonly s: HeadSpec) {
    const [rx, ry, rz] = s.r;
    this.geometry = shape(ellipsoid(rx, ry, rz, 112, 88), (p) => {
      const down = Math.max(0, -p.y / ry);
      p.x *= 1 - s.taper * down * down;
      p.z = this.flat(p.z);
      if (p.z > 0) p.z += this.bulge(p.x, p.y) * ss(0, rz * 0.6, p.z);
    });
    for (const e of s.eyes) for (const x of [-1, 1]) this.sockets.push({ m: HeadShape.eyeMatrix(e, x).invert(), r: e.r });
  }

  static eyeMatrix(e: EyeSpec, x: number): THREE.Matrix4 {
    return new THREE.Matrix4().compose(v3(x * e.x, e.y, e.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(e.turn[0], x * e.turn[1], x * e.turn[2])), v3(1, 1, 1));
  }

  private flat(z: number): number {
    const at = this.s.r[2] * 0.6;
    return z > at ? at + (z - at) * this.s.flat : z;
  }

  private bulge(x: number, y: number): number {
    const m = this.s.muzzle;
    return m.h * Math.exp(-((x / m.sx) ** 2) - ((y - m.y) / m.sy) ** 2);
  }

  front(x: number, y: number): number {
    const [rx, ry, rz] = this.s.r;
    const down = Math.max(0, -y / ry);
    const z = this.flat(rz * Math.sqrt(Math.max(0, 1 - (x / (rx * (1 - this.s.taper * down * down))) ** 2 - (y / ry) ** 2)));
    return z + this.bulge(x, y) * ss(0, rz * 0.6, z);
  }

  /** On the face at (x, y), `out` off it. */
  on(x: number, y: number, out: number): THREE.Vector3 {
    const e = 0.004;
    const n = v3((this.front(x - e, y) - this.front(x + e, y)) / (2 * e), (this.front(x, y - e) - this.front(x, y + e)) / (2 * e), 1).normalize();
    return v3(x, y, this.front(x, y)).addScaledVector(n, out);
  }

  smile(x: number): number {
    const s = this.s.smile;
    return s.y - s.lift * 0.5 + s.lift * 1.35 * (Math.abs(x) / s.w) ** 2 + (s.tilt ?? 0) * x;
  }

  inEye(p: THREE.Vector3, grow: number): boolean {
    const q = new THREE.Vector3();
    for (const e of this.sockets) {
      q.copy(p).applyMatrix4(e.m);
      if ((q.x / e.r[0]) ** 2 + (q.y / e.r[1]) ** 2 + (q.z / e.r[2]) ** 2 < grow) return true;
    }
    return false;
  }

  /** 0..1: how far a place is from the line of the smile. */
  groove(p: THREE.Vector3): number {
    if (p.z < this.s.r[2] * 0.5 || Math.abs(p.x) > this.s.smile.w * 1.05) return 1;
    const d = p.y - this.smile(p.x);
    // (the hairs above it lie down over it: they start farther off)
    return d > 0 ? ss(0.012, 0.045, d) : ss(0.005, 0.02, -d);
  }

  /** The smile: a line that thins towards its ends, in the cheeks. */
  lip(out: number): THREE.BufferGeometry {
    const { w, thick } = this.s.smile;
    const pts: THREE.Vector3[] = [];
    for (let i = -10; i <= 10; i++) pts.push(this.on((i / 10) * w, this.smile((i / 10) * w), out));
    return tube(pts, (u) => 0.0003 + thick * Math.sin(Math.PI * u) ** 0.9, 64, 8);
  }

  mouth(out: number): THREE.BufferGeometry {
    const { w } = this.s.smile;
    return shape(new THREE.PlaneGeometry(1, 1, 28, 12), (p) => {
      const x = p.x * w * 1.86;
      const deep = w * 0.78 * Math.max(0, 1 - (p.x * 2) ** 2) ** 0.8;
      p.copy(this.on(x, this.smile(x) + 0.003 - (0.5 - p.y) * deep, out));
    });
  }

  /** A round mouth that cries out. */
  cry(out: number): THREE.BufferGeometry {
    const { w } = this.s.smile;
    const y = this.smile(0) - w * 0.16;
    return shape(new THREE.CircleGeometry(1, 40), (p) => p.copy(this.on(p.x * w * 0.5, y + p.y * w * 0.62, out)));
  }

  tongue(out: number): THREE.BufferGeometry {
    const { w } = this.s.smile;
    const low = this.smile(0) - w * 0.52;
    return shape(new THREE.SphereGeometry(w * 0.3, 28, 18), (p) => {
      const lift = Math.max(0, p.z) * 0.35;
      p.copy(this.on(p.x * 1.35, low + p.y * 0.62, out + lift));
    });
  }

  /** The colour of every place on it. */
  paint(look: (p: THREE.Vector3, out: THREE.Color) => void): void {
    const pos = this.geometry.getAttribute('position');
    const out = new Float32Array(pos.count * 3);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      look(p.fromBufferAttribute(pos, i), c);
      out.set([c.r, c.g, c.b], i * 3);
    }
    this.geometry.setAttribute('paint', new THREE.Float32BufferAttribute(out, 3));
  }
}

// ---------------------------------------------------------------- materials (made once)

const made = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  let m = made.get(key) as T | undefined;
  if (m === undefined) made.set(key, (m = make()));
  return m;
}
const rim = (p: number): F => f(float(1).sub(abs(normalView.dot(positionViewDirection))).pow(p));

/** A painted skin: lacquered (a beetle's) or soft under a coat. */
function painted(side: number, gloss: number): THREE.Material {
  return once(`painted${side}${gloss}`, () => {
    const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.95 - 0.4 * gloss, clearcoat: 0, specularIntensity: 0.02 + 0.1 * gloss, envMapIntensity: 0.8 });
    m.fog = false;
    const dull = own((b) => b.dull);
    const c = c3(attribute('paint', 'vec3'));
    m.colorNode = mix(c.mul(mx_noise_float(positionGeometry.mul(14)).mul(0.06).add(1)), vec3(0.05, 0.045, 0.04), dull.mul(0.7));
    if (gloss > 0) m.normalNode = bumpMap(f(mx_noise_float(positionGeometry.mul(46))), float(0.004));
    m.emissiveNode = c3(tint(HUE[side].edge).mul(rim(3.2).mul(0.015))).mul(dull.oneMinus()).add(ownColor((b) => b.skin.emissive));
    return m;
  });
}

/** Eyes that look back: a dark middle in a ring of the team's colour, soft lights, facets for an insect's. */
function eyeMaterial(side: number, facets: boolean): THREE.Material {
  return once(`eye${side}${facets}`, () => {
    const T = HUE[side];
    const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.07, specularIntensity: 0.5 });
    m.fog = false;
    const u = c3(attribute('unit', 'vec3'));
    const mir = f(attribute('mir', 'float'));
    const p = c3(vec3(u.x.mul(mir), u.y, u.z));
    const ndv = f(abs(normalView.dot(positionViewDirection)));
    const spot = f(smoothstep(0.82, 0.96, ndv));
    const out = f(smoothstep(0.95, 0.5, ndv));
    const a = vec2(u.x.atan(u.z).mul(15), u.y.asin().mul(15));
    const row = floor(a.y);
    const cell = vec2(fract(a.x.add(row.mod(2).mul(0.5))).sub(0.5), fract(a.y).sub(0.5));
    const facet = facets ? f(mix(float(1), smoothstep(0.52, 0.26, cell.length()).mul(0.7).add(0.5), out)) : f(float(1));
    // (the ring: brighter below, as light gathers in a lens)
    const ring = c3(mix(tint(T.iris).mul(0.3), tint(T.light).mul(1.1), smoothstep(0.45, -0.6, u.y)));
    const deep = c3(mix(ring, vec3(0.012, 0.008, 0.007), smoothstep(0.5, 0.9, ndv)));
    m.colorNode = c3(mix(deep, vec3(0.004, 0.003, 0.003), spot)).mul(facet);
    const at = (x: number, y: number, z: number, r: number, soft: number): F => {
      const l = Math.hypot(x, y, z);
      return f(smoothstep(r, r * (1 - soft), p.sub(vec3(x / l, y / l, z / l)).length()));
    };
    const lights = f(at(0.3, 0.5, 0.8, 0.27, 0.3).add(at(-0.22, -0.4, 0.88, 0.12, 0.45).mul(0.8)).add(at(0.02, 0.28, 0.95, 0.07, 0.5).mul(0.6)));
    const bounce = f(smoothstep(0, -0.9, u.y).mul(ndv.oneMinus().mul(0.8).add(0.1)));
    const dull = own((b) => b.dull);
    m.emissiveNode = c3(tint(T.light).mul(bounce.mul(0.3)).add(tint(T.edge).mul(rim(3).mul(0.14))).add(vec3(0.95, 0.94, 0.9).mul(lights))).mul(dull.oneMinus()).add(ownColor((b) => b.eyes.emissive));
    return m;
  });
}

const plain = (key: string, c: THREE.ColorRepresentation, rough: number, coatOf = 0): THREE.Material =>
  once(`plain${key}`, () => {
    const m = new THREE.MeshPhysicalNodeMaterial({ roughness: rough, clearcoat: coatOf, clearcoatRoughness: 0.25, specularIntensity: rough > 0.7 ? 0.05 : 0.4 });
    m.fog = false;
    const dull = own((b) => b.dull);
    m.colorNode = mix(tint(c), vec3(0.05, 0.045, 0.04), dull.mul(0.7));
    return m;
  });

/** What lies under a thick coat. */
export const soft = (side: number): THREE.Material => plain(`soft${side}`, rgb(HUE[side].shell).multiplyScalar(0.5), 0.98);

/** A limb's skin: dark towards its foot, the team's at its joints. */
export function limbSkin(side: number, shell: number, deep: number): THREE.Material {
  return once(`limb${side}${shell}${deep}`, () => {
    const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.6, clearcoat: 0, specularIntensity: 0.18, envMapIntensity: 0.7 });
    m.fog = false;
    const dull = own((b) => b.dull);
    const y = positionGeometry.y;
    const joint = f(smoothstep(0.2, 0.0, y).pow(1.4).add(smoothstep(0.86, 1, y).mul(0.5)));
    const body = c3(mix(tint(shell).mul(0.4), tint(deep).mul(0.8), smoothstep(0.15, 0.75, y)));
    m.colorNode = mix(mix(body, tint(shell).mul(0.55), joint.mul(0.8)), vec3(0.05, 0.045, 0.04), dull.mul(0.7));
    m.emissiveNode = c3(tint(HUE[side].edge).mul(rim(3).mul(0.03))).mul(dull.oneMinus()).add(ownColor((b) => b.legSkin.emissive));
    return m;
  });
}

// ---------------------------------------------------------------- the three

const ANT: HeadSpec = {
  r: [0.46, 0.43, 0.38],
  taper: 0.3,
  flat: 0.85,
  muzzle: { y: -0.185, sx: 0.2, sy: 0.12, h: 0.1 },
  smile: { y: -0.185, w: 0.16, lift: 0.085, thick: 0.009 },
  eyes: [{ x: 0.245, y: 0.07, z: 0.225, r: [0.145, 0.185, 0.125], turn: [-0.1, 0.5, -0.12], main: true }],
};
const SPIDER: HeadSpec = {
  r: [0.48, 0.41, 0.44],
  taper: 0.12,
  flat: 0.8,
  muzzle: { y: -0.2, sx: 0.24, sy: 0.11, h: 0.07 },
  smile: { y: -0.18, w: 0.135, lift: 0.07, thick: 0.0075 },
  eyes: [
    { x: 0.158, y: 0.06, z: 0.315, r: [0.148, 0.158, 0.105], turn: [-0.02, 0.2, 0], main: true },
    { x: 0.35, y: 0.1, z: 0.185, r: [0.085, 0.09, 0.07], turn: [0, 0.85, 0], main: false },
    { x: 0.29, y: 0.31, z: 0.1, r: [0.055, 0.055, 0.05], turn: [-0.8, 0.5, 0], main: false },
    { x: 0.36, y: 0.275, z: -0.12, r: [0.06, 0.06, 0.055], turn: [-0.7, 1.1, 0], main: false },
  ],
};
const ROACH: HeadSpec = {
  r: [0.46, 0.35, 0.33],
  taper: 0.22,
  flat: 0.82,
  muzzle: { y: -0.06, sx: 0.28, sy: 0.12, h: 0.06 },
  smile: { y: -0.085, w: 0.175, lift: 0.085, thick: 0.009, tilt: 0.13 },
  eyes: [{ x: 0.275, y: 0.09, z: 0.17, r: [0.145, 0.17, 0.12], turn: [-0.1, 0.5, -0.06], main: true }],
};

/** A cockroach's neck: how far behind the head's middle it turns, and how far (radians). */
const NECK = 0.4;
const NECK_TURN = 0.38;

const shapes = new Map<string, HeadShape>();
function headShape(id: string, side: number): HeadShape {
  const key = `${id}${side}`;
  let h = shapes.get(key);
  if (h) return h;
  h = new HeadShape(id === 'ant' ? ANT : id === 'spider' ? SPIDER : ROACH);
  const look = faceLook(id, side);
  h.paint((p, out) => {
    look(p, out);
    out.multiplyScalar(id === 'spider' ? 0.5 : 0.36);
  });
  shapes.set(key, h);
  return h;
}

/** Each face's colours. */
function faceLook(id: string, side: number): (p: THREE.Vector3, out: THREE.Color) => void {
  const T = HUE[side];
  const shell = rgb(T.shell);
  const deep = rgb(T.deep);
  const light = rgb(T.light);
  const pale = rgb(T.pale);
  const blush = rgb(T.blush);
  if (id === 'spider')
    return (p, out) => {
      out.copy(deep).lerp(shell, ss(-0.4, 0.15, p.y)).lerp(light, 0.45 * ss(0.12, 0.38, p.y));
      // (pale round the eyes, a mask down to the mouth)
      const ring = ss(0.27, 0.17, Math.hypot(Math.abs(p.x) - 0.158, p.y - 0.06)) * ss(0.12, 0.3, p.z);
      const mouth = ss(0.3, 0.12, Math.hypot(p.x, (p.y + 0.19) * 1.25)) * ss(0.15, 0.32, p.z);
      out.lerp(pale, Math.min(1, ring + mouth));
      out.lerp(blush, 0.6 * ss(0.1, 0.02, Math.hypot(Math.abs(p.x) - 0.26, p.y + 0.14)) * ss(0.1, 0.25, p.z));
    };
  const roach = id === 'cockroach';
  return (p, out) => {
    out.copy(deep).lerp(shell, ss(-0.5, 0, p.y)).lerp(light, 0.15 * ss(0.15, 0.42, p.y));
    // (under the shield it is in its shadow)
    if (roach) out.lerp(deep, 0.8 * ss(0.12, -0.06, p.z) * ss(-0.05, 0.12, p.y));
    const top = roach ? 0.14 : 0.05;
    const half = (roach ? 0.12 : 0.08) + 0.38 * Math.max(0, top - p.y);
    const face = ss(half + 0.13, half - 0.08, Math.abs(p.x)) * ss(0.12, 0.28, p.z) * ss(top + 0.07, top - 0.13, p.y);
    out.lerp(pale, 0.95 * face);
    out.lerp(blush, (side ? 0.5 : 0.7) * ss(0.11, 0.02, Math.hypot(Math.abs(p.x) - (roach ? 0.27 : 0.235), (p.y + (roach ? 0.14 : 0.17)) * 1.1)) * ss(0.05, 0.18, p.z));
  };
}

/** Beads along a curve, thinner or thicker along it. */
function beads(curve: THREE.Curve<THREE.Vector3>, n: number, thick: (u: number) => number, gap: number): THREE.BufferGeometry {
  const all: THREE.BufferGeometry[] = [];
  const long = curve.getLength() / n;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const at = curve.getPointAt(u);
    const r = thick(u);
    const b = new THREE.CapsuleGeometry(r, Math.max(0.001, long * gap - r), 4, 10).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, curve.getTangentAt(u)));
    b.translate(at.x, at.y, at.z);
    all.push(b);
  }
  return mergeGeometries(all);
}

/** Give a bug its face: the generic head is taken away. Its size against the old one: `size`. */
export function makeFace(view: BugView, side: number): FaceParts {
  const id = view.species.id;
  const T = HUE[side];
  const r = view.species.radius;
  const head = view.head;
  for (const c of head.children) c.visible = false;
  const H = headShape(id, side);
  const s = H.s;
  // ---- its place and size
  const size = (id === 'spider' ? 1.24 : id === 'ant' ? 1.17 : 1.0) * r;
  const at = id === 'spider' ? v3(0, 0.24, 0.62) : id === 'ant' ? v3(0, 0.16, 0.66) : v3(0, 0.12, 0.82);
  head.position.copy(at).multiplyScalar(r);
  view.headAt.copy(head.position);
  view.headRadius = 0.43 * size;
  const g = new THREE.Group();
  g.scale.setScalar(size);
  // (it looks up at you)
  if (id === 'cockroach') g.rotation.x = -0.2;
  head.add(g);
  const coats: THREE.InstancedMesh[] = [];
  const small: THREE.Object3D[] = [];
  const add = (to: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p?: THREE.Vector3, shadow = true): THREE.Mesh => {
    const o = new THREE.Mesh(geo, m);
    if (p) o.position.copy(p);
    o.castShadow = shadow;
    o.receiveShadow = true;
    to.add(o);
    return o;
  };
  const furry = (to: THREE.Object3D, of: THREE.InstancedMesh, p?: THREE.Vector3): THREE.InstancedMesh => {
    const o = coat(of);
    if (p) o.position.copy(p);
    o.receiveShadow = true;
    to.add(o);
    coats.push(o);
    return o;
  };
  const look = faceLook(id, side);
  const dark = plain(`dark${side}`, rgb(T.limb).multiplyScalar(0.5), 0.35, 0.5);
  const mouth = plain(`mouth${side}`, side ? 0x10132e : 0x2e0808, 0.6);
  const tongue = plain('tongue', 0xf0706c, 0.45);
  add(g, H.geometry, painted(side, 0));

  // ---- a coat: the spider's thick one, a fine down on the others
  const bareAt = (p: THREE.Vector3): boolean => H.inEye(p, id === 'spider' ? 1.02 : 1.03);
  // (short at an eye's edge, longer away from it)
  const byEye = (p: THREE.Vector3): number => (H.inEye(p, 1.15) ? 0.5 : H.inEye(p, 1.4) ? 0.75 : 1);
  if (id === 'spider') {
    furry(g, once(`spiderHead${side}`, () => fur(H.geometry, {
      cool: true, count: 12000, long: 0.13, thick: 0.0075, lie: 0.5,
      at: (p) => (bareAt(p) ? 0 : byEye(p) * H.groove(p) * (0.25 + 0.75 * Math.max(ss(0.12, 0.36, p.y), ss(0.25, -0.05, p.z), 0.8 * ss(0.3, 0.42, Math.abs(p.x))))),
      color: look,
      comb: (p, _n, out) => out.set(p.x * 1.5, -0.7 + 1.5 * ss(0.05, 0.3, p.y), -0.1 - 0.8 * ss(0.05, 0.3, p.y)),
    })));
    furry(g, once(`spiderFace${side}`, () => fur(H.geometry, {
      cool: true, count: 20000, long: 0.05, thick: 0.0042, lie: 0.62,
      at: (p) => (bareAt(p) || p.z < 0.05 ? 0 : H.groove(p) * byEye(p) * ss(0.36, 0.2, p.y)),
      color: look,
      comb: (p, _n, out) => out.set(p.x * 2.2, -0.8, 0.1),
    })));
  } else
    furry(g, once(`${id}Velvet${side}`, () => fur(H.geometry, {
      cool: true, count: 56000, long: 0.036, thick: 0.0026, lie: 0.72,
      at: (p) => (bareAt(p) ? 0 : H.groove(p) * byEye(p)),
      color: (p, out) => {
        look(p, out);
        if (out.g < 0.3) out.lerp(rgb(T.light), 0.12);
      },
      comb: (p, _n, out) => {
        // (parted over the brow: up and back above, down below)
        const up = ss(0.02, 0.26, p.y);
        out.set(p.x * (1.4 + 6 * Math.exp(-(((up - 0.42) / 0.22) ** 2))), -0.75 + 1.8 * up, -0.2 - 0.6 * up);
      },
    })));

  // ---- eyes
  const lids: THREE.Group[] = [];
  for (const e of s.eyes)
    for (const x of [-1, 1]) {
      const socket = new THREE.Group();
      socket.applyMatrix4(HeadShape.eyeMatrix(e, x));
      g.add(socket);
      const geo = once(`eyeGeo${id}${s.eyes.indexOf(e)}${x}`, () => {
        const q = ellipsoid(e.r[0], e.r[1], e.r[2], 48, 36);
        const pos = q.getAttribute('position');
        const unit = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) unit.set([pos.getX(i) / e.r[0], pos.getY(i) / e.r[1], pos.getZ(i) / e.r[2]], i * 3);
        q.setAttribute('unit', new THREE.Float32BufferAttribute(unit, 3));
        // (the lights fall from the same side on both)
        q.setAttribute('mir', new THREE.Float32BufferAttribute(new Float32Array(pos.count).fill(1), 1));
        return q;
      });
      add(socket, geo, eyeMaterial(side, id !== 'spider'), undefined, false);
      // (a thin dark rim it sits in)
      add(socket, geo, plain(`rim${side}`, side ? 0x0a1230 : 0x2a0c08, 0.8), v3(0, 0, -e.r[2] * 0.12), false).scale.set(1.035, 1.03, 1.0);
      if (!e.main) continue;
      // (shut: a lid over it all, a line curved up as when one laughs)
      const lid = new THREE.Group();
      lid.visible = false;
      const lidAt = id === 'spider' ? v3(x * e.x, e.y, e.z + 0.1) : v3(0, 0.22, 0.28);
      const lidColor = new THREE.Color();
      look(lidAt, lidColor);
      add(lid, geo, plain(`lid${side}${id}`, lidColor.clone().multiplyScalar(0.75), 0.9), undefined, false).scale.setScalar(id === 'spider' ? 1.07 : 1.012);
      furry(lid, once(`lidFur${id}${side}`, () => fur(ellipsoid(e.r[0] * 1.05, e.r[1] * 1.05, e.r[2] * 1.05, 48, 36), {
        cool: true, count: id === 'spider' ? 15000 : 11000, long: id === 'spider' ? 0.028 : 0.024, thick: 0.0036, lie: 0.75,
        at: (p) => (p.z < -0.03 ? 0 : 1),
        color: (_p, out) => out.copy(lidColor),
        comb: (p, _n, out) => out.set(p.x, p.y > -0.02 ? -1 : 1, 0),
      })));
      const lash: THREE.Vector3[] = [];
      for (let i = -8; i <= 8; i++) {
        const a = (i / 8) * 1.0;
        // (level on the face, whichever way the eye leans)
        const y = e.r[1] * (0.0 - 0.3 * (i / 8) ** 2) - Math.sin(a) * e.r[0] * x * e.turn[2];
        const k = Math.sqrt(1 - (y / e.r[1]) ** 2);
        lash.push(v3(Math.sin(a) * e.r[0] * k, y, Math.cos(a) * e.r[2] * k).multiplyScalar(id === 'spider' ? 1.16 : 1.1));
      }
      add(lid, tube(lash, (u) => 0.0003 + 0.0085 * Math.sin(Math.PI * u), 48, 8), mouth, undefined, false);
      socket.add(lid);
      lids.push(lid);
    }

  // ---- the smile, and the open mouth under it
  const furOn = id === 'spider' ? 0.016 : 0.01;
  const lip = add(g, once(`lip${id}`, () => H.lip(furOn)), mouth, undefined, false);
  const jaw = new THREE.Group();
  g.add(jaw);
  jaw.visible = false;
  add(jaw, once(`mouth${id}`, () => H.mouth(furOn + (id === 'spider' ? 0.02 : 0.016))), mouth, undefined, false);
  add(jaw, once(`tongue${id}`, () => H.tongue(furOn + (id === 'spider' ? 0.0225 : 0.0185))), tongue, undefined, false);

  const oh = add(g, once(`cry${id}`, () => H.cry(furOn + (id === 'spider' ? 0.03 : 0.024))), plain(`cry${side}`, 0x7a1418, 0.6), undefined, false);
  const yell = add(g, once(`yell${id}`, () => H.tongue(furOn + (id === 'spider' ? 0.034 : 0.028)).scale(0.75, 1, 1)), tongue, undefined, false);
  oh.visible = yell.visible = false;

  // ---- what each has of its own
  const feelers: { g: THREE.Group; x: number }[] = [];
  const mandibles: { g: THREE.Group; x: number }[] = [];
  const amber = plain('amber', 0x5c260c, 0.55, 0.1);
  const horn = plain(`horn${side}`, rgb(T.shell).lerp(rgb(T.deep), 0.6), 0.7);
  for (const x of [-1, 1]) {
    if (id === 'ant') {
      const a = new THREE.Group();
      a.position.set(x * 0.115, 0.2, 0.3);
      g.add(a);
      feelers.push({ g: a, x });
      add(a, new THREE.TorusGeometry(0.03, 0.009, 12, 32), horn, v3(0, 0, 0.005), false).rotation.x = -0.5;
      const elbow = v3(x * 0.36, 0.38, 0.04);
      add(a, tube([v3(0, -0.01, 0), v3(x * 0.13, 0.21, 0.06), elbow], (u) => 0.029 - 0.005 * u, 28, 24), horn);
      add(a, BALL, horn, elbow, false).scale.setScalar(0.026);
      const curve = new THREE.CatmullRomCurve3([elbow, v3(x * 0.52, 0.46, 0.13), v3(x * 0.67, 0.45, 0.24), v3(x * 0.78, 0.38, 0.33)]);
      add(a, beads(curve, 9, (u) => 0.023 + 0.015 * ss(0.6, 0.95, u), 0.95), horn);
      add(a, BALL, horn, curve.getPointAt(0.985)).scale.setScalar(0.037);
      // small curved jaws, their roots in the cheeks; they spread when it laughs
      const m = new THREE.Group();
      m.position.set(x * 0.12, -0.34, 0.14);
      m.scale.setScalar(0.66);
      g.add(m);
      mandibles.push({ g: m, x });
      const curveM = [v3(x * -0.02, 0.03, -0.05), v3(x * 0.035, -0.035, 0.05), v3(x * 0.0, -0.06, 0.11), v3(x * -0.09, -0.055, 0.14)];
      add(m, tube(curveM, (u) => 0.036 * Math.max(0.02, 1 - u) ** 0.75, 36, 16), amber);
      for (const [tx, tz] of [[-0.02, 0.125], [-0.045, 0.133]]) {
        const tooth = add(m, new THREE.ConeGeometry(0.009, 0.026, 8), amber, v3(x * tx, -0.05, tz), false);
        tooth.rotation.z = x * 1.3;
      }
    } else if (id === 'spider') {
      // two furred lobes under the smile, a small fang in each; feelers like mittens
      const lobe = ellipsoid(0.115, 0.135, 0.1, 36, 28);
      const p = v3(x * 0.105, -0.335, 0.27);
      add(g, lobe, plain(`lobe${side}`, rgb(T.shell).lerp(rgb(T.pale), 0.2), 0.8), p);
      furry(g, once(`lobeFur${side}${x}`, () => fur(lobe, {
        cool: true, count: 2200, long: 0.06, thick: 0.0045, lie: 0.55,
        at: () => 1,
        color: (q, out) => out.copy(rgb(T.deep)).lerp(rgb(T.shell), ss(-0.12, 0, q.y)).lerp(rgb(T.light), 0.5 * ss(0, 0.1, q.y)),
        comb: (q, _n, out) => out.set(q.x, -1, 0.2),
      })), p);
      const fang = add(g, new THREE.ConeGeometry(0.02, 0.07, 10), dark, v3(x * 0.085, -0.475, 0.31), false);
      fang.rotation.set(Math.PI - 0.15, 0, x * 0.2);
      const m = new THREE.Group();
      m.position.set(x * 0.31, -0.25, 0.22);
      g.add(m);
      feelers.push({ g: m, x });
      const arm = once(`mitten${x}`, () => tube([v3(0, 0, 0), v3(x * 0.1, -0.02, 0.12), v3(x * 0.12, -0.12, 0.26), v3(x * 0.07, -0.2, 0.33)], (u) => 0.05 + 0.035 * Math.sin(Math.PI * Math.min(1, u * 1.1)) * u + (u > 0.95 ? (0.95 - u) * 0.9 : 0), 30, 14));
      add(m, arm, plain(`mittenSkin${side}`, rgb(T.pale).multiplyScalar(0.5), 0.95));
      furry(m, once(`mittenFur${side}${x}`, () => fur(arm, {
        cool: true, count: 2600, long: 0.07, thick: 0.0045, lie: 0.5,
        at: () => 1,
        color: (q, out) => out.copy(rgb(T.deep)).lerp(rgb(T.shell), 0.5).lerp(rgb(T.pale), 0.85 * ss(0.16, 0.3, q.z)),
        comb: (_q, _n, out) => out.set(0, -0.5, 0.9),
      })));
    } else {
      const a = new THREE.Group();
      a.position.set(x * 0.15, 0.22, 0.22);
      g.add(a);
      feelers.push({ g: a, x });
      add(a, new THREE.TorusGeometry(0.03, 0.009, 12, 32), horn, v3(0, 0, 0.005), false).rotation.x = -0.5;
      // a long whip, finely ringed, out to the side
      const whip = [v3(0, -0.01, 0), v3(x * 0.1, 0.22, 0.02), v3(x * 0.34, 0.6, -0.02), v3(x * 0.8, 0.88, -0.06), v3(x * 1.3, 0.93, -0.1), v3(x * 1.7, 0.82, -0.2)];
      add(a, tube(whip, (u) => (0.027 * (1 - 0.86 * u) + 0.0025) * (1 + 0.05 * Math.cos(u * 6.2832 * 70)), 420, 14), horn);
      add(g, tube([v3(x * 0.15, -0.22, 0.17), v3(x * 0.19, -0.265, 0.21), v3(x * 0.18, -0.3, 0.25)], (u) => 0.018 * (1 - 0.5 * u) * (u > 0.94 ? Math.sqrt(Math.max(0, (1 - u) / 0.06)) : 1), 24, 12), amber);
    }
  }

  return {
    coats,
    small,
    blink(shut) {
      const on = shut > 0.55;
      for (const l of lids) l.visible = on;
    },
    open(k) {
      const o = ss(0.25, 0.6, k);
      jaw.visible = o > 0.3;
      for (const m of mandibles) {
        m.g.rotation.set(0.5 * o, m.x * 0.2 * o, 0);
        m.g.visible = o < 0.6;
      }
      lip.visible = o <= 0.3;
    },
    cry(on) {
      oh.visible = yell.visible = on;
      // (its smile is off as long as it cries, and back with the next change of its mouth)
      if (!on) return;
      lip.visible = jaw.visible = false;
      for (const m of mandibles) m.g.visible = false;
    },
    sway(seconds, lively) {
      if (id === 'cockroach' && view.pose.weight < 0.001) {
        // (it turns on its neck, not on its middle, and not so far: no eye goes under the shield)
        const y = Math.max(-NECK_TURN, Math.min(NECK_TURN, head.rotation.y));
        head.rotation.y = y;
        head.position.copy(view.headAt);
        head.position.x += Math.sin(y) * NECK * r;
        head.position.z += (Math.cos(y) - 1) * NECK * r + Math.abs(Math.sin(y)) * 0.3 * r;
      }
      for (const q of feelers) {
        q.g.rotation.y = Math.sin(seconds * 1.9 + q.x * 1.3) * 0.1;
        q.g.rotation.z = q.x * (Math.sin(seconds * 1.3 + q.x) * 0.06 - 0.12 * lively);
        q.g.rotation.x = Math.sin(seconds * 1.6 + q.x * 2) * 0.06 + (id === 'spider' ? -0.35 * lively : -0.15 * lively);
      }
    },
  };
}

/** Jointed legs with feet and hairs in place of the plain ones. */
export function makeLegs(view: BugView, side: number): THREE.Object3D[] {
  const id = view.species.id;
  const T = HUE[side];
  const small: THREE.Object3D[] = [];
  const skin = limbSkin(side, T.shell, T.limb);
  const coatMat = plain(`fuzz${side}`, rgb(T.shell).multiplyScalar(0.85), 0.95);
  const spines = plain(`spines${side}`, T.limb, 0.5);
  const thick = (id === 'spider' ? 0.078 : id === 'ant' ? 0.064 : 0.07) * view.species.radius;
  const pivots = view.root.children.filter((c) => c !== view.torso && c.children.length === 2 && !(c as THREE.Mesh).isMesh);
  for (const pivot of pivots) {
    const [upper, lower] = pivot.children as THREE.Mesh[];
    upper.geometry = FEMUR;
    lower.geometry = FOOT;
    for (const m of [upper, lower]) {
      m.material = skin;
      m.scale.x = m.scale.z = thick;
      const o = new THREE.Mesh(hairs(m.scale.x / m.scale.y, m === upper, id === 'spider' ? 0.75 : 0.38, id === 'spider' ? 4 : 7), coatMat);
      m.add(o);
      small.push(o);
      if (id !== 'spider') continue;
      const few = new THREE.Mesh(hairs(m.scale.x / m.scale.y, m === upper, id === 'spider' ? 1.7 : 1, 0.06), spines);
      m.add(few);
      small.push(few);
    }
  }
  return small;
}

/** A lathe along -z, from profile points (radius, how far back). */
function along(profile: (t: number) => number, long: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0)];
  for (let i = 1; i < 140; i++) pts.push(new THREE.Vector2(Math.max(0.001, profile(i / 140)), i / 140));
  pts.push(new THREE.Vector2(0.001, 1));
  return shape(new THREE.LatheGeometry(pts, 56), (p) => {
    const t = p.y;
    p.set(p.x, p.z * 0.9, -t * long);
  });
}
const frac = (x: number): number => x - Math.floor(x);

/** An ant's body: two lobes, a waist with a node, an abdomen of plates; velvet all over. */
export function antBody(view: BugView, side: number): THREE.InstancedMesh[] {
  const T = HUE[side];
  const r = view.species.radius;
  const out: THREE.InstancedMesh[] = [];
  const abdomen = view.lumps[0].parent as THREE.Object3D;
  for (const l of view.lumps.slice(0, 2)) l.visible = false;
  const tone = (p: number, c: THREE.Color): THREE.Color => c.copy(rgb(T.deep)).lerp(rgb(T.shell), ss(-0.35, 0.05, p)).lerp(rgb(T.light), 0.3 * ss(0.1, 0.4, p));
  const part = (key: string, to: THREE.Object3D, geo: () => THREE.BufferGeometry, at: THREE.Vector3, count: number, look: (p: THREE.Vector3, c: THREE.Color) => void): void => {
    const q = once(`antGeo${key}${side}`, () => {
      const made2 = geo();
      const pos = made2.getAttribute('position');
      const arr = new Float32Array(pos.count * 3);
      const p = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        look(p.fromBufferAttribute(pos, i), c);
        arr.set([c.r * 0.36, c.g * 0.36, c.b * 0.36], i * 3);
      }
      made2.setAttribute('paint', new THREE.Float32BufferAttribute(arr, 3));
      return made2;
    });
    const m = new THREE.Mesh(q, painted(side, 0));
    m.position.copy(at);
    m.castShadow = m.receiveShadow = true;
    const f0 = coat(once(`antFur${key}${side}`, () => fur(q, { cool: true, count: Math.round(count * 2.6), long: 0.045, thick: 0.0029, lie: 0.66, at: () => 1, color: look, comb: (_p, _n, o) => o.set(0, -0.15, -1) })));
    f0.position.copy(at);
    f0.receiveShadow = true;
    const g = new THREE.Group();
    g.scale.setScalar(r);
    g.add(m, f0);
    to.add(g);
    out.push(f0);
  };
  part('front', view.torso, () => ellipsoid(0.31, 0.29, 0.3), v3(0, 0.0, 0.17), 5200, (p, c) => void tone(p.y, c));
  part('rear', view.torso, () => ellipsoid(0.25, 0.24, 0.27), v3(0, -0.04, -0.16), 4200, (p, c) => void tone(p.y, c));
  part('node', abdomen, () => ellipsoid(0.1, 0.16, 0.09), v3(0, 0.0, -0.16), 1200, (p, c) => void tone(p.y, c));
  part('back', abdomen, () => along((t) => 0.54 * Math.sin(Math.PI * Math.min(1, 0.05 + t * 0.95)) ** 0.68 * (0.975 + 0.04 * frac(t * 5) ** 2), 1.32), v3(0, 0.07, -0.22), 17000, (p, c) => {
    tone(p.y, c);
    const t = frac((-p.z / 1.32) * 5);
    c.lerp(rgb(side ? 0x040c26 : 0x1c0403), 0.85 * ss(0.78, 0.93, t) * ss(-0.3, 0.1, p.y) * (p.z < -1.2 ? 0 : 1));
  });
  return out;
}

/** A cockroach's back: two wing cases that close in one seam, veined; a shield over its neck; wings that show when they open. */
export function roachBack(view: BugView, side: number): () => void {
  const T = HUE[side];
  const r = view.species.radius;
  const lacquer = once(`lacquer${side}`, () => {
    const q = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.6, clearcoat: 0.22, clearcoatRoughness: 0.3, specularIntensity: 0.08, envMapIntensity: 0.35, side: THREE.DoubleSide });
    q.fog = false;
    const dull = own((b) => b.dull);
    const c = c3(attribute('paint', 'vec3'));
    q.colorNode = mix(c, vec3(0.05, 0.045, 0.04), dull.mul(0.7));
    q.normalNode = bumpMap(f(mx_noise_float(positionGeometry.mul(40))), float(0.003));
    q.emissiveNode = c3(tint(T.edge).mul(rim(3).mul(0.02))).mul(dull.oneMinus()).add(ownColor((b) => b.skin.emissive));
    return q;
  });
  const film = once(`film${side}`, () => {
    const q = new THREE.MeshPhysicalNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.35, specularIntensity: 0.3 });
    q.fog = false;
    q.colorNode = mix(tint(T.pale), tint(T.light), f(mx_noise_float(positionGeometry.mul(vec3(14, 1, 2))).mul(0.5).add(0.5)));
    const ray = f(positionGeometry.x.atan(positionGeometry.z.oneMinus().add(0.15)).mul(14).sin().abs());
    const vein = f(smoothstep(0.16, 0.05, ray));
    q.opacityNode = f(mix(float(0.34), float(0.85), vein));
    q.emissiveNode = c3(tint(T.light).mul(0.04));
    return q;
  });
  const amber = once(`belly${side}`, () => {
    const q = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.6, specularIntensity: 0.2 });
    q.fog = false;
    const dull = own((b) => b.dull);
    const t = f(fract(positionGeometry.z.div(-1.72).mul(7)));
    const c = c3(mix(tint(side ? 0x14285a : 0x4a2208), tint(side ? 0x060e24 : 0x200803), f(smoothstep(0.5, 0.85, t))));
    q.colorNode = mix(c, vec3(0.05, 0.045, 0.04), dull.mul(0.7));
    q.normalNode = bumpMap(t, float(0.03));
    return q;
  });
  const LONG = 1.98;
  const caseGeo = (s: number): THREE.BufferGeometry =>
    once(`case${s}${side}`, () => {
      const nu = 80;
      const nv = 30;
      const pos: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const c = new THREE.Color();
      for (let i = 0; i <= nu; i++)
        for (let k = 0; k <= nv; k++) {
          const u = i / nu;
          const v = k / nv;
          // (round shoulders, widest at a third, a rounded tail)
          const wide = 0.7 * Math.sin(Math.PI * Math.min(1, 0.02 + u * 0.98)) ** 0.42;
          const high = 0.31 * Math.sin(Math.PI * Math.min(1, 0.06 + u * 0.94)) ** 0.5;
          const lap = 0.03 * Math.min(1, (1 - u) * 14);
          const x = -lap + (wide + lap) * v;
          const a = Math.min(1, v * 1.02);
          const rib = 0.006 * Math.cos(v * Math.PI * 2 * 6.5) * Math.sin(Math.PI * u) * ss(0, 0.15, v) * ss(1, 0.85, v);
          const y = high * Math.sqrt(Math.max(0, 1 - a * a)) - 0.03 * ss(0.9, 1, v) * Math.sin(Math.PI * u) + rib - 0.008 * ss(0.045, 0.0, v) * Math.min(1, (1 - u) * 8) + (s > 0 ? 0.004 : 0) * ss(0.12, 0, v) * Math.min(1, (1 - u) * 8);
          pos.push(s * x, y, 0.2 - u * LONG);
          // (deep in the middle, nearly black along its edge and tail; fine dark veins)
          c.copy(rgb(side ? 0x0a2a78 : 0x660b07));
          c.lerp(rgb(side ? 0x040a22 : 0x1e0303), 0.95 * Math.max(ss(0.66, 0.97, v), ss(0.72, 1, u)));
          c.lerp(rgb(side ? 0x040a22 : 0x1e0303), 0.5 * ss(0.8, 1, Math.cos(v * Math.PI * 2 * 6.5 + Math.PI)) + 0.8 * ss(0.035, 0.012, v));
          col.push(c.r, c.g, c.b);
          if (i < nu && k < nv) {
            const q = i * (nv + 1) + k;
            if (s > 0) idx.push(q, q + nv + 1, q + 1, q + 1, q + nv + 1, q + nv + 2);
            else idx.push(q, q + 1, q + nv + 1, q + 1, q + nv + 2, q + nv + 1);
          }
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('paint', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    });
  const films: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  view.torso.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const q of meshes) {
    const was = q.userData.was as number | undefined;
    if (was === 0xc98a4a) q.visible = false;
    else if (was === view.species.color && q.parent === view.torso) q.visible = false;
    else if (was === view.species.color && q.parent !== view.head && q.geometry.type === 'SphereGeometry' && q.parent !== view.lumps[0].parent) {
      // a wing case, on its hinge
      const hinge = q.parent as THREE.Object3D;
      q.visible = false;
      const s = Math.sign(q.position.x) || 1;
      const m = new THREE.Mesh(caseGeo(s), lacquer);
      m.position.set(-s * 0.05 * r, 0, 0);
      m.scale.setScalar(r);
      m.castShadow = m.receiveShadow = true;
      hinge.add(m);
    } else if (was === 0xd8a868) {
      q.material = film;
      // (fanned: its surface shows)
      const s = Math.sign(q.position.x) || 1;
      q.scale.x *= 1.25;
      q.rotation.set(0.1, 0, s * 0.45);
      films.push(q);
    }
  }
  view.lumps[1].visible = false;
  const abdomen = view.lumps[0].parent as THREE.Object3D;
  for (const q of abdomen.children) if ((q as THREE.Mesh).isMesh) q.visible = false;
  const belly = once('bellyGeo', () =>
    shape(along((t) => 0.6 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.8)) ** 0.55 * (0.975 + 0.035 * frac(t * 7) ** 2), 1.72), (p) => {
      p.y *= p.y > 0 ? 0.2 : 0.46;
    }),
  );
  const under = new THREE.Mesh(belly, amber);
  under.position.set(0, 0.0, 0.38 * r);
  under.scale.setScalar(r);
  under.castShadow = under.receiveShadow = true;
  abdomen.add(under);
  // ---- the shield: a dome over the neck, a pale soft border, two dark spots
  const shield = once(`shield${side}`, () => {
    const g = shape(new THREE.SphereGeometry(1, 96, 64), (p) => {
      p.set(p.x * 0.6, p.y * (p.y > 0 ? 0.27 : 0.09), p.z * 0.46);
    });
    const pos = g.getAttribute('position');
    const arr = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / 0.6;
      const z = pos.getZ(i) / 0.46;
      const d = Math.hypot(x, z);
      c.copy(rgb(side ? 0x0a2a78 : 0x700d08));
      c.lerp(rgb(side ? 0xa8c4ec : 0xe8c08c), ss(0.8, 0.92, d));
      // (one soft dark mask, notched in front)
      const mask = Math.hypot(x * 0.95, (z + 0.1) * 1.35 - 0.22 * Math.exp(-((x / 0.16) ** 2)) * ss(-0.1, 0.4, z) * -1);
      c.lerp(rgb(side ? 0x060c20 : 0x1c0604), 0.9 * ss(0.56, 0.42, mask));
      arr.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('paint', new THREE.Float32BufferAttribute(arr, 3));
    return g;
  });
  const m = new THREE.Mesh(shield, lacquer);
  m.position.set(0, 0.225 * r, 0.45 * r);
  m.rotation.x = 0.16;
  m.scale.setScalar(r);
  m.castShadow = m.receiveShadow = true;
  view.torso.add(m);
  return () => {
    for (const q of films) q.visible = view.wings > 0.05;
  };
}

/** A spider's coat on its body: thick, banded, in the team's colours. */
export function spiderBody(view: BugView, side: number): THREE.InstancedMesh[] {
  const T = HUE[side];
  const out: THREE.InstancedMesh[] = [];
  view.lumps.slice(0, 2).forEach((lump, i) => {
    const s = lump.scale;
    const geo = once(`spiderLump${i}${s.x.toFixed(3)}${s.y.toFixed(3)}`, () => ellipsoid(s.x, s.y, s.z));
    const of = once(`spiderBody${i}${side}`, () =>
      fur(geo, {
        cool: true,
        count: i ? 8000 : 30000,
        long: i ? 0.14 : 0.2,
        thick: 0.0092,
        lie: 0.6,
        at: () => 1,
        color: (p, c) => {
          c.copy(rgb(T.deep)).lerp(rgb(T.shell), ss(-0.6, 0.1, p.y / s.y)).lerp(rgb(T.light), 0.4 * ss(0.3, 0.95, p.y / s.y));
          if (i) return;
          // (a row of pale hearts down its back)
          const t = p.z / s.z;
          const row = Math.abs(((((t + 1) * 2.2) % 1) + 1) % 1 - 0.5) * 2;
          const mark = ss(0.4, 0.14, Math.abs(p.x / s.x) + row * 0.2) * ss(0.3, 0.6, p.y / s.y) * ss(0.45, 0.75, 1 - row * 0.5);
          c.lerp(rgb(side ? 0xd8e8ff : 0xffdca0), mark);
          c.lerp(rgb(T.deep), 0.45 * ss(0.75, 1, row) * ss(0.1, 0.5, p.y / s.y));
        },
        comb: (_p, _n, o) => o.set(0, -0.25, -1),
      }),
    );
    const m = coat(of);
    m.position.copy(lump.position);
    m.receiveShadow = true;
    (lump.parent as THREE.Object3D).add(m);
    out.push(m);
  });
  return out;
}
