import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  cameraPosition,
  dot,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  mx_noise_vec3,
  normalize,
  pow,
  smoothstep,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { createRng } from '../../terrain/noise';
import type { SceneLayout } from '../../terrain/generators/types';
import { Glow, MAX_LIGHTS, hueColor } from './glow';

/** Number of dust motes. */
export const DUST_COUNT = 3000;
/** Smallest size a mote is drawn at, in pixels: below this it would flicker; it fades instead. */
const MIN_PIXELS = 3;

/**
 * Dust motes in the case air: render-only, seeded, advected on the GPU (compute shader) by a cheap
 * analytic airflow: in at the front radiator, along the case, rising over hot parts, out at the rear
 * vents and along the top edge of the glass. Motes that leave come back in at the intake. Gameplay never
 * sees them. Needs the WebGPU backend (compute); `supported` is false on the WebGL2 fallback.
 */
export class DustMotes {
  readonly sprite: THREE.Sprite;
  private readonly dt = uniform(0);
  private readonly frame = uniform(0);
  private readonly boxMin = uniform(new THREE.Vector3());
  private readonly boxMax = uniform(new THREE.Vector3(1, 1, 1));
  private readonly intakeMin = uniform(new THREE.Vector3());
  private readonly intakeMax = uniform(new THREE.Vector3(1, 1, 1));
  private readonly heatA = uniform(new THREE.Vector3(0, -1000, 0));
  private readonly heatB = uniform(new THREE.Vector3(0, -1000, 0));
  /** Top of the scene (the glass): motes shine only where the key light came in through it. */
  private readonly top = uniform(1e4);
  /** World size of one pixel at distance 1 (set from the camera and the canvas height). */
  readonly pixelAngle = uniform(0.001);
  private readonly positions;
  private readonly step;
  private frames = 0;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    glow: Glow,
    sunDir: THREE.Node<'vec3'>,
    seed: number,
  ) {
    const init = new Float32Array(DUST_COUNT * 4);
    const rng = createRng(seed * 31 + 5);
    for (let i = 0; i < DUST_COUNT; i++) {
      init[i * 4] = rng();
      init[i * 4 + 1] = rng();
      init[i * 4 + 2] = rng();
      init[i * 4 + 3] = 0.05 + rng() * 0.1; // size 0.05..0.15
    }
    // positions start as fractions of the box; the first step spreads them (see `place`)
    this.positions = instancedArray(init, 'vec4');
    const pos = this.positions;

    this.step = Fn(() => {
      const p = pos.element(instanceIndex);
      const x = p.xyz.toVar();
      If(this.frame.lessThan(0.5), () => {
        // first frame: fractions -> anywhere in the box
        x.assign(this.boxMin.add(x.mul(this.boxMax.sub(this.boxMin))));
      });
      const size = this.boxMax.sub(this.boxMin);
      const rel = x.sub(this.boxMin).div(size);
      // along the case from the front (intake) to the rear (exhaust)
      const v = vec3(0, 0, 0.9).toVar();
      // intake jet in front of the radiator fans
      const inJet = smoothstep(this.intakeMax.z.add(26), this.intakeMax.z, x.z)
        .mul(smoothstep(this.intakeMin.x.sub(6), this.intakeMin.x.add(4), x.x))
        .mul(smoothstep(this.intakeMax.x.add(6), this.intakeMax.x.sub(4), x.x));
      v.z.addAssign(inJet.mul(3.2));
      // warm air rises over the pump and the graphics card
      const ha = x.sub(this.heatA);
      const hb = x.sub(this.heatB);
      v.y.addAssign(exp(dot(ha.xz, ha.xz).mul(-1 / 140)).mul(smoothstep(-2, 6, ha.y)).mul(1.4));
      v.y.addAssign(exp(dot(hb.xz, hb.xz).mul(-1 / 220)).mul(smoothstep(-2, 6, hb.y)).mul(1.2));
      // out along the top edge of the glass
      v.x.addAssign(smoothstep(0.45, 1, rel.y).mul(smoothstep(0.3, 1, rel.x)).mul(1.6));
      // slow swirls
      v.addAssign(mx_noise_vec3(x.mul(0.045).add(vec3(0, this.frame.mul(0.0008), 0))).mul(1.1));
      x.addAssign(v.mul(this.dt));
      // left the case (exhaust, or a wall): come back in at the intake
      const out = x.z.greaterThan(this.boxMax.z.sub(1.5))
        .or(x.x.greaterThan(this.boxMax.x.sub(1.5)))
        .or(x.x.lessThan(this.boxMin.x.add(1)))
        .or(x.z.lessThan(this.boxMin.z.add(1)))
        .or(x.y.greaterThan(this.boxMax.y.sub(0.8)))
        .or(x.y.lessThan(this.boxMin.y.add(0.4)));
      If(out, () => {
        const h = float(instanceIndex).mul(3.17).add(this.frame.mul(0.618));
        const r = vec3(hash(h), hash(h.add(11.3)), hash(h.add(27.1)));
        x.assign(this.intakeMin.add(r.mul(this.intakeMax.sub(this.intakeMin))));
      });
      p.assign(vec4(x, p.w));
    })().compute(DUST_COUNT);

    // drawing: a soft round sprite per mote, never smaller than MIN_PIXELS (it fades instead)
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mote = pos.toAttribute() as unknown as THREE.Node<'vec4'>;
    m.positionNode = mote.xyz;
    const dist = length(cameraPosition.sub(mote.xyz));
    const minSize = dist.mul(this.pixelAngle).mul(MIN_PIXELS);
    const drawn = max(mote.w, minSize);
    m.scaleNode = vec2(drawn, drawn);
    // fade: sub-pixel motes lose energy instead of flickering; far motes fade with the fog
    // and none in the dark corners and against the walls (same falloff as the fog's dark corners)
    const centre = this.boxMin.xz.add(this.boxMax.xz).mul(0.5);
    const half = this.boxMax.xz.sub(this.boxMin.xz).mul(0.5);
    const q = mote.xz.sub(centre).abs().div(half);
    const wall = smoothstep(0.0, 0.5, length(max(q.sub(0.42), 0).div(0.58)));
    const cover = varying(pow(mote.w.div(drawn), 2).mul(smoothstep(110, 50, dist)).mul(smoothstep(12, 30, dist)).mul(float(1).sub(wall)));
    // light: forward scattering toward the key light, plus the colour of nearby RGB lights
    const view = normalize(mote.xyz.sub(cameraPosition));
    const phase = pow(max(dot(view, sunDir), 0), 4).mul(2.6).add(0.06);
    // in the light? follow the ray to the sun up to the top and see that it came in through the glass:
    // motes under the case's solid edges stay dark
    const along = this.top.sub(mote.y).div(max(sunDir.y, 0.05));
    const px = mote.x.add(sunDir.x.mul(along));
    const pz = mote.z.add(sunDir.z.mul(along));
    const inX = smoothstep(this.boxMin.x, this.boxMin.x.add(3), px).mul(smoothstep(this.boxMax.x, this.boxMax.x.sub(3), px));
    const inZ = smoothstep(this.boxMin.z, this.boxMin.z.add(3), pz).mul(smoothstep(this.boxMax.z, this.boxMax.z.sub(3), pz));
    const lit = inX.mul(inZ);
    const tint = float(0).toVar();
    const tintNode = Fn(() => {
      Loop(MAX_LIGHTS, ({ i }) => {
        const l = glow.lights.element(i) as unknown as THREE.Node<'vec4'>;
        const dl = length(mote.xyz.sub(l.xyz));
        tint.addAssign(l.w.mul(exp(dl.mul(dl).mul(-1 / 260))));
      });
      return min(tint, 1.5);
    })();
    const light = varying(vec3(1, 0.78, 0.52).mul(phase).mul(lit).add(hueColor(glow.hue).mul(tintNode).mul(0.15)));
    const disc = smoothstep(0.5, 0.1, length(uv().sub(0.5)));
    m.colorNode = vec4(light.mul(disc).mul(cover).mul(0.3), 1);
    this.sprite = new THREE.Sprite(m);
    this.sprite.count = DUST_COUNT;
    this.sprite.frustumCulled = false;
  }

  /** Box the motes live in, and where they come back in (the intake). Heat sources make them rise. */
  setLayout(layout: SceneLayout, boardTop: number): void {
    const [x0, , z0, x1, y1, z1] = layout.inner;
    this.boxMin.value.set(x0, boardTop + 1, z0);
    this.boxMax.value.set(x1, y1 - 1, z1);
    const fans = layout.features.filter((f) => f.kind === 'fan' && f.axis === 2 && f.facing > 0);
    if (fans.length > 0) {
      let fx0 = Infinity;
      let fx1 = -Infinity;
      for (const f of fans) {
        fx0 = Math.min(fx0, f.x - f.radius);
        fx1 = Math.max(fx1, f.x + f.radius);
      }
      const f = fans[0];
      this.intakeMin.value.set(fx0, f.y - f.radius, f.z + 3);
      this.intakeMax.value.set(fx1, f.y + f.radius, f.z + 9);
    } else {
      this.intakeMin.value.set(x0 + 2, boardTop + 2, z0 + 2);
      this.intakeMax.value.set(x1 - 2, y1 - 4, z0 + 8);
    }
    const heat = layout.features.filter((f) => f.kind === 'heat');
    this.heatA.value.set(heat[0]?.x ?? 0, heat[0]?.y ?? -1000, heat[0]?.z ?? 0);
    this.heatB.value.set(heat[1]?.x ?? 0, heat[1]?.y ?? -1000, heat[1]?.z ?? 0);
    this.frames = 0;
    this.frame.value = 0;
  }

  setTop(y: number): void {
    this.top.value = y;
  }

  /** Advance the motes by `dt` seconds (on the GPU). */
  update(dt: number): void {
    this.dt.value = Math.min(dt, 1 / 20);
    this.frame.value = this.frames++;
    this.renderer.compute(this.step);
  }
}
