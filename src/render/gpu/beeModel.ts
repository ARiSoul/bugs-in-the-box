import * as THREE from 'three/webgpu';
import { abs, attribute, bumpMap, color, cos, float, floor, fract, max, mix, mx_noise_float, normalView, positionGeometry, positionLocal, positionViewDirection, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BugView } from '../BugView';
import { own, ownColor, type Face } from './heroDress';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;
type V2 = THREE.Node<'vec2'>;
const UP = new THREE.Vector3(0, 1, 0);
const BALL = new THREE.SphereGeometry(1, 32, 24);
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const f = (n: unknown): F => n as F;
const c3 = (n: unknown): V3 => n as V3;
const tint = (c: number): V3 => c3(color(c));
export const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rgb = (c: number): THREE.Color => new THREE.Color(c);

/** Each team's bee: its bands, the scarf, the light on its edges, the eyes' sheen, the limbs' hairs. */
const TEAM = [
  { band: 0x1e130e, scarf: 0x9c0e08, edge: 0xffb27a, eye: 0x8a2214, wing: 0xffc9b4, fuzz: 0xe0402c },
  { band: 0x15151c, scarf: 0x2374e0, edge: 0x8fd6ff, eye: 0x164a9c, wing: 0xb8dcff, fuzz: 0x3a86ee },
];
const GOLD = rgb(0xffc822);
const DEEP = rgb(0xe0970c);
const CREAM = rgb(0xf6d698);
const BLACK = rgb(0x1c120c);

// ---------------------------------------------------------------- hair

/** One hair: a thin blade that bends over, its root at 0, one unit long; its normals are its root's (a coat shades as one). */
const BLADE = ((): THREE.BufferGeometry => {
  const seg = 4;
  const pos: number[] = [];
  const nor: number[] = [];
  const tall: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const s = i / seg;
    const w = 0.5 * (1 - s ** 1.6);
    const y = s * (1 - 0.28 * s);
    const z = 0.52 * s * s;
    for (const x of i === seg ? [0] : [-w, w]) {
      pos.push(x, y, z);
      // (none across: a hair is so thin that its side would win)
      nor.push(0, 1, 0.12 * s);
      tall.push(s);
    }
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    if (i === seg - 1) idx.push(a, a + 1, a + 2);
    else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('tall', new THREE.Float32BufferAttribute(tall, 1));
  g.setIndex(idx);
  return g;
})();

interface FurLook {
  /** Not gold: its own colour at the root and in the shade. */
  cool?: boolean;
  count: number;
  long: number;
  thick: number;
  /** How long at a place (0: bare). */
  at: (p: THREE.Vector3, n: THREE.Vector3) => number;
  color: (p: THREE.Vector3, out: THREE.Color) => void;
  /** Which way it lies, at a place. */
  comb: (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Vector3) => void;
  /** How flat it lies (0: upright, 1: flat). */
  lie: number;
}

/** Repeatable draws. */
function draws(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A coat over a body: hairs drawn over its surface, in no order (so the first part of them is a thinner coat). */
export function fur(g: THREE.BufferGeometry, o: FurLook): THREE.InstancedMesh {
  const rnd = draws(o.count);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const index = g.getIndex();
  const tris = (index ? index.count : pos.count) / 3;
  const at = (i: number): number => (index ? index.getX(i) : i);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const sums = new Float32Array(tris);
  let sum = 0;
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, at(t * 3));
    b.fromBufferAttribute(pos, at(t * 3 + 1));
    c.fromBufferAttribute(pos, at(t * 3 + 2));
    sum += b.sub(a).cross(c.sub(a)).length() * 0.5;
    sums[t] = sum;
  }
  const mesh = new THREE.InstancedMesh(BLADE, furMaterial(o.cool === true), o.count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const lay = new THREE.Vector3();
  const side = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let made = 0;
  for (let k = 0; k < o.count * 4 && made < o.count; k++) {
    const want = rnd() * sum;
    let lo = 0;
    let hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sums[mid] < want) lo = mid + 1;
      else hi = mid;
    }
    let u = rnd();
    let v = rnd();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    p.set(0, 0, 0);
    n.set(0, 0, 0);
    for (const [i, q] of [[0, w], [1, u], [2, v]]) {
      p.addScaledVector(tmp.fromBufferAttribute(pos, at(lo * 3 + i)), q);
      n.addScaledVector(tmp.fromBufferAttribute(nor, at(lo * 3 + i)), q);
    }
    n.normalize();
    const high = o.at(p, n);
    if (high <= 0.02) continue;
    o.comb(p, n, lay);
    // (locks: neighbours lean the same way)
    const lock = Math.sin(p.x * 13 + Math.sin(p.y * 11) * 2) + Math.sin(p.y * 12 + p.z * 10);
    lay.x += lock * 0.16 + (rnd() - 0.5) * 0.5;
    lay.y += Math.sin(p.z * 14 + p.x * 9) * 0.16 + (rnd() - 0.5) * 0.5;
    lay.z += (rnd() - 0.5) * 0.4;
    lay.addScaledVector(n, -lay.dot(n));
    if (lay.lengthSq() < 1e-4) lay.set(n.y, n.z, n.x).addScaledVector(n, -(n.y * n.x + n.z * n.y + n.x * n.z));
    lay.normalize();
    const lean = o.lie + (rnd() - 0.5) * 0.25;
    const len = o.long * high * (0.72 + 0.42 * rnd() + lock * 0.05);
    const up = tmp.copy(n).multiplyScalar(1 - lean * 0.55).addScaledVector(lay, lean).normalize().multiplyScalar(len);
    side.crossVectors(up, lay).normalize().multiplyScalar(o.thick * (0.75 + 0.5 * rnd()));
    const over = lay.multiplyScalar(len);
    m.makeBasis(side, up, over).setPosition(p.x - n.x * 0.006, p.y - n.y * 0.006, p.z - n.z * 0.006);
    mesh.setMatrixAt(made, m);
    o.color(p, col);
    const k2 = 0.82 + rnd() * 0.34;
    mesh.setColorAt(made, col.multiplyScalar(k2));
    made++;
  }
  mesh.count = made;
  mesh.userData.full = made;
  mesh.frustumCulled = false;
  return mesh;
}

