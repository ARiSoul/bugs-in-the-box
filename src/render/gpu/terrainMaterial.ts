import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  atan,
  clamp,
  attribute,
  cos,
  cross,
  dFdx,
  dFdy,
  fwidth,
  length,
  dot,
  float,
  If,
  max,
  mix,
  normalView,
  normalize,
  positionView,
  positionWorld,
  pow,
  select,
  smoothstep,
  uniform,
} from 'three/tsl';
import { GLOW_FAN, GLOW_RGB } from '../../terrain/materials';
import { Glow, MAX_FANS, hueColor } from './glow';

/** How bright the RGB diffusers glow (HDR, before bloom and tone mapping). */
/** (The smooth light overlays carry most of the glow; this lights the diffuser under them.) */
const RGB_GLOW = 0.12;
/** Peak brightness of the spinning stripe on fan blades. */
/** (The smooth rotor stand-ins carry the stripe; the terrain blades under them stay dark.) */
const FAN_STRIPE = 0;
/** Radians per second the stripe turns. */
const FAN_SPIN = 2.4;

/**
 * Terrain material for the WebGPU path (TSL): the same inputs as the WebGL one (vertex colours with AO,
 * per-vertex roughness / metalness / glow kind in `pbr`, hard-edge shading), plus glow: RGB diffusers
 * show the shared hue, and fan blades carry a bright stripe that turns, so the static blades read as
 * spinning.
 */
export function createTerrainMaterial(glow: Glow): { material: THREE.MeshStandardNodeMaterial; sharp: { value: number } } {
  const sharp = uniform(1);
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('pbr', 'vec3');
  // specular anti-aliasing: where the normal changes fast across a pixel, the surface gets rougher
  m.roughnessNode = max(pbr.x, clamp(length(fwidth(normalView)).mul(1.2), 0, 0.9));
  m.metalnessNode = pbr.y;

  // Hard edges: where the triangle's own normal disagrees strongly with the interpolated one, use it.
  // (Turned to face the camera: the sign of the screen-space derivatives differs between backends.)
  m.normalNode = Fn(() => {
    const face = normalize(cross(dFdx(positionView), dFdy(positionView))).toVar();
    face.assign(select(dot(face, positionView).greaterThan(0), face.negate(), face));
    const n = normalView.toVar();
    return normalize(mix(n, face, sharp.mul(smoothstep(0.62, 0.45, dot(face, n)))));
  })();

  m.emissiveNode = Fn(() => {
    // glow weights, blended by the mesher across material borders: + RGB light, - fan blade
    const rgbW = clamp(pbr.z.mul(GLOW_RGB), 0, 1);
    const fanW = clamp(pbr.z.mul(GLOW_FAN), 0, 1);
    const rgb = hueColor(glow.hue);
    const out = rgb.mul(rgbW.mul(rgbW).mul(RGB_GLOW)).toVar();
    // (skipped entirely while the rotor stand-ins carry the stripe)
    if (FAN_STRIPE > 0) If(fanW.greaterThan(0.01), () => {
      const stripe = float(0).toVar();
      Loop(MAX_FANS, ({ i }) => {
        const f = glow.fans.element(i) as unknown as THREE.Node<'vec4'>;
        const axis = glow.fanAxis.element(i) as unknown as THREE.Node<'float'>;
        const rel = positionWorld.sub(f.xyz).toVar();
        // coordinates in the fan's plane (u, v) and along its axis (a)
        const a = select(axis.lessThan(0.5), rel.x, select(axis.lessThan(1.5), rel.y, rel.z));
        const u = select(axis.lessThan(0.5), rel.y, select(axis.lessThan(1.5), rel.x, rel.x));
        const v = select(axis.lessThan(0.5), rel.z, select(axis.lessThan(1.5), rel.z, rel.y));
        const r = u.mul(u).add(v.mul(v)).sqrt();
        If(r.lessThan(f.w).and(abs(a).lessThan(2.5)), () => {
          const ang = atan(v, u).sub(glow.time.mul(FAN_SPIN)).add(float(i).mul(1.7));
          const s = pow(cos(ang).mul(0.5).add(0.5), 18).mul(smoothstep(0.25, 0.95, r.div(f.w)));
          stripe.assign(max(stripe, s));
        });
      });
      out.addAssign(rgb.mul(stripe.mul(FAN_STRIPE).mul(fanW)));
    });
    return out;
  })();

  return { material: m, sharp };
}
