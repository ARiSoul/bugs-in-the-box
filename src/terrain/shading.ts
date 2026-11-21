import { vnoise3 } from './noise';

/**
 * Per-vertex colour for the generic test scenario: grass on up-facing surfaces, rock elsewhere,
 * darkened by explosion scorch. Scenario-specific palettes will replace this.
 * Writes r,g,b into `out[o..o+2]`.
 */
export function shadeVertex(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  ny: number,
  scorch01: number,
): void {
  const grass = Math.min(1, Math.max(0, (ny - 0.55) * 3.2));
  const n = vnoise3(x * 0.35, y * 0.35, z * 0.35, 3);
  const burn = Math.min(1, scorch01 * 1.4);
  const keep = 1 - burn * 0.87;
  out[o] = ((0.34 + 0.09 * n) * (1 - grass) + (0.2 + 0.05 * n) * grass) * keep;
  out[o + 1] = ((0.27 + 0.07 * n) * (1 - grass) + (0.48 + 0.09 * n) * grass) * keep;
  out[o + 2] = ((0.23 + 0.06 * n) * (1 - grass) + (0.17 + 0.04 * n) * grass) * keep;
}