const furMats: (THREE.MeshPhysicalNodeMaterial | null)[] = [null, null];
function furMaterial(cool: boolean): THREE.MeshPhysicalNodeMaterial {
  const was = furMats[cool ? 1 : 0];
  if (was) return was;
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 1, specularIntensity: 0, envMapIntensity: 0.9 });
  m.fog = false;
  const s = f(attribute('tall', 'float'));
  const hair = c3(attribute('instanceColor', 'vec3'));
  const dull = own((b) => b.dull);
  // (darker and redder at the root, as light does not get there)
  const root = c3(cool ? hair.mul(vec3(0.46, 0.4, 0.38)) : hair.mul(vec3(0.6, 0.38, 0.18)));
  const base = c3(mix(root, cool ? hair.mul(1.02) : hair, smoothstep(0, cool ? 0.95 : 0.65, s)));
  m.colorNode = mix(base, vec3(0.05, 0.045, 0.04), dull.mul(0.7));
  // (its own warm glow: in weak or cool light the gold stays gold, not olive)
  m.emissiveNode = c3((cool ? hair.mul(0.55) : hair.mul(vec3(1.35, 0.95, 0.3))).mul(s.mul(0.11).add(0.05))).mul(dull.oneMinus()).add(ownColor((b) => b.skin.emissive).mul(0.6));
  furMats[cool ? 1 : 0] = m;
  return m;
}

// ---------------------------------------------------------------- shapes (a bee of radius 1)

export function ellipsoid(rx: number, ry: number, rz: number, w = 56, h = 40): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);
  g.computeVertexNormals();
  return g;
}

export function shape(g: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    fn(p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A tube along points, its radius from `thick` at each place (0..1). */
export function tube(points: THREE.Vector3[], thick: (u: number) => number, seg = 40, round = 12): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, seg, 1, round);
  const pos = g.getAttribute('position');
  const mid = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = Math.floor(i / (round + 1)) / seg;
    curve.getPointAt(u, mid);
    const k = thick(u);
    pos.setXYZ(i, mid.x + (pos.getX(i) - mid.x) * k, mid.y + (pos.getY(i) - mid.y) * k, mid.z + (pos.getZ(i) - mid.z) * k);
  }
  g.computeVertexNormals();
  return g;
}

const CHEST = ellipsoid(0.5, 0.47, 0.53);
const LONG = 1.4;
const RINGS = 6;
/** The abdomen's radius along it (0: the waist, 1: the tip). */
const girth = (t: number): number => 0.55 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9)) ** 0.72 * (1 - 0.06 * t);
const frac = (x: number): number => x - Math.floor(x);
const BACK = ((): THREE.BufferGeometry => {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0)];
  const n = 120;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector2(girth(t) * (0.988 + 0.022 * frac(t * RINGS) ** 2), t));
  }
  pts.push(new THREE.Vector2(0.001, 1));
  return shape(new THREE.LatheGeometry(pts, 56), (p) => {
    const t = p.y;
    p.set(p.x, p.z * (p.z < 0 ? 0.92 : 1) - 0.2 * t * t, -t * LONG);
  });
})();
/** How much of a dark band is at a place of the abdomen. */
const bandAt = (t: number): number => {
  const r = frac(t * RINGS + 0.02);
  return t < 0.05 ? 0 : t > 0.9 ? 1 : ss(0.47, 0.51, r) * (1 - ss(0.98, 1, r));
};

/** The muzzle: how far the face comes forward at (x, y). */
const muzzle = (x: number, y: number): number => 0.135 * Math.exp(-((x / 0.185) ** 2) - ((y + 0.165) / 0.125) ** 2);
const flatter = (z: number): number => (z > 0.22 ? 0.22 + (z - 0.22) * 0.82 : z);
const HEAD = shape(ellipsoid(0.45, 0.43, 0.37, 120, 96), (p) => {
  // (a heart of a face: broad brow, small chin, a little flat in front)
  const down = Math.max(0, -p.y / 0.43);
  p.x *= 1 - 0.3 * down * down;
  p.z = flatter(p.z);
  if (p.z > 0) p.z += muzzle(p.x, p.y) * ss(0, 0.22, p.z);
});
/** The face's front at (x, y). */
const front = (x: number, y: number): number => {
  const down = Math.max(0, -y / 0.43);
  const z = flatter(0.37 * Math.sqrt(Math.max(0, 1 - (x / (0.45 * (1 - 0.3 * down * down))) ** 2 - (y / 0.43) ** 2)));
  return z + muzzle(x, y) * ss(0, 0.22, z);
};
const SMILE_Y = -0.17;
const EYE = ((): THREE.BufferGeometry => ellipsoid(0.185, 0.3, 0.225, 56, 44))();
/** Where an eye sits: its place and turn. */
const eyeFrame = (x: number): THREE.Matrix4 => new THREE.Matrix4().compose(v3(x * 0.295, 0.075, 0.125), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, x * 0.62, x * -0.2)), v3(1, 1, 1));
const EYE_IN = [-1, 1].map((x) => eyeFrame(x).invert());
const inEye = (p: THREE.Vector3, grow: number): boolean => {
  for (const m of EYE_IN) {
    const q = p.clone().applyMatrix4(m);
    if ((q.x / 0.185) ** 2 + (q.y / 0.3) ** 2 + (q.z / 0.225) ** 2 < grow) return true;
  }
  return false;
};
/** The smile's height over SMILE_Y. */
const smile = (x: number): number => -0.05 + 0.085 * (Math.abs(x) / 0.15) ** 2;
const onSnout = (x: number, y0: number, out: number): THREE.Vector3 => {
  const y = y0 + SMILE_Y;
  const e = 0.004;
  const n = v3((front(x - e, y) - front(x + e, y)) / (2 * e), (front(x, y - e) - front(x, y + e)) / (2 * e), 1).normalize();
  return v3(x, y, front(x, y)).addScaledVector(n, out);
};

