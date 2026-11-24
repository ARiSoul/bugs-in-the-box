import * as THREE from 'three/webgpu';
import { abs, bumpMap, float, fract, mix, mx_noise_float, normalView, positionLocal, positionViewDirection, smoothstep, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BugView } from '../BugView';

const UP = new THREE.Vector3(0, 1, 0);
const HAIR = new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0);
const BALL = new THREE.SphereGeometry(1, 24, 18);
/** A limb's spines, by species and proportions. */
const SPINES = new Map<string, THREE.BufferGeometry>();
type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

/** What moves on a dressed bug besides its body: the lids (0 open, 1 shut), the jaws (0 shut, 1 wide). */
export interface Face {
  blink(shut: number): void;
  jaws(open: number): void;
  /** Whether it is near enough for its hairs and spines. */
  near(on: boolean): void;
}

/** Each team's colours on the fighters: the shell, its shadow side, the light on its edge, the limbs. */
const PAINT = [
  { shell: 0xc2231c, deep: 0x3a0608, edge: 0xffa070, limb: 0x2a0c0c },
  { shell: 0x1f6fd0, deep: 0x06163c, edge: 0x7fd4ff, limb: 0x0c1830 },
];

interface Coat {
  shell: number;
  deep: number;
  edge: number;
  rough: number;
  /** Dark seams of an abdomen's plates along its length. */
  plates?: boolean;
  /** Dark bands along a limb, and a glow at its joints. */
  limb?: boolean;
}

/** A number, or a colour, of the bug a mesh belongs to: the material is shared, this is not. */
const ofBug = (o: THREE.Object3D | null): BugView | undefined => o?.userData.bug as BugView | undefined;
function own(get: (v: BugView) => number): F {
  return uniform(0).onObjectUpdate(({ object }) => {
    const v = ofBug(object);
    return v ? get(v) : 0;
  }) as unknown as F;
}
const NONE = new THREE.Color(0);
function ownColor(get: (v: BugView) => THREE.Color): V3 {
  return uniform(new THREE.Color(0)).onObjectUpdate(({ object }, self) => {
    const v = ofBug(object);
    (self.value as unknown as THREE.Color).copy(v ? get(v) : NONE);
  }) as unknown as V3;
}

const EYE = new THREE.MeshStandardNodeMaterial({ color: 0x060505, roughness: 0.06 });
EYE.fog = false;
EYE.emissiveNode = ownColor((v) => v.eyes.emissive);
const GLINT = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
const FANG = new THREE.MeshStandardNodeMaterial({ color: 0x060505, roughness: 0.12, fog: false });
const BRISTLE = [0, 1].map(() => new THREE.MeshStandardNodeMaterial({ roughness: 0.5 }));

/** The coats made so far: every fighter of a team shares them (a shader is slow to make). */
const COATS = new Map<string, THREE.MeshPhysicalNodeMaterial>();

/** Lacquered chitin: pitted, darker underneath, lit along its edge. */
function chitin(o: Coat): THREE.MeshPhysicalNodeMaterial {
  const key = JSON.stringify(o);
  let m = COATS.get(key);
  if (!m) COATS.set(key, (m = coating(o)));
  return m;
}

