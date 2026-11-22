import * as THREE from 'three/webgpu';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import type { Craters } from './craters';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A lathe profile for a disc or a short cylinder from `y0` to `y1` of `radius` with rounded edges of
 * `bevel`: the top face, the rounded rims and the side (the bottom is hidden on what it stands on).
 */
function roundedDisc(radius: number, y0: number, y1: number, bevel: number, inner = 0): THREE.Vector2[] {
  const p: THREE.Vector2[] = [];
  const b = Math.min(bevel, (y1 - y0) / 2, radius - inner);
  p.push(new THREE.Vector2(inner, y1));
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    p.push(new THREE.Vector2(radius - b + Math.sin(a) * b, y1 - b + Math.cos(a) * b));
  }
  p.push(new THREE.Vector2(radius, y0));
  // (a lathe's faces point outward when the profile runs up the outside and in over the top)
  return p.reverse();
}

/**
 * Smooth stand-ins for the Studio Monitor's round parts (render only): the woofer's back (basket ring and
 * arms, the paper cone, the corrugated spider, the magnet stack with its label), the tweeter, and the
 * screwdriver. Like the other stand-ins they sit just outside the terrain and hide its steps; the terrain
 * under them stays the destructible part, and the craters cut them exactly like the terrain.
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
  private readonly hole: THREE.MeshBasicNodeMaterial;
  private readonly label: THREE.MeshStandardNodeMaterial;
  private readonly rodMaterials = new Map<string, THREE.MeshStandardNodeMaterial>();

  constructor(
    scene: THREE.Scene,
    private readonly craters: Craters,
  ) {
    const m = (color: number, metalness: number, roughness: number): THREE.MeshStandardNodeMaterial =>
      craters.cut(new THREE.MeshStandardNodeMaterial({ color, metalness, roughness }));
    this.basket = m(0x17181b, 0.55, 0.45);
    this.paper = m(0x24211e, 0, 0.92);
    this.damper = m(0xb58a2e, 0, 0.72);
    this.zinc = m(0xaab1b8, 1, 0.36);
    this.ferrite = m(0x2b2b2d, 0, 0.82);
    this.former = m(0x3a2a1c, 0.2, 0.6);
    this.plastic = m(0x141416, 0, 0.55);
    this.hole = craters.cut(new THREE.MeshBasicNodeMaterial({ color: 0x030303 }));
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
        if (f.path.length === 4) this.addWoofer(f);
        else this.addTweeter(f);
      } else if (f.kind === 'rod') this.addRod(f);
    }
  }

  /** The woofer's back, built from the same numbers as the terrain (see the generator). */
  private addWoofer(f: Feature): void {
    const [coneTop, spiderTop, plateY, magnetTop] = f.path;
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
    const ringTop = y0 + 2.6 + 0.15;
    lathe(roundedDisc(R + 0.15, y0 + 0.1, ringTop, 0.6, 24 * k), this.basket);
    const C45 = Math.SQRT1_2;
    for (const [ex, ez] of [[C45, C45], [-C45, C45], [-C45, -C45], [C45, -C45]]) {
      const half = 3.4 * k + 0.6 + 0.15;
      const ear = new THREE.Mesh(new THREE.BoxGeometry(2 * half, 0.4, 2 * half), this.basket);
      ear.position.set(ex * (R - 1), ringTop - 0.2, ez * (R - 1));
      ear.rotation.y = Math.PI / 4;
      g.add(ear);
    }
    // the cone: straight paper from the ring up to the neck, just outside the terrain's shell
    const coneAt = (y: number): number => 29 * k - (20 * k * (y - y0)) / (coneTop - y0);
    const cone: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const y = ringTop - 0.3 + ((coneTop - ringTop + 0.3) * i) / 8;
      cone.push(new THREE.Vector2(coneAt(y) + 0.15, y + 0.22));
    }
    lathe(cone, this.paper);
    // the spider: a golden disc with three corrugations, its rim turned down
    const sp: THREE.Vector2[] = [];
    const rIn = 7 * k + 0.2;
    const rOut = 19 * k + 0.25;
    for (let i = 0; i <= 48; i++) {
      const r = rIn + ((rOut - 0.5 - rIn) * i) / 48;
      sp.push(new THREE.Vector2(r, spiderTop + 0.2 + 0.45 * (1 + Math.cos((2 * Math.PI * (r - 11 * k)) / (3.5 * k)))));
    }
    sp.push(new THREE.Vector2(rOut, spiderTop - 0.3), new THREE.Vector2(rOut, spiderTop - 2.45), new THREE.Vector2(rIn + 2, spiderTop - 2.45));
    lathe(sp.reverse(), this.damper, 96);
    // the voice coil former between the spider and the magnet
    lathe(roundedDisc(7 * k + 0.2, spiderTop - 0.5, plateY + 0.1, 0.1), this.former, 40);
    // the magnet: zinc bottom plate, ferrite ring with a paper label, zinc top plate, the pole and its vent
    const fy0 = plateY + 2.5 * k;
    const fy1 = plateY + 10.5 * k;
    lathe(roundedDisc(22.5 * k + 0.2, plateY - 0.15, fy0 + 0.05, 0.5), this.zinc);
    lathe(roundedDisc(21 * k + 0.2, fy0, fy1, 0.7), this.ferrite);
    lathe(roundedDisc(19.5 * k + 0.2, fy1 - 0.05, magnetTop + 0.15, 0.9), this.zinc);
    lathe(roundedDisc(4.5 * k + 0.15, magnetTop, magnetTop + 1.15, 0.4), this.zinc, 40);
    const vent = new THREE.Mesh(new THREE.CircleGeometry(1.3 * k + 0.3, 24), this.hole);
    vent.rotation.x = -Math.PI / 2;
    vent.position.y = magnetTop + 1.17;
    g.add(vent);
    const lh = Math.min(5.5 * k, fy1 - fy0 - 1);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(21 * k + 0.28, 21 * k + 0.28, lh, 40, 1, true, Math.PI * 0.15, Math.PI * 0.55), this.label);
    label.position.y = (fy0 + fy1) / 2;
    g.add(label);
    // the four arms, from the ring up to the bottom plate
    for (const [ex, ez] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const a = new THREE.Vector3(ex * (R - 3 * k), y0 + 2.4, ez * (R - 3 * k));
      const b = new THREE.Vector3(ex * 22.5 * k, plateY, ez * 22.5 * k);
      g.add(this.capsule(a, b, Math.max(1.4, 1.8 * k) + 0.2, this.basket));
    }
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
    const plate = new THREE.Mesh(new RoundedSquare(24 * tk + 0.4, 2.2 + 0.3, 1.5).geometry, this.plastic);
    plate.position.y = y0 + 1.1;
    g.add(plate);
    g.add(new THREE.Mesh(new THREE.LatheGeometry(roundedDisc(9.5 * tk + 0.2, y0 + 2, y0 + 2.2 + 7 * tk + 0.12, 1), 56), this.plastic));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(roundedDisc(7 * tk + 0.2, y0 + 2.2 + 7 * tk - 0.1, y0 + 2.2 + 11 * tk + 0.15, 1.2), 56), this.zinc));
    g.position.set(f.x, 0, f.z);
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.push(g);
  }

  /** A straight round rod (the screwdriver's shaft, ferrule and handle). */
  private addRod(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.path;
    const key = `${f.color}|${f.metal ?? 0}|${f.rough ?? 0.5}`;
    let m = this.rodMaterials.get(key);
    if (!m) {
      m = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: f.metal ?? 0, roughness: f.rough ?? 0.5 }));
      this.rodMaterials.set(key, m);
    }
    const mesh = this.capsule(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1), f.radius + 0.05, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.push(mesh);
  }

  private capsule(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 24), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    return mesh;
  }

  private push(object: THREE.Object3D): void {
    this.group.add(object);
    this.pieces.push(object);
  }
}

/** A flat square plate with rounded corners and edges (an extruded rounded square, lying flat). */
class RoundedSquare {
  readonly geometry: THREE.BufferGeometry;
  constructor(size: number, height: number, corner: number) {
    const h = size / 2;
    const c = Math.min(corner, h - 0.1);
    const s = new THREE.Shape();
    s.moveTo(-h + c, -h);
    s.lineTo(h - c, -h);
    s.quadraticCurveTo(h, -h, h, -h + c);
    s.lineTo(h, h - c);
    s.quadraticCurveTo(h, h, h - c, h);
    s.lineTo(-h + c, h);
    s.quadraticCurveTo(-h, h, -h, h - c);
    s.lineTo(-h, -h + c);
    s.quadraticCurveTo(-h, -h, -h + c, -h);
    const bevel = Math.min(0.5, height / 3);
    const g = new THREE.ExtrudeGeometry(s, { depth: height - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -height / 2 + bevel, 0);
    this.geometry = g;
  }
}

/** The paper label on the magnet: a plain part label (no brand). */
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
    g.fillRect(400, 24, 84, 84);
    g.fillStyle = '#e9e6de';
    g.fillRect(410, 34, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
