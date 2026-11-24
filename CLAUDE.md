# Bugs in the Box

Turn-based 3D artillery game that runs in the browser. Teams of "bugs" (ants, spiders, cockroaches, made-up creatures) fight inside electronic devices (the insides of PCs, speakers, fridges, guitars, microwaves, projectors...). The terrain is fully destructible and procedurally generated. Genre inspiration: Worms. **It is not a clone**: the bugs, scenarios, weapons and name are our own (see "Trademark" below).

Author: Ricardo (Marinha Grande, PT). Project priority #1: **the best possible performance**, regardless of the stack.

Current goal: **a PC demo first, as a proof of concept** (desktop browser, keyboard and mouse). Phones are a later concern: keep the on-screen pad and the measurement tools working, but do not let phone limits drive decisions for now. The default map is the large one (5×3×5 chunks, 160×96×160).

## Language

- **Everything in the repo is in English**: code, comments, docs (`README`, `docs/`, this file), UI text, commit messages and pull requests.
- **Chat with Ricardo is in Portuguese** (European Portuguese, "tu").

## Commands

```bash
npm install
npm run dev         # Vite with hot reload (http://localhost:5173)
npm run dev:lan     # same, reachable from a phone on the local network
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
    mesher.ts           ChunkMesher: Dual Contouring (sharp) or Surface Nets (smooth) per chunk, + AO and pbr (no allocations in hot loops)
    region.ts           copy the samples one chunk needs in/out of the grid (what the mesh workers receive)
    noise.ts            deterministic noise, seeded PRNG
    shading.ts          per-vertex color from the material id (+ grass/rock for GROUND)
    materials.ts        material ids and their colours (visual only)
    sdf.ts              SDF primitives + stamps (add/cut into a shape's bounding box)
    scenarios.ts        scenario list: generator + background/fog
    generators/         one generator per scenario: pcCase (default), speaker, fridge, microwave, desk, car; bodies.ts (hidden bodies for drawn parts); parts.ts (shared fans, cables, ribbons, placement); keyboards.ts (key layouts and their relief); carPlan.ts (the car dashboard's shape and parts, shared with the render); types.ts (TerrainGenerator, SceneLayout)
  game/               gameplay, SAME purity rule as terrain/ (no three.js, no DOM)
    bug.ts              Bug: sphere physics against the field, fixed 60 Hz tick, discrete input
    field.ts            TerrainField (what gameplay may see) + surfaceDistance
    species.ts          species as data (physics numbers + body proportions)
    spawn.ts            dropNear: deterministic spawn search
    match.ts            Match: teams, turn flow (aim -> flight -> settle), wind, explosions, damage, events
    brain.ts            computer opponent: gives the match a player's input, tries shots with the game's own code (seeded, deterministic)
    projectile.ts       shells and grenades (gravity, wind, bounces)
    weapons.ts          weapons as data (Solder Blob, Capacitor, Short Circuit, Soldering Iron; the species' own: Web Shot, Web Bow, Ant Column, Blackout Swarm)
    math.ts             rotate2: deterministic rotation without sin/cos
  render/             three.js: stage (Stage interface, key light), ChunkRenderer (1 mesh per chunk), MeshWorkers (worker pool), BugView, DrawnGround (where a foot rests: the drawn parts, not their hidden bodies), FollowCamera, labels, projectiles, aim, effects
    gpu/                the renderer, WebGPU (TSL): terrain material + glow, atmosphere (fog, glass, backdrop), god rays + bloom post, dust compute, heat shimmer, LEDs
  debug/              shared hooks for every map: ?pose, ?flythrough, ?fly, ?perf, ?res, ?hud; camera views per scenario; perf log; captures
  workers/            mesh.worker.ts (runs the mesher on a mirror grid) + message types; no three.js, no DOM
  audio/              sound, all computed (no files): dsp.ts and sounds.ts (recipes; pure, tested), sound.worker.ts (computes them), SoundEngine (Web Audio), GameSounds (match events and state -> sounds); reads the match, never changes it
  input/              Controls (keyboard + on-screen pad -> MatchInput), picking against the density field
  ui/                 DOM HUD
  bench/              benchmark shared between the in-browser button and scripts/bench.ts
  main.ts             glue: wires terrain, render, input and UI
tests/                Vitest + helpers (meshIntegrity, worlds)
scripts/bench.ts      Node benchmark
docs/                 ARCHITECTURE.md, ROADMAP.md, IDEAS.md
```

