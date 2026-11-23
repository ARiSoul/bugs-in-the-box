import * as THREE from 'three/webgpu';
import { color, uniform } from 'three/tsl';
import type { Craters } from './craters';
import type { SceneLayout } from '../../terrain/generators/types';

/** Most activity LEDs shown. */
const MAX_LEDS = 12;

/**
 * Small activity LEDs (amber or green) that blink like disk and network activity: render-only lights on
 * the bases the generator placed. Each LED's on/off pattern is a fixed function of time, so it is the
 * same on every run. An LED whose base was blown away goes (see `DrawnGround.dropLoose`).
 */
export class ActivityLeds {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly levels: { value: number }[] = [];
  private readonly colors: { value: THREE.Color }[] = [];
  /** LEDs that stay on (power) instead of blinking (feature `glow` 1). */
  private readonly steady: boolean[] = [];
  private active = 0;

  constructor(scene: THREE.Scene, craters: Craters) {
    const g = new THREE.SphereGeometry(0.75, 12, 8);
    for (let i = 0; i < MAX_LEDS; i++) {
      const level = uniform(0);
      const tint = uniform(new THREE.Color(0xffa21a));
      const m = craters.cut(new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0 }));
      m.colorNode = color(0x111111);
      m.emissiveNode = tint.mul(level).mul(9);
      const mesh = new THREE.Mesh(g, m);
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.levels.push(level);
      this.colors.push(tint);
    }
  }

  setLayout(layout: SceneLayout): void {
    this.active = 0;
    for (const f of layout.features) {
      if (f.kind !== 'led' || this.active >= MAX_LEDS) continue;
      const mesh = this.meshes[this.active];
      mesh.position.set(f.x, f.y, f.z);
      mesh.visible = true;
      this.colors[this.active].value.setHex(f.color).convertSRGBToLinear();
      this.steady[this.active] = f.glow === 1;
      this.active++;
    }
    for (let i = this.active; i < MAX_LEDS; i++) this.meshes[i].visible = false;
  }

  /** Blink: bursts of short flashes with pauses, a different rhythm per LED. */
  update(seconds: number): void {
    for (let i = 0; i < this.active; i++) {
      const t = seconds * (1.3 + i * 0.37) + i * 2.1;
      const burst = Math.sin(t * 0.9) > 0.15 ? 1 : 0;
      const flick = Math.sin(t * 23.0 + Math.sin(t * 3.1) * 4) > 0 ? 1 : 0.15;
      this.levels[i].value = this.steady[i] ? 0.8 : i === 1 ? 0.55 + 0.45 * burst : burst * flick + 0.04;
    }
  }
}
