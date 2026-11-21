/**
 * CPU benchmark of the terrain pipeline (no rendering). Run with `npm run bench`.
 * Reference numbers (96×64×96 world, ~100k triangles, Node 22, one core of a cloud VM):
 *   generate ~100-270 ms · initial mesh ~40-80 ms · explosion r=6: mean ~7 ms, p95 ~18 ms.
 * Treat them as a regression baseline, not as absolute truth: re-measure on your own machine.
 */
import { performance } from 'node:perf_hooks';
import { runExplosionBenchmark } from '../src/bench/explosions';
import { floatingIslands } from '../src/terrain/generators/floatingIslands';
import { SurfaceNetsMesher } from '../src/terrain/mesher';
import { Terrain } from '../src/terrain/Terrain';

const mesher = new SurfaceNetsMesher();
const coords: [number, number, number] = [0, 0, 0];

function remesh(t: Terrain): number {
  let n = 0;
  for (const id of t.dirty) {
    const [cx, cy, cz] = t.chunkCoords(id, coords);
    mesher.mesh(t, cx, cy, cz);
    n++;
  }
  t.dirty.clear();
  return n;
}

// Warm up the JIT, otherwise the first numbers are misleading.
{
  const w = new Terrain(3, 2, 3);
  floatingIslands(w, 1);
  remesh(w);
  runExplosionBenchmark(w, () => remesh(w), 6, 20);
}

const t = new Terrain(3, 2, 3);
let t0 = performance.now();
floatingIslands(t, 1234);
const gen = performance.now() - t0;
t0 = performance.now();
remesh(t);
const mesh = performance.now() - t0;
console.log(`world ${t.W}x${t.H}x${t.D} (${t.chunkCount} chunks)`);
console.log(`generate: ${gen.toFixed(0)} ms   initial mesh: ${mesh.toFixed(0)} ms`);

for (const radius of [4, 6, 10]) {
  const fresh = new Terrain(3, 2, 3);
  floatingIslands(fresh, 1234);
  remesh(fresh);
  const r = runExplosionBenchmark(fresh, () => remesh(fresh), radius, 60);
  console.log(
    `explosions r=${radius}: mean ${r.meanMs.toFixed(1)} ms  median ${r.medianMs.toFixed(1)}  p95 ${r.p95Ms.toFixed(1)}  worst ${r.worstMs.toFixed(1)}  (${r.meanChunks.toFixed(1)} chunks each)`,
  );
}