/** A wing's outline: along its length (0..1) its front and back edge. */
const FORE = { long: 1.5, front: (u: number) => 0.06 + 0.16 * Math.sin(Math.PI * Math.min(1, u * 0.82 + 0.06)) ** 0.8, back: (u: number) => -0.05 - 0.37 * Math.sin(Math.PI * Math.min(1, 0.04 + u ** 1.3 * 0.82)) ** 0.9 };
const HIND = { long: 1.02, front: (u: number) => 0.04 + 0.07 * Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.05)), back: (u: number) => -0.04 - 0.31 * Math.sin(Math.PI * Math.min(1, 0.04 + u ** 1.1 * 0.82)) ** 0.9 };
function wingGeometry(o: typeof FORE): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 64, 16);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5;
    const v = pos.getY(i) + 0.5;
    // (both edges meet in a round tip)
    const k = u > 0.78 ? Math.sqrt(Math.max(0, 1 - ((u - 0.78) / 0.22) ** 2)) : u < 0.07 ? 0.4 + 0.6 * (u / 0.07) : 1;
    const a = o.front(Math.min(u, 0.86));
    const b = o.back(Math.min(u, 0.86));
    const mid = (a + b) / 2;
    const z = mid + (b + (a - b) * v - mid) * k;
    pos.setXYZ(i, u * o.long, (0.06 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u) + 0.012 * Math.sin(u * 17 + v * 9)) * k, z);
  }
  g.computeVertexNormals();
  return g;
}

/** Veins: white on black. */
function veins(fore: boolean): THREE.CanvasTexture {
  const w = 1024;
  const h = 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = '#000';
  x.fillRect(0, 0, w, h);
  x.strokeStyle = '#fff';
  x.lineCap = x.lineJoin = 'round';
  const line = (width: number, ...p: number[]): void => {
    x.lineWidth = width;
    x.beginPath();
    x.moveTo(p[0] * w, p[1] * h);
    for (let i = 2; i < p.length; i += 4) x.quadraticCurveTo(p[i] * w, p[i + 1] * h, p[i + 2] * w, p[i + 3] * h);
    x.stroke();
  };
  line(26, 0, 0.1, 0.3, 0.04, 0.62, 0.04);
  line(18, 0.62, 0.04, 0.8, 0.04, 0.9, 0.12);
  line(11, 0, 0.32, 0.25, 0.2, 0.5, 0.18, 0.66, 0.16, 0.74, 0.07);
  if (fore) {
    line(8, 0, 0.5, 0.2, 0.44, 0.42, 0.42, 0.62, 0.4, 0.8, 0.44);
    line(7, 0, 0.68, 0.2, 0.72, 0.46, 0.7, 0.66, 0.68, 0.78, 0.72);
    line(6, 0.26, 0.27, 0.24, 0.36, 0.28, 0.43);
    line(6, 0.44, 0.2, 0.47, 0.32, 0.43, 0.42);
    line(6, 0.6, 0.18, 0.6, 0.3, 0.57, 0.41);
    line(6, 0.7, 0.15, 0.73, 0.3, 0.71, 0.42);
    line(6, 0.34, 0.43, 0.38, 0.56, 0.35, 0.71);
    line(6, 0.56, 0.41, 0.62, 0.55, 0.6, 0.68);
    line(5, 0.6, 0.55, 0.7, 0.5, 0.79, 0.44);
    line(6, 0.1, 0.5, 0.12, 0.6, 0.12, 0.7);
  } else {
    line(7, 0, 0.5, 0.3, 0.5, 0.7, 0.52);
    line(6, 0, 0.68, 0.25, 0.78, 0.5, 0.84);
    line(6, 0.34, 0.24, 0.38, 0.38, 0.36, 0.5);
    line(6, 0.3, 0.51, 0.34, 0.66, 0.36, 0.8);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

// ---- the legs, in a limb's own frame (along +y, 0 at the hip's end; across in units of its thickness)
const turned = (pts: [number, number][], n = 18): THREE.BufferGeometry => {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  return new THREE.LatheGeometry(curve.getPoints(70).map((p) => new THREE.Vector2(Math.max(0.001, p.x), p.y)), n);
};
export const FEMUR = turned([[0.02, -0.05], [0.7, -0.035], [1.0, 0.04], [1.4, 0.22], [1.5, 0.42], [1.2, 0.68], [0.85, 0.88], [0.74, 0.95], [0.78, 1.0], [0.55, 1.03], [0.02, 1.04]]);
export const FOOT = ((): THREE.BufferGeometry => {
  const shin = turned([[0.02, -0.05], [0.55, -0.04], [0.8, -0.005], [0.8, 0.05], [0.82, 0.1], [1.1, 0.28], [1.3, 0.45], [1.1, 0.535], [0.6, 0.56], [0.02, 0.565]]);
  const parts: THREE.BufferGeometry[] = [shin];
  let y = 0.55;
  for (const [r, l] of [[0.72, 0.13], [0.6, 0.085], [0.55, 0.075], [0.52, 0.07], [0.5, 0.075]]) {
    parts.push(turned([[0.02, y - 0.006], [r * 0.62, y], [r, y + l * 0.5], [r * 0.95, y + l * 0.8], [r * 0.5, y + l], [0.02, y + l + 0.004]], 14));
    y += l * 0.97;
  }
  // (two claws, and a pad between them)
  for (const s of [-1, 1]) parts.push(new THREE.ConeGeometry(0.22, 0.075, 8).rotateZ(0).translate(s * 0.4, y + 0.025, 0));
  parts.push(new THREE.SphereGeometry(1, 14, 10).scale(0.42, 0.02, 0.5).translate(0, y + 0.012, 0));
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
})();
/** A clump of pollen grains. */
const POLLEN = ((): THREE.BufferGeometry => {
  const rnd = draws(5);
  const parts: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(0.12, 3).scale(0.85, 1.15, 0.85)];
  for (let i = 0; i < 90; i++) {
    const y = 1 - (2 * (i + 0.5)) / 90;
    const a = i * 2.39996;
    const r = Math.sqrt(1 - y * y);
    parts.push(new THREE.IcosahedronGeometry(0.017 + 0.012 * rnd(), 1).translate(Math.cos(a) * r * 0.1, y * 0.135, Math.sin(a) * r * 0.1));
  }
  return mergeGeometries(parts);
})();

// ---------------------------------------------------------------- materials and coats, per team

interface Parts {
  wingFore: THREE.Material;
  wingHind: THREE.Material;
  eye: THREE.Material;
  back: THREE.Material;
  limb: THREE.Material;
  fuzz: THREE.Material;
  dark: THREE.Material;
  lid: THREE.Material;
  scarf: THREE.Material;
  club: THREE.Material;
  skin: THREE.Material;
  mouth: THREE.Material;
  tongue: THREE.Material;
  pollen: THREE.Material;
  amber: THREE.Material;
  furChest: THREE.InstancedMesh;
  furHead: THREE.InstancedMesh;
  furFace: THREE.InstancedMesh;
  furBack: THREE.InstancedMesh;
  furLid: THREE.InstancedMesh;
}
const teams: (Parts | null)[] = [null, null];
let shared: { lid: THREE.InstancedMesh; head: THREE.InstancedMesh; face: THREE.InstancedMesh; chest: THREE.InstancedMesh; fore: THREE.CanvasTexture; hind: THREE.CanvasTexture } | null = null;

function skin(c: V3, rough = 0.6): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough });
  m.fog = false;
  const dull = own((b) => b.dull);
  m.colorNode = mix(c, vec3(0.05, 0.045, 0.04), dull.mul(0.7));
  m.emissiveNode = c3(c.mul(0.03)).mul(dull.oneMinus()).add(ownColor((b) => b.skin.emissive));
  return m;
}