function coating(o: Coat): THREE.MeshPhysicalNodeMaterial {
  // (its colours are uniforms: coats of one kind are one shader)
  const color = (c: number): V3 => uniform(new THREE.Color(c)) as unknown as V3;
  const m = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.1, clearcoat: o.limb ? 0.35 : 0.9, clearcoatRoughness: 0.16 });
  const fine = mx_noise_float(positionLocal.mul(17)) as unknown as F;
  const broad = mx_noise_float(positionLocal.mul(2.7)).mul(0.5).add(0.5) as unknown as F;
  const lit = smoothstep(-0.75, 0.55, o.limb ? float(0.2) : positionLocal.y).mul(broad.mul(0.5).add(0.6)) as unknown as F;
  let c = mix(color(o.deep), color(o.shell), lit) as unknown as V3;
  let bump = fine.mul(0.5) as unknown as F;
  const rim = float(1).sub(abs(normalView.dot(positionViewDirection))).pow(3) as unknown as F;
  let glow = color(o.edge).mul(rim.mul(0.26)) as unknown as V3;
  if (o.plates) {
    const seam = smoothstep(0, 0.22, abs(fract(positionLocal.z.mul(2.35).add(0.5)).sub(0.06))) as unknown as F;
    c = c.mul(seam.mul(0.8).add(0.2)) as unknown as V3;
    bump = bump.add(seam.mul(1.5)) as unknown as F;
  }
  if (o.limb) {
    const band = smoothstep(0.35, 0.5, abs(fract(positionLocal.y.mul(2.5)).sub(0.5)).mul(2)) as unknown as F;
    c = mix(c, color(o.shell).mul(0.8), band.mul(0.75)) as unknown as V3;
    const joint = smoothstep(0.07, 0, positionLocal.y).add(smoothstep(0.95, 1, positionLocal.y)) as unknown as F;
    glow = glow.add(color(o.edge).mul(joint.mul(0.28))) as unknown as V3;
  }
  // (what happens to this one bug: dead, it fades; a special attack lights it up)
  const dull = own((v) => v.dull);
  m.fog = false;
  m.colorNode = mix(c, vec3(0.045, 0.04, 0.034), dull.mul(0.75));
  m.roughnessNode = (uniform(o.rough) as unknown as F).add(fine.mul(0.1));
  m.normalNode = bumpMap(bump, float(0.02));
  m.emissiveNode = glow.add(color(o.shell).mul(0.07)).mul(dull.oneMinus()).add(ownColor((v) => (o.limb ? v.legSkin : v.skin).emissive));
  return m;
}

/** A coat of short hairs over an ellipsoid, leaning back, in clumps, paler at the tips. */
function fur(on: THREE.Mesh, count: number, long: number, thick: number, root: number, tip: number): void {
  const hue = (c: number): V3 => uniform(new THREE.Color(c)) as unknown as V3;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  mat.colorNode = mix(hue(root), hue(tip), smoothstep(0.1, 1, positionLocal.y));
  mat.fog = false;
  mat.emissiveNode = hue(tip).mul(smoothstep(0.5, 1, positionLocal.y).mul(0.1));
  const f = new THREE.InstancedMesh(HAIR, mat, count);
  f.userData.fine = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // (an even spiral over the ball; the clumps lean the same way)
    const y = 1 - (2 * (i + 0.5)) / count;
    const a = i * 2.39996;
    const r = Math.sqrt(1 - y * y);
    p.set(Math.cos(a) * r, y, Math.sin(a) * r);
    n.set(p.x / on.scale.x, p.y / on.scale.y, p.z / on.scale.z).normalize();
    const clump = Math.sin(p.x * 9 + Math.sin(p.z * 7) * 2) + Math.sin(p.y * 8 + p.z * 6);
    n.z -= 0.95 + clump * 0.16;
    n.x += Math.sin(i * 7.7) * 0.1 + clump * 0.12;
    n.y += Math.sin(i * 3.1) * 0.1;
    q.setFromUnitVectors(UP, n.normalize());
    p.multiply(on.scale).add(on.position);
    f.setMatrixAt(i, m.compose(p, q, s.set(thick, long * (0.7 + 0.35 * Math.abs(Math.sin(i * 12.9)) + clump * 0.12), thick)));
  }
  on.parent?.add(f);
}

