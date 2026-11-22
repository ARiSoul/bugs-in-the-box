import * as THREE from 'three/webgpu';
import { Fn, Loop, float, mx_noise_vec3, screenSize, smoothstep, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import type { SceneLayout } from '../../terrain/generators/types';

/** Most heat volumes shown at once. */
const MAX_HEAT = 4;
/** Largest UV offset of the shimmer (fraction of the screen). */
const STRENGTH = 0.0006;

/**
 * Heat shimmer: screen-space refraction inside small screen rectangles over hot parts. Each frame the
 * world boxes of the `heat` features are projected to screen rectangles (no allocations); the post pass
 * offsets the scene lookup by a little animated noise inside them, fading out to their edges and to the
 * top. Render-only.
 */
export class HeatShimmer {
  /** Screen rectangles (u0, v0, u1, v1) with v down; empty ones lie off screen. */
  private readonly rects = uniformArray(Array.from({ length: MAX_HEAT }, () => new THREE.Vector4(2, 2, 3, 3)), 'vec4');
  private readonly time = uniform(0);
  private readonly boxes: number[][] = [];
  private readonly corner = new THREE.Vector3();

  /** UV to sample the scene with, given the plain screen UV. */
  uv(uvNode: THREE.Node<'vec2'>): THREE.Node<'vec2'> {
    return Fn(() => {
      const off = vec2(0).toVar();
      const aspect = screenSize.x.div(screenSize.y);
      Loop(MAX_HEAT, ({ i }) => {
        const r = this.rects.element(i) as unknown as THREE.Node<'vec4'>;
        const w = r.z.sub(r.x);
        const h = r.w.sub(r.y);
        const fx = uvNode.x.sub(r.x).div(w);
        const fy = uvNode.y.sub(r.y).div(h);
        const mask = smoothstep(0, 0.25, fx)
          .mul(smoothstep(1, 0.75, fx))
          .mul(smoothstep(0, 0.45, fy)) // fades out towards the top of the rising air
          .mul(smoothstep(1, 0.85, fy));
        const n = mx_noise_vec3(vec3(uvNode.x.mul(aspect).mul(70), uvNode.y.mul(45).add(this.time.mul(2.2)), this.time.mul(0.9)));
        off.addAssign(n.xy.mul(mask).mul(float(STRENGTH)));
      });
      return uvNode.add(off);
    })();
  }

  setLayout(layout: SceneLayout): void {
    this.boxes.length = 0;
    for (const f of layout.features) if (f.kind === 'heat' && this.boxes.length < MAX_HEAT) this.boxes.push(f.box.slice());
    for (let i = 0; i < MAX_HEAT; i++) (this.rects.array[i] as THREE.Vector4).set(2, 2, 3, 3);
  }

  /** Project the heat boxes for this frame. */
  update(camera: THREE.Camera, seconds: number): void {
    this.time.value = seconds;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      let u0 = Infinity;
      let v0 = Infinity;
      let u1 = -Infinity;
      let v1 = -Infinity;
      let behind = false;
      for (let c = 0; c < 8; c++) {
        this.corner.set(c & 1 ? b[3] : b[0], c & 2 ? b[4] : b[1], c & 4 ? b[5] : b[2]).project(camera);
        if (this.corner.z > 1) behind = true;
        const u = this.corner.x * 0.5 + 0.5;
        const v = 0.5 - this.corner.y * 0.5;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      const r = this.rects.array[i] as THREE.Vector4;
      if (behind || u1 < 0 || u0 > 1 || v1 < 0 || v0 > 1) r.set(2, 2, 3, 3);
      else r.set(u0, v0, u1, v1);
    }
  }
}
