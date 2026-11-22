import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  exp,
  float,
  fog,
  length,
  max,
  min,
  mix,
  mrt,
  mx_fractal_noise_float,
  normalize,
  positionView,
  positionWorld,
  pow,
  reflect,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { SceneLayout } from '../../terrain/generators/types';
import { Glow, MAX_LIGHTS, hueColor } from './glow';

/**
 * The air of an enclosed scenario on the WebGPU path: exponential distance fog (clear near the camera,
 * the scenario's fog colour far away), a thin denser layer that hugs the floor and takes the colour of
 * the nearest RGB lights, and corners that fall to near-black so the lit centre reads first. Plus the
 * dark-room backdrop and the render-only glass panel.
 */
/**
 * Layer of the meshes that only draw inside the post pipeline's MRT scene pass (their materials write the
 * emissive target only through `mrtNode`); the camera turns it on once that pipeline exists.
 */
export const POST_LAYER = 1;

export class Atmosphere {
  readonly fogColor = uniform(new THREE.Color(0x0b1016));
  /** Distance fog: clear up to `clear`, nearly full at `clear + span`. */
  readonly clear = uniform(40);
  readonly span = uniform(110);
  /** Floor layer: below `layerTop`, up to `layerStrength` thick far away. */
  readonly layerTop = uniform(21);
  readonly layerStrength = uniform(0.42);
  /** Enclosure, for the dark corners: centre and half size on the floor plane (xz). */
  readonly roomCenter = uniform(new THREE.Vector2(80, 80));
  readonly roomHalf = uniform(new THREE.Vector2(75, 75));
  readonly cornerDark = uniform(0.75);
  readonly sunDir = uniform(new THREE.Vector3(0.4, 0.85, 0.3));
  glass: THREE.Mesh | null = null;

  constructor(
    private readonly glow: Glow,
    private readonly scene: THREE.Scene,
  ) {
    scene.fogNode = this.fogNode();
    scene.backgroundNode = this.backdrop();
  }

  setLayout(layout: SceneLayout, fogHex: number): void {
    this.fogColor.value.setHex(fogHex);
    const [x0, , z0, x1, , z1] = layout.inner;
    this.roomCenter.value.set((x0 + x1) / 2, (z0 + z1) / 2);
    this.roomHalf.value.set((x1 - x0) / 2, (z1 - z0) / 2);
    if (this.glass) {
      this.scene.remove(this.glass);
      this.glass.geometry.dispose();
      this.glass = null;
    }
    if (layout.glassY > 0) {
      const g = new THREE.PlaneGeometry(x1 - x0 + 2, z1 - z0 + 2);
      g.rotateX(-Math.PI / 2);
      this.glass = new THREE.Mesh(g, this.glassMaterial(x1 - x0 + 2, z1 - z0 + 2));
      this.glass.position.set((x0 + x1) / 2, layout.glassY, (z0 + z1) / 2);
      this.glass.renderOrder = 10;
      this.glass.layers.set(POST_LAYER);
      this.scene.add(this.glass);
    }
  }

  private fogNode(): THREE.Node {
    const g = this.glow;
    return Fn(() => {
      const d = length(positionView);
      const p = positionWorld;
      // distance fog: zero until `clear`, then a smooth exponential rise (a soft onset keeps the first
      // stretch past `clear` crisp); about 95% at `clear + span`
      const x = max(d.sub(this.clear), 0).div(this.span);
      const distF = float(1).sub(exp(pow(x, 2.5).mul(-3)));
      // floor layer, coloured by the nearby RGB lights
      const tint = vec3(0).toVar();
      Loop(MAX_LIGHTS, ({ i }) => {
        const l = g.lights.element(i) as unknown as THREE.Node<'vec4'>;
        const dl = length(p.sub(l.xyz));
        tint.addAssign(l.w.mul(exp(dl.mul(dl).mul(-1 / 1800))));
      });
      const tintAmount = min(tint.x, 1);
      const layerW = smoothstep(this.layerTop, this.layerTop.sub(9), p.y)
        .mul(float(1).sub(exp(d.mul(-0.012))))
        .mul(this.layerStrength);
      // a faint cool haze (blue-black like the depth fog), taking a little of the colour of the RGB lights near them
      const layerColor = mix(vec3(0.03, 0.036, 0.048), hueColor(g.hue).mul(0.1), tintAmount);
      const f1 = clamp(distF.add(layerW.mul(float(1).sub(distF))), 0, 1);
      const c1 = mix(this.fogColor, layerColor, layerW.div(max(f1, 1e-4)).mul(float(1).sub(distF)));
      // dark corners: 0 in the middle of the room, 1 against the walls and in the corners
      const q = abs(p.xz.sub(this.roomCenter)).div(this.roomHalf);
      const edge = length(max(q.sub(0.42), 0).div(0.58));
      const corner = smoothstep(0.1, 0.95, edge).mul(this.cornerDark);
      const f2 = f1.add(float(1).sub(f1).mul(corner));
      const c2 = mix(c1, this.fogColor.mul(1.1), corner.div(max(f2, 1e-4)).mul(float(1).sub(f1)));
      return fog(c2, f2);
    })();
  }

