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
  min,
  mix,
  normalView,
  normalize,
  positionView,
  positionWorld,
  pow,
  select,
  smoothstep,
  uniform,
  sin,
  vec3,
  vertexColor,
  mx_noise_float,
  positionViewDirection,
} from 'three/tsl';
import { BUILT_METAL, GLOW_BROKEN, GLOW_FAN, GLOW_FUZZ, GLOW_GRAIN, GLOW_PEEL, GLOW_RGB, HIDDEN_ROUGHNESS } from '../../terrain/materials';
import { type Craters, brokenInside } from './craters';
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
 * Terrain material (TSL): vertex colours with AO, per-vertex roughness / metalness / glow kind in `pbr`,
 * hard-edge shading, plus glow: RGB diffusers
 * show the shared hue, and fan blades carry a bright stripe that turns, so the static blades read as
 * spinning.
 */
export function createTerrainMaterial(
  glow: Glow,
  craters: Craters,
): { material: THREE.MeshStandardNodeMaterial; sharp: { value: number }; insideCore: { value: THREE.Color }; insideLine: { value: THREE.Color } } {
  const sharp = uniform(1);
  /** What the ground is made of inside (the scenario sets it): the broken stuff, and its thin layers. */
  const insideCore = craters.insideCore;
  const insideLine = craters.insideLine;
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const pbr = attribute('pbr', 'vec3');
  // specular anti-aliasing: where the normal changes fast across a pixel, the surface gets rougher
  // collision bodies of drawn-only parts (COLLIDER, marked by an impossible roughness): never drawn, in
  // colour or in the shadow pass; only where a crater was blown into one: the drawn part is a hollow shell, and
  // the body's wall closes the hole in it
  const seen = pbr.x.lessThan((HIDDEN_ROUGHNESS + 1) / 2);
  // (a hidden body's roughness is a mark, not a roughness: the wall of a crater in one is dull)
  m.roughnessNode = select(seen, min(max(pbr.x, clamp(length(fwidth(normalView)).mul(1.2), 0, 0.9)), 1), float(0.95));
  m.maskNode = Fn(() => {
    const keep = seen.toVar();
    // (what bugs build draws its own holes)
    If(keep.not().and(pbr.y.greaterThan(BUILT_METAL)), () => {
      keep.assign(craters.onWall());
    });
    return keep;
  })();

  // fibrous wadding (GLOW_FUZZ): a velvet sheen towards the silhouette and a fine fibre mottling
  m.colorNode = Fn(() => {
    const base = vertexColor().rgb.toVar();
    // (a hidden body's crater: the broken inside of what was drawn, dull and grainy, darker deep in its cracks)
    // (its layers, as a board, a tile or a moulding is made: thin pale lines along the level, wavy, of uneven spacing,
    // broken up, only on steep walls: the floor of a crater is plain broken stuff)
    const inside = brokenInside(insideCore as unknown as THREE.Node<'vec3'>, insideLine as unknown as THREE.Node<'vec3'>);
    If(seen.not(), () => {
      base.assign(inside);
    });
    const broken = clamp(float(1).sub(abs(pbr.z.sub(GLOW_BROKEN)).div(0.025)), 0, 1);
    If(broken.greaterThan(0.01), () => {
      // (the mesher's colour carries its burn and a little of its outside; the inside's own colour over it)
      const mesherLum = base.r.add(base.g).add(base.b).div(0.39);
      base.assign(mix(base, inside.mul(mesherLum.clamp(0.8, 1.2)), broken));
    });
    // (the special shadings are codes in the glow channel; the mesher blends them across borders)
    const fuzz = clamp(float(1).sub(abs(pbr.z.sub(GLOW_FUZZ)).div(0.15)), 0, 1);
    const grain = clamp(float(1).sub(abs(pbr.z.sub(GLOW_GRAIN)).div(0.15)), 0, 1);
    // (only on near-black surfaces: where two other materials meet, the blended code passes through
    // this one, and a mottle on a light surface would draw dashed lines along the border)
    // (a narrow window: borders between the vinyl and other black parts blend to codes just off it)
    const peel = clamp(float(1).sub(abs(pbr.z.sub(GLOW_PEEL)).div(0.035)), 0, 1).mul(smoothstep(0.07, 0.035, base.r.add(base.g).add(base.b)));
    If(peel.greaterThan(0.01), () => {
      // orange-peel mottle (breaks up the light bands on the black wrap) and a cool sheen at the edges
      // (so a black wall in front of the camera still reads as a surface, not as the void)
      const mottle = mx_noise_float(positionWorld.mul(2.3)).mul(0.6).add(mx_noise_float(positionWorld.mul(6.1)).mul(0.4));
      const edge = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 3);
      base.assign(mix(base, base.mul(float(1).add(mottle.mul(0.35))).add(vec3(0.016, 0.018, 0.022).mul(edge)), peel));
    });
    If(grain.greaterThan(0.01), () => {
      // long grain along x: wavy lines from a stretched noise, darker late wood, a few wider bands
      const p = positionWorld;
      const warp = mx_noise_float(p.mul(vec3(0.02, 0.2, 0.12))).mul(3);
      const lines = sin(p.z.mul(1.9).add(warp.mul(2.4))).mul(0.5).add(0.5);
      const bands = mx_noise_float(p.mul(vec3(0.008, 0.1, 0.05))).mul(0.5).add(0.5);
      // fine pores and streaks along the grain, crisp at bug scale
      const streaks = mx_noise_float(p.mul(vec3(0.35, 3, 7))).mul(0.5).add(0.5);
      const tone = float(0.8).add(lines.mul(lines).mul(0.22)).add(bands.mul(0.16)).add(streaks.mul(0.1));
      base.assign(mix(base, base.mul(tone), grain));
    });
    If(fuzz.greaterThan(0.01), () => {
      const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 2);
      // (fine fibres only: no broad blotches)
      const fibre = mx_noise_float(positionWorld.mul(4.1)).mul(0.6).add(mx_noise_float(positionWorld.mul(9.7)).mul(0.4));
      base.assign(mix(base, base.mul(float(0.97).add(fibre.mul(0.07))).add(rim.mul(0.28)), fuzz));
    });
    return base;
  })();
  m.metalnessNode = max(pbr.y, 0);

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
    // wadding lets light through: its folds never fall fully dark (a little of its own colour)
    const fuzzW = clamp(float(1).sub(abs(pbr.z.sub(GLOW_FUZZ)).div(0.15)), 0, 1);
    out.addAssign(vertexColor().rgb.mul(fuzzW.mul(0.12)));
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

  return { material: m, sharp, insideCore, insideLine };
}