/** Bare: where an eye is. */
const bare = (p: THREE.Vector3): boolean => inEye(p, 1.02);
const crown = (p: THREE.Vector3): number => Math.max(ss(0.1, 0.38, p.y), ss(0.17, -0.1, p.z));
const headLook = {
  color: (p: THREE.Vector3, out: THREE.Color): void => {
    // (a cream face that widens down to the muzzle, softly into the gold; blush on the cheeks)
    const half = 0.07 + 0.42 * Math.max(0, 0.2 - p.y);
    const pale = ss(half + 0.1, half - 0.07, Math.abs(p.x)) * ss(0.1, 0.26, p.z) * ss(0.26, 0.02, p.y);
    const blush = ss(0.1, 0.02, Math.hypot(Math.abs(p.x) - 0.225, (p.y + 0.19) * 1.1)) * ss(0.05, 0.16, p.z);
    out.copy(DEEP).lerp(GOLD, ss(-0.45, 0.05, p.y)).lerp(CREAM, pale);
    out.lerp(rgb(0xff8a4a), 0.6 * blush);
  },
  comb: (p: THREE.Vector3, _n: THREE.Vector3, out: THREE.Vector3): void => {
    // (up and back over the brow, out and down on the face)
    const up = ss(0.1, 0.3, p.y);
    // (over the lip down, as a moustache parts)
    const lip = Math.exp(-((p.x / 0.17) ** 2) - ((p.y + 0.15) / 0.1) ** 2);
    out.set(p.x * (1.6 + 3 * lip), -0.8 + 1.5 * up, 0.15 - 1.1 * up);
  },
};
const chestColor = (p: THREE.Vector3, out: THREE.Color): void => {
  out.copy(DEEP).lerp(GOLD, ss(-0.42, 0.18, p.y)).lerp(CREAM, 0.35 * ss(0.22, 0.5, p.z));
  // (a dark saddle between the wings, and dark below)
  out.lerp(BLACK, 0.95 * ss(0.36, 0.2, Math.hypot(p.x * 1.1, p.z + 0.08)) * ss(0.25, 0.36, p.y) + 0.85 * ss(-0.2, -0.36, p.y));
};
/** The skin takes the colour of the hairs on it, a little darker: no gap shows between them. */
function paint(g: THREE.BufferGeometry, look: (p: THREE.Vector3, out: THREE.Color) => void, dark = 0.5): void {
  const pos = g.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    look(p.fromBufferAttribute(pos, i), c);
    out.set([c.r * dark, c.g * dark * 0.86, c.b * dark * 0.76], i * 3);
  }
  g.setAttribute('paint', new THREE.Float32BufferAttribute(out, 3));
}
paint(HEAD, headLook.color, 0.85);
paint(CHEST, chestColor, 0.75);

/** The hair gives way along the smile. */
const groove = (p: THREE.Vector3): number => (p.z < 0.2 || Math.abs(p.x) > 0.158 ? 1 : 0.18 + 0.82 * ss(0.003, 0.02, Math.abs(p.y - SMILE_Y - smile(p.x))));

