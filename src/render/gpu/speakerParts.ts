import * as THREE from 'three/webgpu';
import { BASKET_HIGH, BASKET_LOW, BASKET_THICK, WINDOW_HALF, WINDOW_HEAD, WINDOW_SILL } from '../../terrain/generators/speaker';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import type { Craters } from './craters';

const UP = new THREE.Vector3(0, 1, 0);
/** How far a stand-in sits outside the terrain it hides. */
const OUT = 0.3;

/**
 * A lathe profile for a disc or a short cylinder from `y0` to `y1` of `radius` with rounded edges of
 * `bevel`: the top face, the rounded rim and the side, and with `closed` the underside too (a plate
 * that overhangs a gap).
 */
function roundedDisc(radius: number, y0: number, y1: number, bevel: number, inner = 0, closed = false): THREE.Vector2[] {
  const p: THREE.Vector2[] = [];
  const b = Math.min(bevel, (y1 - y0) / 2, radius - inner);
  p.push(new THREE.Vector2(inner, y1));
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    p.push(new THREE.Vector2(radius - b + Math.sin(a) * b, y1 - b + Math.cos(a) * b));
  }
  p.push(new THREE.Vector2(radius, y0));
  if (closed) {
    p.push(new THREE.Vector2(inner, y0));
    if (inner > 0) p.push(new THREE.Vector2(inner, y1)); // (a ring: its inner wall too)
  }
  // (a lathe's faces point outward when the profile runs up the outside and in over the top)
  return p.reverse();
}

/**
 * A patch of a conical shell (the basket frame): between heights s0..s1 of the frustum from (r0, y0) to
 * (r1, y1), `thick` thick, over the angles centre ± half(r) (half >= PI: the full ring). Outer and inner
 * faces, and the edges all round. Drawn double-sided.
 */
