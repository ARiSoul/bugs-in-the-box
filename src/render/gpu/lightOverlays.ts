import * as THREE from 'three/webgpu';
import { color, cos, float, positionLocal } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import { Glow, hueColor } from './glow';

/** Brightness of the light rings and bars (HDR, before bloom and tone mapping). */
const OVERLAY_GLOW = 1.15;
/** The RAM light bars are the brightest lights (the hero of their view). */
const BAR_GLOW = 1.9;
/** Tube radius of the smooth rings, and how far they sit in front of the terrain diffuser. */
const RING_TUBE = 1.4;
const RING_OUT = 0.5;

/** Reads the terrain: an overlay goes dark when its diffuser has been blown away. */
export interface SolidField {
  sample(x: number, y: number, z: number): number;
}

interface Overlay {
  mesh: THREE.Mesh;
  /** Points inside the terrain diffuser under the overlay (x, y, z triples). */
  probes: number[];
}

/**
 * Smooth light rings (fans, pump) and light bars (RAM), render-only, laid over the terrain's RGB
 * diffusers. At one sample per unit a thin ring of terrain is ragged; the overlay gives it a clean
 * shape and a clean glow, while the terrain under it stays the destructible part: every few frames
 * each overlay checks its diffuser and hides when most of it is gone. All share the RGB hue.
 */
export class LightOverlays {
  private readonly items: Overlay[] = [];
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly barMaterial: THREE.MeshStandardNodeMaterial;
  private field: SolidField | null = null;
  private frame = 0;

  constructor(
    private readonly scene: THREE.Scene,
    glow: Glow,
  ) {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0 });
    m.colorNode = color(0x050505);
    m.emissiveNode = hueColor(glow.hue).mul(float(OVERLAY_GLOW));
    this.material = m;
    // light bars: the brightest RGB in the case, with a row of LEDs showing through the diffuser
    const b = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0 });
    b.colorNode = color(0x050505);
    b.emissiveNode = hueColor(glow.hue).mul(float(BAR_GLOW).mul(cos(positionLocal.z.mul(1.6)).mul(0.22).add(0.88)));
    this.barMaterial = b;
  }

  setLayout(layout: SceneLayout, field: SolidField | null): void {
    this.field = field;
    for (const o of this.items) {
      this.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
    }
    this.items.length = 0;
    for (const f of layout.features) {
      if (f.kind === 'fan') this.add(this.ring(f, f.radius + 0.3, f.axis, f.facing * RING_OUT + f.facing * 2), f, f.radius + 0.3, f.facing * 2);
      else if (f.kind === 'pump') this.add(this.ring(f, f.radius, 1, RING_OUT), f, f.radius, 0);
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

  /** `axisOffset`: where the diffuser ring is along the axis, relative to the feature centre. */
  private add(mesh: THREE.Mesh, f: Feature, radius: number, axisOffset: number): void {
    const probes: number[] = [];
    for (const [c, s] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      if (f.axis === 0) probes.push(f.x + axisOffset, f.y + c * radius, f.z + s * radius);
      else if (f.axis === 1) probes.push(f.x + c * radius, f.y, f.z + s * radius);
      else probes.push(f.x + c * radius, f.y + s * radius, f.z + axisOffset);
    }
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.items.push({ mesh, probes });
  }

  private addBar(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const h = 1.3;
    const g = new RoundedBoxGeometry(x1 - x0 + 0.1, h, z1 - z0 - 0.4, 3, 0.5);
    const mesh = new THREE.Mesh(g, this.barMaterial);
    mesh.position.set((x0 + x1) / 2, y1 - h / 2 + 0.2, (z0 + z1) / 2);
    const probes: number[] = [];
    for (const u of [0.15, 0.5, 0.85]) probes.push((x0 + x1) / 2, (y0 + y1) / 2, z0 + (z1 - z0) * u);
    this.scene.add(mesh);
    this.items.push({ mesh, probes });
  }

  /** Hide overlays whose diffuser is mostly gone (checked a few overlays per frame). */
  update(): void {
    const field = this.field;
    if (!field || this.items.length === 0) return;
    const o = this.items[this.frame++ % this.items.length];
    let solid = 0;
    const n = o.probes.length / 3;
    for (let i = 0; i < o.probes.length; i += 3) if (field.sample(o.probes[i], o.probes[i + 1], o.probes[i + 2]) < 0.5) solid++;
    o.mesh.visible = solid * 2 > n;
  }
}