function partsOf(side: number): Parts {
  const made = teams[side];
  if (made) return made;
  const T = TEAM[side];
  shared ??= {
    lid: fur(EYE, {
      count: 9000,
      long: 0.034,
      thick: 0.0036,
      lie: 0.7,
      at: (p) => (p.z < -0.08 ? 0 : 1),
      color: (_p, out) => {
        out.copy(GOLD).lerp(DEEP, 0.15);
      },
      comb: (p, _n, out) => out.set(p.x, p.y > -0.03 ? -1 : 1, 0),
    }),
    chest: fur(CHEST, {
      count: 11000,
      long: 0.25,
      thick: 0.0115,
      lie: 0.42,
      at: (p) => 0.8 + 0.3 * ss(0.1, 0.5, p.z) + 0.15 * ss(0.1, 0.45, p.y),
      color: chestColor,
      comb: (p, _n, out) => out.set(p.x * 0.5, p.y > 0 ? 0.1 : -0.5, -0.8 + p.z * 0.9),
    }),
    head: fur(HEAD, { ...headLook, count: 10500, long: 0.16, thick: 0.0085, lie: 0.5, at: (p) => (bare(p) ? 0 : (0.2 + 0.8 * crown(p)) * ss(0.02, 0.3, crown(p)) * (0.35 + 0.65 * ss(-0.34, -0.12, p.z))) }),
    face: fur(HEAD, { ...headLook, count: 34000, long: 0.042, thick: 0.0034, lie: 0.68, at: (p) => (bare(p) || p.z < 0 ? 0 : groove(p) * (1 - ss(0.5, 1, crown(p))) * (0.75 + 0.35 * ss(0.15, 0.02, Math.hypot(Math.abs(p.x) - 0.25, p.y + 0.22)))) }),
    fore: veins(true),
    hind: veins(false),
  };
  const bandCol = rgb(T.band);
  const furBack = fur(BACK, {
    count: 34000,
    long: 0.12,
    thick: 0.0062,
    lie: 0.7,
    at: (p) => {
      const t = -p.z / LONG;
      // (the dark ones a little longer: the gold behind does not hide them)
      return (0.82 + 0.18 * bandAt(t)) * (0.8 + 0.2 * ss(0.7, 1, t) + 0.5 * ss(0.26, 0.04, t));
    },
    color: (p, out) => {
      const t = -p.z / LONG;
      const up = ss(-0.45, 0.25, p.y);
      out.copy(DEEP).lerp(GOLD, 0.35 + 0.65 * up);
      out.lerp(bandCol, bandAt(t));
      // (a pale fringe where a plate ends)
      out.lerp(CREAM, 0.12 * ss(0.92, 1, frac(t * RINGS)) * (1 - ss(0.86, 0.9, t)));
    },
    comb: (p, _n, out) => out.set(p.x * 0.25, -0.12, -1),
  });

  const rim = (p: number): F => f(float(1).sub(abs(normalView.dot(positionViewDirection))).pow(p));
  const dull = own((b) => b.dull);
  const wing = (t: THREE.CanvasTexture): THREE.MeshPhysicalNodeMaterial => {
    const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.15, specularIntensity: 0.25, envMapIntensity: 0.5 });
    m.fog = false;
    const vein = f(texture(t, uv() as unknown as V2).r);
    const ndv = f(abs(normalView.dot(positionViewDirection)));
    const turn = f(ndv.mul(8).add(uv().x.mul(6)));
    const film = c3(vec3(cos(turn), cos(turn.add(2.1)), cos(turn.add(4.2))).mul(0.5).add(0.5));
    const graze = f(smoothstep(0.75, 0.15, ndv));
    const edge = f(smoothstep(0.975, 1, uv().y).max(smoothstep(0.02, 0, uv().y)));
    const v = f(max(vein, edge));
    // (the lines are amber, the clear between them takes a film's colours only when seen flat)
    m.colorNode = mix(mix(tint(T.wing), film, graze.mul(0.55)), vec3(0.3, 0.12, 0.025), v);
    m.emissiveNode = c3(mix(film.mul(tint(T.wing)).mul(graze.mul(0.16)).add(tint(T.edge).mul(0.015)), vec3(0.03, 0.012, 0), v)).mul(dull.oneMinus());
    m.opacityNode = mix(f(graze.mul(0.22).add(0.13)), float(0.95), v);
    return m;
  };

  // ---- compound eyes: facets towards the edge, a sheen in the team's colour, the dark spot that looks back, soft lights
  const eye = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08, specularIntensity: 0.6 });
  eye.fog = false;
  {
    const p = c3(positionGeometry.div(vec3(0.185, 0.3, 0.225)).normalize());
    const mir = f(attribute('mir', 'float'));
    const a = vec2(p.x.atan(p.z).mul(17), p.y.asin().mul(17));
    const row = floor(a.y);
    const cellX = fract(a.x.add(row.mod(2).mul(0.5))).sub(0.5);
    const facet = f(smoothstep(0.52, 0.26, vec2(cellX, fract(a.y).sub(0.5)).length()));
    const ndv = f(abs(normalView.dot(positionViewDirection)));
    const out = f(smoothstep(0.95, 0.45, ndv));
    const spot = f(smoothstep(0.82, 0.97, ndv));
    const deep = c3(mix(vec3(0.02, 0.01, 0.006), tint(T.eye), ndv.oneMinus().pow(0.9).mul(0.95)));
    const bounce = f(smoothstep(-0.2, -0.95, p.y).mul(ndv.oneMinus()));
    const sky = f(smoothstep(0.2, 0.9, p.y).mul(0.5).mul(ndv.oneMinus()));
    eye.colorNode = c3(mix(deep, vec3(0.004, 0.003, 0.003), spot.mul(0.9))).mul(mix(float(1), facet.mul(0.8).add(0.45), out));
    eye.normalNode = bumpMap(f(facet.mul(out)), float(0.006));
    const lightAt = (x: number, y: number, z: number, r: number, soft: number): F => {
      const l = Math.hypot(x, y, z);
      const d = vec3(p.x.mul(mir), p.y.mul(1), p.z).sub(vec3(x / l, y / l, z / l)).length();
      return f(smoothstep(r, r * (1 - soft), d));
    };
    // (a curved light high up, a small one low: it looks awake and kind)
    const big = f(lightAt(0.32, 0.55, 0.78, 0.235, 0.35).mul(smoothstep(0.1, 0.2, vec3(p.x.mul(mir), p.y, p.z).sub(vec3(0.36, 0.42, 0.83)).length().sub(0.02)).mul(0.25).add(0.75)));
    const little = lightAt(0.1, -0.42, 0.9, 0.095, 0.5);
    const lights = f(big.add(little.mul(0.75)));
    eye.emissiveNode = c3(tint(T.edge).mul(rim(3).mul(0.18)).add(tint(T.eye).mul(bounce.mul(0.55))).add(vec3(0.2, 0.24, 0.32).mul(sky.mul(0.4))).add(vec3(0.95, 0.93, 0.88).mul(lights))).mul(dull.oneMinus()).add(ownColor((b) => b.eyes.emissive));
  }

  const tOf = f(positionGeometry.z.div(-LONG));
  const ring = f(fract(tOf.mul(RINGS).add(0.02)));
  const banded = c3(mix(mix(tint(0xb06a06), tint(0xe8a40c), smoothstep(-0.4, 0.4, positionGeometry.y)), tint(T.band).mul(0.8), smoothstep(0.47, 0.51, ring).mul(smoothstep(1, 0.98, ring)).max(smoothstep(0.88, 0.92, tOf))));
  const back = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.92, specularIntensity: 0.1 });
  back.fog = false;
  back.colorNode = mix(banded, vec3(0.05, 0.045, 0.04), dull.mul(0.7));
  back.emissiveNode = c3(tint(T.edge).mul(rim(3).mul(0.12))).mul(dull.oneMinus()).add(ownColor((b) => b.skin.emissive));

  const limb = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25 });
  limb.fog = false;
  const joint = f(smoothstep(0.2, 0.0, positionGeometry.y).pow(1.4).add(smoothstep(0.86, 1, positionGeometry.y).mul(0.6)));
  limb.colorNode = mix(mix(vec3(0.012, 0.007, 0.005), vec3(0.03, 0.013, 0.007), smoothstep(0.1, 0.6, positionGeometry.y)), tint(T.scarf), joint.mul(0.6));
  limb.emissiveNode = c3(tint(T.edge).mul(rim(3).mul(0.16)).add(tint(T.scarf).mul(joint.mul(0.12)))).mul(dull.oneMinus()).add(ownColor((b) => b.legSkin.emissive));
  const fuzz = new THREE.MeshStandardNodeMaterial({ color: T.fuzz, roughness: 0.7 });
  fuzz.fog = false;
  const dark = new THREE.MeshPhysicalNodeMaterial({ color: 0x1e0d05, roughness: 0.34, clearcoat: 0.5 });
  dark.fog = false;
  const lid = skin(c3(mix(tint(0xc08010), tint(0xd08c10), smoothstep(-0.1, 0.7, positionGeometry.y).add(mx_noise_float(positionGeometry.mul(26)).mul(0.12)))), 0.9);

  const scarf = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, side: THREE.DoubleSide });
  scarf.fog = false;
  const fold = f(mx_noise_float(positionGeometry.mul(vec3(9, 9, 22))).mul(0.5).add(0.5));
  scarf.colorNode = c3(mix(tint(T.scarf).mul(0.5), tint(T.scarf), fold));
  scarf.normalNode = bumpMap(fold, float(0.03));
  scarf.emissiveNode = c3(tint(T.scarf).mul(rim(2.2).mul(0.06))).mul(dull.oneMinus());
  const pollen = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  pollen.fog = false;
  pollen.colorNode = c3(mix(tint(0xd07404), tint(0xf0a020), f(mx_noise_float(positionGeometry.mul(30)).mul(0.6).add(0.5))));

  const p: Parts = {
    wingFore: wing(shared.fore),
    wingHind: wing(shared.hind),
    eye,
    back,
    limb,
    fuzz,
    dark,
    lid,
    scarf,
    club: skin(c3(mix(tint(0x1e0d05), tint(T.scarf), smoothstep(-0.2, 0.9, positionLocal.y))), 0.45),
    skin: skin(c3(attribute('paint', 'vec3')), 0.85),
    mouth: skin(tint(0x3a0c10), 0.6),
    tongue: skin(tint(0xf0706c), 0.4),
    pollen,
    amber: skin(tint(0x6e3208), 0.3),
    furChest: shared.chest,
    furHead: shared.head,
    furFace: shared.face,
    furBack,
    furLid: shared.lid,
  };
  teams[side] = p;
  return p;
}