function shellPatch(r0: number, y0: number, r1: number, y1: number, thick: number, s0: number, s1: number, centre: number, half: (r: number) => number): THREE.BufferGeometry {
  const NS = 8;
  const NA = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (s: number, j: number, inner: boolean): [number, number, number] => {
    const r = r0 + (r1 - r0) * s;
    const h = Math.min(Math.PI, half(r));
    const a = centre - h + (2 * h * j) / NA;
    const rr = inner ? r - thick - OUT : r + OUT;
    return [Math.cos(a) * rr, y0 + (y1 - y0) * s, Math.sin(a) * rr];
  };
  /** A grid of (nu + 1) × (nv + 1) vertices from `f(u, v)`, as its own vertices (sharp edges between faces). */
  const grid = (nu: number, nv: number, f: (u: number, v: number) => [number, number, number]): void => {
    const base = pos.length / 3;
    for (let v = 0; v <= nv; v++) for (let u = 0; u <= nu; u++) pos.push(...f(u, v));
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) {
        const a = base + v * (nu + 1) + u;
        idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
  };
  const s = (v: number): number => s0 + ((s1 - s0) * v) / NS;
  grid(NA, NS, (u, v) => at(s(v), u, false));
  grid(NA, NS, (u, v) => at(s(v), NA - u, true));
  grid(NA, 1, (u, v) => at(s0, u, v === 1));
  grid(NA, 1, (u, v) => at(s1, u, v === 0));
  if (half((r0 + r1) / 2) < Math.PI) {
    grid(1, NS, (u, v) => at(s(v), 0, u === 1));
    grid(1, NS, (u, v) => at(s(v), NA, u === 0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Smooth stand-ins for the Studio Monitor's round parts (render only): the woofer's back (basket ring and
 * frame, the paper cone, the pleated spider, the magnet stack with its label), the tweeter, the bass
 * port's lip and dark throat, and the screwdriver. Like the other stand-ins they sit just outside the
 * terrain (which the generator keeps a little smaller under them) and hide its steps; the terrain stays
 * the destructible part, and the craters cut them exactly like the terrain.
 */
export class SpeakerParts {
  private readonly group = new THREE.Group();
  private readonly pieces: THREE.Object3D[] = [];
  private readonly basket: THREE.MeshStandardNodeMaterial;
  private readonly paper: THREE.MeshStandardNodeMaterial;
  private readonly damper: THREE.MeshStandardNodeMaterial;
  private readonly zinc: THREE.MeshStandardNodeMaterial;
  private readonly ferrite: THREE.MeshStandardNodeMaterial;
  private readonly former: THREE.MeshStandardNodeMaterial;
  private readonly plastic: THREE.MeshStandardNodeMaterial;
  private readonly lip: THREE.MeshStandardNodeMaterial;
  private readonly hole: THREE.MeshBasicNodeMaterial;
  private readonly throat: THREE.MeshBasicNodeMaterial;
  private readonly label: THREE.MeshStandardNodeMaterial;
  private readonly rodMaterials = new Map<string, THREE.MeshStandardNodeMaterial>();

  constructor(
    scene: THREE.Scene,
    private readonly craters: Craters,
  ) {
    const m = (color: number, metalness: number, roughness: number): THREE.MeshStandardNodeMaterial =>
      craters.cut(new THREE.MeshStandardNodeMaterial({ color, metalness, roughness }));
    // satin black paint and plastic (warm light leaves them dark grey, not orange), dull zinc plate
    this.basket = m(0x1b1c1f, 0.3, 0.62);
    this.basket.side = THREE.DoubleSide;
    this.paper = m(0x2e2a25, 0, 0.94);
    this.damper = m(0xc2a463, 0, 0.88);
    this.zinc = m(0x9ca3aa, 0.85, 0.5);
    this.ferrite = m(0x262628, 0, 0.85);
    this.former = m(0x9a6a2c, 0.1, 0.55);
    this.plastic = m(0x161618, 0, 0.7);
    this.lip = m(0x2b2c2f, 0, 0.55);
    this.hole = craters.cut(new THREE.MeshBasicNodeMaterial({ color: 0x030303 }));
    this.throat = craters.cut(new THREE.MeshBasicNodeMaterial({ color: 0x010101, side: THREE.BackSide }));
    this.label = craters.cut(new THREE.MeshStandardNodeMaterial({ map: labelTexture(), metalness: 0, roughness: 0.7 }));
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
    for (const f of layout.features) {
      if (f.kind === 'driver') {
        if (f.path.length >= 4) this.addWoofer(f);
        else this.addTweeter(f);
      } else if (f.kind === 'rod') this.addRod(f);
      else if (f.kind === 'port') this.addPort(f);
      else if (f.kind === 'room') this.addRoom(f);
    }
  }

  /** The woofer's back, built from the same numbers as the terrain (see the generator). */
  private addWoofer(f: Feature): void {
    const [coneTop, spiderTop, plateY, magnetTop, landingR] = f.path;
    const R = f.radius;
    const k = R / 33;
    const y0 = f.y;
    const g = new THREE.Group();
    const lathe = (profile: THREE.Vector2[], material: THREE.Material, segments = 72): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, segments), material);
      g.add(mesh);
      return mesh;
    };
    // basket ring (flat, its inner edge under the cone) and the four screw ears
    const ringTop = y0 + 2.4;
    lathe(roundedDisc(R + 0.15, y0 + 0.1, ringTop + 0.15, 0.6, 24 * k), this.basket);
    const C45 = Math.SQRT1_2;
    for (const [ex, ez] of [[C45, C45], [-C45, C45], [-C45, -C45], [C45, -C45]]) {
      const half = 3.4 * k + 0.4 + 0.15;
      // (square to the axes, like the terrain's ears under them)
      // (the full height of the terrain's ear, so none of its side shows)
      const ear = new THREE.Mesh(roundedBar(2 * half + 0.2, ringTop + 0.2 - y0, 2 * half + 0.2, 1), this.basket);
      ear.position.set(ex * (R - 1), (y0 + ringTop + 0.2) / 2, ez * (R - 1));
      g.add(ear);
    }
    // the basket frame: a band at the ring, four tapered ribs between the windows, a band under the magnet
    const lowY = ringTop - 0.5;
    const rLow = BASKET_LOW * k;
    const rHigh = BASKET_HIGH * k;
    const sAt = (y: number): number => (y - lowY) / (plateY - lowY);
    const sSill = sAt(ringTop + WINDOW_SILL);
    const sHead = sAt(plateY - WINDOW_HEAD);
    const full = (): number => Math.PI;
    g.add(new THREE.Mesh(shellPatch(rLow, lowY, rHigh, plateY, BASKET_THICK, 0, sSill, 0, full), this.basket));
    g.add(new THREE.Mesh(shellPatch(rLow, lowY, rHigh, plateY, BASKET_THICK, sHead, 1, 0, full), this.basket));
    // (the drawn ribs a little wider than the terrain's, so its cut edges stay inside them)
    const w = WINDOW_HALF * k - 0.5;
    const rib = (r: number): number => Math.PI / 4 - Math.asin(Math.min(1, w / r));
    for (let i = 0; i < 4; i++) g.add(new THREE.Mesh(shellPatch(rLow, lowY, rHigh, plateY, BASKET_THICK, sSill - 0.02, sHead + 0.02, (i * Math.PI) / 2, rib), this.basket));
    // a solid collar where the frame meets the magnet's bottom plate (closed underneath: seen from the gap)
    const headY = plateY - WINDOW_HEAD;
    const collarOut = rHigh + ((rLow - rHigh) * WINDOW_HEAD) / (plateY - lowY) + OUT + 0.2;
    lathe(roundedDisc(collarOut, headY - 0.4, plateY + 0.1, 0.15, rHigh - BASKET_THICK - OUT - 0.3, true), this.basket);
    // the cone: straight paper from the ring up to the neck, just outside the terrain's shell
    const coneAt = (y: number): number => 29 * k - (20 * k * (y - y0)) / (coneTop - y0);
    const cone: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const y = ringTop - 0.2 + ((coneTop - ringTop + 0.2) * i) / 8;
      cone.push(new THREE.Vector2(coneAt(y) + 0.15, y + 0.25));
    }
    lathe(cone, this.paper);
    // the spider: pale cloth with sharp regular pleats, its rim turned down
    const sp: THREE.Vector2[] = [];
    const rIn = 7 * k + 0.2;
    const rOut = 19 * k + 0.25;
    // seven soft corrugations of stiffened cloth (the terrain disc under it is flat)
    const pitch = (rOut - 0.5 - rIn) / 7;
    for (let i = 0; i <= 140; i++) {
      const r = rIn + ((rOut - 0.5 - rIn) * i) / 140;
      sp.push(new THREE.Vector2(r, spiderTop + 0.15 + 0.38 * (1 - Math.cos((2 * Math.PI * (r - rIn)) / pitch))));
    }
    // the rim: a thin turned-down edge, tapering in under the disc (the terrain stops at 17k)
    sp.push(new THREE.Vector2(rOut, spiderTop - 0.1), new THREE.Vector2(rOut - 0.3, spiderTop - 0.55), new THREE.Vector2(17 * k + 0.25, spiderTop - 2.4), new THREE.Vector2(rIn + 2, spiderTop - 2.45));
    lathe(sp.reverse(), this.damper, 96);
    // the spider landing: the ledge inside the frame the spider's rim is glued to
    if (landingR) lathe(roundedDisc(landingR + 0.2, spiderTop - 2.4, spiderTop - 0.05, 0.25, 18.5 * k - 0.3, true), this.basket);
    // the voice coil former (amber) between the spider and the magnet
    lathe(roundedDisc(7 * k + 0.15, spiderTop - 0.5, plateY + 0.1, 0.1), this.former, 40);
    // the magnet: zinc bottom plate (closed underneath: it overhangs the gap), ferrite ring with a paper
    // label, zinc top plate, the pole and its vent
    const fy0 = plateY + 2.5 * k;
    const fy1 = plateY + 10.5 * k;
    lathe(roundedDisc(22.5 * k + 0.15, plateY - 0.15, fy0 + 0.05, 0.5, 0, true), this.zinc);
    lathe(roundedDisc(21 * k + 0.15, fy0, fy1, 0.7), this.ferrite);
    lathe(roundedDisc(19.5 * k + 0.15, fy1 - 0.05, magnetTop + 0.15, 0.9, 0, true), this.zinc);
    lathe(roundedDisc(4.5 * k + 0.15, magnetTop, magnetTop + 1.15, 0.4), this.zinc, 40);
    const vent = new THREE.Mesh(new THREE.CircleGeometry(1.3 * k + 0.3, 24), this.hole);
    vent.rotation.x = -Math.PI / 2;
    vent.position.y = magnetTop + 1.17;
    g.add(vent);
    const lh = Math.min(5.5 * k, fy1 - fy0 - 1);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(21 * k + 0.2, 21 * k + 0.2, lh, 40, 1, true, Math.PI * 0.15, Math.PI * 0.55), this.label);
    label.position.y = (fy0 + fy1) / 2;
    g.add(label);
    g.position.set(f.x, 0, f.z);
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.push(g);
  }

  /** The tweeter's back: face plate, housing and the zinc cup. */
  private addTweeter(f: Feature): void {
    const tk = f.radius / 12;
    const y0 = f.y;
    const g = new THREE.Group();
    const plate = new THREE.Mesh(roundedSquare(24 * tk + 0.3, 2.2 + 0.3, 1.5), this.plastic);
    plate.position.y = y0 + 1.1;
    g.add(plate);
    g.add(new THREE.Mesh(new THREE.LatheGeometry(roundedDisc(9.5 * tk + 0.15, y0 + 2, y0 + 2.2 + 7 * tk + 0.12, 1), 56), this.plastic));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(roundedDisc(7 * tk + 0.15, y0 + 2.2 + 7 * tk - 0.1, y0 + 2.2 + 11 * tk + 0.15, 1.2), 56), this.zinc));
    g.position.set(f.x, 0, f.z);
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.push(g);
  }

  /** The bass port: a rounded lip around the slot, and a black throat down into the void. */
  private addPort(f: Feature): void {
    const [sx0, sz0, sx1, sz1, bottom] = f.path;
    const [bx0, , bz0, bx1, , bz1] = f.box;
    const top = f.y;
    const g = new THREE.Group();
    // the flared lip: a rounded ring around the slot (its edges rolled over into the hole)
    const lip = new THREE.Mesh(roundedRing(bx1 - bx0 + 0.3, bz1 - bz0 + 0.3, sx1 - sx0 - 0.2, sz1 - sz0 - 0.2, 1.4, 0.7), this.lip);
    lip.position.set((bx0 + bx1) / 2, top - 0.6, (bz0 + bz1) / 2);
    g.add(lip);
    const throat = new THREE.Mesh(new THREE.BoxGeometry(sx1 - sx0 - 0.2, top - 0.6 - bottom, sz1 - sz0 - 0.2), this.throat);
    throat.position.set((sx0 + sx1) / 2, (top - 0.6 + bottom) / 2, (sz0 + sz1) / 2);
    g.add(throat);
    g.traverse((o) => {
      o.castShadow = o !== throat;
      o.receiveShadow = o !== throat;
    });
    this.push(g);
  }

  /** The room's floor far below: a wide plane of dark floorboards, lit only by the key light. */
  private addRoom(f: Feature): void {
    const m = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, roughness: 0.8, metalness: 0 }));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), m);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(f.x, f.y, f.z);
    plane.receiveShadow = false;
    this.push(plane);
  }

  /** A straight round rod (the screwdriver's shaft, ferrule and handle), maybe with a blade or a fluted grip. */
  private addRod(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.path;
    const key = `${f.color}|${f.metal ?? 0}|${f.rough ?? 0.5}`;
    let m = this.rodMaterials.get(key);
    if (!m) {
      m = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: f.metal ?? 0, roughness: f.rough ?? 0.5 }));
      if (f.metal === 0) m.emissive = new THREE.Color(f.color).multiplyScalar(0.06); // a little light in the amber
      this.rodMaterials.set(key, m);
    }
    const a = new THREE.Vector3(x0, y0, z0);
    const b = new THREE.Vector3(x1, y1, z1);
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const g = new THREE.Group();
    if (f.facing === -1) {
      // a flat wedge blade from the generator's tip (3 before the rod's start) to the rod: as wide as the
      // shaft, thin at its straight edge, thick enough over the thin terrain tip inside it
      const len = 3.2;
      // (forged from the shaft: as thick as the shaft where they meet, thinning to the edge)
      const geo = new THREE.BoxGeometry(f.radius * 2 + 0.1, len, f.radius * 2 + 0.1, 1, 10, 1);
      const p = geo.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const u = (p.getY(i) + len / 2) / len; // 0 at the edge, 1 at the rod
        p.setZ(i, p.getZ(i) * (0.16 + 0.84 * Math.min(1, u * u * 1.6)));
      }
      geo.computeVertexNormals();
      const blade = new THREE.Mesh(geo, m);
      blade.position.copy(a).addScaledVector(dir, -len / 2 + 0.2);
      blade.quaternion.setFromUnitVectors(UP, dir);
      g.add(blade);
    }
    const rod = this.capsule(a, b, f.radius + 0.05, m, f.axis === 0 ? 80 : 32);
    if (f.axis === 0) flute(rod.geometry, f.radius + 0.05);
    g.add(rod);
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.push(g);
  }

  private capsule(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, radial = 32): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, radial), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    return mesh;
  }

  private push(object: THREE.Object3D): void {
    this.group.add(object);
    this.pieces.push(object);
  }
}