  /** Dark room behind everything: a faint warm-grey glow in the middle, black at the edges. */
  private backdrop(): THREE.Node {
    return Fn(() => {
      const aspect = screenSize.x.div(screenSize.y);
      const uv = screenUV.sub(vec2(0.5, 0.45)).mul(vec2(aspect, 1));
      const t = smoothstep(0, 0.95, length(uv));
      return mix(color(0x1a1d24).mul(0.55), color(0x020203), t);
    })();
  }

  /**
   * Tempered glass, render-only: almost clear when looked through from above, reflective at grazing
   * angles (Fresnel), a faint green tint along its edges (its thickness), procedural smudges, and a
   * soft streak and highlight from the key light.
   */
  private glassMaterial(width: number, depth: number): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.fog = false;
    // transparent: leave the emissive buffer (bloom input) as it is under it, or the glow behind is wiped
    m.mrtNode = mrt({ emissive: vec4(0, 0, 0, 0) });
    const center = this.roomCenter;
    const half = vec2(width / 2, depth / 2);
    {
      const v = normalize(cameraPosition.sub(positionWorld));
      const cosT = abs(v.y);
      const fres = float(0.03).add(float(0.97).mul(pow(float(1).sub(cosT), 5)));
      const n = vec3(0, 1, 0);
      const r = reflect(v.negate(), n);
      const sky = mix(color(0x0b0d12), color(0x3a424c), smoothstep(-0.1, 0.8, r.y));
      // smudges: soft fingerprints and wipes from fractal noise
      const pxz = positionWorld.xz;
      // sparse fingerprints (small, only where a coarse mask allows) and faint wipe arcs
      const mask = smoothstep(0.25, 0.55, mx_fractal_noise_float(vec3(pxz.mul(0.03), 3.1), 2, 2, 0.5));
      const print = smoothstep(0.3, 0.8, mx_fractal_noise_float(vec3(pxz.mul(0.11), 5.7), 3, 2.2, 0.55));
      const wipe = smoothstep(0.3, 0.6, mx_fractal_noise_float(vec3(pxz.mul(vec2(0.01, 0.07)), 7.3), 2, 2, 0.5));
      // faint, and stronger at grazing angles where glass shows its dirt
      const smudge = print.mul(mask).mul(0.012).add(wipe.mul(0.006)).mul(float(1).add(fres.mul(6)));
      // edge tint
      const q = abs(pxz.sub(center)).div(half);
      const edgeDist = min(float(1).sub(q.x).mul(half.x), float(1).sub(q.y).mul(half.y));
      const edge = smoothstep(2.2, 0, edgeDist).mul(float(0.35).add(fres.mul(2)));
      // key light: tight highlight plus a long soft diagonal streak
      const along = dot(pxz.sub(center).div(half), normalize(vec2(1, -0.6)));
      const streak = smoothstep(0.5, 0, abs(along.sub(0.25))).mul(0.012).mul(float(0.4).add(fres.mul(3)));
      const rgb = sky.mul(fres).add(vec3(0.55, 0.57, 0.58).mul(smudge)).add(vec3(0.03, 0.09, 0.06).mul(edge)).add(vec3(1, 0.96, 0.88).mul(streak));
      // capped: at grazing angles a near-opaque dark reflection would swallow the lights far behind the glass
      const alpha = clamp(fres.add(smudge).add(edge.mul(0.3)).add(streak), 0, 0.55);
      m.colorNode = rgb.div(max(alpha, 1e-3));
      m.opacityNode = alpha;
    }
    return m;
  }
}