/** A coat for one more bee (the hairs and their shader are shared). */
export function coat(of: THREE.InstancedMesh): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(of.geometry, of.material as THREE.Material, of.userData.full as number);
  m.instanceMatrix = of.instanceMatrix;
  m.instanceColor = of.instanceColor;
  m.geometry = of.geometry.clone();
  m.geometry.setAttribute('instanceColor', of.instanceColor as THREE.InstancedBufferAttribute);
  m.instanceColor = null;
  m.frustumCulled = false;
  m.userData.full = of.userData.full;
  return m;
}

/** Make a bee of a bug's view: the generic body is taken away, a real one takes its place. Returns what moves. */
export function dressBee(view: BugView, side: number): Face {
  const P = partsOf(side);
  const torso = view.torso;
  const abdomen = view.lumps[0].parent as THREE.Object3D;
  const old: THREE.Object3D[] = [];
  torso.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) old.push(o);
  });
  for (const o of old) o.visible = false;
  const coats: THREE.InstancedMesh[] = [];
  const small: THREE.Object3D[] = [];
  const add = (to: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, at?: THREE.Vector3, shadow = true): THREE.Mesh => {
    const o = new THREE.Mesh(g, m);
    if (at) o.position.copy(at);
    o.castShadow = shadow;
    o.receiveShadow = true;
    to.add(o);
    return o;
  };
  const furry = (to: THREE.Object3D, of: THREE.InstancedMesh, at?: THREE.Vector3): THREE.InstancedMesh => {
    const o = coat(of);
    if (at) o.position.copy(at);
    o.receiveShadow = true;
    to.add(o);
    coats.push(o);
    return o;
  };

  const chest = v3(0, 0.1, -0.02);
  add(torso, CHEST, P.skin, chest);
  furry(torso, P.furChest, chest);

  // ---- abdomen, hinged at the waist
  abdomen.position.set(0, 0.06, -0.42);
  const tilt = new THREE.Group();
  tilt.rotation.x = -0.1;
  abdomen.add(tilt);
  add(tilt, BACK, P.back);
  furry(tilt, P.furBack);
  const sting = add(tilt, new THREE.ConeGeometry(0.022, 0.13, 10).rotateX(-Math.PI / 2), P.amber, v3(0, -0.2, -LONG - 0.035), false);
  // (what climbs on it, or grips it, finds its body here)
  view.lumps[0].position.set(0, -0.06, -LONG * 0.46);
  view.lumps[0].scale.set(0.5, 0.48, 0.68);

  // ---- head
  const head = view.head;
  head.position.set(0, 0.14, 0.74);
  view.headAt.copy(head.position);
  add(head, HEAD, P.skin);
  furry(head, P.furHead);
  furry(head, P.furFace);
  const lids: THREE.Group[] = [];
  for (const x of [-1, 1]) {
    const socket = new THREE.Group();
    socket.applyMatrix4(eyeFrame(x));
    head.add(socket);
    const g = EYE.clone();
    g.setAttribute('mir', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(-x), 1));
    add(socket, g, P.eye);
    // (shut: a furred lid over the whole eye, a dark line where its halves meet, curved up as when one laughs)
    const lid = new THREE.Group();
    lid.visible = false;
    add(lid, EYE, P.lid, undefined, false).scale.setScalar(1.02);
    furry(lid, P.furLid);
    const lash: THREE.Vector3[] = [];
    for (let i = -8; i <= 8; i++) {
      const a = (i / 8) * 0.95;
      const y = -0.02 - 0.06 * (i / 8) ** 2;
      const k = Math.sqrt(1 - (y / 0.3) ** 2);
      lash.push(v3(Math.sin(a) * 0.185 * k, y, Math.cos(a) * 0.225 * k).multiplyScalar(1.045));
    }
    add(lid, tube(lash, (u) => 0.002 + 0.0075 * Math.sin(Math.PI * u), 48, 8), P.mouth, undefined, false);
    socket.add(lid);
    lids.push(lid);
  }
  // ---- the smile: a thin line, its corners curled up into the cheeks
  const lip: THREE.Vector3[] = [];
  for (let i = -9; i <= 9; i++) {
    const x = (i / 9) * 0.152;
    lip.push(onSnout(x, smile(x), 0.013));
  }
  lip.unshift(onSnout(-0.163, smile(0.152) + 0.026, 0.004), onSnout(-0.16, smile(0.152) + 0.012, 0.013));
  lip.push(onSnout(0.16, smile(0.152) + 0.012, 0.013), onSnout(0.163, smile(0.152) + 0.026, 0.004));
  const lipLine = add(head, tube(lip, (u) => 0.0004 + 0.0072 * Math.sin(Math.PI * u) ** 0.9, 64, 8), P.mouth, undefined, false);
  // (a fold of the cheek at each end)
  const jaw = new THREE.Group();
  head.add(jaw);
  const cavity = shape(new THREE.PlaneGeometry(1, 1, 28, 12), (p) => {
    const x = p.x * 0.25;
    const t = 0.5 - p.y;
    const deep = 0.075 * Math.max(0, 1 - (p.x * 2) ** 2) ** 0.7;
    p.copy(onSnout(x, smile(x) - t * deep, 0.03));
  });
  add(jaw, cavity, P.mouth, undefined, false);
  add(jaw, shape(new THREE.CircleGeometry(0.04, 28), (p) => p.copy(onSnout(p.x * 1.35, smile(0) - 0.052 + p.y * 0.5, 0.0325))), P.tongue, undefined, false);
  jaw.visible = false;
  const oh = add(head, shape(new THREE.CircleGeometry(1, 40), (p) => p.copy(onSnout(p.x * 0.07, smile(0) - 0.03 + p.y * 0.085, 0.036))), P.mouth, undefined, false);
  oh.visible = false;
  // ---- feelers: a socket, a long joint, ten beads, a slim club
  const feelers: THREE.Group[] = [];
  for (const x of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(x * 0.075, 0.2, 0.325);
    head.add(g);
    feelers.push(g);
    const socket = add(g, new THREE.TorusGeometry(0.024, 0.009, 10, 24), P.dark, v3(0, 0, 0.005), false);
    socket.rotation.x = -0.5;
    const elbow = v3(x * 0.2, 0.36, 0.06);
    add(g, tube([v3(0, -0.01, 0), v3(x * 0.07, 0.19, 0.06), elbow], (u) => 0.02 - 0.004 * u, 18, 10), P.dark);
    add(g, BALL, P.dark, elbow, false).scale.setScalar(0.021);
    const curve = new THREE.CatmullRomCurve3([elbow, v3(x * 0.33, 0.45, 0.16), v3(x * 0.47, 0.44, 0.28), v3(x * 0.57, 0.36, 0.36)]);
    const beads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 10; i++) {
      const u = (i + 0.5) / 10;
      const at = curve.getPointAt(u);
      const b = new THREE.CapsuleGeometry(0.0155 + 0.002 * (i / 9), 0.036, 4, 10).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, curve.getTangentAt(u)));
      b.translate(at.x, at.y, at.z);
      beads.push(b);
    }
    add(g, mergeGeometries(beads), P.dark);
    const club = add(g, BALL, P.club, curve.getPointAt(1));
    club.quaternion.setFromUnitVectors(UP, curve.getTangentAt(1));
    club.scale.set(0.023, 0.055, 0.023);
  }

  // ---- a scarf in the team's colour, its tails in the wind
  const neck = new THREE.Group();
  neck.position.set(0, 0.06, 0.45);
  neck.rotation.x = 0.16;
  torso.add(neck);
  for (const [r, t, z, turn] of [[0.425, 0.085, 0, 0], [0.4, 0.07, 0.1, 0.14]]) {
    const ring = add(neck, shape(new THREE.TorusGeometry(r, t, 22, 84), (p) => {
      const a = Math.atan2(p.y, p.x);
      const k = 1 + 0.03 * Math.sin(a * 5 + p.z * 16) + 0.02 * Math.sin(a * 11);
      p.x *= k;
      p.y *= k;
      p.z *= 1.05;
    }), P.scarf, v3(0, 0, z));
    ring.rotation.set(turn, 0, turn * 2);
  }
  const knot = add(neck, shape(ellipsoid(0.1, 0.085, 0.085, 28, 20), (p) => p.multiplyScalar(1 + 0.08 * Math.sin(p.x * 30 + p.y * 22))), P.scarf, v3(0.3, -0.34, 0.16));
  knot.rotation.z = 0.5;
  const tails: { m: THREE.Mesh; base: Float32Array; long: number; k: number }[] = [];
  for (const [k, long] of [[0, 0.85], [1, 0.66]]) {
    const g = new THREE.BoxGeometry(0.2, long, 0.02, 12, 28, 1);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = 0.5 - pos.getY(i) / long;
      const end = Math.max(0, (t - 0.78) / 0.22);
      pos.setXYZ(i, pos.getX(i) * (0.4 + 0.75 * t) * (1 - end), -t * long, pos.getZ(i) + 0.03 * Math.sin((pos.getX(i) / 0.2) * 9) * t * (1 - end));
    }
    const m = add(neck, g, P.scarf, v3(0.32, -0.37, 0.14));
    m.rotation.set(0.55 + k * 0.25, 0.5, 0.75 + k * 0.4);
    tails.push({ m, base: (pos.array as Float32Array).slice(), long, k });
  }

  // ---- wings, a dark scale over each joint
  const wings: { hinge: THREE.Group; x: number; fore: boolean }[] = [];
  for (const x of [-1, 1])
    for (const fore of [true, false]) {
      const hinge = new THREE.Group();
      hinge.position.set(x * 0.27, 0.47, fore ? 0.08 : -0.16);
      torso.add(hinge);
      const w = add(hinge, wingGeometry(fore ? FORE : HIND), fore ? P.wingFore : P.wingHind);
      w.scale.x = x;
      w.receiveShadow = false;
      w.renderOrder = 3;
      wings.push({ hinge, x, fore });
    }

  // ---- legs: swollen thighs, jointed feet with claws, hairs in the team's colour; pollen on the hind pair
  const pivots = view.root.children.filter((c) => c !== torso && c.children.length === 2 && !(c as THREE.Mesh).isMesh);
  pivots.forEach((pivot, i) => {
    const [upper, lower] = pivot.children as THREE.Mesh[];
    upper.geometry = FEMUR;
    lower.geometry = FOOT;
    for (const m of [upper, lower]) {
      m.material = P.limb;
      m.scale.x = m.scale.z = 0.07;
      const o = new THREE.Mesh(hairs(m.scale.x / m.scale.y, m === upper), P.fuzz);
      m.add(o);
      small.push(o);
    }
    if (i >= 4) {
      const t = lower.scale;
      const grains = add(lower, POLLEN, P.pollen, v3(i % 2 ? -0.95 : 0.95, 0.3, 0));
      grains.scale.set(1 / t.x, 1 / t.y, 1 / t.z);
    }
  });

  view.root.traverse((o) => (o.userData.bug = view));
  let close = -1;
  let raised = 0;
  return {
    near(on, distance = on ? 0 : 99) {
      // (a thinner coat the farther it is)
      const step = !on ? 0 : distance < 17 ? 3 : distance < 32 ? 2 : 1;
      if (step === close) return;
      close = step;
      for (const c of coats) {
        c.visible = step > 0;
        c.count = Math.floor((c.userData.full as number) * [0, 0.22, 0.5, 1][step]);
      }
      for (const o of small) o.visible = step > 1;
      sting.visible = step > 1;
    },
    blink(shut) {
      // (squinting, the lower lid comes up a little too: it smiles with its eyes)
      // (all the way or not at all: half shut it looks drowsy)
      const s = shut > 0.55 ? 1 : 0;
      for (const l of lids) l.visible = s > 0;
    },
    jaws(open) {
      const k = ss(0.4, 0.9, open);
      jaw.visible = k > 0.02;
      jaw.scale.y = 1;
      jaw.position.y = 0;
      jaw.scale.set(1, 0.4 + 0.6 * k, 1);
      jaw.position.y = (1 - jaw.scale.y) * (SMILE_Y + smile(0));
      feelers.forEach((g, i) => {
        g.rotation.z = (i ? -1 : 1) * 0.12 * open;
        g.rotation.x = -0.15 * open - 0.4 * raised;
      });
    },
    cry(on) {
      oh.visible = on;
      lipLine.visible = !on;
      if (on) jaw.visible = false;
    },
    wingsTo(open, beat, seconds) {
      raised = open;
      // (folded back over the abdomen; in flight out to the sides, beating)
      const phase = seconds * 62;
      for (const w of wings) {
        const x = w.x;
        w.hinge.rotation.order = 'YZX';
        w.hinge.rotation.y = x * ((w.fore ? 1.2 : 1.32) * (1 - open) + (w.fore ? 0.12 : 0.42) * open);
        w.hinge.rotation.z = x * (0.3 * (1 - open) + open * (0.2 + beat * 0.75 * Math.sin(phase + (w.fore ? 0 : 0.45))));
        w.hinge.rotation.x = open * beat * 0.45 * Math.cos(phase) - 0.14 * (1 - open);
      }
      const gust = 0.35 + open * 0.65;
      for (const t of tails) {
        const pos = t.m.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const u = -t.base[i * 3 + 1] / t.long;
          pos.setZ(i, t.base[i * 3 + 2] + Math.sin(u * 6 - seconds * (3 + 5 * open) + t.k * 1.6) * 0.11 * u * gust);
          pos.setX(i, t.base[i * 3] + Math.sin(u * 4 - seconds * 2.4 + t.k) * 0.05 * u * gust);
        }
        pos.needsUpdate = true;
        t.m.geometry.computeVertexNormals();
        t.m.rotation.x = 0.55 + t.k * 0.25 + open * 0.5;
      }
      feelers.forEach((g, i) => {
        g.rotation.y = Math.sin(seconds * 1.9 + i * 2.2) * 0.12;
      });
      abdomen.rotation.x = Math.sin(seconds * 2.3) * 0.03 - open * 0.16;
    },
  };
}

