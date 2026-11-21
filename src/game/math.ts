/**
 * Deterministic helpers for gameplay. Only + - * / and Math.sqrt: bit-identical on every device.
 */

/** Scratch output of `rotate2`: [x, y]. Read it right after the call. */
export const rot = new Float64Array(2);

/**
 * Rotate the 2D unit vector (x, y) counter-clockwise by `a` radians and renormalise. Writes `rot`.
 * Small-angle series instead of Math.sin/cos; accurate to ~1e-12 for |a| < 0.1 (one tick of turning).
 */
export function rotate2(x: number, y: number, a: number): void {
  const a2 = a * a;
  const c = 1 - a2 * 0.5 + a2 * a2 * (1 / 24);
  const s = a * (1 - a2 * (1 / 6) + a2 * a2 * (1 / 120));
  const rx = x * c - y * s;
  const ry = x * s + y * c;
  const l = Math.sqrt(rx * rx + ry * ry);
  rot[0] = rx / l;
  rot[1] = ry / l;
}
