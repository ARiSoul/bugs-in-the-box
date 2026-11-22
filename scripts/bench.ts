/**
 * CPU benchmark of the terrain pipeline (no rendering). Run with `npm run bench`.
 * Reference numbers (96×64×96 world, ~100k triangles, Node 22, one core of a cloud VM):
 *   generate ~100-270 ms · initial mesh ~40-80 ms · explosion r=6: mean ~7 ms, p95 ~18 ms.
 * Treat them as a regression baseline, not as absolute truth: re-measure on your own machine.
 */
import { performance } from 'node:perf_hooks';
import { runExplosionBenchmark } from '../src/bench/explosions';
import { Bug } from '../src/game/bug';
import { dropNear } from '../src/game/spawn';
import { ANT } from '../src/game/species';
import { floatingIslands } from '../src/terrain/generators/floatingIslands';
import { insidePC } from '../src/terrain/generators/insidePC';
import { pcCase } from '../src/terrain/generators/pcCase';
import { ChunkMesher } from '../src/terrain/mesher';
import { Terrain } from '../src/terrain/Terrain';

// The islands use smooth meshing (Surface Nets) in the game; built scenarios use Dual Contouring.
const smooth = new ChunkMesher(false);
const sharp = new ChunkMesher(true);
const coords: [number, number, number] = [0, 0, 0];

function remesh(t: Terrain, mesher = smooth): number {
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

// Larger maps (Phase 3): generation and initial meshing scale with the volume; one explosion does not.
for (const [cx, cy, cz] of [
  [5, 2, 5],
  [5, 3, 5],
]) {
  const big = new Terrain(cx, cy, cz);
  let s0 = performance.now();
  floatingIslands(big, 1234);
  const g = performance.now() - s0;
  s0 = performance.now();
  remesh(big);
  const m = performance.now() - s0;
  const r = runExplosionBenchmark(big, () => remesh(big), 6, 60);
  console.log(
    `world ${big.W}x${big.H}x${big.D} (${big.chunkCount} chunks): generate ${g.toFixed(0)} ms  initial mesh ${m.toFixed(0)} ms  ` +
      `explosion r=6 mean ${r.meanMs.toFixed(1)} ms  p95 ${r.p95Ms.toFixed(1)}`,
  );
}

// Phase 4 scenarios on the default large map (built from SDF stamps, Dual Contouring).
for (const [label, gen] of [
  ['inside a PC', insidePC],
  ['tower case (pc-case)', pcCase],
] as const) {
  const warm = new Terrain(5, 3, 5);
  gen(warm, 1); // warm-up
  remesh(warm, sharp);
  const pc = new Terrain(5, 3, 5);
  let s0 = performance.now();
  gen(pc, 1234);
  const g = performance.now() - s0;
  s0 = performance.now();
  remesh(pc, sharp);
  const m = performance.now() - s0;
  const r = runExplosionBenchmark(pc, () => remesh(pc, sharp), 6, 60);
  console.log(
    `${label} (Dual Contouring) ${pc.W}x${pc.H}x${pc.D}: generate ${g.toFixed(0)} ms  initial mesh ${m.toFixed(0)} ms  ` +
      `explosion r=6 mean ${r.meanMs.toFixed(1)} ms  p95 ${r.p95Ms.toFixed(1)}`,
  );
}

// Bug physics: one walking, turning, jumping bug for 20k ticks (~5.5 min of game time).
{
  const world = new Terrain(3, 2, 3);
  floatingIslands(world, 1234);
  const bug = new Bug(ANT);
  const ticks = 20_000;
  const input = { move: 1 as const, turn: 0 as -1 | 0 | 1, jump: false };
  const start = performance.now();
  for (let n = 0; n < ticks; n++) {
    if (!bug.alive || n % 600 === 0) dropNear(bug, world, world.W / 2, world.D / 2);
    input.turn = n % 240 < 40 ? 1 : 0;
    input.jump = n % 90 === 0;
    bug.step(world, input);
  }
  const us = ((performance.now() - start) * 1000) / ticks;
  console.log(`bug step: ${us.toFixed(1)} µs per bug per tick`);
}
