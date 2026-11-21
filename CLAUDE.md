# Bugs in the Box

Turn-based 3D artillery game that runs in the browser. Teams of "bugs" (ants, spiders, cockroaches, made-up creatures) fight inside electronic devices (the insides of PCs, speakers, fridges, guitars, microwaves, projectors...). The terrain is fully destructible and procedurally generated. Genre inspiration: Worms. **It is not a clone**: the bugs, scenarios, weapons and name are our own (see "Trademark" below).

Author: Ricardo (Marinha Grande, PT). Project priority #1: **the best possible performance**, regardless of the stack.

## Language

- **Everything in the repo is in English**: code, comments, docs (`README`, `docs/`, this file), UI text, commit messages and pull requests.
- **Chat with Ricardo is in Portuguese** (European Portuguese, "tu").

## Commands

```bash
npm install
npm run dev         # Vite with hot reload (http://localhost:5173)
npm run test        # Vitest: mesh integrity, determinism, carve, raycast
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build into dist/
npm run bench       # CPU benchmark of the terrain pipeline (no rendering)
```

Before any commit: `npm run typecheck && npm run test`. For changes in `src/terrain/` or the mesher: also run `npm run bench` and compare against the reference numbers below.

## Structure

```
src/
  terrain/            game core, NO dependency on three.js or the DOM (so it can move to a Worker/WASM)
    Terrain.ts          density grid + sample/normal/raycast/carve + set of dirty chunks
    mesher.ts           Surface Nets per chunk (no allocations in hot loops)
    noise.ts            deterministic noise, seeded PRNG
    shading.ts          per-vertex color (provisional, depends on the scenario)
    generators/         one generator per scenario; today only floatingIslands (generic test scenario)
  render/             three.js: stage (renderer/camera/lights), ChunkRenderer (1 mesh per chunk), effects
  input/              mouse picking against the density field
  ui/                 DOM HUD
  bench/              benchmark shared between the in-browser button and scripts/bench.ts
  main.ts             glue: wires terrain, render, input and UI
tests/                Vitest + helpers (meshIntegrity)
scripts/bench.ts      Node benchmark
docs/                 ARCHITECTURE.md, ROADMAP.md, IDEAS.md
```

Details and rationale in `docs/ARCHITECTURE.md`. Plan in `docs/ROADMAP.md`.

## Architecture decisions (do not revert without discussion)

1. **Density, not blocks.** The terrain is a grid of float values (negative = solid). It was designed for procedural generation and smooth visuals; blocks/voxels were ruled out.
2. **Surface Nets** for meshing (simpler and fewer triangles than Marching Cubes). In 32³ chunks; neighbouring chunks share boundary vertices identically (tested: watertight mesh).
3. **Gameplay only talks to the terrain interface**: `sample`, `normal`, `raycast`, `carve`. Nothing outside `terrain/` knows about the mesher. This lets us swap the representation or move meshing to a Worker without touching the game.
4. **Collisions against the density field, never against the mesh.** Bugs and projectiles test `sample()`/gradient. Mesh colliders are expensive to rebuild after every explosion.
5. **Determinism by seed.** A shared map is just a number. In generation and game logic: **`Math.random()` is forbidden**, as are `Math.sin/cos` and anything else that varies between devices. Use `noise.ts` (integer hash) and `createRng`. (`Math.random` is only acceptable in the UI, e.g. the "random" button.)
6. **Turn-based multiplayer = send events** (shot, angle, power), not state; every client simulates the same. That is why the determinism above is critical.
7. **Performance first, measure before optimizing.** Planned order: Worker for meshing → (only if the benchmark demands it) WASM → (only if meshing is still the bottleneck) WebGPU compute shaders. See ROADMAP.

## Conventions

- Strict TypeScript. Everything in English (see "Language" above).
- In hot loops (`mesher.ts`, `Terrain.carve/sample`, generators): no allocations, no per-iteration closures, no temporary arrays. Reuse buffers (see `SurfaceNetsMesher`).
- `src/terrain/` does not import three.js, the DOM, or anything from `src/render`, `src/ui`, `src/input`.
- A new generator = one file in `terrain/generators/` that implements `TerrainGenerator` and ends with `terrain.commitGeneration()`. It must be deterministic.
- Any change to the mesher/terrain must keep the integrity tests green (zero open edges, >99% of faces facing outward, no degenerate faces).
- Do not commit `dist/` or `node_modules/`.

## Reference numbers (96×64×96, 18 chunks, ~100k triangles)

Measured on Node 22 in a cloud VM (one core). They serve as a regression baseline; re-measure on Ricardo's PC.

| | |
|---|---|
| Generate map | ~60–270 ms |
| Initial mesh (18 chunks) | ~30–80 ms |
| Explosion r=6 (carve + remesh of ~3 chunks) | mean ~5–7 ms · p95 ~9–18 ms |
| Remesh per chunk | ~2–3 ms |

Target budget: one explosion must not exceed 1 frame (16 ms) on the main thread; once meshing moves to a Worker, it stops blocking. Render target: 60 fps on desktop, to be validated on mid-range phones.

## Trademark

"Worms" is a registered trademark. Do not use the name, characters, iconic weapons (e.g. Holy Hand Grenade, Banana Bomb), sounds or art from the original game. Our bugs, weapons and scenarios are original.

## Current status

Phase 0 done: destructible SDF terrain prototype (click to explode, seed, benchmark). Next: Phase 1, the first bug walking/jumping/falling with collision against the density field. See `docs/ROADMAP.md`.