/** Ten flutes along a capsule's straight part (a screwdriver grip). */
function flute(g: THREE.BufferGeometry, radius: number): void {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    if (r < radius * 0.98) continue; // (the round ends stay round)
    const s = 1 - 0.13 * Math.pow(0.5 + 0.5 * Math.cos(10 * Math.atan2(z, x)), 3);
    p.setX(i, x * s);
    p.setZ(i, z * s);
  }
  g.computeVertexNormals();
}

/**
 * A flat rectangular ring (outer w × d, a hole of hw × hd in the middle) with rounded corners and edges
 * rolled over by `roll`: a flared port lip. Lying flat, its base at y = 0.
 */
function roundedRing(w: number, d: number, hw: number, hd: number, h: number, roll: number): THREE.BufferGeometry {
  const rect = (path: THREE.Path, rw: number, rd: number, c: number): void => {
    const x = rw / 2;
    const z = rd / 2;
    path.moveTo(-x + c, -z);
    path.lineTo(x - c, -z);
    path.quadraticCurveTo(x, -z, x, -z + c);
    path.lineTo(x, z - c);
    path.quadraticCurveTo(x, z, x - c, z);
    path.lineTo(-x + c, z);
    path.quadraticCurveTo(-x, z, -x, z - c);
    path.lineTo(-x, -z + c);
    path.quadraticCurveTo(-x, -z, -x + c, -z);
  };
  const s = new THREE.Shape();
  rect(s, w - 2 * roll, d - 2 * roll, 1);
  const hole = new THREE.Path();
  rect(hole, hw + 2 * roll, hd + 2 * roll, Math.min(1, hd / 2));
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.05, h - 2 * roll), bevelEnabled: true, bevelThickness: roll, bevelSize: roll, bevelSegments: 5, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, roll, 0);
  return g;
}

