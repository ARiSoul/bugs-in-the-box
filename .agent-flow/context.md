# Workspace context — Bugs in the Box

<!-- Written by Agent Flow Studio. The agents of this workspace's flows read it as background. One section per root (folder or repository), kept by the context keeper; the notes section is yours. -->

<!-- afs:begin app -->
## app — `G:\repos\bugs-in-the-box`

### What it is
**Bugs in the Box** (`G:\repos\bugs-in-the-box`, package `bugs-in-the-box` 0.1.0) is a turn-based 3D artillery game that runs in the browser. Teams of bugs fight inside devices (and on a desk and a car dashboard) on destructible, procedurally generated terrain. The genre is inspired by Worms but the game is not a clone: never use Worms names, characters, weapons, sounds or art. Status: prototype, Phase 4 (procedural scenarios) in progress, with local hot-seat matches and no online play yet. The current goal is a demo on desktop PCs; phone work is postponed. (README.md, CLAUDE.md)

### Stack
- TypeScript (strict, `typescript ^7.0.2`), ES modules, Node >= 20.19 (or 22+).
- three.js `^0.187.0`. Every map renders with `WebGPURenderer` + TSL, which falls back to three's WebGL2 backend by itself (no dust compute or GPU timestamps there). The separate WebGL path was removed.
- Vite `^8.3.8` (build target es2022, `base: './'`), Vitest `^5.1.1`, tsx for scripts.
- Meshing runs in a pool of Web Workers (`cores − 1`, at most 4).

