import * as THREE from 'three/webgpu';
import { Fn, If, float, length, materialColor, mix, mx_noise_float, mx_noise_vec3, mx_worley_noise_float, normalView, normalize, positionView, positionWorld, smoothstep, texture, uniform, uv, vec3 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  carScale, DASH_X0, DASH_X1, dashFace, dashTop, GLASS, glassFoot, GLOVE, GLOVE_THINGS, GRILLE, grilleHalf, grilleMid, HOLDER, OPENING, openingNorm, PHONE, pillarA, pillarB, PLATE, SECTION_LEN,
  SECTION_SUB, section, STACK, STACK_ITEMS, SWITCH, VENT_BACK, VENT_DEPTH, VENTS, WHEEL, type Leaning,
} from '../../terrain/generators/carPlan';
import type { SceneLayout } from '../../terrain/generators/types';
import {
  arrow, brushedTexture, canvasTexture, climateFront, clusterTextures, dialAngle, DIALS, emblem, glassStreaks, garage, labelTexture, mirrorView, paperTexture, phoneMap, radioFront, radioScreen,
  SEAM, signTexture, skinTextures, stalkTexture, surround,
} from './carTextures';
import type { Craters } from './craters';

type Mat = THREE.MeshStandardNodeMaterial;

/** How far the drawn skin stands over the terrain (the mesher's surface must never show through it). */
const SKIN_LIFT = 0.17;
/** Samples of the skin along x, per unit. */
const SKIN_X = 1.5;
/** How often the hazard lamps flash (Hz). */
const FLASH = 1.35;

/** A flat rounded rectangle facing +z, its picture across it. */
function roundedPlate(w: number, h: number, r: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(roundedRect(w, h, r), 12);
  const p = g.getAttribute('position');
  const t = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) t.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** A smooth closed outline through corner points, each rounded by its share of its shorter side. */
function roundedOutline(pts: readonly (readonly [number, number])[], share = 0.3): THREE.Shape {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const p: [number, number] = [b[0] + (a[0] - b[0]) * share, b[1] + (a[1] - b[1]) * share];
    const q: [number, number] = [b[0] + (c[0] - b[0]) * share, b[1] + (c[1] - b[1]) * share];
    if (i) s.lineTo(...p);
    else s.moveTo(...p);
    s.quadraticCurveTo(b[0], b[1], ...q);
  }
  s.closePath();
  return s;
}

/**
 * The car dashboard's render-only parts, drawn from its plan (`carPlan.ts`, base units, scaled as a whole to the
 * map): the smooth skin over the terrain's dashboard, the lit instruments with their needles, the steering wheel and
 * its column, the vents, the centre stack with the radio's cracked screen, the phone and its map, the open glove box
 * and what lies in it, the defroster's grille, the windscreen, the pillars and doors, the garage outside, the seats
 * behind. Explosions cut them all.
 */
