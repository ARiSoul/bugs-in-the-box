# Workspace context — Bugs in the Box

<!-- Written by Agent Flow Studio. The agents of this workspace's flows read it as background. One section per root (folder or repository), kept by the context keeper; the notes section is yours. -->

<!-- afs:begin app -->
## app — `G:\repos\bugs-in-the-box`

### What it is
**Bugs in the Box** (`G:\repos\bugs-in-the-box`, package `bugs-in-the-box` 0.1.0) is a turn-based 3D artillery game that runs in the browser. Teams of bugs fight inside electronic devices on destructible, procedurally generated terrain. The genre is inspired by Worms but the game is not a clone: never use Worms names, characters, weapons, sounds or art. Status: prototype, Phase 4 (procedural scenarios) in progress, with local hot-seat matches and no online play yet. The current goal is a demo on desktop PCs; phone work is postponed. The default map is the large one, 5×3×5 chunks (160×96×160). (README.md, CLAUDE.md)

### Stack
- TypeScript (strict, `typescript ^7.0.2`), ES modules, Node >= 20.19 (or 22+).
- three.js `^0.187.0`, with two render paths: WebGL (`MeshStandardMaterial`) and WebGPU (`WebGPURenderer` + TSL, loaded on demand).
- Vite `^8.3.8` (build target es2022, `base: './'`), Vitest `^5.1.1` (node environment), tsx for scripts.
- Meshing runs in a pool of Web Workers (`cores − 1`, at most 4).

### Layout
- `index.html` and `src/main.ts`: the entry point, which wires terrain, render, input and UI.
- `src/terrain/`: the density grid (`Terrain.ts`: sample/normal/raycast/carve), `mesher.ts` (Dual Contouring for built scenarios, Surface Nets for natural terrain, 32³ chunks), `region.ts`, `noise.ts` (seeded PRNG), `sdf.ts` (SDF stamps), `materials.ts`, `shading.ts`, `scenarios.ts` (scenario ids `pc` (default), `pc-case`, `speaker`, `islands`), and `generators/` (`insidePC`, `pcCase`, `speaker`, `floatingIslands`, shared `parts.ts`, `types.ts`).
- `src/game/`: gameplay. `bug.ts` (physics with a fixed 60 Hz tick, `DT`), `field.ts`, `species.ts`, `spawn.ts`, `match.ts` (turns, wind, damage, events), `projectile.ts`, `weapons.ts`, `math.ts`.
- `src/render/`: three.js. `stage.ts` (the `Stage` interface and the WebGL path), `ChunkRenderer.ts`, `MeshWorkers.ts`, `BugView.ts`, `followCamera.ts`, labels, projectiles, aim and effects. `render/gpu/` holds the WebGPU path: terrain material, atmosphere, god rays and bloom (`gpuStage.ts`), dust compute, heat, LEDs, overlays and craters.
- `src/workers/`: `mesh.worker.ts` and `meshProtocol.ts`.
- `src/input/` (controls, picking), `src/ui/hud.ts`, `src/bench/explosions.ts`.
- `src/debug/`: URL hooks `?pose`, `?flythrough`, `?fly`, `?perf`, `?res`, `?hud`, per-scenario views and captures.
- `tests/`: `*.test.ts` files plus `helpers/` (`meshIntegrity.ts`, `worlds.ts`).
- `scripts/`: `bench.ts` (Node benchmark), `topview.ts` (prints a top-down map of a layout), `review-pack.sh` (uses ffmpeg) and `capture-poses.md` (visual review procedure).
- `docs/`: `ARCHITECTURE.md`, `ROADMAP.md` (phases 0–6), `IDEAS.md`.

### Build, run and test
```bash
npm install
npm run dev         # Vite on http://localhost:5173 (also .claude/launch.json "dev")
npm run dev:lan     # vite --host (reach it from a phone)
npm run build       # tsc --noEmit && vite build -> dist/
npm run preview
npm run test        # vitest run (tests/**/*.test.ts)
npm run test:watch
npm run typecheck   # tsc --noEmit
npm run bench       # tsx scripts/bench.ts (terrain pipeline + bug physics, CPU)
```
- Before any commit, run `npm run typecheck && npm run test`.
- For changes in `src/terrain/` or the mesher, also run `npm run bench` and compare with the reference numbers in CLAUDE.md.
- URL options: `?scenario=<id>`, `?mesh=main` (mesh on the main thread), `?map=3x2x3` (small map).

### Conventions (from CLAUDE.md)
- **Language:** everything in the repo is in English (code, comments, docs, UI, commits, PRs). Chat with the owner is in European Portuguese.
- **Commit messages:** a short subject, often prefixed by the area, e.g. `Studio Monitor: ...` or `Docs: ...`.
- **Branches:** one per phase (`phase-1-first-bug` … `phase-4-scenarios`, the current one). `main` is protected.
- **Boundaries:** `src/terrain/` and `src/game/` must not import three.js, the DOM, or render/ui/input code. Game code sees the terrain only through `TerrainField`.
- **Determinism by seed:**
  - In terrain and game code, only these `Math` functions are allowed: `floor`, `ceil`, `round`, `min`, `max`, `abs`, `sqrt`, `imul`.
  - `random`, `sin`, `cos`, `pow`, `exp`, `log` and `hypot` are forbidden there, and a test enforces this.
  - Use `noise.ts` and `createRng` instead.
- **Collisions** are tested against the density field, never against the mesh.
- **Render vs game:** the render reads `match.events` and never changes the game state. Gameplay runs in fixed ticks, not with the frame time.
- **Hot loops** (mesher, carve/sample, generators): no allocations, closures or temporary arrays.
- **New scenario:**
  - Add one file in `terrain/generators/` that implements `TerrainGenerator`.
  - It starts with `terrain.beginGeneration()` and ends with `terrain.commitGeneration()`.
  - Add an entry in `terrain/scenarios.ts`.
  - Parts must be at least ~2 cells thick, with gaps of at least ~2 cells.
- **Mesh integrity tests must stay green:** zero open edges, more than 99% of faces facing outward, no degenerate faces.
- **Architecture decisions** listed in CLAUDE.md (density not blocks, DC/Surface Nets, events-based multiplayer…) must not be reverted without discussion.

### Key files to read first
- `CLAUDE.md`: rules, structure, reference performance numbers and current status.
- `docs/ARCHITECTURE.md`: the rationale for rendering, workers, the debug hooks and each scenario.
- `docs/ROADMAP.md`: the plan.
- New scenario: `src/terrain/scenarios.ts`, `src/terrain/generators/types.ts`, `parts.ts`, `sdf.ts`.
- Gameplay: `src/game/match.ts`, `bug.ts`, `weapons.ts`.
- Rendering: `src/render/stage.ts`, `src/render/gpu/gpuStage.ts`.

### Be careful about
- `dist/`, `node_modules/`, `captures/` and `.env*` are git-ignored. Never commit them.
- `vite.config.ts` has a dev-only `/__capture` endpoint that writes PNG/JPG files into `captures/`.
- Explosions have a budget of ≤16 ms per frame. Measure before optimizing, in this order: workers, then WASM, then WebGPU compute.
- Switching between the WebGL and WebGPU render paths reloads the page, because a canvas keeps one context type.
- Visual review needs a running dev server and ffmpeg for `review-pack.sh`.
- `.claude/settings.local.json` is ignored.

<!-- afs:end app -->
