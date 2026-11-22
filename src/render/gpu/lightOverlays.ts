import * as THREE from 'three/webgpu';
import { abs, cameraPosition, color, cos, dot, float, normalize, normalWorld, positionLocal, positionWorld, pow } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import type { Craters } from './craters';
import { Glow, hueColor } from './glow';

/** Brightness of the light rings and bars (HDR, before bloom and tone mapping). */
const OVERLAY_GLOW = 0.95;
/** The RAM light bars are the brightest lights (the hero of their view). */
const BAR_GLOW = 1.1;
/** Tube radius of the smooth rings, and how far they sit in front of the terrain diffuser. */
const RING_TUBE = 1.1;
const RING_OUT = 0.5;

/** Reads the terrain (render only, e.g. an LED goes dark when its base is gone). */
export interface SolidField {
  sample(x: number, y: number, z: number): number;
}

/**
 * Smooth light rings (fans, pump) and light bars (RAM), render-only, laid over the terrain's RGB
 * diffusers. At one sample per unit a thin ring of terrain is ragged; the overlay gives it a clean
 * shape and a clean glow, while the terrain under it stays the destructible part: the overlays are cut
 * by the craters (`Craters`) exactly like the terrain. All share the RGB hue.
 */
export class LightOverlays {
  private readonly items: THREE.Mesh[] = [];
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly barMaterial: THREE.MeshStandardNodeMaterial;
  constructor(
    private readonly scene: THREE.Scene,
    glow: Glow,
    craters: Craters,
  ) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0 });
    m.colorNode = color(0x050505);
    // a hot core where the tube faces the camera, dimmer towards its silhouette: reads as a light tube
    const facing = abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))));
    const core = pow(facing, 2).mul(0.6).add(0.7);
    m.emissiveNode = hueColor(glow.hue).mul(float(OVERLAY_GLOW)).mul(glow.boost).mul(core);
    this.material = m;
    // light bars: the brightest RGB in the case, with a row of LEDs showing through the diffuser
    const b = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0 });
    b.colorNode = color(0x050505);
    b.emissiveNode = hueColor(glow.hue).mul(float(BAR_GLOW).mul(cos(positionLocal.z.mul(1.6)).mul(0.22).add(0.88))).mul(glow.boost).mul(core);
    this.barMaterial = b;
    craters.cut(m);
    craters.cut(b);
  }

  setLayout(layout: SceneLayout): void {
    for (const o of this.items) {
      this.scene.remove(o);
      o.geometry.dispose();
    }
    this.items.length = 0;
    for (const f of layout.features) {
      if (f.kind === 'fan') this.add(this.ring(f, f.radius + 0.3, f.axis, f.facing * RING_OUT + f.facing * 2));
      else if (f.kind === 'pump') this.add(this.ring(f, f.radius, 1, RING_OUT));
      else if (f.kind === 'lightBar') this.addBar(f);
    }
  }

  private ring(f: Feature, radius: number, axis: number, out: number): THREE.Mesh {
    const g = new THREE.TorusGeometry(radius, RING_TUBE, 14, 72);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(f.x, f.y, f.z);
    // the torus lies in the xy plane (axis z); turn it to the feature's axis and push it out front
    if (axis === 0) {
      mesh.rotation.y = Math.PI / 2;
      mesh.position.x += out;
    } else if (axis === 1) {
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y += out;
    } else {
      mesh.position.z += out;
    }
    return mesh;
  }

  private add(mesh: THREE.Mesh): void {
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.items.push(mesh);
  }

  private addBar(f: Feature): void {
    const [x0, , z0, x1, y1, z1] = f.box;
    const h = 1.3;
    const g = new RoundedBoxGeometry(x1 - x0 + 0.1, h, z1 - z0 - 0.4, 3, 0.5);
    const mesh = new THREE.Mesh(g, this.barMaterial);
    mesh.position.set((x0 + x1) / 2, y1 - h / 2 + 0.2, (z0 + z1) / 2);
    this.scene.add(mesh);
    this.items.push(mesh);
  }
}
