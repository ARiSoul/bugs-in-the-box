import * as THREE from 'three/webgpu';
import { abs, atan, cameraPosition, color, cos, dot, float, mix, normalize, normalWorld, positionLocal, positionWorld, pow, smoothstep, uniform } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { arcPoint, type Vec3 } from '../../terrain/generators/parts';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import { Glow, hueColor } from './glow';
import type { SolidField } from './lightOverlays';

/** Pieces each tube is split into: a blown-away stretch hides only its own piece. */
const TUBE_PIECES = 10;
/** Radians per second of the light stripe on the fan blades. */
const FAN_SPIN = 2.4;

interface Piece {
  object: THREE.Object3D;
  /** Points inside the terrain part under the piece (x, y, z triples). */
  probes: number[];
}

/**
 * Smooth stand-ins for the hero parts (render-only): the cooler tubes, the fan rotors and the pump cap.
 * At one sample per unit these parts come out of the mesher lumpy; the stand-ins sit a little outside
 * the terrain surface and hide it. The terrain stays the real, destructible part: each piece checks the
 * terrain under it every few frames and hides when that is gone, so craters still show.
 * The rotors carry the turning light stripe that suggests the spin (the blades never move).
 */
export class HeroOverlays {
  private readonly pieces: Piece[] = [];
  private readonly rubber = new THREE.MeshStandardNodeMaterial({ color: 0x0c0c0e, roughness: 0.62, metalness: 0 });
  private readonly rotor: THREE.MeshStandardNodeMaterial;
  private readonly cap = new THREE.MeshStandardNodeMaterial({ color: 0x3a3e45, roughness: 0.35, metalness: 0.8 });
  private readonly sleeve = new THREE.MeshStandardNodeMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0 });
  private readonly capTop = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a8, roughness: 0.42, metalness: 0.8 });
  private readonly hole = new THREE.MeshBasicNodeMaterial({ color: 0x020203 });
  private readonly fitting = new THREE.MeshStandardNodeMaterial({ color: 0x2a2c31, roughness: 0.3, metalness: 0.7 });
  private readonly gold = new THREE.MeshStandardNodeMaterial({ color: 0xd9a441, roughness: 0.38, metalness: 1 });
  private readonly beadGeometry = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly connector = new THREE.MeshStandardNodeMaterial({ color: 0x1b1c20, roughness: 0.55, metalness: 0 });
  private readonly tuftGeometry = new THREE.IcosahedronGeometry(1, 3);
  private readonly fluff = (() => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
    const v = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1).sub(abs(dot(normalWorld, v))), 2.2);
    m.colorNode = mix(color(0x3e3f42), color(0x8a8c90), rim);
    return m;
  })();
  private readonly copper = new THREE.MeshStandardNodeMaterial({ color: 0xb06c38, roughness: 0.55, metalness: 0.9 });
  private readonly ramBody = new THREE.MeshStandardNodeMaterial({ color: 0x24262c, roughness: 0.4, metalness: 0.6 });
  private readonly group = new THREE.Group();
  private field: SolidField | null = null;
  private frame = 0;
  private readonly spin = uniform(0);

  constructor(scene: THREE.Scene, glow: Glow) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.1 });
    m.colorNode = color(0x5c626e);
    // a narrow bright arc that turns around the rotor's local z axis, brighter towards the tips
    const p = positionLocal;
    const ang = atan(p.y, p.x).sub(this.spin);
    const r = p.x.mul(p.x).add(p.y.mul(p.y)).sqrt();
    m.emissiveNode = hueColor(glow.hue).mul(pow(cos(ang).mul(0.5).add(0.5), 24).mul(smoothstep(1.5, 6, r)).mul(float(0.8)));
    this.rotor = m;
    scene.add(this.group);
  }

  setLayout(layout: SceneLayout, field: SolidField | null): void {
    this.field = field;
    for (const p of this.pieces) {
      this.group.remove(p.object);
      p.object.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry !== this.beadGeometry && o.geometry !== this.tuftGeometry) o.geometry.dispose();
      });
    }
    this.pieces.length = 0;
    for (const f of layout.features) {
      if (f.kind === 'tube') this.addTube(f);
      else if (f.kind === 'fan') this.addRotor(f);
      else if (f.kind === 'pump') this.addCap(f);
      else if (f.kind === 'capacitor') this.addCapacitor(f);
      else if (f.kind === 'grommet') this.addGrommet(f);
      else if (f.kind === 'pad') this.addPad(f);
      else if (f.kind === 'connector') this.addConnector(f);
      else if (f.kind === 'dust') this.addDust(f);
      else if (f.kind === 'trace') this.addTrace(f);
      else if (f.kind === 'ramBody') this.addBlock(f.box, this.ramBody, 0.6);
      else if (f.kind === 'part') this.addPart(f);
    }
  }

  private addTube(f: Feature): void {
    const [ax, ay, az, bx, by, bz, lift, radius] = f.path;
    const a: Vec3 = [ax, ay, az];
    const b: Vec3 = [bx, by, bz];
    const q: Vec3 = [0, 0, 0];
    const points: THREE.Vector3[] = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      arcPoint(a, b, lift, i / N, q);
      points.push(new THREE.Vector3(q[0], q[1], q[2]));
    }
    const per = N / TUBE_PIECES;
    for (let k = 0; k < TUBE_PIECES; k++) {
      const curve = new THREE.CatmullRomCurve3(points.slice(Math.max(0, k * per - 1), Math.min(N, (k + 1) * per + 1) + 1));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, radius + 0.3, 20, false), this.sleeveFor(f.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mid = points[Math.round((k + 0.5) * per)];
      this.push(mesh, [mid.x, mid.y, mid.z]);
    }
    if (f.color !== 0xffffff) return; // a cable: no fitting
    // a barbed fitting where the tube meets the radiator tank
    const fit = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.7, radius + 1.1, 2.6, 28), this.fitting);
    fit.position.set(bx, by + 0.9, bz);
    fit.castShadow = true;
    this.push(fit, [bx, by - 1, bz]);
  }

  private addRotor(f: Feature): void {
    const reach = f.radius - 0.8;
    const hub = reach * 0.32;
    const g = new THREE.Group();
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(hub + 0.4, hub + 0.4, 3.4, 32), this.rotor);
    hubMesh.rotation.x = Math.PI / 2; // cylinder along the group's local z
    g.add(hubMesh);
    const len = reach - hub;
    const w = Math.max(2.2, reach * 0.4) + 0.6;
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new RoundedBoxGeometry(len + 0.5, w, 2.8, 2, 0.6), this.rotor);
      const a = (i / 6) * Math.PI * 2;
      blade.position.set(Math.cos(a) * (hub + len / 2), Math.sin(a) * (hub + len / 2), 0);
      blade.rotation.z = a;
      g.add(blade);
    }
    g.position.set(f.x, f.y, f.z);
    if (f.axis === 0) g.rotation.y = Math.PI / 2;
    else if (f.axis === 1) g.rotation.x = Math.PI / 2;
    g.traverse((o) => (o.castShadow = true));
    this.push(g, [f.x, f.y, f.z]);
  }

  private addCap(f: Feature): void {
    const r = f.radius - 2.8 + 0.3;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.6, 40), this.cap);
    mesh.position.set(f.x, f.y + 0.6, f.z);
    mesh.castShadow = true;
    this.push(mesh, [f.x, f.y, f.z]);
  }

  private readonly sleeves = new Map<number, THREE.MeshStandardNodeMaterial>();
  private sleeveFor(c: number): THREE.MeshStandardNodeMaterial {
    if (c === 0xffffff) return this.rubber;
    let m = this.sleeves.get(c);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.7, metalness: 0 });
      this.sleeves.set(c, m);
    }
    return m;
  }

  private readonly partMaterials = new Map<string, THREE.MeshStandardNodeMaterial>();

  /** A small detail (ports, slots, shields, drives...): a clean box or cylinder over its terrain block. */
  private addPart(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const key = `${f.color}|${f.metal ?? 0}|${f.rough ?? 0.5}|${f.glow ?? 0}`;
    let m = this.partMaterials.get(key);
    if (!m) {
      m = new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: f.metal ?? 0, roughness: f.rough ?? 0.5 });
      if (f.glow) m.emissive = new THREE.Color(f.color).multiplyScalar(f.glow);
      this.partMaterials.set(key, m);
    }
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    let g: THREE.BufferGeometry;
    const shape = f.shape ?? 'box';
    if (shape === 'box') {
      g = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.35, Math.min(w, h, d) * 0.3));
    } else {
      const along = shape === 'cylX' ? w : shape === 'cylY' ? h : d;
      const r = (shape === 'cylX' ? Math.min(h, d) : shape === 'cylY' ? Math.min(w, d) : Math.min(w, h)) / 2;
      g = new THREE.CylinderGeometry(r, r, along, 24);
      if (shape === 'cylX') g.rotateZ(Math.PI / 2);
      else if (shape === 'cylZ') g.rotateX(Math.PI / 2);
    }
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.push(mesh, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  }

  /** A copper trace, cut into short pieces (each hides on its own when blown away). */
  private addTrace(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.ceil(len / 7));
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const b = (i + 1) / n;
      const box: [number, number, number, number, number, number] = alongX
        ? [x0 + (x1 - x0) * a, y0, z0, x0 + (x1 - x0) * b, y1, z1]
        : [x0, y0, z0 + (z1 - z0) * a, x1, y1, z0 + (z1 - z0) * b];
      this.addBlock(box, this.copper, 0.5, 1.2);
    }
  }

  /** A clean rounded block over a terrain box (`grow` outward so the lumpy surface stays hidden). */
  private addBlock(box: number[], material: THREE.Material, round: number, overlap = 0): void {
    const [x0, y0, z0, x1, y1, z1] = box;
    const grow = 0.2;
    // `overlap` lengthens only the long side (pieces of one trace run into each other: no seams)
    const ox = x1 - x0 >= z1 - z0 ? overlap : 0;
    const oz = x1 - x0 >= z1 - z0 ? 0 : overlap;
    const g = new RoundedBoxGeometry(x1 - x0 + 2 * grow + ox, y1 - y0 + 2 * grow, z1 - z0 + 2 * grow + oz, 2, round);
    const m = new THREE.Mesh(g, material);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    this.push(m, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  }

  /** A dust bunny: a few soft, flattened tufts with a velvet sheen at their rims (reads as fluff). */
  private addDust(f: Feature): void {
    const g = new THREE.Group();
    const tufts: [number, number, number, number][] = [
      [0, 0.35, 0, 1],
      [0.75, 0.25, 0.45, 0.72],
      [-0.6, 0.22, -0.5, 0.65],
      [0.15, 0.55, -0.35, 0.55],
    ];
    for (const [dx, dy, dz, k] of tufts) {
      const t = new THREE.Mesh(this.tuftGeometry, this.fluff);
      t.scale.set(f.radius * k * 1.4, f.radius * k * 0.75, f.radius * k * 1.4);
      t.position.set(f.x + dx * f.radius, f.y + dy * f.radius, f.z + dz * f.radius);
      g.add(t);
    }
    this.push(g, [f.x, f.y + 0.2, f.z]);
  }

  /** A clean connector block with a darker plug face. */
  private addConnector(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const m = new THREE.Mesh(new RoundedBoxGeometry(x1 - x0 + 0.4, y1 - y0 + 0.2, z1 - z0 + 0.4, 3, 0.5), this.connector);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.1, (z0 + z1) / 2);
    m.castShadow = true;
    this.push(m, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  }

  /** A smooth domed solder bead. */
  private addPad(f: Feature): void {
    const bead = new THREE.Mesh(this.beadGeometry, this.gold);
    bead.scale.set(f.radius + 0.3, 1.9, f.radius + 0.3);
    bead.position.set(f.x, f.y, f.z);
    bead.castShadow = true;
    this.push(bead, [f.x, f.y + 0.6, f.z]);
  }

  /** A clean rubber grommet: a round lip and a dark opening. */
  private addGrommet(f: Feature): void {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(f.radius, 1.45, 16, 48), this.rubber);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(f.x, f.y + 0.15, f.z);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(f.radius - 0.6, 40), this.hole);
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(f.x, f.y - 0.6, f.z);
    const g = new THREE.Group();
    g.add(ring, hole);
    ring.castShadow = true;
    this.push(g, [f.x + f.radius, f.y, f.z]);
  }

  /** A clean capacitor: sleeve with a rounded shoulder and a scored aluminium top. */
  private addCapacitor(f: Feature): void {
    const r = f.radius + 0.25;
    const h = f.box[4] - f.y + 0.2;
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h - 0.6, 32), this.sleeve);
    sleeve.position.set(f.x, f.y + (h - 0.6) / 2, f.z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.35, r, 0.6, 32), this.capTop);
    top.position.set(f.x, f.y + h - 0.3, f.z);
    const g = new THREE.Group();
    g.add(sleeve, top);
    // small round tops catch the blind stripes as flickering patches in motion: no received shadow
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = false;
    });
    this.push(g, [f.x, f.y + h * 0.5, f.z]);
  }

  private push(object: THREE.Object3D, probes: number[]): void {
    this.group.add(object);
    this.pieces.push({ object, probes });
  }

  update(seconds: number): void {
    this.spin.value = seconds * FAN_SPIN;
    const field = this.field;
    if (!field || this.pieces.length === 0) return;
    // a few pieces per frame
    for (let n = 0; n < 4; n++) {
      const p = this.pieces[this.frame++ % this.pieces.length];
      p.object.visible = field.sample(p.probes[0], p.probes[1], p.probes[2]) < 0.6;
    }
  }
}