/** A flat square plate with rounded corners and edges, lying flat, centred on its middle. */
function roundedSquare(size: number, height: number, corner: number): THREE.BufferGeometry {
  return roundedBar(size, height, size, corner);
}

/** A flat bar `w` × `h` × `d` with rounded corners (in plan) and bevelled edges, centred on its middle. */
function roundedBar(w: number, h: number, d: number, corner: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const c = Math.max(0.05, Math.min(corner, hw - 0.05, hd - 0.05));
  const s = new THREE.Shape();
  s.moveTo(-hw + c, -hd);
  s.lineTo(hw - c, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + c);
  s.lineTo(hw, hd - c);
  s.quadraticCurveTo(hw, hd, hw - c, hd);
  s.lineTo(-hw + c, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - c);
  s.lineTo(-hw, -hd + c);
  s.quadraticCurveTo(-hw, -hd, -hw + c, -hd);
  const bevel = Math.min(0.5, h / 3, c);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2 + bevel, 0);
  return g;
}

/** The paper label on the magnet: a plain part label (no brand), with a printed barcode. */
function labelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#e9e6de';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#26241f';
    g.font = 'bold 34px sans-serif';
    g.fillText('4 OHM WOOFER', 28, 50);
    g.font = '26px sans-serif';
    g.fillText('P/N WF-5010   2131', 28, 96);
    // a barcode: bars of a fixed pseudo-random pattern
    let x = 372;
    for (let i = 0; x < 490; i++) {
      const bw = 2 + ((i * 7) % 5);
      if (i % 2 === 0) g.fillRect(x, 30, bw, 70);
      x += bw;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