/** Short hairs over a limb, for its proportions. */
const HAIRS = new Map<string, THREE.BufferGeometry>();
export function hairs(thin: number, thigh: boolean, length = 1, dense = 1): THREE.BufferGeometry {
  const key = `${thigh}${thin.toFixed(3)}${length}x${dense}`;
  let g = HAIRS.get(key);
  if (g) return g;
  const one = new THREE.ConeGeometry(1, 1, 3).translate(0, 0.5, 0);
  const m = new THREE.Matrix4();
  const all: THREE.BufferGeometry[] = [];
  const n = Math.round((thigh ? 260 : 300) * dense);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996;
    // (a thick coat goes over the knee)
    const from = dense > 1 ? -0.035 : 0.05;
    const y = from + ((thigh ? (dense > 1 ? 1.05 : 0.85) : dense > 1 ? 0.93 : 0.84) * i) / n;
    const wide = thigh ? 1.0 + 0.4 * Math.sin(Math.PI * y) : y < 0.55 ? 1.05 : 0.5;
    const l = length * (thigh ? 0.75 : y < 0.55 ? 0.9 : 0.4) * (0.6 + 0.5 * Math.abs(Math.sin(i * 7.3)));
    m.makeBasis(v3(-Math.sin(a) * 0.05, 0, Math.cos(a) * 0.05), v3(Math.cos(a) * l, 1.5 * l * thin, Math.sin(a) * l), v3(0, 0.05 * thin, 0));
    all.push(one.clone().applyMatrix4(m.setPosition(Math.cos(a) * wide * 0.92, y, Math.sin(a) * wide * 0.92)));
  }
  g = mergeGeometries(all);
  HAIRS.set(key, g);
  return g;
}