export class CarParts {
  private readonly group = new THREE.Group();
  private readonly pieces: THREE.Object3D[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly mats = new Map<string, Mat>();
  /** Lamps that flash together (the hazard button, the arrows), and how bright when lit. */
  private flashing: { m: Mat; on: number; off: number }[] = [];
  private needles: { pivot: THREE.Object3D; base: number; shake: number }[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly craters: Craters,
  ) {
    scene.add(this.group);
  }

  setLayout(layout: SceneLayout): void {
    for (const p of this.pieces) {
      this.group.remove(p);
      p.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.pieces.length = 0;
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.mats.clear();
    this.flashing = [];
    this.needles = [];
    const f = layout.features.find((q) => q.kind === 'car');
    if (!f) return;
    const { s, ox, oz } = carScale(f.path[0], f.path[1], f.path[2]);
    this.group.scale.setScalar(s);
    this.group.position.set(ox, 0, oz);
    this.skin();
    this.seams();
    this.opening();
    this.cluster();
    for (const v of VENTS) this.vent(v.x, v.y, v.z, v.R, v.silver);
    this.demisters();
    this.defroster();
    this.stack();
    this.phone();
    this.wheel();
    this.lightSwitch();
    this.badge();
    this.gloveBox();
    this.tunnel();
    this.windscreen();
    this.sides();
    this.footwell();
    this.outside();
    this.sunBlinds();
  }

  /** The flashing lamps, the needles' tremble (seconds of the render's clock). */
  update(seconds: number): void {
    if (this.flashing.length === 0) return;
    const phase = (seconds * FLASH) % 1;
    // (a filament's rise and fall, not a square wave)
    const lit = phase < 0.5 ? Math.min(1, phase * 14) : Math.max(0, 1 - (phase - 0.5) * 9);
    for (const l of this.flashing) l.m.emissiveIntensity = l.off + (l.on - l.off) * lit;
    for (const n of this.needles) n.pivot.rotation.z = -(n.base + n.shake * (Math.sin(seconds * 7.3) * 0.6 + Math.sin(seconds * 17.1) * 0.4));
  }

  // ---- helpers

  private mat(color: number, metal = 0, rough = 0.6): Mat {
    const key = `${color}|${metal}|${rough}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial({ color, metalness: metal, roughness: rough });
      this.mats.set(key, m);
    }
    return m;
  }

  private two(color: number, metal = 0, rough = 0.6): Mat {
    const key = `two${color}|${metal}|${rough}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial({ color, metalness: metal, roughness: rough, side: THREE.DoubleSide });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Grained soft plastic or leather: a fine pebble (its creases darker) and a little bump, gone in the distance. */
  private grained(color: number, rough: number, scale: number, strength: number): Mat {
    const key = `grain${color}|${rough}|${scale}|${strength}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new THREE.MeshStandardNodeMaterial({ color, metalness: 0, roughness: rough });
    // (its numbers are uniforms: every grained part shares one shader, and that noise is slow to compile)
    const near = smoothstep(float(60), float(16), length(positionView)).mul(uniform(Math.min(1, strength * 6)));
    m.colorNode = this.pebbled(materialColor as unknown as THREE.Node<'vec3'>, near as unknown as THREE.Node<'float'>, uniform(scale * 1.7) as unknown as THREE.Node<'float'>);
    m.normalNode = this.bumped(near.mul(uniform(Math.min(strength, 1 / 6))) as unknown as THREE.Node<'float'>, uniform(scale * 1.3) as unknown as THREE.Node<'float'>);
    this.mats.set(key, m);
    return m;
  }

  /** `base` with pebble creases, `near` of them (worked out only where they show: the noise is dear). */
  private pebbled(base: THREE.Node<'vec3'>, near: THREE.Node<'float'>, scale: THREE.Node<'float'>): THREE.Node<'vec3'> {
    return Fn(() => {
      const out = vec3(base).toVar();
      If(near.greaterThan(0.02), () => {
        const crease = smoothstep(0.3, 0.75, mx_worley_noise_float(positionWorld.mul(scale)));
        out.mulAssign(mix(float(1), float(1.08).sub(crease.mul(0.4)), near));
      });
      return out;
    })() as unknown as THREE.Node<'vec3'>;
  }

  private bumped(amount: THREE.Node<'float'>, scale: THREE.Node<'float'>): THREE.Node<'vec3'> {
    return Fn(() => {
      const n = normalView.toVar();
      If(amount.greaterThan(0.004), () => {
        n.assign(normalize(n.add(mx_noise_vec3(positionWorld.mul(scale)).mul(amount))));
      });
      return n;
    })() as unknown as THREE.Node<'vec3'>;
  }

  /** A lit texture over a printed one. */
  private screen(map: THREE.Texture, intensity: number, color: THREE.Texture | null = null, rough = 0.3): Mat {
    const m = new THREE.MeshStandardNodeMaterial({ color: color ? 0xffffff : 0x050506, metalness: 0, roughness: rough });
    if (color) m.map = color;
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveMap = map;
    m.emissiveIntensity = intensity;
    return m;
  }

  /** A bright display: only its own light (the sun on it would wash it out). */
  private display(map: THREE.Texture, level: number): THREE.MeshBasicNodeMaterial {
    return new THREE.MeshBasicNodeMaterial({ map, color: new THREE.Color(level, level, level) });
  }

  /** A sign or word in `color`, on clear, lit by `glow`. */
  private ink(map: THREE.Texture, color: number, glow: number): Mat {
    const m = new THREE.MeshStandardNodeMaterial({ color, metalness: 0, roughness: 0.6, transparent: true, depthWrite: false });
    m.map = map;
    m.emissive = new THREE.Color(color);
    m.emissiveMap = map;
    m.emissiveIntensity = glow;
    return m;
  }

  private word(text: string, w: number, h: number, color: number, glow: number, x: number, y: number, z: number, size = 0.7): THREE.Mesh {
    return this.card(w, h, this.ink(this.tex(labelTexture(text, w / h, size)), color, glow), x, y, z);
  }

  private sign(id: Parameters<typeof signTexture>[0], size: number, color: number, glow: number, x: number, y: number, z: number): THREE.Mesh {
    return this.card(size, size, this.ink(this.tex(signTexture(id)), color, glow), x, y, z);
  }

  private tex<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true): THREE.Mesh {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = cast;
    o.receiveShadow = true;
    return o;
  }

  private box(w: number, h: number, d: number, round: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    return this.mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(round, Math.min(w, h, d) * 0.49)), m, x, y, z);
  }

  /** A shape with a soft bevelled edge, its smooth turns shaded smooth. */
  private slab(shape: THREE.Shape, depth: number, bevel: number, m: THREE.Material, x = 0, y = 0, z = 0, segments = 8, across = bevel): THREE.Mesh {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: across, bevelOffset: -across, bevelSegments: segments, curveSegments: 24 });
    return this.mesh(toCreasedNormals(g, 0.9), m, x, y, z);
  }

  /** A flat picture facing +z. */
  private card(w: number, h: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const o = this.mesh(new THREE.PlaneGeometry(w, h), m, x, y, z, false);
    o.renderOrder = 1;
    return o;
  }

  /** A sheet through a grid of points (`at(i, k)`, i of n, k of m), smooth. */
  private sheet(n: number, m: number, at: (u: number, v: number) => THREE.Vector3, mat: THREE.Material, flip = false): THREE.Mesh {
    const pos: number[] = [];
    const tc: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++)
      for (let k = 0; k <= m; k++) {
        const p = at(i / n, k / m);
        pos.push(p.x, p.y, p.z);
        tc.push(i / n, k / m);
      }
    for (let i = 0; i < n; i++)
      for (let k = 0; k < m; k++) {
        const q = i * (m + 1) + k;
        if (flip) idx.push(q, q + m + 1, q + 1, q + 1, q + m + 1, q + m + 2);
        else idx.push(q, q + 1, q + m + 1, q + 1, q + m + 2, q + m + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tc, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return this.mesh(g, mat, 0, 0, 0, false);
  }

  private tube(pts: THREE.Vector3[], r: number, m: THREE.Material, segments = pts.length * 4, closed = false): THREE.Mesh {
    return this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), segments, r, 10, closed), m, 0, 0, 0, false);
  }

  /** A group in a leaning frame: +x right, +y up its face, +z out of it. */
  private frame(f: Leaning): THREE.Group {
    const g = new THREE.Group();
    g.position.set(f.x, f.y, f.z);
    g.rotation.x = -Math.atan2(f.s, f.c);
    return g;
  }

  /** A point of the dashboard's outline at x, `t` in control points (0..13), and its outward normal. */
  private onSkin(x: number, t: number, lift = 0): { p: THREE.Vector3; n: THREE.Vector3 } {
    const at = (qx: number, qt: number): THREE.Vector3 => {
      const buf = new Float64Array(SECTION_LEN * 2);
      section(qx, buf);
      const k = Math.max(0, Math.min(SECTION_LEN - 1.001, qt * SECTION_SUB));
      const i = Math.floor(k);
      const f = k - i;
      return new THREE.Vector3(qx, buf[2 * i + 1] + (buf[2 * i + 3] - buf[2 * i + 1]) * f, buf[2 * i] + (buf[2 * i + 2] - buf[2 * i]) * f);
    };
    const p = at(x, t);
    const dt = at(x, t + 0.08).sub(at(x, t - 0.08));
    const dx = at(x + 0.5, t).sub(at(x - 0.5, t));
    const n = dt.cross(dx).normalize();
    return { p: p.addScaledVector(n, lift), n };
  }

  /** A group standing on the dashboard at (x, t): +z out of it, +x along the car. */
  private onSkinFrame(x: number, t: number, lift = 0): THREE.Group {
    const { p, n } = this.onSkin(x, t, lift);
    const g = new THREE.Group();
    const ax = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
    g.position.copy(p);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, new THREE.Vector3().crossVectors(n, ax), n));
    return g;
  }

  // ---- the parts

  /** Is this point of the skin's face in one of its holes (the hood's opening, a vent, the glove box)? */
  private inHole(x: number, y: number, z: number): boolean {
    if (z < 80) return false;
    for (const v of VENTS) if (Math.hypot(x - v.x, y - v.y) < v.R - 0.6) return true;
    if (x > GLOVE.x0 && x < GLOVE.x1 && y > GLOVE.y0 - 0.6 && y < GLOVE.y1) return true;
    if (Math.abs(x - OPENING.x) > OPENING.a + 3 || Math.abs(y - OPENING.y) > OPENING.b + 3) return false;
    const g = Math.hypot(openingNorm(x + 0.5, y) - openingNorm(x - 0.5, y), openingNorm(x, y + 0.5) - openingNorm(x, y - 0.5));
    return (1 - openingNorm(x, y)) / Math.max(0.004, g) > -1;
  }

  /** The dashboard's smooth skin, over the terrain's. */
  private skin(): void {
    const nx = Math.round((DASH_X1 - DASH_X0) * SKIN_X) + 1;
    // (two more rows close the underside, back to the bulkhead)
    const nt = SECTION_LEN + 2;
    const pos = new Float32Array(nx * nt * 3);
    const nor = new Float32Array(nx * nt * 3);
    const tc = new Float32Array(nx * nt * 2);
    const buf = new Float64Array(SECTION_LEN * 2);
    for (let i = 0; i < nx; i++) {
      const x = DASH_X0 + ((DASH_X1 - DASH_X0) * i) / (nx - 1);
      section(x, buf);
      for (let k = 0; k < nt; k++) {
        const o = (i * nt + k) * 3;
        const q = Math.min(k, SECTION_LEN - 1);
        pos[o] = x;
        pos[o + 1] = k < SECTION_LEN ? buf[2 * q + 1] : buf[2 * q + 1] - (k === SECTION_LEN ? 0.6 : 0);
        pos[o + 2] = k < SECTION_LEN ? buf[2 * q] : k === SECTION_LEN ? buf[2 * q] - 4 : 34;
        tc[(i * nt + k) * 2] = i / (nx - 1);
        tc[(i * nt + k) * 2 + 1] = q / (SECTION_LEN - 1);
      }
    }
    const P = (i: number, k: number, a: number): number => pos[(Math.max(0, Math.min(nx - 1, i)) * nt + Math.max(0, Math.min(nt - 1, k))) * 3 + a];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < nx; i++)
      for (let k = 0; k < nt; k++) {
        a.set(P(i + 1, k, 0) - P(i - 1, k, 0), P(i + 1, k, 1) - P(i - 1, k, 1), P(i + 1, k, 2) - P(i - 1, k, 2));
        b.set(P(i, k + 1, 0) - P(i, k - 1, 0), P(i, k + 1, 1) - P(i, k - 1, 1), P(i, k + 1, 2) - P(i, k - 1, 2));
        b.cross(a).normalize();
        const o = (i * nt + k) * 3;
        nor[o] = b.x;
        nor[o + 1] = b.y;
        nor[o + 2] = b.z;
      }
    for (let o = 0; o < pos.length; o++) pos[o] += nor[o] * SKIN_LIFT;
    const idx: number[] = [];
    const hole = (q: number): boolean => this.inHole(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]);
    for (let i = 0; i + 1 < nx; i++)
      for (let k = 0; k + 1 < nt; k++) {
        const q = i * nt + k;
        if (k < SECTION_LEN - 1 && (hole(q) || hole(q + 1) || hole(q + nt) || hole(q + nt + 1))) continue;
        idx.push(q, q + 1, q + nt, q + 1, q + nt + 1, q + nt);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(tc, 2));
    g.setIndex(idx);
    const { color, finish } = skinTextures();
    this.tex(color);
    this.tex(finish);
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, side: THREE.DoubleSide });
    const fin = texture(finish, uv());
    const near = smoothstep(float(55), float(14), length(positionView));
    const grain = fin.r.mul(near) as unknown as THREE.Node<'float'>;
    m.colorNode = this.pebbled(texture(color, uv()).rgb as unknown as THREE.Node<'vec3'>, grain, uniform(5.2) as unknown as THREE.Node<'float'>);
    m.roughnessNode = fin.g;
    m.normalNode = this.bumped(grain.mul(0.16) as unknown as THREE.Node<'float'>, uniform(3.6) as unknown as THREE.Node<'float'>);
    this.push(this.mesh(g, m, 0, 0, 0, false));
  }

  /** The shut lines between the dashboard's panels: thin dark grooves laid in the skin. */
  private seams(): void {
    const dark = this.mat(0x050505, 0, 0.95);
    const line = (pts: [number, number][], r = 0.11): void => {
      const c = new THREE.CatmullRomCurve3(pts.map(([x, t]) => new THREE.Vector3(x, t, 0)), false, 'centripetal');
      // (broken where it meets a vent's bezel)
      let run: THREE.Vector3[] = [];
      const flush = (): void => {
        if (run.length > 1) this.push(this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(run), run.length * 2, r, 8), dark, 0, 0, 0, false));
        run = [];
      };
      const n = pts.length * 14;
      for (let i = 0; i <= n; i++) {
        const q = c.getPoint(i / n);
        const { p } = this.onSkin(q.x, q.y, SKIN_LIFT - 0.07);
        if (VENTS.some((v) => p.z > 85 && Math.hypot(p.x - v.x, p.y - v.y) < v.R + 0.9)) flush();
        else run.push(p);
      }
      flush();
    };
    line([...SEAM, [205, 10.4], [205, 11.6], [205, 12.9]]);
    line([[205, 9.02], [225, 9.02], [250, 9.02], [275, 9.02], [296.5, 9.02]]);
    line([[205, 9.55], [222, 9.6], [246, 9.74], [268, 9.82], [284, 9.82], [296.5, 9.76]]);
    line([[24, 9.04], [26, 9.04]]);
    line([[52, 9.04], [60, 9.05], [70, 9.06], [100, 9.06], [132, 9.06]]);
    line([[24, 10.02], [40, 10.02], [70, 10.02], [100, 10.02], [132, 10.02]]);
  }

  /** The hood's opening: a thin lip on its face, the tunnel back to the plate. */
  private opening(): void {
    const N = 200;
    // (across: how far outside the outline, and how far off the face; the last row is at the plate)
    const rows: [number, number][] = [[2.6, -0.14], [2.2, 0.12], [1.5, 0.28], [0.8, 0.28], [0.25, 0.04], [0, -0.5], [-0.05, -2]];
    const pos: number[] = [];
    const idx: number[] = [];
    const out = (a: number): [number, number] => {
      const x = Math.cos(a) * OPENING.a;
      const y = Math.sin(a) * OPENING.b;
      const r = openingNorm(OPENING.x + x, OPENING.y + y);
      return [OPENING.x + x / r, OPENING.y + y / r];
    };
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const [x, y] = out(a);
      const [x0, y0] = out(a - 0.01);
      const [x1, y1] = out(a + 0.01);
      const l = Math.hypot(x1 - x0, y1 - y0);
      const nx = (y1 - y0) / l;
      const ny = -(x1 - x0) / l;
      for (const [o, d] of rows) pos.push(x + nx * o, y + ny * o, dashFace(x + nx * o, y + ny * o) + SKIN_LIFT + d);
      pos.push(x - nx * 0.4, y - ny * 0.4, OPENING.back + 1 - (y - OPENING.y) * 0.12);
    }
    const m = rows.length + 1;
    for (let i = 0; i < N; i++)
      for (let k = 0; k + 1 < m; k++) {
        const q = i * m + k;
        idx.push(q, q + m, q + 1, q + 1, q + m, q + m + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const lip = this.grained(0x2b2b2c, 0.8, 2.8, 0.06);
    lip.side = THREE.DoubleSide;
    this.push(this.mesh(g, lip, 0, 0, 0, false));
  }

  /** The instruments: the plate in the hood, its lit scales, the dials' wells, the needles, the arrows. */
  private cluster(): void {
    const g = this.frame(PLATE);
    const { color, light } = clusterTextures();
    this.tex(color);
    this.tex(light);
    const { hw, hh } = PLATE;
    // (the opening's oval, a little wider)
    const sh = new THREE.Shape();
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const r = openingNorm(OPENING.x + Math.cos(a) * OPENING.a, OPENING.y + Math.sin(a) * OPENING.b);
      const x = (Math.cos(a) * hw) / r;
      const y = (Math.sin(a) * hh) / r;
      if (k) sh.lineTo(x, y);
      else sh.moveTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(sh, 24);
    const pos = geo.getAttribute('position');
    const t = geo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) t.setXY(i, pos.getX(i) / (2 * hw) + 0.5, pos.getY(i) / (2 * hh) + 0.5);
    const face = this.screen(light, 0.85, color, 0.5);
    face.metalness = 0.2;
    g.add(this.mesh(geo, face, 0, 0, 0.4, false));
    // the wells: a dark wall standing out of the plate round each dial, a thin bright ring on it, a soft outer step
    const wall = this.two(0x101113, 0.2, 0.45);
    const prof = (pts: [number, number][]): THREE.BufferGeometry => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 96).rotateX(Math.PI / 2);
    for (const d of [DIALS.tacho, DIALS.speed, DIALS.water, DIALS.fuel]) {
      const big = d.r > 5;
      const h = big ? 2.6 : 1.3;
      g.add(this.mesh(prof([[d.r + 0.05, 0.42], [d.r + 0.3, h - 0.1], [d.r + 0.5, h + 0.05], [d.r + 0.72, h - 0.05], [d.r + 1.15, 0.42]]), wall, d.u, d.w, 0));
      g.add(this.mesh(new THREE.TorusGeometry(d.r + 0.5, big ? 0.16 : 0.1, 10, 96), this.mat(0xaeb3b9, 0.85, 0.28), d.u, d.w, h + 0.06, false));
      if (big) g.add(this.mesh(new THREE.TorusGeometry(d.r + 1.35, 0.14, 8, 96), this.mat(0x4c5056, 0.4, 0.45), d.u, d.w, 0.46, false));
    }
    // the middle screen's frame, sunk behind it
    const frame = this.mat(0x26282b, 0.35, 0.42);
    g.add(this.box(11.6, 0.6, 1.2, 0.25, frame, 0, 3.2, 0.7), this.box(11.6, 0.6, 1.2, 0.25, frame, 0, -8.8, 0.7), this.box(0.6, 12.6, 1.2, 0.25, frame, -5.6, -2.8, 0.7), this.box(0.6, 12.6, 1.2, 0.25, frame, 5.6, -2.8, 0.7));
    // the warning triangle's key between the small dials
    g.add(this.slab(roundedOutline([[-1.25, 3.6], [1.25, 3.6], [0, 6]], 0.18), 0.3, 0.12, this.mat(0x1b1c1e, 0.2, 0.45), 0, 0, 0.5, 3));
    // the needles: lit red, a domed black hub
    const red = new THREE.MeshStandardNodeMaterial({ color: 0xff3a22, emissive: new THREE.Color(0xff2a14), emissiveIntensity: 1.1, roughness: 0.5 });
    const needle = (u: number, w: number, r: number, angle: number, shake: number): void => {
      const pivot = new THREE.Group();
      pivot.position.set(u, w, 1);
      const n = new THREE.Shape();
      const bw = Math.max(0.12, r * 0.032);
      n.moveTo(-bw, 0);
      n.lineTo(bw, 0);
      n.lineTo(bw * 0.35, r * 0.84);
      n.lineTo(-bw * 0.35, r * 0.84);
      pivot.add(this.mesh(new THREE.ExtrudeGeometry(n, { depth: 0.12, bevelEnabled: false }), red));
      pivot.add(this.mesh(new THREE.SphereGeometry(r * 0.16, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.7), this.mat(0x141416, 0.2, 0.35), 0, 0, 0.02));
      pivot.rotation.z = -angle;
      g.add(pivot);
      this.needles.push({ pivot, base: angle, shake });
    };
    needle(DIALS.tacho.u, DIALS.tacho.w, DIALS.tacho.r, dialAngle(7.4 / 60), 0.012);
    needle(DIALS.speed.u, DIALS.speed.w, DIALS.speed.r, dialAngle(-0.008), 0);
    needle(DIALS.water.u, DIALS.water.w, DIALS.water.r, -0.36, 0);
    needle(DIALS.fuel.u, DIALS.fuel.w, DIALS.fuel.r, -0.5, 0.003);
    for (const [u, w] of DIALS.arrows) {
      const a = this.tex(canvasTexture(128, 128, (c) => {
        c.fillStyle = '#ffffff';
        arrow(c, 64 - Math.sign(u) * 6, 64, Math.sign(u) * 44);
      }));
      const m = this.ink(a, 0x35ff62, 0);
      this.flashing.push({ m, on: 1.2, off: 0 });
      g.add(this.card(3.2, 3.2, m, u, w, 0.46));
    }
    // the reset pin between the dials' feet
    g.add(this.mesh(new THREE.CylinderGeometry(0.4, 0.45, 2, 20).rotateX(Math.PI / 2), this.mat(0x121213, 0.1, 0.4), 7.6, -9.2, 1.2));
    g.add(this.mesh(new THREE.SphereGeometry(0.32, 16, 10), this.mat(0xd2d4d6, 0.4, 0.3), 7.6, -9.2, 2.2, false));
    this.push(g);
  }

  /** A round vent in its hole in the skin: the bezel, the barrel, seven blades, the tab they are turned with. */
  private vent(x: number, y: number, z: number, R: number, silver: boolean): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // (lathed about z: the bezel's outer edge on the skin, over its rim, down the barrel to the back)
    const prof = (pts: [number, number][]): THREE.BufferGeometry => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 112).rotateX(Math.PI / 2);
    const bezel = silver ? this.mat(0x6b6f75, 0.6, 0.45) : this.mat(0x2a2e34, 0.5, 0.4);
    bezel.side = THREE.DoubleSide;
    g.add(this.mesh(prof([[R + 0.95, 0.05], [R + 0.9, 0.45], [R + 0.6, 0.9], [R + 0.15, 1.1], [R - 0.35, 0.95], [R - 0.85, 0.35], [R - 1.15, -0.5], [R - 1.35, -VENT_DEPTH]]), bezel));
    g.add(this.mesh(new THREE.TorusGeometry(R + 1.02, 0.15, 8, 96), this.mat(0x050506, 0, 0.9), 0, 0, 0.14, false));
    const r = R - 1.35;
    const barrel = this.two(0x0f1012, 0.1, 0.5);
    g.add(this.mesh(prof([[r, -VENT_DEPTH + 1.5], [r - 0.75, -VENT_DEPTH + 1], [r - 0.85, -VENT_BACK]]), barrel));
    g.add(this.mesh(new THREE.CircleGeometry(r, 64), this.mat(0x020202, 0, 1), 0, 0, -VENT_BACK + 0.2, false));
    const blade = this.mat(0x1c1d1f, 0.1, 0.5);
    const gap = (2 * r) / 7.6;
    for (let k = -3; k <= 3; k++) {
      const h = k * gap;
      const half = Math.sqrt(Math.max(0, (r - 0.55) * (r - 0.55) - h * h));
      if (half < 1) continue;
      // (a thin blade from wall to wall, its middle third a step higher, its front edge tipped down)
      // (the outermost ones straight)
      const up = Math.abs(k) === 3 ? 0 : 0.34;
      const sh = new THREE.Shape();
      sh.moveTo(-half, -0.2);
      sh.lineTo(-half * 0.52, -0.2);
      sh.lineTo(-half * 0.4, -0.2 + up);
      sh.lineTo(half * 0.4, -0.2 + up);
      sh.lineTo(half * 0.52, -0.2);
      sh.lineTo(half, -0.2);
      sh.lineTo(half, 0.18);
      sh.lineTo(half * 0.5, 0.18);
      sh.lineTo(half * 0.38, 0.18 + up);
      sh.lineTo(-half * 0.38, 0.18 + up);
      sh.lineTo(-half * 0.5, 0.18);
      sh.lineTo(-half, 0.18);
      sh.closePath();
      const b = this.mesh(new THREE.ExtrudeGeometry(sh, { depth: 2.2, bevelEnabled: false }), blade, 0, h, -VENT_DEPTH - 1.9);
      b.rotation.x = 0.3;
      g.add(b);
    }
    // the tab: a wide lens with three round dimples along its front, a half ball over its middle
    const tab = this.mat(silver ? 0x85898f : 0x4b5058, 0.55, 0.38);
    const zt = -VENT_DEPTH + 0.5;
    g.add(this.mesh(new THREE.SphereGeometry(1, 56, 28).scale(4.7, 1.2, 1.7), tab, 0, -0.7, zt));
    g.add(this.mesh(new THREE.SphereGeometry(1.1, 32, 16).scale(1, 1, 0.8), tab, 0, 0.35, zt - 0.2));
    for (const u of [-2, 0, 2]) {
      const f = Math.sqrt(Math.max(0, 1 - (u / 4.7) ** 2)) * 1.7;
      g.add(this.mesh(new THREE.SphereGeometry(0.42, 20, 12).scale(1, 1, 0.4), this.mat(silver ? 0x3c3e42 : 0x1c1e22, 0.4, 0.5), u, -0.75, zt + f - 0.1, false));
    }
    this.push(g);
  }

  /** The two small oval outlets on the top by the pillars: a flush ring, a dark hole, slanted ribs. */
  private demisters(): void {
    for (const [x, z] of [[50, 66], [270, 62]]) {
      const y = dashTop(x, z);
      const g = new THREE.Group();
      g.position.set(x, y + SKIN_LIFT, z);
      const slope = (dashTop(x, z + 2) - dashTop(x, z - 2)) / 4;
      const tiltX = (dashTop(x + 2, z) - dashTop(x - 2, z)) / 4;
      g.rotation.set(-Math.atan(slope), 0, Math.atan(tiltX));
      g.add(this.mesh(new THREE.TorusGeometry(6.4, 0.5, 12, 72).rotateX(Math.PI / 2).scale(1.05, 0.7, 0.85), this.mat(0x2a2b2d, 0.1, 0.45), 0, 0.1, 0, false));
      g.add(this.mesh(new THREE.CircleGeometry(6.2, 72).rotateX(-Math.PI / 2).scale(1.05, 1, 0.85), this.mat(0x020202, 0, 1), 0, 0.16, 0, false));
      for (let k = -2; k <= 2; k++) {
        const half = Math.sqrt(1 - (k / 3) ** 2) * 5.2;
        const bar = this.box(0.9, 0.5, half * 2, 0.2, this.mat(0x303133, 0.1, 0.5), k * 2.25, 0.3, 0);
        bar.rotation.set(0, 0.16, 0.55);
        g.add(bar);
      }
      this.push(g);
    }
  }

  /** The defroster's grille along the windscreen: two broad rails that meet in long tips, two black slots, the sensor. */
  private defroster(): void {
    const { x0, x1 } = GRILLE;
    const N = 220;
    const half = grilleHalf;
    const mid = grilleMid;
    /** A strip over the top from `a` to `b` (across, -1 the windscreen's side), `lift` high, its sides and ends closed. */
    const strip = (a: number, b: number, lift: number, m: THREE.Material, from: number, to: number, n = N): void => {
      this.push(this.sheet(n + 2, 5, (u, v) => {
        const i = Math.round(u * (n + 2));
        const x = from + ((to - from) * Math.max(0, Math.min(n, i - 1))) / n;
        const k = Math.round(v * 5);
        const h = half(x);
        const c = mid(x);
        const e = Math.min(0.22, h * (b - a) * 0.3);
        const z = k === 0 || k === 1 ? c + h * a : k === 2 ? c + h * a + e : k === 3 ? c + h * b - e : c + h * b;
        const l = i === 0 || i === n + 2 || k === 0 || k === 5 ? 0.05 : k === 1 || k === 4 ? lift - 0.18 : lift;
        return new THREE.Vector3(x, dashTop(x, z) + l, z);
      }, m));
    };
    const rail = this.two(0x56575a, 0.05, 0.6);
    const dark = this.two(0x010101, 0, 1);
    const blade = this.two(0x1f2021, 0.1, 0.5);
    const notch = 9;
    for (const [a, b] of [[x0, 160 - notch], [160 + notch, x1]]) {
      strip(-0.75, 0.75, 0.46, dark, a, b);
      strip(-1, -0.66, 0.7, rail, a, b);
      strip(0.6, 1, 0.7, rail, a, b);
      strip(-0.12, 0.04, 0.6, blade, Math.max(a, x0 + 14), Math.min(b, x1 - 14));
    }
    for (let x = x0 + 20; x < x1 - 18; x += 8.5) if (Math.abs(x - 160) > notch + 2) strip(-0.66, 0.6, 0.52, blade, x - 0.2, x + 0.2, 2);
    // (the sensor's segment: its own two rail tiles in line with the others, a dark floor between, a low matt pill)
    strip(-0.8, 0.8, 0.34, dark, 160 - notch + 0.3, 160 + notch - 0.3, 24);
    strip(-1, -0.6, 0.78, rail, 160 - notch + 0.5, 160 + notch - 0.5, 24);
    strip(0.54, 1, 0.78, rail, 160 - notch + 0.5, 160 + notch - 0.5, 24);
    const z = mid(160);
    const g = new THREE.Group();
    g.position.set(160, dashTop(160, z), z);
    g.rotation.x = -Math.atan((dashTop(160, z + 3) - dashTop(160, z - 3)) / 6);
    g.add(this.box(8, 0.9, 5.6, 0.35, this.mat(0x1c1c1d, 0.05, 0.7), 0, 0.5, 0));
    g.add(this.box(4.8, 2.4, 3.2, 1.15, this.mat(0x161617, 0.05, 0.6), 0, 1.4, 0));
    this.push(g);
  }

  /** The centre stack: the metallic panel, the row of buttons, the radio, the climate panel. */
  private stack(): void {
    const g = this.frame(STACK);
    const { len, topHalf, bottomHalf, out } = STACK;
    const sh = new THREE.Shape();
    const r = 7;
    sh.moveTo(-bottomHalf + 1, -len - 1);
    sh.lineTo(bottomHalf - 1, -len - 1);
    sh.lineTo(topHalf - 0.4, -r);
    sh.quadraticCurveTo(topHalf, 0, topHalf - r, 0);
    sh.lineTo(-topHalf + r, 0);
    sh.quadraticCurveTo(-topHalf, 0, -topHalf + 0.4, -r);
    sh.closePath();
    const panel = new THREE.MeshStandardNodeMaterial({ metalness: 0.45, roughness: 0.46 });
    // (a fine metallic speckle in dark blue-grey paint)
    const fleck = mx_noise_float(positionWorld.mul(9)).mul(smoothstep(float(60), float(15), length(positionView)));
    const pc = new THREE.Color(0x434a53);
    panel.colorNode = vec3(pc.r, pc.g, pc.b).mul(float(1).add(fleck.mul(0.12)));
    g.add(this.slab(sh, out + 3.2, 0.9, panel, 0, 0, -3.1, 6));
    // each control in its own dark well
    const well = this.mat(0x060607, 0, 0.85);
    const key = this.grained(0x1d1e20, 0.6, 5, 0.03);
    g.add(this.mesh(new THREE.ShapeGeometry(roundedRect(8.9, 9, 2.4), 12), this.mat(0x32383f, 0.45, 0.46), -18.9, -6.9, out + 1.02, false));
    g.add(this.mesh(new THREE.RingGeometry(3.6, 4.1, 64), well, -18.6, -6.9, out + 1.05, false));
    for (const it of STACK_ITEMS) {
      const z = out + it.out;
      if (it.kind === 'round') {
        // the hazard button: a red dome, its triangle lit while it flashes
        const red = new THREE.MeshStandardNodeMaterial({ color: 0xb01024, roughness: 0.42, emissive: new THREE.Color(0xff1428), emissiveIntensity: 0.05 });
        this.flashing.push({ m: red, on: 0.45, off: 0.03 });
        g.add(this.mesh(new THREE.CylinderGeometry(it.w / 2 - 0.25, it.w / 2, it.out, 64).rotateX(Math.PI / 2), red, it.u, -it.v, out + it.out / 2 - 0.3));
        g.add(this.mesh(new THREE.SphereGeometry(it.w / 2 - 0.25, 56, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.2), red, it.u, -it.v, z - 0.3));
        const tri = this.ink(this.tex(signTexture('hazard')), 0xffe9d8, 0.2);
        this.flashing.push({ m: tri, on: 1.1, off: 0.15 });
        g.add(this.card(4.4, 4.4, tri, it.u, -it.v, z + 0.42));
      } else if (it.kind === 'button') {
        g.add(this.mesh(new THREE.ShapeGeometry(roundedRect(it.w + 0.35, it.h + 0.4, 0.9), 10), well, it.u, -it.v, out + 1.02, false));
        const b = this.slab(roundedRect(it.w - 0.15, it.h - 0.15, 0.8), it.out + 0.2, 0.5, key, it.u, -it.v, out - 0.5, 6);
        g.add(b);
        if (it.id === 'defrost') g.add(this.sign('defrost', 3.4, 0xffc9a8, 0.45, it.u, -it.v, z + 0.24));
        if (it.id === 'cup') g.add(this.sign('cup', 3, 0xd8d8d6, 0.12, it.u - 0.4, -it.v, z + 0.24));
      } else if (it.id === 'radio') this.radio(g, it.v, z, it.w, it.h);
      else if (it.id === 'climate') {
        const { color, light } = climateFront();
        this.tex(color);
        this.tex(light);
        g.add(this.slab(roundedRect(it.w, it.h, 1.4), it.out + 0.6, 0.4, this.mat(0x141416, 0.1, 0.5), it.u, -it.v, z - it.out - 1.2, 4));
        g.add(this.card(it.w - 1.2, it.h - 1, this.screen(light, 0.8, color, 0.6), it.u, -it.v, z + 0.24));
        for (let k = 0; k < 9; k++) g.add(this.box(0.28, 1.8, 0.4, 0.1, this.mat(0x232325, 0.1, 0.5), 11.6 + k * 0.6, -it.v - 3.9, z + 0.26));
      } else if (it.kind === 'knob') this.knob(g, it.id, it.u, -it.v, out, it.w / 2, it.out);
      else {
        g.add(this.box(it.w, it.h, 1.2, 0.25, this.mat(0x101012, 0.1, 0.45), it.u, -it.v, z - 0.6));
        if (it.id === 'PLAY') g.add(this.sign('PLAY', 1.2, 0xffe0d4, 0.6, it.u, -it.v, z + 0.02));
        else g.add(this.word(it.id, 2.9, 1.32, 0xffe0d4, 0.6, it.u, -it.v, z + 0.02, 0.66));
        // (the pale lip under each, as on the radio)
        g.add(this.box(2.2, 0.28, 0.5, 0.12, this.mat(0x7d7e82, 0.5, 0.4), it.u, -it.v - 1.1, z - 0.5));
      }
    }
    this.push(g);
  }

  private radio(g: THREE.Group, v: number, z: number, w: number, h: number): void {
    g.add(this.slab(roundedRect(w, h, 0.9), 2, 0.4, this.mat(0x17171a, 0.1, 0.5), 0, -v, z - 2.4, 4));
    const front = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.55, map: this.tex(radioFront()) });
    const top = -v + h / 2;
    g.add(this.card(w - 1, h - 1, front, 0, -v, z + 0.03));
    // the disc's slot: a black gap between two lips, the lower one worn pale
    g.add(this.mesh(new THREE.ShapeGeometry(roundedRect(23, 1.5, 0.7), 10), this.mat(0x020202, 0, 1), -0.4, top - 1.9, z + 0.05, false));
    g.add(this.box(23.2, 0.26, 0.5, 0.12, this.mat(0x6a655c, 0.2, 0.5), -0.4, top - 2.72, z + 0.1), this.box(23.2, 0.22, 0.4, 0.1, this.mat(0x0d0d0e, 0.1, 0.4), -0.4, top - 1.08, z + 0.1));
    // the two small keys in their frames, the bright dot
    for (const [u, id] of [[-14, 'BT'], [13.2, 'eject']] as const) {
      g.add(this.box(2.9, 1.5, 0.5, 0.15, this.mat(0x3a3a3c, 0.3, 0.45), u, top - 1.9, z), this.box(2.6, 1.2, 0.5, 0.12, this.mat(0x101011, 0.1, 0.45), u, top - 1.9, z + 0.1));
      g.add(id === 'BT' ? this.word('BT', 1.9, 1, 0xe6e6e4, 0.15, u, top - 1.9, z + 0.37) : this.sign('eject', 1, 0xe6e6e4, 0.15, u, top - 1.9, z + 0.37));
    }
    // the screen, sunk in a sloped frame; the lower slope broad and scuffed
    const sw = 25.4;
    const sh = 14.2;
    const y = -v - 0.4;
    const slope = this.mat(0x232325, 0.15, 0.45);
    const lower = this.mat(0x4a443e, 0.15, 0.5);
    const side = (pts: [number, number, number][], m: THREE.Material): void => {
      const q = new THREE.BufferGeometry();
      q.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      q.setIndex([0, 1, 2, 0, 2, 3]);
      q.computeVertexNormals();
      g.add(this.mesh(q, m, 0, y, z, false));
    };
    const a = sw / 2;
    const b = sh / 2;
    const o = 0.9;
    side([[-a, -b, 0.05], [-a - o, -b - 1.7, 0.75], [a + o, -b - 1.7, 0.75], [a, -b, 0.05]], lower);
    side([[-a - o, b + 0.6, 0.6], [-a, b, 0.05], [a, b, 0.05], [a + o, b + 0.6, 0.6]], slope);
    side([[-a - o, -b - 1.7, 0.75], [-a, -b, 0.05], [-a, b, 0.05], [-a - o, b + 0.6, 0.6]], slope);
    side([[a, -b, 0.05], [a + o, -b - 1.7, 0.75], [a + o, b + 0.6, 0.6], [a, b, 0.05]], slope);
    g.add(this.card(sw, sh, this.display(this.tex(radioScreen()), 0.85), 0, y, z + 0.07));
  }

  /** A turning knob: knurled, with a brushed cap (the radio's), or fluted black with a pointer (the climate's). */
  private knob(g: THREE.Group, id: string, u: number, w: number, base: number, r: number, h: number): void {
    const radio = id === 'volume' || id === 'tune';
    const n = radio ? 60 : 22;
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k < n * 4; k++) {
      const a = (k / (n * 4)) * Math.PI * 2;
      const q = r * (1 - (radio ? 0.03 : 0.07) * (0.5 + 0.5 * Math.cos(a * n)));
      pts.push(new THREE.Vector2(Math.cos(a) * q, Math.sin(a) * q));
    }
    const body = toCreasedNormals(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h - 0.7, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelOffset: -0.35, bevelSegments: 3 }), 0.5);
    g.add(this.mesh(body, radio ? this.mat(0x57534a, 0.85, 0.36) : this.mat(0x17181a, 0.15, 0.45), u, w, base + 0.35));
    if (radio) {
      const cap = new THREE.MeshStandardNodeMaterial({ metalness: 0.85, roughness: 0.36, map: this.tex(brushedTexture()) });
      g.add(this.mesh(new THREE.CircleGeometry(r * 0.84, 64), cap, u, w, base + h + 0.02, false));
    } else {
      g.add(this.mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.7, 0.8, 56).rotateX(Math.PI / 2), this.mat(0x222326, 0.25, 0.4), u, w, base + h + 0.2));
      const mark = new THREE.MeshStandardNodeMaterial({ color: 0xffd0b8, emissive: new THREE.Color(0xff5a3c), emissiveIntensity: 0.9, roughness: 0.5 });
      const a = id === 'fan' ? 0.7 : -0.5;
      const b = this.box(0.32, r * 0.5, 0.12, 0.05, mark, u + Math.sin(a) * r * 0.36, w + Math.cos(a) * r * 0.36, base + h + 0.62);
      b.rotation.z = -a;
      g.add(b);
    }
  }

  /** The phone, a map on it, in its holder on the left centre vent. */
  private phone(): void {
    const g = new THREE.Group();
    const black = this.mat(0x111112, 0.1, 0.5);
    const { x, y, z, hw, hh, hd } = HOLDER;
    // the arm from the vent's blades, the plate, its ribbed sliding strips
    g.add(this.mesh(new THREE.CylinderGeometry(1.6, 1.9, 7, 24).rotateX(Math.PI / 2), black, x, y + 1, z - 4.4));
    g.add(this.mesh(new THREE.SphereGeometry(2.3, 24, 16), black, x, y + 1, z - 2.2));
    g.add(this.box(hw * 2, hh * 2, hd * 2, 0.6, this.mat(0x171718, 0.1, 0.45), x, y, z));
    for (const e of [-1, 1]) {
      for (let k = 0; k < 5; k++) g.add(this.box(0.3, hh * 1.7, 0.3, 0.1, this.mat(0x2b2b2c, 0.1, 0.5), x + e * (6 + k * 0.45), y, z + hd + 0.02));
      // the jaw: an L round the phone's edge, its foot flared
      const jaw = new THREE.Shape();
      jaw.moveTo(0, -3);
      jaw.lineTo(2.2, -3);
      jaw.bezierCurveTo(3, -1, 3, 2, 2.4, 5.4);
      jaw.bezierCurveTo(2.2, 6.6, 1, 7, -0.6, 6.8);
      jaw.lineTo(-0.8, 6);
      jaw.bezierCurveTo(0.6, 5.9, 1, 5.4, 1, 4.6);
      jaw.lineTo(0.6, 1);
      jaw.closePath();
      const j = new THREE.ExtrudeGeometry(jaw, { depth: 10.6, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.3, bevelSegments: 4, curveSegments: 12 });
      // (drawn in x and z, laid along y)
      j.rotateX(Math.PI / 2);
      j.scale(e, 1, 1);
      const jm = this.grained(0x1b1b1c, 0.75, 4, 0.06);
      jm.side = THREE.DoubleSide;
      g.add(this.mesh(toCreasedNormals(j, 0.7), jm, x + e * 8.1, y + 5.2, z));
    }
    const P = PHONE;
    g.add(this.slab(roundedRect(P.hw * 2, P.hh * 2, 1.6), P.hd * 2 - 0.2, 0.25, this.mat(0x2b2d31, 0.8, 0.3), P.x, P.y, P.z - P.hd + 0.1, 4));
    g.add(this.mesh(new THREE.ShapeGeometry(roundedRect(P.hw * 2 - 0.4, P.hh * 2 - 0.4, 1.4), 12), this.mat(0x050506, 0, 0.3), P.x, P.y, P.z + P.hd + 0.13, false));
    g.add(this.mesh(roundedPlate(P.hw * 2 - 0.9, P.hh * 2 - 0.9, 1.2), this.display(this.tex(phoneMap()), 0.62), P.x, P.y, P.z + P.hd + 0.16, false));
    for (const [dy, h] of [[7, 2.4], [2.4, 4.4]]) g.add(this.box(0.3, h, 0.7, 0.12, this.mat(0x35373c, 0.8, 0.3), P.x + P.hw + 0.08, P.y + dy, P.z));
    // the cable's plug in its foot
    g.add(this.box(2, 2.2, 1, 0.4, black, P.x - 2, P.y - P.hh - 1, P.z));
    this.push(g);
  }

  /** The steering wheel: the rim, the domed pad with the emblem, the button pods, the column, the stalks. */
  private wheel(): void {
    const g = this.frame(WHEEL);
    const leather = this.grained(0x1b1b1c, 0.55, 3.4, 0.06);
    g.add(this.mesh(new THREE.TorusGeometry(WHEEL.R, WHEEL.r, 32, 180), leather));
    // the plate behind: the arms, broadening into the rim, and the lower spoke's two sides
    const plate = new THREE.Shape();
    plate.moveTo(-10.6, -35.4);
    plate.bezierCurveTo(-10, -30, -12, -24, -16, -17);
    plate.bezierCurveTo(-20, -11, -26, -8.8, -30, -9.6);
    plate.bezierCurveTo(-32, -10.4, -33.4, -12, -34.4, -14.6);
    plate.lineTo(-35.6, 4);
    plate.bezierCurveTo(-34.6, 3.2, -32, 3.6, -28, 4);
    plate.bezierCurveTo(-20, 5, -12, 7, 0, 7);
    plate.bezierCurveTo(12, 7, 20, 5, 28, 4);
    plate.bezierCurveTo(32, 3.6, 34.6, 3.2, 35.6, 4);
    plate.lineTo(34.4, -14.6);
    plate.bezierCurveTo(33.4, -12, 32, -10.4, 30, -9.6);
    plate.bezierCurveTo(26, -8.8, 20, -11, 16, -17);
    plate.bezierCurveTo(12, -24, 10, -30, 10.6, -35.4);
    plate.closePath();
    g.add(this.slab(plate, 1, 1.6, leather, 0, 0, -0.8, 10, 0.9));
    // the pad over it, domed
    const pad = new THREE.Shape();
    pad.moveTo(-8, -20.6);
    pad.bezierCurveTo(-3, -22, 3, -22, 8, -20.6);
    pad.bezierCurveTo(11, -17.4, 14, -13, 19.4, -9.6);
    pad.bezierCurveTo(20.4, -7, 20.4, 1, 19.6, 3.6);
    pad.bezierCurveTo(13, 5.6, 8.5, 9.6, 0, 9.8);
    pad.bezierCurveTo(-8.5, 9.6, -13, 5.6, -19.6, 3.6);
    pad.bezierCurveTo(-20.4, 1, -20.4, -7, -19.4, -9.6);
    pad.bezierCurveTo(-14, -13, -11, -17.4, -8, -20.6);
    const soft = this.grained(0x202021, 0.72, 3.4, 0.06);
    g.add(this.slab(pad, 0.8, 3.4, soft, 0, 0, -0.4, 16, 1.7));
    for (const e of [-1, 1]) {
      // the pod: glossy, filling the arm, four dished buttons paired by a capsule's outline
      const pod = new THREE.Shape();
      pod.moveTo(e * 20.2, 3.6);
      pod.bezierCurveTo(e * 23, 4.6, e * 26, 4.4, e * 28.8, 3.6);
      pod.bezierCurveTo(e * 30, 0, e * 30, -6, e * 28.6, -9);
      pod.bezierCurveTo(e * 26, -9.2, e * 23, -9.8, e * 20.4, -10.6);
      pod.bezierCurveTo(e * 19.8, -7, e * 19.6, 0, e * 20.2, 3.6);
      const gloss = this.mat(0x111113, 0.25, 0.28);
      gloss.side = THREE.DoubleSide;
      g.add(this.slab(pod, 1, 0.7, gloss, 0, 0, 1.4, 6));
      const signs = e < 0 ? (['up2', 'mute', 'down2', 'cycle'] as const) : (['next', 'volup', 'prev', 'voldown'] as const);
      signs.forEach((s, k) => {
        const u = e * 24.6 + (k % 2 ? 1.85 : -1.85);
        const w = -2.9 + (k < 2 ? 2.7 : -2.7);
        g.add(this.mesh(new THREE.TorusGeometry(1.45, 0.14, 10, 40), this.mat(0x2a2b2e, 0.3, 0.35), u, w, 3.72, false));
        g.add(this.mesh(new THREE.SphereGeometry(1.4, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.32), this.mat(0x17181a, 0.15, 0.4), u, w, 3.62));
        g.add(this.sign(s, 1.75, 0xffd9c8, 0.5, u, w, 4.14));
      });
      for (const c of [-1.85, 1.85]) {
        const ring: THREE.Vector3[] = [];
        for (let k = 0; k < 40; k++) {
          const a = (k / 40) * Math.PI * 2;
          ring.push(new THREE.Vector3(e * 24.6 + c + Math.cos(a) * 1.72, -2.9 + Math.sin(a) * 1.72 + (Math.sin(a) > 0 ? 2.7 : -2.7), 3.72));
        }
        g.add(this.tube(ring, 0.07, this.mat(0x34353a, 0.4, 0.4), 120, true));
      }
    }
    // the lower spoke: a hollowed grained panel between the plate's two sides
    const lower = roundedOutline([[-7.6, -21], [7.6, -21], [8.4, -33.6], [-8.4, -33.6]], 0.16);
    g.add(this.slab(lower, 0.3, 0.5, this.grained(0x18181a, 0.6, 4, 0.04), 0, 0, 1.4, 4));
    // the round middle with its tongue below (a keyhole), the chrome ring, the emblem, the horn's sign
    const keyhole = new THREE.Shape();
    const a0 = -Math.PI / 2 + 0.62;
    keyhole.absarc(0, -7.6, 11.6, a0, a0 + Math.PI * 2 - 1.24, false);
    keyhole.lineTo(-6.7, -19.6);
    keyhole.quadraticCurveTo(-6.5, -21, -5, -21);
    keyhole.quadraticCurveTo(0, -21.5, 5, -21);
    keyhole.quadraticCurveTo(6.5, -21, 6.7, -19.6);
    keyhole.closePath();
    g.add(this.slab(keyhole, 0.5, 0.7, this.mat(0x1a1a1c, 0.1, 0.5), 0, 0, 5.5, 6));
    g.add(this.mesh(new THREE.TorusGeometry(8.6, 0.32, 12, 112), this.mat(0xc9ccd0, 0.95, 0.2), 0, -7, 7.3));
    const face = new THREE.MeshStandardNodeMaterial({ map: this.tex(emblem()), color: 0xb4b4b4, metalness: 0, roughness: 0.75 });
    g.add(this.mesh(new THREE.CircleGeometry(8.4, 80), face, 0, -7, 7.26, false));
    g.add(this.sign('horn', 2.1, 0x5a5a5c, 0, 0, -17.2, 7.24));
    g.add(this.word('AIRBAG', 5.4, 1.2, 0x5a5a5c, 0, 0, -19.4, 7.24, 0.8));
    // the column's shroud behind it, its seam, the stalks with their signs
    const shroud = this.grained(0x222223, 0.75, 3, 0.06);
    g.add(this.box(24, 17, 36, 6.5, shroud, 0, -2.5, -20));
    g.add(this.mesh(new THREE.CylinderGeometry(9.5, 11, 6, 64).rotateX(Math.PI / 2), this.mat(0x131314, 0, 0.6), 0, -4, -3.5));
    for (const e of [-1, 1]) {
      // (a broad leaf: narrow at the column, wide towards its tip)
      const leaf = new THREE.Shape();
      leaf.moveTo(e * 8, 2.6);
      leaf.bezierCurveTo(e * 14, 2.4, e * 18, 1.6, e * 24, 2);
      leaf.bezierCurveTo(e * 30, 2.4, e * 34.4, 4, e * 34.4, 6.2);
      leaf.bezierCurveTo(e * 34.2, 8.8, e * 28, 9.2, e * 22, 8.2);
      leaf.bezierCurveTo(e * 16, 7.2, e * 12, 6.6, e * 8, 6.4);
      leaf.closePath();
      const lm = this.mat(0x161617, 0.05, 0.5);
      lm.side = THREE.DoubleSide;
      const l = this.slab(leaf, 0.8, 1.4, lm, 0, 0, -12.6, 10);
      g.add(l);
      g.add(this.card(17, 4.6, this.ink(this.tex(stalkTexture(e < 0)), 0xd8d8d6, 0.12), e * 23, 5.8, -9.32));
    }
    this.push(g);
  }

  /** Under the left vent: the light switch on its dark oval panel. */
  private lightSwitch(): void {
    const g = this.frame(SWITCH);
    g.add(this.slab(roundedRect(32, 10.6, 5), 8, 0.9, this.mat(0x121213, 0.05, 0.45), 0, 0, -8, 8));
    const k = new THREE.Group();
    k.position.set(-4, 0, 1.8);
    k.add(this.mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.8, 48).rotateX(Math.PI / 2), this.mat(0x1d1d1f, 0.2, 0.4)));
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const q = 3 * (1 - 0.05 * (0.5 + 0.5 * Math.cos(a * 30)));
      pts.push(new THREE.Vector2(Math.cos(a) * q, Math.sin(a) * q));
    }
    const grip = toCreasedNormals(new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 2.4, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelOffset: -0.4, bevelSegments: 3 }), 0.5);
    k.add(this.mesh(grip, this.mat(0x161617, 0.1, 0.45), 0, 0, 0.4));
    k.add(this.mesh(new THREE.TorusGeometry(2.7, 0.12, 8, 48), this.mat(0xa32018, 0.1, 0.4), 0, 0, 3.15, false));
    k.add(this.sign('lamp', 2.2, 0xffc9a8, 0.5, 0, 0, 3.24));
    g.add(k);
    g.add(this.word('0', 1.4, 1.4, 0xffc9a8, 0.5, -9.6, 2, 1.03), this.sign('lamp', 1.5, 0xffc9a8, 0.5, -8.4, 3.9, 1.03), this.sign('beam', 1.7, 0xffc9a8, 0.5, 1.4, 3, 1.03));
    for (const [u, s] of [[6.2, 'lamp'], [10.4, 'beam']] as const) {
      g.add(this.box(2.2, 6, 1, 0.3, this.mat(0x1c1c1e, 0.1, 0.5), u, -0.8, 1.1));
      g.add(this.sign(s, 1.7, 0xffc9a8, 0.45, u, 3.6, 1.03));
      for (let i = 0; i < 5; i++) g.add(this.box(1.7, 0.35, 0.3, 0.1, this.mat(0x2b2b2d, 0.1, 0.5), u, -2.8 + i, 1.65));
    }
    this.push(g);
  }

  /** The raised badge on the passenger's pad. */
  private badge(): void {
    const b = this.onSkinFrame(246, 7.1, SKIN_LIFT);
    const sh = new THREE.Shape();
    sh.moveTo(-6.4, -0.9);
    sh.quadraticCurveTo(0, -1.8, 6.4, -0.9);
    sh.quadraticCurveTo(6.8, 0, 6.4, 0.9);
    sh.quadraticCurveTo(0, 1.8, -6.4, 0.9);
    sh.quadraticCurveTo(-6.8, 0, -6.4, -0.9);
    b.add(this.slab(sh, 0.15, 0.25, this.mat(0x18181a, 0.05, 0.45), 0, 0, -0.1, 4));
    b.add(this.word('A I R B A G', 12, 2.2, 0x4a4a4d, 0, 0, 0, 0.58, 0.86));
    this.push(b);
  }

  /** The open glove box: its lined cave, the lid with its rim and latch, the papers and things in it, its lamp. */
  private gloveBox(): void {
    const { x0, x1, y0, y1, z0 } = GLOVE;
    const mid = (x0 + x1) / 2;
    const w = x1 - x0;
    const liner = this.grained(0x28282a, 0.9, 3, 0.05);
    liner.side = THREE.DoubleSide;
    const face = (x: number, y: number): number => dashFace(x, y) - 0.15;
    const e = 0.3;
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    const back = z0 + 0.6;
    this.push(
      this.sheet(12, 4, (u, v) => V(x0 + w * u, y0 + e, back + (face(x0 + w * u, y0 + e) - back) * v), liner, true),
      this.sheet(12, 4, (u, v) => V(x0 + w * u, y1 - e, back + (face(x0 + w * u, y1 - e) - back) * v), liner),
      this.sheet(4, 8, (u, v) => V(x0 + 0.5, y0 + (y1 - y0) * v, back + (face(x0, y0 + (y1 - y0) * v) - back) * u), liner, true),
      this.sheet(4, 8, (u, v) => V(x1 - 0.5, y0 + (y1 - y0) * v, back + (face(x1, y0 + (y1 - y0) * v) - back) * u), liner),
    );
    const rear = this.grained(0x1b1b1d, 0.95, 3, 0.05);
    this.push(this.mesh(new THREE.PlaneGeometry(w + 2, y1 - y0 + 2), rear, mid, (y0 + y1) / 2, back, false));
    // the frame round its mouth, on the dashboard's face: one closed bar with rounded corners
    const trim = this.mat(0x333436, 0.05, 0.6);
    const mouth: THREE.Vector3[] = [];
    const R = 2.2;
    const corner = (cx: number, cy: number, a: number): void => {
      for (let k = 0; k <= 8; k++) {
        const q = a + (k / 8) * (Math.PI / 2);
        const x = cx + Math.cos(q) * R;
        const y = cy + Math.sin(q) * R;
        mouth.push(V(x, y, dashFace(x, y) + SKIN_LIFT));
      }
    };
    const run = (ax: number, ay: number, bx: number, by: number): void => {
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 2);
      for (let k = 1; k < n; k++) mouth.push(V(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, dashFace(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n) + SKIN_LIFT));
    };
    const [l, r, b, t] = [x0 - 0.4, x1 + 0.4, y0 - 0.6, y1 + 0.2];
    corner(r - R, t - R, 0);
    run(r - R, t, l + R, t);
    corner(l + R, t - R, Math.PI / 2);
    run(l, t - R, l, b + R);
    corner(l + R, b + R, Math.PI);
    run(l + R, b, r - R, b);
    corner(r - R, b + R, Math.PI * 1.5);
    run(r, b + R, r, t - R);
    this.push(this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mouth, true, 'centripetal'), 480, 0.95, 12, true), trim, 0, 0, 0, false));
    // the lid
    const lid = new THREE.Group();
    lid.position.set(mid, GLOVE.hingeY, GLOVE.hingeZ);
    lid.rotation.x = Math.atan2(GLOVE.s, GLOVE.c);
    const outer = this.grained(0x3a3b3d, 0.7, 2.6, 0.05);
    lid.add(this.box(w + 2, GLOVE.thick, GLOVE.len, 0.9, outer, 0, -GLOVE.thick / 2, GLOVE.len / 2));
    lid.add(this.box(w + 2, 3.6, 2.2, 0.9, outer, 0, 0.6, GLOVE.len - 1.1));
    for (const m of [-1, 1]) {
      lid.add(this.box(2.2, 3.6, GLOVE.len - 3, 0.9, outer, m * (w / 2 - 0.1), 0.6, GLOVE.len / 2 + 1.4));
      // (two round cup holders moulded in it)
      lid.add(this.mesh(new THREE.TorusGeometry(4.6, 0.35, 10, 64).rotateX(Math.PI / 2), outer, m * 18, 0.1, 10, false));
      lid.add(this.mesh(new THREE.CircleGeometry(4.5, 48).rotateX(-Math.PI / 2), this.mat(0x1b1b1c, 0, 0.8), m * 18, 0.05, 10, false));
    }
    lid.add(this.box(w - 6, 0.3, GLOVE.len - 6, 0.14, this.grained(0x202022, 0.9, 3, 0.06), 0, 0, GLOVE.len / 2 - 0.6));
    // (the latch on its lip, the handle's scoop on the far side)
    lid.add(this.box(5, 1.4, 1.2, 0.4, this.mat(0x101011, 0.1, 0.45), 0, 2.6, GLOVE.len - 1.2), this.box(2.4, 0.8, 1.6, 0.2, this.mat(0x8a8d92, 0.8, 0.35), 0, 3.2, GLOVE.len - 1.2));
    lid.add(this.box(16, 2.4, 0.5, 0.2, this.mat(0x161617, 0.05, 0.5), -4, 0.4, GLOVE.len + 0.1));
    // (on it: a crumpled receipt, a pen, three coins)
    const note = new THREE.PlaneGeometry(9, 5, 24, 12);
    const np = note.getAttribute('position');
    for (let i = 0; i < np.count; i++) {
      const nx = np.getX(i);
      const ny = np.getY(i);
      np.setZ(i, 0.35 + Math.sin(nx * 1.3) * 0.22 + Math.sin(ny * 2.1 + nx) * 0.16);
    }
    note.computeVertexNormals();
    const receipt = this.mesh(note.rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ map: this.tex(paperTexture('receipt')), roughness: 0.9, side: THREE.DoubleSide }), 4, 0.2, 9);
    receipt.rotation.y = 0.5;
    lid.add(receipt);
    const pen = new THREE.Group();
    pen.add(this.mesh(new THREE.CylinderGeometry(0.42, 0.42, 11, 20).rotateZ(Math.PI / 2), this.mat(0x1f4fa8, 0.1, 0.3)), this.mesh(new THREE.ConeGeometry(0.42, 1.2, 20).rotateZ(-Math.PI / 2), this.mat(0xc9ccd0, 0.8, 0.3), 6.1, 0, 0), this.box(3.4, 0.2, 0.3, 0.08, this.mat(0xc9ccd0, 0.8, 0.3), -3.4, 0.5, 0));
    pen.position.set(-4, 0.58, 14.4);
    pen.rotation.y = 0.18;
    lid.add(pen);
    for (const [cx, cz, c] of [[10.6, 14.6, 0xb8923f], [12.6, 13.2, 0xb8923f], [-11, 5.4, 0x9a5a32]] as const) lid.add(this.mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.22, 32), this.mat(c, 0.85, 0.35), cx, 0.28, cz));
    this.push(lid);
    // the folder with the car's papers sticking out of it
    const { folder, papers, map, tissues, torch } = GLOVE_THINGS;
    const f = new THREE.Group();
    f.position.set(folder.x, y0 + 0.16, folder.z);
    f.add(this.box(folder.w, folder.h - 0.2, folder.d, 0.5, this.grained(0x15161a, 0.55, 3.4, 0.05), 0, (folder.h - 0.2) / 2, 0));
    const sheets: [number, number, number, string][] = [[0.4, 0.06, 0.2, 'form'], [1.4, -0.05, 0.75, 'lines'], [-1, 0.12, 1.25, 'stamp']];
    for (const [dx, turn, h, look] of sheets) {
      const p = this.mesh(new RoundedBoxGeometry(papers.w - 2, 0.14, papers.d - 2, 1, 0.05), this.mat(0xe9e7df, 0, 0.9), dx, folder.h + h - 0.1, papers.z - folder.z);
      const top = this.mesh(new THREE.PlaneGeometry(papers.w - 2.2, papers.d - 2.2).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ map: this.tex(paperTexture(look as 'form')), roughness: 0.9 }), 0, 0.085, 0, false);
      p.add(top);
      p.rotation.y = turn;
      f.add(p);
    }
    this.push(f);
    // the folded road map, its pleats
    const m2 = new THREE.Group();
    m2.position.set(map.x, y0 + 0.16, map.z);
    m2.rotation.y = -0.06;
    for (let k = 0; k < 4; k++) m2.add(this.box(map.w, 0.46, map.d - k * 0.3, 0.2, this.mat(k % 2 ? 0xe2ddcc : 0xd2ccb8, 0, 0.85), k % 2 ? 0.12 : 0, 0.3 + k * 0.54, 0));
    m2.add(this.mesh(new THREE.PlaneGeometry(map.w - 0.4, map.d - 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ map: this.tex(paperTexture('map')), roughness: 0.85 }), 0, 2.2, 0, false));
    this.push(m2);
    // a packet of tissues, one pulled out
    const t2 = new THREE.Group();
    t2.position.set(tissues.x, y0 + 0.16, tissues.z);
    t2.add(this.box(tissues.w, tissues.h - 0.4, tissues.d, 1.4, this.mat(0x7fb3d9, 0, 0.4), 0, (tissues.h - 0.4) / 2, 0));
    const tissue = new THREE.ConeGeometry(2.6, 4.4, 24, 6, true);
    const tp = tissue.getAttribute('position');
    for (let i = 0; i < tp.count; i++) {
      const a = Math.atan2(tp.getZ(i), tp.getX(i));
      const k = 1 + 0.3 * Math.sin(a * 4 + tp.getY(i));
      tp.setX(i, tp.getX(i) * k);
      tp.setZ(i, tp.getZ(i) * k);
    }
    tissue.computeVertexNormals();
    t2.add(this.mesh(tissue, this.two(0xf2f1ee, 0, 0.95), 0, tissues.h + 1.4, 0));
    this.push(t2);
    // a torch
    const tr = new THREE.Group();
    tr.position.set((torch.x0 + torch.x1) / 2, y0 + torch.r + 0.1, torch.z);
    const len = torch.x1 - torch.x0;
    tr.add(this.mesh(new THREE.CylinderGeometry(1.5, 1.5, len, 32).rotateZ(Math.PI / 2), this.mat(0x1b1c1e, 0.5, 0.4)), this.mesh(new THREE.CylinderGeometry(torch.r, 1.6, 5, 40).rotateZ(-Math.PI / 2), this.mat(0x26282b, 0.6, 0.35), len / 2, 0, 0));
    for (let k = 0; k < 8; k++) tr.add(this.mesh(new THREE.TorusGeometry(1.55, 0.14, 8, 32).rotateY(Math.PI / 2), this.mat(0x0e0e0f, 0.3, 0.5), -len / 2 + 3 + k * 0.9, 0, 0, false));
    tr.add(this.mesh(new THREE.CircleGeometry(torch.r - 0.3, 32).rotateY(Math.PI / 2), this.mat(0xd8dcde, 0.3, 0.15), len / 2 + 2.52, 0, 0, false));
    this.push(tr);
    // its lamp, up in the corner
    const lamp = new THREE.MeshStandardNodeMaterial({ color: 0xfff1d8, emissive: new THREE.Color(0xffe2b4), emissiveIntensity: 1.6, roughness: 0.4 });
    this.push(this.box(7, 1, 3, 0.4, lamp, x1 - 8, y1 - 0.6, 92));
    const light = new THREE.PointLight(0xffdcae, 90, 46, 1.7);
    light.position.set(x1 - 10, y1 - 3, 88);
    this.group.add(light);
    this.pieces.push(light);
  }

  /** The tray between the seats, smooth over its terrain: its sides, its mat; the gear lever; the lighter socket. */
  private tunnel(): void {
    const trim = this.grained(0x242426, 0.7, 2.8, 0.05);
    const o = 0.16;
    this.push(this.box(51 + 2 * o, 4.4 + o, 62 + o, 1.2, trim, 160, 4.8 + o / 2, 123 + o));
    const rim = new THREE.Shape();
    rim.moveTo(132.8, -92);
    rim.lineTo(132.8, -152);
    rim.quadraticCurveTo(132.8, -156.4, 137.2, -156.4);
    rim.lineTo(182.8, -156.4);
    rim.quadraticCurveTo(187.2, -156.4, 187.2, -152);
    rim.lineTo(187.2, -92);
    rim.lineTo(183.2, -92);
    rim.lineTo(183.2, -150.4);
    rim.quadraticCurveTo(183.2, -152.4, 181.2, -152.4);
    rim.lineTo(138.8, -152.4);
    rim.quadraticCurveTo(136.8, -152.4, 136.8, -150.4);
    rim.lineTo(136.8, -92);
    rim.closePath();
    const rail = this.slab(rim, 6.6, 1.2, trim, 0, 4, 0, 6);
    rail.geometry.rotateX(-Math.PI / 2);
    rail.position.set(0, 5.4, 0);
    this.push(rail);
    this.push(this.box(44, 0.5, 20, 0.2, this.grained(0x0f0f10, 0.95, 3, 0.08), 160, 7.2, 116));
    const ribs: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      ribs.push(new THREE.Vector2(9.4 - t * 7.6 + Math.sin(t * Math.PI * 5) * 0.28 * (1 - t), t * 10.4));
    }
    ribs.push(new THREE.Vector2(1.1, 10.6));
    const boot = this.grained(0x161617, 0.75, 3.4, 0.05);
    boot.side = THREE.DoubleSide;
    this.push(this.mesh(new THREE.LatheGeometry(ribs, 64), boot, 160, 7.2, 140));
    this.push(this.mesh(new THREE.TorusGeometry(9.8, 0.6, 12, 72).rotateX(Math.PI / 2), this.mat(0x8f9398, 0.7, 0.36), 160, 7.4, 140));
    const a = new THREE.Vector3(160, 15, 140);
    const b = new THREE.Vector3(160, 26, 138.8);
    const stick = this.mesh(new THREE.CylinderGeometry(1.1, 1.3, a.distanceTo(b), 24), this.mat(0xb4b7bb, 0.9, 0.3));
    stick.position.copy(a).add(b).multiplyScalar(0.5);
    stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.push(stick);
    const knob = new THREE.Group();
    knob.position.set(160, 28.4, 138.5);
    knob.rotation.x = 0.16;
    knob.scale.setScalar(0.86);
    const kp = [[1.4, -5.4], [2.6, -4.6], [4, -2.6], [5, 0.4], [5, 2.6], [4.2, 4.6], [3.2, 5.1]].map(([r, h]) => new THREE.Vector2(r, h));
    knob.add(this.mesh(new THREE.LatheGeometry(new THREE.SplineCurve(kp).getPoints(32), 56), this.grained(0x19191a, 0.55, 3.6, 0.05)));
    const gates = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, map: this.tex(canvasTexture(256, 256, (g) => {
      g.fillStyle = '#17181a';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#e6e6e4';
      g.strokeStyle = '#e6e6e4';
      g.lineWidth = 8;
      g.lineCap = 'round';
      g.font = '600 44px "Segoe UI", Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      ['1', '3', '5', '2', '4', 'R'].forEach((s, k) => g.fillText(s, 68 + (k % 3) * 60, k < 3 ? 58 : 202));
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        g.moveTo(68 + k * 60, 92);
        g.lineTo(68 + k * 60, 166);
      }
      g.moveTo(68, 129);
      g.lineTo(188, 129);
      g.stroke();
    })) });
    knob.add(this.mesh(new THREE.CylinderGeometry(3.2, 3.3, 0.4, 56), this.mat(0x8f9398, 0.8, 0.32), 0, 5.1, 0), this.mesh(new THREE.CircleGeometry(2.9, 56).rotateX(-Math.PI / 2), gates, 0, 5.32, 0, false));
    this.push(knob);
    const socket = new THREE.Group();
    socket.position.set(142, 7.5, 121);
    socket.add(this.mesh(new THREE.TorusGeometry(2.4, 0.4, 10, 48).rotateX(Math.PI / 2), this.mat(0x2a2a2c, 0.5, 0.4)), this.mesh(new THREE.CylinderGeometry(1.7, 2, 2.6, 32), this.mat(0x151516, 0.1, 0.5), 0, 1, 0));
    this.push(socket);
  }

  /** The windscreen: the pane with its faint streaks, its black dotted edge, the rubber, the cowl, the wipers, the sticker. */
  private windscreen(): void {
    const at = (x: number, t: number, off: number): THREE.Vector3 => new THREE.Vector3(x, GLASS.y + t * GLASS.s - off * GLASS.c, glassFoot(x) + t * GLASS.c + off * GLASS.s);
    const pane = (x0: number, x1: number, t0: number, t1: number, off: number, m: THREE.Material): THREE.Mesh =>
      this.sheet(64, 24, (u, v) => at(x0 + (x1 - x0) * u, t0 + (t1 - t0) * v, off), m, true);
    const glass = new THREE.MeshStandardNodeMaterial({ color: 0xc8d6da, metalness: 0, roughness: 0.06, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaMap: this.tex(glassStreaks()), opacity: 0.5 });
    const p = pane(27, 293, 0, GLASS.len + 40, 0, glass);
    p.renderOrder = 4;
    this.push(p);
    // (the black edge: solid at the foot, then rows of dots that shrink)
    const frit = this.tex(canvasTexture(256, 256, (g, W, H) => {
      g.fillStyle = '#000000';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffffff';
      g.fillRect(0, H * 0.55, W, H);
      for (let row = 0; row < 5; row++) {
        const r = 15 - row * 2.6;
        for (let x = -32; x <= W + 32; x += 32) {
          g.beginPath();
          g.arc(x + (row % 2) * 16, H * 0.55 - 10 - row * 27, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }));
    frit.wrapS = THREE.RepeatWrapping;
    frit.repeat.set(70, 1);
    const black = new THREE.MeshStandardNodeMaterial({ color: 0x060607, metalness: 0, roughness: 0.4, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaMap: frit });
    this.push(pane(26.5, 293.5, -12, 0.3, 0.04, this.two(0x060607, 0, 0.6)));
    const edge = pane(27, 293, 0, 4.2, 0.06, black);
    edge.renderOrder = 5;
    this.push(edge);
    const sideFrit = this.two(0x070708, 0, 0.5);
    for (const [a, b] of [[26.5, 30], [290, 293.5]]) this.push(pane(a, b, -14, GLASS.len + 40, 0.05, sideFrit));
    const foot = (dy: number, dz: number, x0 = 26, x1 = 294): THREE.Vector3[] =>
      Array.from({ length: 33 }, (_, i) => {
        const x = x0 + ((x1 - x0) * i) / 32;
        return new THREE.Vector3(x, GLASS.y + dy, glassFoot(x) + dz);
      });
    this.push(this.tube(foot(0.3, 0.4), 1.1, this.mat(0x060606, 0, 0.85), 128));
    // the cowl outside, dark, from the glass to the bonnet
    const cowl = this.two(0x0a0a0b, 0.1, 0.5);
    this.push(this.sheet(64, 10, (u, v) => {
      const x = 10 + 300 * u;
      const c = (x - 160) / 176;
      return new THREE.Vector3(x, GLASS.y - 0.8 + v * 0.9 - c * c * 3 * v, glassFoot(Math.min(293, Math.max(27, x))) - v * 17);
    }, cowl));
    // (a dark skirt hanging from the bonnet's edge: no light between the cowl and the bonnet)
    this.push(this.sheet(64, 1, (u, v) => {
      const x = -16 + 352 * u;
      return new THREE.Vector3(x, this.bonnetEdge(x) - v * 30, glassFoot(Math.min(293, Math.max(27, x))) - 13);
    }, this.two(0x0a0a0b, 0.1, 0.5)));
    // the wipers lying on it: an arm and a blade each
    const rubber = this.mat(0x0b0b0c, 0.1, 0.55);
    for (const [x0, x1] of [[70, 168], [158, 256]]) {
      const pts = foot(3.2, -1.6, x0, x1);
      this.push(this.tube(pts, 0.45, rubber, 96));
      this.push(this.tube(pts.map((q) => q.clone().add(new THREE.Vector3(0, 0.9, -0.5))).filter((_, i) => i < 24), 0.7, this.mat(0x111113, 0.3, 0.45), 72));
      for (const q of [pts[0], pts[pts.length - 1]]) this.push(this.mesh(new THREE.SphereGeometry(0.46, 12, 8), rubber, q.x, q.y, q.z, false));
    }
    // the sticker, low on the passenger's side: a blue frame, a faded blank form
    const st = this.tex(canvasTexture(256, 200, (g) => {
      g.fillStyle = '#254f96';
      g.fillRect(0, 0, 256, 200);
      g.fillStyle = '#d9d9d4';
      g.fillRect(18, 48, 220, 138);
      g.fillStyle = '#8d8d92';
      g.save();
      g.translate(128, 118);
      g.rotate(0.02);
      g.fillRect(-88, -50, 176, 98);
      g.fillStyle = '#7a7a80';
      for (let k = 0; k < 5; k++) g.fillRect(-74, -36 + k * 17, 100 + ((k * 47) % 40), 4);
      g.restore();
    }));
    this.push(pane(250, 262, 10, 19, 0.1, new THREE.MeshStandardNodeMaterial({ map: st, roughness: 0.8, side: THREE.DoubleSide })));
  }

  /** At both ends: the broad pillar, the window's black frame, the corner panel with its grille, the door, the mirror. */
  private sides(): void {
    const dots = this.tex(canvasTexture(256, 256, (g) => {
      g.fillStyle = '#3a3a3d';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#080808';
      for (let y = 0; y < 16; y++) for (let x = -1; x < 16; x++) {
        g.beginPath();
        g.arc(x * 16 + (y % 2) * 8 + 8, y * 16 + 8, 5.4, 0, Math.PI * 2);
        g.fill();
      }
    }));
    dots.wrapS = dots.wrapT = THREE.RepeatWrapping;
    for (const m of [-1, 1]) {
      const X = (v: number): number => (m < 0 ? v : 320 - v);
      const flip = m > 0;
      const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(X(x), y, z);
      // (three lines up the windscreen's side: the glass's edge, the pillar's other edge, the window frame's)
      const A = pillarA;
      const B = pillarB;
      const lining = this.grained(0x8f8e8a, 0.9, 3, 0.03);
      lining.side = THREE.DoubleSide;
      this.push(this.sheet(64, 16, (t, v) => {
        const a = A(t);
        const b = B(t);
        const bulge = Math.sin(v * Math.PI) ** 0.8;
        return V(a[0] + (b[0] - a[0]) * v + 3.6 * bulge, a[1] + (b[1] - a[1]) * v + 1.2 * bulge, a[2] + (b[2] - a[2]) * v + 2 * bulge);
      }, lining, flip));
      // (it casts the pillar's shadow)
      const seal: THREE.Vector3[] = [];
      const rim: THREE.Vector3[] = [];
      for (let k = 0; k <= 40; k++) {
        const b = B(k / 40);
        seal.push(V(b[0] - 0.4, b[1], b[2] + 0.6));
        rim.push(V(...A(k / 40)));
      }
      this.push(this.tube(seal, 1.2, this.mat(0x080808, 0, 0.85), 160), this.tube(rim, 0.7, this.mat(0x0a0a0a, 0, 0.8), 160));
      const frame = this.two(0x111113, 0.05, 0.5);
      this.push(this.sheet(64, 10, (t, v) => {
        const b = B(Math.max(0.06, t));
        const bulge = Math.sin(v * Math.PI);
        return V(b[0] - 0.8 - 5 * v + 1.4 * bulge, b[1] - 1.5 * v, b[2] + 0.8 + 10 * v);
      }, frame, flip));
      // the corner panel: from the frame down to the door's top, one piece, a rounded grille set in it
      const turn = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.rotateY(-Math.PI / 2);
      const corner: [number, number][] = [[46, 63], [92, 63], [92, 132], [84, 124], [50, 78]];
      const shell = new THREE.ExtrudeGeometry(roundedOutline(corner, 0.05), { depth: 2.4, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.4, bevelSegments: 3 });
      this.push(this.mesh(turn(toCreasedNormals(shell, 0.7)), this.two(0x262629, 0.05, 0.55), X(19.4) + (m < 0 ? 1.2 : 1.2), 0, 0));
      const set: [number, number][] = [[58, 69], [87, 69], [87, 114]];
      const gg = new THREE.ShapeGeometry(roundedOutline(set, 0.12), 12);
      const tc = gg.getAttribute('uv');
      for (let i = 0; i < tc.count; i++) tc.setXY(i, tc.getX(i) / 9, tc.getY(i) / 9);
      this.push(this.mesh(turn(gg), new THREE.MeshStandardNodeMaterial({ map: dots, roughness: 0.75, side: THREE.DoubleSide }), X(22.1), 0, 0, false));
      const line = roundedOutline(set, 0.12).getPoints(10).map((q) => V(22.1, q.y, q.x));
      this.push(this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line, true, 'catmullrom', 0.2), 160, 0.3, 8, true), this.mat(0x0c0c0d, 0, 0.6), 0, 0, 0, false));
      // the window's front post
      this.push(this.box(4, 190, 5, 1.2, frame, X(19.5), 63 + 95, 94.5));
      // the door, on past the map: its body, a soft shoulder, the window's seal, the armrest, the cloth, the opener
      const body = this.grained(0x2c2c2e, 0.8, 2.6, 0.05);
      this.push(this.box(21.2, 58, 300, 3, body, X(13.2), 36.6, 184));
      this.push(this.box(19, 2.4, 300, 1.1, this.grained(0x262628, 0.8, 2.6, 0.05), X(12), 64.45, 184));
      this.push(this.box(2, 2.2, 230, 0.8, this.mat(0x070707, 0, 0.85), X(5), 64.9, 206));
      this.push(this.box(9.4, 6.8, 250, 2.2, body, X(26.4), 30.2, 233));
      const cloth = new THREE.MeshStandardNodeMaterial({ roughness: 0.97 });
      const p = positionWorld;
      const weave = mx_noise_float(vec3(p.x, p.y.mul(5), p.z.mul(5)));
      cloth.colorNode = vec3(0.072, 0.03, 0.033).mul(float(1).add(weave.mul(0.4)));
      const insert = roundedOutline([[112, 36], [300, 36], [300, 58], [120, 58]], 0.12);
      this.push(this.mesh(turn(new THREE.ExtrudeGeometry(insert, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelSegments: 3 })), cloth, X(23.9) + (m < 0 ? 0.6 : 0), 0, 0));
      const op = new THREE.Group();
      op.position.set(X(24.6), 47.5, 138);
      op.scale.x = m < 0 ? 1 : -1;
      const bowl = this.mat(0x0d0d0e, 0.05, 0.45);
      bowl.side = THREE.DoubleSide;
      op.add(this.mesh(new THREE.SphereGeometry(1, 48, 24).scale(1.2, 8.4, 13), bowl), this.mesh(new THREE.TorusGeometry(1, 0.07, 12, 72).rotateY(Math.PI / 2).scale(6, 8.6, 13.2), bowl, 0.4, 0, 0));
      op.add(this.box(1.4, 3.6, 11, 0.65, this.mat(0x85898f, 0.7, 0.38), 1.6, 0.4, 1));
      this.push(op);
      // the mirror outside, on its arm: the shell, the glass set in it
      const mir = new THREE.Group();
      mir.position.set(X(-24), 86, 84);
      mir.rotation.y = -m * 0.42;
      const shellM = this.mat(0x23252a, 0.3, 0.4);
      mir.add(this.box(44, 29, 20, 9, shellM, 0, 0, -6), this.slab(roundedRect(39, 24, 7.5), 0.6, 0.4, this.mat(0x0a0a0b, 0.1, 0.5), 0, 0, 3.4, 4));
      const view = new THREE.MeshBasicNodeMaterial({ map: this.tex(mirrorView()), color: 0xbdbdbd });
      view.fog = false;
      mir.add(this.mesh(roundedPlate(36, 21, 6), view, 0, 0, 5.06, false));
      mir.add(this.box(26, 9, 8, 3.6, shellM, m < 0 ? 26 : -26, -8, -4));
      this.push(mir);
    }
    // the small box on the left pillar's foot, its cable
    this.push(this.box(12, 5, 6, 1.6, this.mat(0x101011, 0.1, 0.45), 40, 80.8, 41));
    this.push(this.tube([new THREE.Vector3(34, 80, 42), new THREE.Vector3(31, 78.6, 46), new THREE.Vector3(27.6, 73, 50), new THREE.Vector3(25, 66.8, 56)], 0.5, this.mat(0x0c0c0d, 0, 0.6), 32));
  }

  /** Under the dashboard: the bulkhead, the carpet, the pedals, the kick panels. */
  private footwell(): void {
    const carpet = new THREE.MeshBasicNodeMaterial();
    carpet.fog = false;
    const pile = mx_noise_float(positionWorld.mul(1.9)).mul(0.6).add(mx_noise_float(positionWorld.mul(5)).mul(0.4));
    carpet.colorNode = vec3(0.026, 0.0255, 0.025).mul(float(1).add(pile.mul(0.45)));
    carpet.side = THREE.DoubleSide;
    this.push(this.sheet(8, 24, (u, v) => {
      // (up the bulkhead, then along the floor)
      const t = v * 2;
      const y = t < 1 ? 16 - 84 * (1 - (1 - t) ** 2) : -68;
      const z = t < 1 ? 34 + 34 * t * t : 68 + (t - 1) * 450;
      return new THREE.Vector3(2 + 316 * u, y, z);
    }, carpet, true));
    const metal = this.mat(0x2a2b2d, 0.4, 0.5);
    for (const [x, y, w, h] of [[58, -30, 13, 12], [84, -30, 14, 12], [108, -36, 9, 24]]) {
      const pad = this.box(w, h, 3, 1.1, this.mat(0x0d0d0e, 0, 0.85), x, y, 78);
      pad.rotation.x = -0.7;
      this.push(pad);
      const arm = this.box(2.4, 36, 2.4, 0.8, metal, x, y + 14, 69);
      arm.rotation.x = 0.28;
      this.push(arm);
    }
    this.push(this.box(40, 80, 130, 8, this.grained(0x1f1f21, 0.85, 2.6, 0.04), 160, -38.2, 96));
  }

  /** The height of the bonnet's rear edge at x. */
  private bonnetEdge(x: number): number {
    const c = (x - 160) / 176;
    return 81.2 - c * c * 7 + Math.cos(c * Math.PI * 1.6) * 1.2;
  }

  /** Outside and behind: the bonnet, the garage round the car, the seats, the cabin's dark back. */
  private outside(): void {
    const paint = new THREE.MeshStandardNodeMaterial({ color: 0x2c3036, metalness: 0.55, roughness: 0.3, side: THREE.DoubleSide });
    const refl = this.tex(garage());
    refl.wrapS = THREE.MirroredRepeatWrapping;
    paint.emissive = new THREE.Color(0xffffff);
    paint.emissiveMap = refl;
    paint.emissiveIntensity = 0.16;
    this.push(this.sheet(64, 40, (u, v) => {
      const x = -16 + 352 * u;
      return new THREE.Vector3(x, this.bonnetEdge(x) - v * v * 13, glassFoot(Math.min(293, Math.max(27, x))) - 13 - v * 170);
    }, paint));
    // the garage, all round the front of the car, on the inside of a drum
    const drum = new THREE.CylinderGeometry(430, 430, 520, 96, 1, true, Math.PI / 2 - 0.55, Math.PI + 1.1);
    const tc = drum.getAttribute('uv');
    for (let i = 0; i < tc.count; i++) tc.setX(i, 1 - tc.getX(i));
    const wall = new THREE.MeshBasicNodeMaterial({ map: this.tex(surround()), color: 0xd0d0d0, side: THREE.BackSide });
    wall.fog = false;
    this.push(this.mesh(drum, wall, 160, 128, 110, false));
    // the seats, far back: soft dark shapes
    const cloth = this.mat(0x1d1d1f, 0, 0.95);
    for (const x of [82, 238]) {
      const back = this.box(96, 150, 34, 15, cloth, x, 30, 410);
      back.rotation.x = 0.26;
      this.push(back);
      this.push(this.box(48, 34, 22, 9, cloth, x, 124, 432));
      this.push(this.box(96, 26, 100, 11, cloth, x, -42, 360));
    }
    const dark = new THREE.MeshBasicNodeMaterial({ color: 0x17171a });
    dark.fog = false;
    this.push(this.mesh(new THREE.PlaneGeometry(1000, 520), dark, 160, 110, 520, false));
  }

  /** Never drawn: what keeps the sun off most of the dashboard, so it falls in patches (a window with its bars). */
  private sunBlinds(): void {
    const unseen = new THREE.MeshBasicNodeMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.position.set(160, 121, 70);
    g.rotation.y = -0.38;
    const blind = (x0: number, x1: number, z0: number, z1: number): void => {
      const o = this.mesh(new THREE.BoxGeometry(x1 - x0, 0.6, z1 - z0), unseen, (x0 + x1) / 2, 0, (z0 + z1) / 2);
      o.receiveShadow = false;
      g.add(o);
    };
    blind(-112, -14, -90, 46);
    blind(16, 22, -90, 80);
    blind(52, 160, -90, 46);
    this.push(g);
  }

  /** Add a piece to the scene; whatever it is made of, the explosions' craters cut it. */
  private push(...objects: THREE.Object3D[]): void {
    for (const object of objects) {
      object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as THREE.NodeMaterial[]) if (!m.maskNode) this.craters.cut(m);
        // (a small part's shadow is finer than the shadow map: not worth a second drawing of it)
        o.geometry.computeBoundingSphere();
        if ((o.geometry.boundingSphere?.radius ?? 0) < 2.6) o.castShadow = false;
      });
      this.group.add(object);
      this.pieces.push(object);
    }
  }
}
