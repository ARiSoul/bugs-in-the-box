import type { Terrain } from '../terrain/Terrain';

export interface ExplosionBenchResult {
  count: number;
  radius: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  /** Mean chunks re-meshed per explosion. */
  meanChunks: number;
}

/**
 * Blow `count` craters at pseudo-random surface points and time carve + remesh.
 * `remesh` must re-mesh the dirty chunks and return how many it processed.
 * Deterministic (own LCG), shared by the in-browser button and `npm run bench`.
 */
export function runExplosionBenchmark(
  terrain: Terrain,
  remesh: () => number,
  radius: number,
  count = 60,
): ExplosionBenchResult {
  let a = 99;
  const rnd = (): number => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  const times: number[] = [];
  let chunkSum = 0;
  let guard = 0;
  while (times.length < count && guard++ < count * 8) {
    const x = 14 + rnd() * (terrain.W - 28);
    const z = 14 + rnd() * (terrain.D - 28);
    const top = terrain.H - 3;
    const t = terrain.raycast(x, top, z, 0, -1, 0);
    if (t < 0) continue;
    const start = performance.now();
    terrain.carve(x, top - t, z, radius);
    chunkSum += remesh();
    times.push(performance.now() - start);
  }
  const sorted = [...times].sort((p, q) => p - q);
  const n = sorted.length;
  const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : 0;
  return {
    count: n,
    radius,
    meanMs: mean,
    medianMs: n ? sorted[n >> 1] : 0,
    p95Ms: n ? sorted[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
    worstMs: n ? sorted[n - 1] : 0,
    meanChunks: n ? chunkSum / n : 0,
  };
}
