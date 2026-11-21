# Architecture

## Overview

```
            ┌────────────── src/terrain (pure, no DOM/three) ───────────────────┐
 generator ▶│ Terrain: density grid + dirty chunks                               │
 (seed)     │   sample · normal · raycast · carve                                │
            │ SurfaceNetsMesher: chunk ──▶ positions, normals, colors, indices   │
            └───────────────▲──────────────────────────────┬─────────────────────┘
                            │ stable interface             │ ChunkMesh
              gameplay (bugs, projectiles, picking)        ▼
                                                   src/render: ChunkRenderer → three.js
```

The boundary that matters is the one on the left: gameplay only uses `sample`, `normal`, `raycast` and `carve`. Whatever draws (three.js today, something else tomorrow) only receives `ChunkMesh`.

## Data model

- A world of `W×H×D` cells (today 96×64×96 = 3×2×3 chunks of 32). One world unit = one cell.
- Density samples at the grid points: `(W+1)(H+1)(D+1)` floats. `< 0` is solid, `> 0` is air. The value is an *approximate* signed distance (not exact after several operations), in cell units, clamped to ±6.
- The outer layer of the world is always air, so the surface is closed (no "holes" at the edges). `carve` never opens it.
- `scorch` (0–255 per sample) stores the burn mark; it is visual only and feeds into the vertex colors.
- `dirty`: the set of chunk ids to re-mesh.

## Procedural generation

A generator is `(terrain, seed) => void` and ends with `terrain.commitGeneration()`. The current `floatingIslands` combines a rolling ground (2D fBm per column), interior cave pockets (only ≥ 3 cells below the surface, hidden until someone blows them open) and floating islands (a union of rough ellipsoids).

Shapes are composed with SDF operations: union `min(a,b)`, subtraction `max(a,-b)`, intersection `max(a,b)`. This is what later lets us build recognizable scenarios (a PC, a speaker) from primitives (boxes, cylinders, cones) plus noise to make them look organic.

Determinism: integer-hash noise (`noise.ts`), seeded PRNG (`createRng`). No `Math.random`/`Math.sin` in generation, so the same number gives the same map on any device. The tests check this.

## Meshing (Surface Nets)

Per chunk, in three steps (`mesher.ts`):

1. **Vertices.** For each cell whose 8 corners have different signs, one vertex at the average of the edge crossings. The normal is the analytic gradient of that cell's trilinear interpolation.
2. **Lazy emission.** Output vertices are only created when some quad uses them.
3. **Quads.** For each grid edge with a sign change, one quad connecting the 4 cells that share it; the winding depends on which side is solid.

**Seams.** Vertices are computed over the chunk's cells `[start-1, end)` and depend only on the global grid, so two neighbouring chunks produce exactly the same vertices on their shared boundary. Each chunk emits only the quads whose source edge lies inside it, so no quad is duplicated. The tests check this (zero open edges after welding positions).

**Performance.** No allocations in hot loops; scratch buffers are reused between calls (so one mesher instance serves one thread at a time). ~2–3 ms per chunk.

**Known limitations.**
- No sharp edges (Surface Nets smooths them); Dual Contouring would fix this, but costs a lot more.
- Walls thinner than ~1 cell can vanish or get holes.
- There are some non-manifold edges (≈100–200 per map); this is normal for this algorithm, and the test only checks they do not blow up.
- About 0.1% of faces end up wound against their normals in very thin geometry.
- Per-cell normals can show slight faceting; if it bothers us, smooth them with the neighbouring cells' normals.

## Collisions and picking

No mesh colliders. `raycast` does sphere tracing over `sample()` (step `max(0.25, d·0.6)`, refined by bisection) because the field is only approximately an SDF. Bugs and projectiles will test `sample()` and the gradient (`normal()`) directly: this is cheaper than rebuilding a collider after every explosion and gives normals for free. Caution: the minimum step of 0.25 can pass through walls thinner than that.

## Explosions

`carve(p, r)` does `d = max(d, r - dist)` in a box around the sphere, updates `scorch` and marks as dirty the touched chunks **plus their neighbours** (they share boundary vertices). On average ~3 chunks per explosion with r=6.

## Rendering

`ChunkRenderer.sync(terrain)` re-meshes the dirty chunks and replaces the `BufferGeometry` of each `THREE.Mesh`. One material with vertex colors, hemisphere + directional light, no shadows. `stage.ts` creates the renderer, camera and controls.

## Performance path (in this order, always measuring)

1. **Web Worker for meshing.** The mesher already depends only on typed arrays, so the change is: send the grid (or just the chunk + 1 cell of margin) to the worker and get the arrays back as *transferables*. This removes the ~16 ms spikes on the main thread.
2. **WASM (Rust)** for the mesher/noise **only if** the benchmark shows JS is the limit after the Worker.
3. **Compute shaders (WebGPU)** only if CPU/WASM meshing is still the bottleneck; this needs a CPU copy of the grid for gameplay, and GPU→CPU readback has latency (tolerable in a turn-based game).
4. On the render side: per-chunk frustum culling (three.js already does it), LOD for distant chunks, and measuring on phones.

## Multiplayer (plan)

Turn-based and deterministic: client and server exchange **events** (map seed, shots with angle/power/weapon), and everyone simulates the same result. Hence the strict determinism rule. The server (technology to be decided) manages rooms and validates turn order.