/** The finer looks a bug gets when it is shown large in the menus: shell in its team's colours, hairs, spines, jaws, eyes. */
export function dress(view: BugView, side: number): Face {
  const s = view.species;
  const r = s.radius;
  const paint = PAINT[side];
  const coat = { shell: paint.shell, deep: paint.deep, edge: paint.edge, rough: 0.3 };
  const spider = s.id === 'spider';
  // (a spider's hide is dark under its coat)
  const skin = spider ? { ...coat, shell: new THREE.Color(paint.shell).multiplyScalar(0.7).getHex() } : coat;
  const bands = chitin({ ...skin, plates: true });
  const shell = chitin(skin);
  const wing = chitin({ ...coat, rough: 0.2 });
  const legs = chitin({ shell: paint.shell, deep: paint.limb, edge: paint.edge, rough: 0.42, limb: true });
  const lid = chitin({ ...coat, rough: 0.4 });
  const dark = chitin({ shell: paint.limb, deep: 0x050404, edge: paint.edge, rough: 0.35 });
  const eye = EYE;
  const glint = GLINT;
  const tubes: THREE.Mesh[] = [];
  const eyes: { ball: THREE.Mesh; glint: THREE.Mesh; high: number }[] = [];
  view.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const was = m.material as THREE.MeshStandardMaterial;
    if (was === view.skin) m.material = m === view.lumps[0] && !s.shell ? bands : shell;
    else if (was === view.legSkin) {
      m.material = legs;
      if (m.parent !== view.head) tubes.push(m);
    } else if (was === view.eyes) {
      m.material = eye;
      eyes.push({ ball: m, glint: m, high: 1 });
    } else if (was.isMeshStandardMaterial && was.color.getHex() === s.color) m.material = wing;
  });
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const shine = (b: THREE.Mesh): THREE.Mesh => {
    const g = new THREE.Mesh(BALL, glint);
    g.scale.setScalar(b.scale.x * 0.17);
    g.position.copy(b.position).add(v(0.26, 0.5, 0.76).multiplyScalar(b.scale.x));
    view.head.add(g);
    return g;
  };
  for (const e of eyes) {
    e.ball.scale.multiplyScalar(spider ? 1.35 : 1.3);
    e.high = e.ball.scale.y;
    e.glint = shine(e.ball);
  }
  const pair = [eyes[0].ball, eyes[1].ball];
  const hd = view.headRadius;
  if (s.shell) {
    // (its feelers sweep back: they do not poke at whoever stands before it)
    const sweep = new THREE.Group();
    sweep.rotation.x = -1.05;
    view.head.add(sweep);
    for (const m of view.head.children.filter((c) => (c as THREE.Mesh).material === legs)) sweep.add(m);
  }
  const spike = (mat: THREE.Material, at: THREE.Vector3, dir: THREE.Vector3, long: number, thick: number, to: THREE.Object3D): void => {
    const c = new THREE.Mesh(HAIR, mat);
    c.position.copy(at);
    c.quaternion.setFromUnitVectors(UP, dir.normalize());
    c.scale.set(thick, long, thick);
    c.castShadow = true;
    to.add(c);
  };
  // (each half of the jaws swings about its hinge)
  const hinges: { g: THREE.Group; x: number }[] = [];
  for (const x of [-1, 1]) {
    const g = new THREE.Group();
    hinges.push({ g, x });
    view.head.add(g);
    // brows: they give it a mood
    const brow = new THREE.Mesh(BALL, dark);
    const at = pair[x < 0 ? 0 : 1];
    brow.scale.set(at.scale.x * 0.95, at.scale.x * 0.2, at.scale.x * 0.5);
    brow.position.copy(at.position).add(v(x * -0.02, spider ? 0.82 : 0.93, spider ? 0.72 : 0.5).multiplyScalar(at.scale.x));
    brow.rotation.set(0.35, 0, x * 0.5);
    view.head.add(brow);
    if (s.id === 'ant') {
      g.position.set(x * hd * 0.5, -hd * 0.35, hd * 0.62);
      const arc = new THREE.QuadraticBezierCurve3(v(0, 0, 0), v(x * hd * 0.42, -hd * 0.2, hd * 0.75), v(-x * hd * 0.4, -hd * 0.25, hd * 1.0));
      const tube = new THREE.TubeGeometry(arc, 20, hd * 0.15, 10);
      // (a blade: thick at its root, thin at its tip)
      const pos = tube.getAttribute('position');
      const mid = v(0, 0, 0);
      for (let i = 0; i < pos.count; i++) {
        const u = Math.floor(i / 11) / 20;
        arc.getPoint(u, mid);
        const k = 1 - 0.8 * u * u;
        pos.setXYZ(i, mid.x + (pos.getX(i) - mid.x) * k, mid.y + (pos.getY(i) - mid.y) * k, mid.z + (pos.getZ(i) - mid.z) * k);
      }
      tube.computeVertexNormals();
      const jaw = new THREE.Mesh(tube, dark);
      jaw.castShadow = true;
      g.add(jaw);
      for (const u of [0.5, 0.68, 0.84]) spike(dark, arc.getPoint(u), v(-x, 0, -0.4), hd * 0.22, hd * 0.07, g);
    } else if (spider) {
      for (const [ex, ey, ez, er] of [[0.2, 0.38, 0.86, 0.19], [0.74, 0.5, 0.48, 0.14], [0.34, 0.74, 0.54, 0.13]]) {
        const e = new THREE.Mesh(BALL, eye);
        e.position.set(x * hd * ex, hd * ey, hd * ez);
        e.scale.setScalar(hd * er);
        view.head.add(e);
        eyes.push({ ball: e, glint: shine(e), high: e.scale.y });
      }
      g.position.set(x * hd * 0.26, -hd * 0.3, hd * 0.75);
      const base = new THREE.Mesh(BALL, wing);
      base.scale.set(hd * 0.28, hd * 0.46, hd * 0.3);
      base.position.set(0, -hd * 0.16, hd * 0.07);
      g.add(base);
      spike(FANG, v(0, -hd * 0.45, hd * 0.2), v(-x * 0.2, -1, -0.1), hd * 0.62, hd * 0.13, g);
      const limb = new THREE.Mesh(BALL, legs);
      limb.scale.set(hd * 0.15, hd * 0.15, hd * 0.62);
      limb.position.set(x * hd * 0.5, -hd * 0.15, hd * 0.32);
      limb.rotation.set(0.35, x * 0.2, 0);
      g.add(limb);
    } else {
      // feelers round a small mouth
      g.position.set(x * hd * 0.3, -hd * 0.5, hd * 0.6);
      const limb = new THREE.Mesh(BALL, dark);
      limb.scale.set(hd * 0.09, hd * 0.09, hd * 0.3);
      limb.position.set(0, -hd * 0.1, hd * 0.2);
      limb.rotation.x = 0.9;
      g.add(limb);
    }
  }
  if (spider) {
    // (a face to look at: larger, held high)
    view.head.scale.setScalar(1.42);
    view.head.position.y += 0.2 * r;
    view.head.position.z += 0.08 * r;
    view.headAt.copy(view.head.position);
    fur(view.lumps[0], 3200, 0.2 * r, 0.017 * r, paint.deep, new THREE.Color(paint.shell).lerp(new THREE.Color(paint.edge), side ? 0.3 : 0.08).getHex());
    fur(view.lumps[1], 700, 0.11 * r, 0.012 * r, paint.deep, paint.shell);
    fur(view.lumps[2], 560, 0.08 * r, 0.01 * r, paint.deep, paint.edge);
  } else if (s.id === 'ant') fur(view.lumps[0], 300, 0.07 * r, 0.007 * r, paint.shell, paint.edge);
  // spines down the legs (in the limb's own scale: its thickness across, its length along)
  const rows = spider ? 90 : s.shell ? 34 : 22;
  const bristle = BRISTLE[side];
  bristle.color.setHex(paint.limb);
  const m = new THREE.Matrix4();
  const long = s.shell ? 2.6 : spider ? 1.5 : 1.6;
  for (const t of tubes) {
    const thin = t.scale.x / t.scale.y;
    const key = `${s.id}${thin.toFixed(3)}`;
    let g = SPINES.get(key);
    if (!g) {
      const all: THREE.BufferGeometry[] = [];
      for (let i = 0; i < rows; i++) {
        const a = i * 2.4;
        // (the limb's length is many times its thickness: a spine is thinned along it, and leans towards the foot)
        const l = long * (0.7 + 0.3 * Math.sin(i * 5.1));
        m.makeBasis(v(-Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17), v(Math.cos(a) * l, 1.1 * l * thin, Math.sin(a) * l), v(0, 0.17 * thin, 0));
        all.push(HAIR.clone().applyMatrix4(m.setPosition(Math.cos(a) * 0.6, 0.04 + (0.9 * i) / rows, Math.sin(a) * 0.6)));
      }
      g = mergeGeometries(all);
      SPINES.set(key, g);
    }
    const f = new THREE.Mesh(g, bristle);
    f.userData.fine = true;
    t.add(f);
  }
  // (seen from afar its hairs and spines are not worth drawing)
  const fine: THREE.Object3D[] = [];
  view.root.traverse((o) => {
    o.userData.bug = view;
    if (o.userData.fine) fine.push(o);
  });
  let close = true;
  return {
    near(on) {
      if (on === close) return;
      close = on;
      for (const f of fine) f.visible = on;
    },
    blink(shut) {
      for (const e of eyes) {
        // (shut, it is a lid in the shell's colour)
        e.ball.material = shut > 0.6 ? lid : eye;
        e.ball.scale.y = e.high * (1 - 0.45 * Math.min(shut, 0.6));
        e.glint.visible = shut <= 0.6;
      }
    },
    jaws(open) {
      for (const h of hinges) {
        h.g.rotation.y = h.x * (spider ? 0.35 : 0.5) * open;
        if (spider) h.g.rotation.x = -0.6 * open;
      }
    },
  };
}