### Layout
- `index.html` and `src/main.ts`: the entry point, which wires terrain, render, input and UI.
- `src/terrain/`: the density grid (`Terrain.ts`: sample/normal/raycast/carve), `mesher.ts` (Dual Contouring for built scenarios, Surface Nets for natural terrain, 32³ chunks), `region.ts`, `noise.ts` (seeded PRNG), `sdf.ts` (SDF stamps), `materials.ts`, `shading.ts`, `constants.ts`, `scenarios.ts`.
- `src/terrain/generators/`: `pcCase`, `speaker`, `fridge`, `microwave`, `desk`, `car` (with `carPlan.ts`, the car's shape, shared with the render), and the shared `parts.ts`, `keyboards.ts`, `bodies.ts` (hidden `COLLIDER` bodies for drawn parts) and `types.ts` (`TerrainGenerator`, `SceneLayout`, `Feature`).
- `src/game/`: gameplay. `bug.ts` (fixed 60 Hz tick `DT`; bugs crawl on any surface), `field.ts`, `species.ts`, `spawn.ts`, `match.ts` (turns, wind, damage, turntable, webs, events), `projectile.ts`, `weapons.ts`, `math.ts`.
- `src/render/`: `stage.ts` (the `Stage` interface, key light), `ChunkRenderer.ts`, `MeshWorkers.ts`, `BugView.ts`, `drawnGround.ts` (where feet rest: the drawn parts, not their hidden bodies), `webs.ts` (spider silk), `followCamera.ts`, labels, projectiles, aim, effects.
- `src/render/gpu/`: `gpuStage.ts` (the renderer, post effects), `terrainMaterial.ts`, atmosphere, dust, heat, LEDs, glow, overlays, craters, per-scenario drawn parts (`carParts`, `carTextures`, `deskParts`, `microwaveParts`, `speakerParts`), and the Web Bow's cinematic scene (`bowScene.ts`, `bowCamera.ts`).
- `src/workers/`: `mesh.worker.ts` and `meshProtocol.ts`.
- `src/input/` (controls, picking), `src/ui/` (`hud.ts`, `keys.ts` for remappable keys), `src/bench/explosions.ts`.
- `src/debug/`: `hooks.ts` (URL hooks), `views.ts` (camera views per scenario), `camera.ts`, `perf.ts`, `capture.ts`.
- `tests/`: `*.test.ts` plus `helpers/` (`meshIntegrity.ts`, `worlds.ts`, and `floatingIslands.ts`, now only a test generator).
- `scripts/`: `bench.ts`, `topview.ts` (top-down map of a layout), `review-pack.sh` (uses ffmpeg), `capture-poses.md` (visual review procedure).
- `docs/`: `ARCHITECTURE.md`, `ROADMAP.md`, `IDEAS.md`. `public/textures/screen-game.jpg`: a texture.
- `.agent-flow/`: the Agent Flow Studio workspace (root `app`, environment `dev`, flow `map-creator-prompt`).

### Scenarios (`src/terrain/scenarios.ts`)
| id | Name | Default size in chunks | Notes |
|---|---|---|---|
| `pc-case` (default) | Tower Case | 5×3×5 | |
| `speaker` | Studio Monitor | 5×3×5 | |
| `fridge` | Mini Fridge | 5×3×5 | spawns on any level (`spawnLevels`) |
| `microwave` | Microwave | 5×3×5 | `spawnLevels`; the turntable turns a quarter between turns |
| `desk` | Desk | 10×3×5 | `spawnLevels`, twice the scale |
| `car` | Car Dashboard | 10×4×5 | `spawnLevels`, `confine` keeps bugs inside the car |

Inside a PC and the floating islands scenario were removed. An unknown id falls back to the first entry.

### Weapons and species
- Species: ant, spider, cockroach (data in `species.ts`). Weapons are data in `weapons.ts`: Solder Blob, Capacitor, Short Circuit, Soldering Iron for all; Web Shot and Web Bow (special attack with a cinematic scene) for spiders, Ant Column (special) for ants, Blackout Swarm (special) and Hard Shell for cockroaches. The menu picks each team's species and who plays it: a player or the computer (`src/game/brain.ts`, three skills). Sound is synthesized (`src/audio/`).
- Next planned: music, a setup screen for the teams, balance, more specials (docs/IDEAS.md), online play (docs/ROADMAP.md).

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
- URL options: `?scenario=<id>`, `?seed=<n>`, `?mesh=main` (mesh on the main thread), `?map=3x2x3` (size in chunks).
- Debug URL hooks: `?pose=<n>`, `?flythrough=1`, `?fly=1`, `?perf=1`, `?res=2560x1440`, `?hud=0|1`. The menu's free and cinematic cameras reload the page with `?fly=1` and `?flythrough=1`.

### Conventions (from CLAUDE.md)
- **Language:** everything in the repo is in English (code, comments, docs, UI, commits, PRs). Chat with the owner is in European Portuguese.
- **Commit messages:** a short subject that says what changed, often prefixed by the area, e.g. `Desk: ...` or `Web Bow: ...`.
- **Branches:** only `main` exists, locally and on origin. The studio treats `main` as protected (work branch and draft PR).
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
- **Architecture decisions** listed in CLAUDE.md (density not blocks, DC/Surface Nets, events-based multiplayer, WebGPU for every map…) must not be reverted without discussion.

### Key files to read first
- `CLAUDE.md`: rules, structure, reference performance numbers and current status.
- `docs/ARCHITECTURE.md`: the rationale for rendering, workers, the debug hooks and each scenario.
- `docs/ROADMAP.md`: the plan. `docs/IDEAS.md`: ideas for scenarios, bugs and abilities.
- New scenario: `src/terrain/scenarios.ts`, `generators/types.ts`, `parts.ts`, `bodies.ts`, `sdf.ts`; `src/debug/views.ts` for its camera views; an existing one such as `desk.ts` with `render/gpu/deskParts.ts` and `tests/desk.test.ts`.
- Gameplay: `src/game/match.ts`, `bug.ts`, `weapons.ts`.
- Rendering: `src/render/stage.ts`, `src/render/gpu/gpuStage.ts`.

### Be careful about
- `dist/`, `node_modules/`, `coverage/`, `captures/`, `.env*` (except `.env.example`) and `.claude/settings.local.json` are git-ignored. Never commit them.
- `vite.config.ts` has a dev-only `/__capture` endpoint that writes PNG/JPG files into `captures/`.
- Drawn parts and their hidden bodies must agree: what a bug can reach must be solid, and bugs stand on what is drawn (`bodies.ts`, `drawnGround.ts`).
- Explosions have a budget of ≤16 ms per frame. Measure before optimizing, in this order: workers, then WASM, then WebGPU compute.
- Visual review needs a running dev server and ffmpeg for `review-pack.sh`.

<!-- afs:end app -->
