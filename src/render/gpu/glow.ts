import * as THREE from 'three/webgpu';
import { abs, clamp, dot, float, fract, max, uniform, uniformArray, vec3 } from 'three/tsl';
import type { Feature, SceneLayout } from '../../terrain/generators/types';

/**
 * Shared state of the RGB lighting on the WebGPU path: one hue that every RGB light shows at the same
 * time (render-only: a time-based offset, never seen by gameplay), the fans (for the spinning stripe
 * on their blades) and the light positions (for the coloured fog near them).
 */

/** Most fans / lights the shaders look at. */
export const MAX_FANS = 8;
export const MAX_LIGHTS = 16;
/** Seconds for the hue to sweep teal -> magenta and back. */
const HUE_PERIOD = 14;
/** Hue range of the sweep (0..1 around the colour wheel): teal to magenta. */
const HUE_FROM = 0.5;
const HUE_TO = 0.86;

export class Glow {
  /** Current hue (0..1), set by `update`. */
  readonly hue = uniform(HUE_FROM);
  /** Seconds since start, for the fan stripe and the LEDs. */
  readonly time = uniform(0);
  /** Fan centre (xyz) and opening radius (w); axis in `fanAxis` (0, 1, 2). */
  readonly fans = uniformArray(Array.from({ length: MAX_FANS }, () => new THREE.Vector4(0, -1000, 0, 0)), 'vec4');
  readonly fanAxis = uniformArray(new Array<number>(MAX_FANS).fill(1), 'float');
  /** RGB light positions (xyz) and strength (w, 0 = unused). */
  readonly lights = uniformArray(Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -1000, 0, 0)), 'vec4');
  /** Current RGB colour (linear), for CPU-side uses (dust tint, LEDs). */
  readonly rgb = new THREE.Color();
  /** Extra brightness towards teal (a teal glow reads weaker over the green board than magenta). */
  readonly boost = uniform(1);
  /** Debug: hold the hue at this value (0..1); -1 lets it sweep. */
  lock = -1;

  setLayout(layout: SceneLayout): void {
    const fans = layout.features.filter((f) => f.kind === 'fan');
    for (let i = 0; i < MAX_FANS; i++) {
      const f: Feature | undefined = fans[i];
      (this.fans.array[i] as THREE.Vector4).set(f ? f.x : 0, f ? f.y : -1000, f ? f.z : 0, f ? f.radius : 0);
      this.fanAxis.array[i] = f ? f.axis : 1;
    }
    const lights = layout.features.filter((f) => f.kind === 'fan' || f.kind === 'pump' || f.kind === 'lightBar');
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const f: Feature | undefined = lights[i];
      const strength = !f ? 0 : f.kind === 'lightBar' ? 0.7 : 1;
      (this.lights.array[i] as THREE.Vector4).set(f ? f.x : 0, f ? f.y : -1000, f ? f.z : 0, strength);
    }
  }

  update(seconds: number): void {
    this.time.value = seconds;
    // smooth ping-pong between the two hues
    const p = (seconds / HUE_PERIOD) % 1;
    const tri = p < 0.5 ? p * 2 : 2 - p * 2;
    const eased = tri * tri * (3 - 2 * tri);
    this.hue.value = this.lock >= 0 ? this.lock : HUE_FROM + (HUE_TO - HUE_FROM) * eased;
    hueToRgb(this.hue.value, this.rgb);
    this.boost.value = 1;
  }
}

/**
 * Every hue is scaled so that half its luminance plus half its strongest channel is the same: equal
 * luminance alone makes magenta's channels run hot (it clips to pink-white), equal peaks alone makes
 * teal much brighter than magenta.
 */
const HUE_LEVEL = 0.55;
/** Share of the luminance in that level (the rest is the strongest channel). */
const LUM_WEIGHT = 0.6;
/** Red and green added to pure blue (less towards violet and cyan): blue LEDs look lighter than pure blue. */
const BLUE_LIFT = [0.18, 0.24] as const;
/** White added on top at pure blue (it still reads darkest of all hues through the fog). */
const BLUE_WHITE = 0.06;

/** Fully saturated colour of hue `h` (0..1), at the same level for every hue (see HUE_LEVEL), in a shader. */
export function hueColor(h: THREE.Node<'float'>): THREE.Node<'vec3'> {
  const k = fract(vec3(h, h, h).add(vec3(0, 2 / 3, 1 / 3))).mul(6).sub(3);
  const c0 = clamp(abs(k).sub(1), float(0), float(1));
  const blue = c0.z.mul(float(1).sub(max(c0.x, c0.y)));
  const c = c0.add(vec3(BLUE_LIFT[0], BLUE_LIFT[1], 0).mul(blue));
  const level = dot(c, vec3(0.2126, 0.7152, 0.0722)).mul(LUM_WEIGHT).add(max(c.x, max(c.y, c.z)).mul(1 - LUM_WEIGHT));
  const n = c.mul(float(HUE_LEVEL).div(max(level, 0.05)));
  // pure blue gets a little white (only blue: white in the other hues turns them pastel)
  return n.add(blue.mul(BLUE_WHITE));
}

/** Same as `hueColor`, on the CPU (sRGB-ish primaries treated as linear, like the shader). */
export function hueToRgb(h: number, out: THREE.Color): THREE.Color {
  const ch = (o: number): number => Math.min(1, Math.max(0, Math.abs((((h + o) % 1) + 1) % 1 * 6 - 3) - 1));
  const b = ch(1 / 3);
  const blue = b * (1 - Math.max(ch(0), ch(2 / 3)));
  const r = ch(0) + BLUE_LIFT[0] * blue;
  const g = ch(2 / 3) + BLUE_LIFT[1] * blue;
  const level = LUM_WEIGHT * (0.2126 * r + 0.7152 * g + 0.0722 * b) + (1 - LUM_WEIGHT) * Math.max(r, g, b);
  const k = HUE_LEVEL / Math.max(level, 0.05);
  const add = blue * BLUE_WHITE;
  return out.setRGB(r * k + add, g * k + add, b * k + add);
}
