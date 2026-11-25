import * as THREE from 'three/webgpu';
import { abs, bumpMap, float, fract, mix, mx_noise_float, normalView, positionLocal, positionViewDirection, smoothstep, uniform, vec3 } from 'three/tsl';
import { antBody, makeFace, makeLegs, roachBack, soft, spiderBody } from './faces';
import { dressBee } from './beeModel';
import type { BugView } from '../BugView';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

/** What moves on a dressed bug besides its body: the lids (0 open, 1 shut), the jaws (0 shut, 1 wide). */
export interface Face {
  blink(shut: number): void;
  jaws(open: number): void;
  /** Whether it is near enough for its hairs and spines. */
  near(on: boolean, distance?: number): void;
  /** Wings: how far out, how hard they beat (only what has any). */
  wingsTo?(open: number, beat: number, seconds: number): void;
}

/** Each team's colours on the fighters: the shell, its shadow side, the light on its edge, the limbs. */
const PAINT = [
  { shell: 0xa8140c, deep: 0x3a0608, edge: 0xffa070, limb: 0x2a0c0c },
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
export function own(get: (v: BugView) => number): F {
  return uniform(0).onObjectUpdate(({ object }) => {
    const v = ofBug(object);
    return v ? get(v) : 0;
  }) as unknown as F;
}
const NONE = new THREE.Color(0);
export function ownColor(get: (v: BugView) => THREE.Color): V3 {
  return uniform(new THREE.Color(0)).onObjectUpdate(({ object }, self) => {
    const v = ofBug(object);
    (self.value as unknown as THREE.Color).copy(v ? get(v) : NONE);
  }) as unknown as V3;
}


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
  const m = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.1, clearcoat: o.limb ? 0.35 : 0.4, clearcoatRoughness: 0.2, specularIntensity: 0.5, envMapIntensity: 0.7 });
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

/** The finer looks a bug gets when it is shown large in the menus: shell in its team's colours, hairs, spines, jaws, eyes. */
export function dress(view: BugView, side: number): Face {
  const s = view.species;
  if (s.id === 'bee') return dressBee(view, side);
  const paint = PAINT[side];
  const coat = { shell: paint.shell, deep: paint.deep, edge: paint.edge, rough: 0.3 };
  const spider = s.id === 'spider';
  // (a spider's hide is dark under its coat)
  const skin = spider ? { ...coat, shell: new THREE.Color(paint.shell).multiplyScalar(0.7).getHex() } : coat;
  const bands = chitin({ ...skin, plates: true });
  const shell = chitin(skin);
  const wing = chitin({ ...coat, rough: 0.2 });
  const legs = chitin({ shell: paint.shell, deep: paint.limb, edge: paint.edge, rough: 0.42, limb: true });
  view.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const was = m.material as THREE.MeshStandardMaterial;
    if (was.color) m.userData.was = was.color.getHex();
    if (was === view.skin) m.material = m === view.lumps[0] && !s.shell ? bands : shell;
    else if (was === view.legSkin) {
      m.material = legs;
    } else if (was.isMeshStandardMaterial && was.color.getHex() === s.color) m.material = wing;
  });
  view.legSkin.color.setHex(paint.shell);
  // ---- its own face, legs and coat
  const back = s.shell ? roachBack(view, side) : null;
  if (spider) view.lumps.slice(0, 2).forEach((l) => (l.material = soft(side)));
  const face = makeFace(view, side);
  const small = [...face.small, ...makeLegs(view, side)];
  const coats = [...face.coats, ...(spider ? spiderBody(view, side) : s.id === 'ant' ? antBody(view, side) : [])];
  view.root.traverse((o) => {
    o.userData.bug = view;
    if (o.userData.fine) small.push(o);
  });
  let close = -1;
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
    },
    blink: (shut) => face.blink(shut),
    jaws: (open) => face.open(open),
    wingsTo: (open, _beat, seconds) => {
      face.sway(seconds, open);
      back?.();
    },
  };
}