Details and rationale in `docs/ARCHITECTURE.md`. Plan in `docs/ROADMAP.md`.

## Architecture decisions (do not revert without discussion)

1. **Density, not blocks.** The terrain is a grid of float values (negative = solid). It was designed for procedural generation and smooth visuals; blocks/voxels were ruled out.
2. **Dual Contouring / Surface Nets** for meshing, in 32³ chunks, same topology (one vertex per surface cell), so both are watertight and neighbouring chunks share boundary vertices identically (tested). Built scenarios use Dual Contouring (sharp edges, decided in Phase 4); natural terrain uses Surface Nets (smooth). Not Marching Cubes.
3. **Gameplay only talks to the terrain interface**: `sample`, `normal`, `raycast`, `carve`. Nothing outside `terrain/` knows about the mesher. This lets us swap the representation or move meshing to a Worker without touching the game.
4. **Collisions against the density field, never against the mesh.** Bugs and projectiles test `sample()`/gradient. Mesh colliders are expensive to rebuild after every explosion.
5. **Determinism by seed.** A shared map is just a number. In generation and game logic: **`Math.random()` is forbidden**, as are `Math.sin/cos` and anything else that varies between devices. Use `noise.ts` (integer hash) and `createRng`. (`Math.random` is only acceptable in the UI, e.g. the "random" button.)
6. **Turn-based multiplayer = send events** (shot, angle, power), not state; every client simulates the same. That is why the determinism above is critical.
7. **Performance first, measure before optimizing.** Planned order: Worker for meshing → (only if the benchmark demands it) WASM → (only if meshing is still the bottleneck) WebGPU compute shaders. See ROADMAP.
8. **Every map renders with WebGPU** (three's `WebGPURenderer`, TSL; it falls back to WebGL2 by itself where WebGPU is missing). There is no separate WebGL path.

## Conventions

- Strict TypeScript. Everything in English (see "Language" above).
- In hot loops (`mesher.ts`, `Terrain.carve/sample`, generators): no allocations, no per-iteration closures, no temporary arrays. Reuse buffers (see `ChunkMesher`).
- `src/terrain/` does not import three.js, the DOM, or anything from `src/render`, `src/ui`, `src/input`, `src/game`.
- `src/game/` does not import three.js, the DOM, or anything from `src/render`, `src/ui`, `src/input`. It sees the terrain only through `TerrainField` (it may use `createRng` from `terrain/noise.ts`).
- The render reads `match.events` and the game state; it never changes the game state. Randomness in effects is fine (render only).
- Gameplay runs in fixed ticks (`DT` in `game/bug.ts`), never with the frame time. Rendering interpolates between ticks.
- Allowed `Math` in `src/terrain/` and `src/game/`: `floor`, `ceil`, `round`, `min`, `max`, `abs`, `sqrt`, `imul`. Not `hypot`, `sin`, `cos`, `pow`, `exp`, `log`, `random` (a test enforces this).
- Scenario parts must be at least ~2 cells thick, with gaps of at least ~2 cells: the grid has one sample per unit, and thinner parts melt into blobs.
- A new generator = one file in `terrain/generators/` that implements `TerrainGenerator`, starts with `terrain.beginGeneration()` and ends with `terrain.commitGeneration()`, plus an entry in `terrain/scenarios.ts`. It must be deterministic. Prefer SDF stamps (`sdf.ts`) for built shapes: they only touch each shape's bounding box.
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
| Bug step | ~0.5 µs per bug per tick |
| Tower Case (`pc-case`), 160×96×160 | generate ~70 ms · initial mesh ~220 ms (CPU, one thread) · explosion r=6 mean ~13 ms (on the workers) · GPU ~4 ms per frame at 2560×1440 (RTX 4070) |
| Studio Monitor (`speaker`), 160×96×160 | generate ~90 ms · initial mesh ~120 ms (CPU, one thread) · explosion r=6 mean ~8 ms (CPU bench); GPU ~3.5 ms per frame at 2560×1440 (RTX 4070) |
| Mini Fridge (`fridge`), 160×96×160 | generate ~55 ms · initial mesh ~200 ms (CPU, one thread) · explosion r=6 mean ~8 ms (CPU bench); GPU ~3.2 ms per frame at 2560×1440 (RTX 4070) |
| Microwave (`microwave`), 160×96×160 | generate ~30 ms · initial mesh ~150 ms (CPU, one thread) · explosion r=6 mean ~8 ms (CPU bench); a turntable quarter turn moves one grid cylinder (no interpolation); GPU ~3.6 ms per frame at 2560×1440 (RTX 4070) |
| Desk (`desk`), its own 320×96×160 (10×3×5, twice the scale) | generate ~130 ms · initial mesh ~150 ms (CPU, one thread) · explosion r=6 mean ~6 ms (CPU bench); GPU ~3.5 ms per frame at 2560×1440 (RTX 4070) |
| Car Dashboard (`car`), its own 320×128×160 (10×4×5, the desk's scale) | generate ~240 ms · initial mesh ~340 ms (CPU, one thread) · explosion r=6 mean ~7 ms (CPU bench); GPU ~4 ms per frame at 2560×1440 (RTX 4070) |
| Large map 160×96×160 (75 chunks, `?map=5x3x5`) | generate ~700–850 ms · initial mesh ~80–100 ms · explosion r=6 mean ~5 ms |

Target budget: one explosion must not exceed 1 frame (16 ms) on the main thread. Since Phase 3 meshing runs on workers: an explosion costs the main thread ~1–2 ms (region copy + geometry upload) on desktop, 1.8 ms on a Samsung S23 Ultra. Render target: 60 fps on desktop and phones (the S23 Ultra, high-end, holds it: p95 16.7 ms; a mid-range phone is still to be measured).

## Trademark

"Worms" is a registered trademark. Do not use the name, characters, iconic weapons (e.g. Holy Hand Grenade, Banana Bomb), sounds or art from the original game. Our bugs, weapons and scenarios are original.

## Current status

Phase 0 done: destructible SDF terrain prototype (click to explode, seed, benchmark). Phase 1 done: a controllable bug (ant, spider, cockroach) that walks, jumps, falls into craters and dies off the map, with a follow camera. Phase 2 done: local hot-seat matches (Red Ants vs Blue Spiders, 3 bugs each), turns, wind, 4 weapons, damage, knockback, fall damage, on-screen pad for mouse and touch. Phase 3 done for PC: meshing runs on a Web Worker pool, live performance readouts, the large map (5×3×5) is the default and runs at 60 fps on desktop; WASM and LOD not needed for now. Phone work is postponed (see ROADMAP). Phase 4 in progress: SDF stamps, materials, Tower Case (`pc-case`, the default; it replaced the first themed scenario, Inside a PC, now removed) on the new WebGPU render path with shared debug hooks and review tooling, Studio Monitor (`speaker`), a speaker opened up on a desk, Mini Fridge (`fridge`), a bar fridge with its door open, fought over on its shelves, Microwave (`microwave`), a microwave with its cover off whose glass turntable turns between turns, Desk (`desk`), the owner's real desk at twice the scale on its own larger map, and Car Dashboard (`car`), the owner's car with the ignition on and its glove box open, on its own map. The menu has a cinematic camera for every map. Spiders have their own ability (Web Shot and a thread, `render/webs.ts`; the Web Bow, a special attack with a cinematic scene, `render/gpu/bowScene.ts`), ants theirs (the Ant Column, a steered march with its own scene, `render/gpu/columnScene.ts`), cockroaches theirs (Hard Shell; the Blackout Swarm, called in the dark onto a marked spot, `render/gpu/broodScene.ts`). The menu picks each team's species (`?teams=ant,cockroach`) and who plays it, a player or the computer (`?players=human,normal`). Sound effects and ambience are in, all synthesized (`src/audio/`). Next: music. See `docs/ROADMAP.md`.
