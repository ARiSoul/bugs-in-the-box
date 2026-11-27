import { GROUND, MATERIAL_NOISE, MATERIAL_RGB } from './materials';
import { vnoise3 } from './noise';

/**
 * Per-vertex colour from the material of the nearest sample: GROUND is grass on up-facing surfaces and
 * rock elsewhere; every other material is its base colour with a little noise (`MATERIAL_NOISE`). Explosion scorch darkens
 * everything. Writes r,g,b into `out[o..o+2]`.
 */
export function shadeVertex(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  ny: number,
  scorch01: number,
  material: number,
): void {
  shadeWithNoise(out, o, vnoise3(x * 0.35, y * 0.35, z * 0.35, 3), ny, scorch01, material);
}

/** The value noise `shadeVertex` uses at (x, y, z): compute it once when shading several materials. */
export function shadeNoise(x: number, y: number, z: number): number {
  return vnoise3(x * 0.35, y * 0.35, z * 0.35, 3);
}

/** `shadeVertex` with the noise value already computed (see `shadeNoise`). */
export function shadeWithNoise(out: Float32Array, o: number, n: number, ny: number, scorch01: number, material: number): void {
  const burn = Math.min(1, scorch01 * 1.4);
  // (scorched: darker, but its own colour still under the soot, not a black hole)
  const keep = 1 - burn * 0.6;
  const soot = burn * 0.035;
  if (material === GROUND || material >= MATERIAL_RGB.length) {
    const grass = Math.min(1, Math.max(0, (ny - 0.55) * 3.2));
    out[o] = ((0.2 + 0.06 * n) * (1 - grass) + (0.07 + 0.03 * n) * grass) * keep + soot;
    out[o + 1] = ((0.15 + 0.05 * n) * (1 - grass) + (0.24 + 0.06 * n) * grass) * keep + soot * 0.9;
    out[o + 2] = ((0.12 + 0.04 * n) * (1 - grass) + (0.05 + 0.02 * n) * grass) * keep + soot * 0.8;
    return;
  }
  const c = MATERIAL_RGB[material];
  const amp = MATERIAL_NOISE[material] ?? 0.24;
  const v = (1 - amp / 2 + amp * n) * keep;
  out[o] = c[0] * v + soot;
  out[o + 1] = c[1] * v + soot * 0.9;
  out[o + 2] = c[2] * v + soot * 0.8;
}
