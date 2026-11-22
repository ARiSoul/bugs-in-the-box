# Architecture

## Overview

```
            ┌────────────── src/terrain (pure, no DOM/three) ───────────────────┐
 generator ▶│ Terrain: density grid + dirty chunks                               │
 (seed)     │   sample · normal · raycast · carve                                │
            │ ChunkMesher: chunk ──▶ positions, normals, colors, pbr, indices    │
            └───────────────▲──────────────────────────────┬─────────────────────┘
                            │ stable interface             │ ChunkMesh
              gameplay (bugs, projectiles, picking)        ▼
                                                   src/render: ChunkRenderer → three.js
```

The boundary that matters is the one on the left: gameplay only uses `sample`, `normal`, `raycast` and `carve`. Whatever draws (three.js today, something else tomorrow) only receives `ChunkMesh`.

## Data model

- A world of `W×H×D` cells (default 160×96×160 = 5×3×5 chunks of 32; `?map=3x2x3` gives 96×64×96). One world unit = one cell.
- Density samples at the grid points: `(W+1)(H+1)(D+1)` floats. `< 0` is solid, `> 0` is air. The value is an *approximate* signed distance (not exact after several operations), in cell units, clamped to ±6.
- The outer layer of the world is always air, so the surface is closed (no "holes" at the edges). `carve` never opens it.
- `scorch` (0–255 per sample) stores the burn mark; `material` (one id per sample, `materials.ts`) says what the surface near the sample is made of. Both are visual only and feed into the vertex colors; gameplay never reads them.
- `dirty`: the set of chunk ids to re-mesh.

## Procedural generation

A generator is `(terrain, seed) => void`; it starts with `terrain.beginGeneration()` (all air, no material, no scorch) and ends with `terrain.commitGeneration()`. Scenarios (`scenarios.ts`) pair a generator with its look (page background and fog colour); the menu and `?scenario=` pick one.

### Inside a PC (`generators/insidePC.ts`, the default)

A motherboard floating in the dark (fall off its edge and you are gone), built from SDF stamps: plated mounting holes, copper traces, a CPU socket with a tower cooler (fins) and a fan on top, four RAM sticks, a 24-pin and an 8-pin connector, a graphics card on its edge with a two-fan cooler, a power supply with a guarded fan and front vents, capacitors around the socket, a chipset with a heatsink, loose chips, and power cables that arc from the PSU to the connectors (two strands side by side: bridges). The layout scales with the map; the seed moves and varies the parts. Generating it takes ~35 ms on the large map (the islands take ~800 ms: they evaluate noise everywhere).

### SDF stamps (`sdf.ts`)

Primitives: sphere, box (rounded, optionally rotated about one axis), cylinder, capsule, torus; `distance(shape, p)` is exact. A stamp (`add` = union, optionally smooth; `cut` = subtraction) writes one shape into the grid, visiting only its bounding box plus 4 cells, so hundreds of parts stay cheap. Beyond that padding the grid keeps at most the clamp value (6), and `raycast` steps 0.6 × the sample (3.6 < 4), so it cannot jump over a part. `add` also sets the material of the samples where the shape owns the surface. Stamps never write the outer two layers (the world stays closed), and never write an exact 0 (a surface exactly on a sample would make degenerate triangles). Rotations use exact (cos, sin) pairs (e.g. √3/2 for 60°): no `Math.sin/cos`.

### Floating islands (`generators/floatingIslands.ts`)

The first test scenario combines a rolling ground (2D fBm per column), interior cave pockets (only ≥ 3 cells below the surface, hidden until someone blows them open) and floating islands (a union of rough ellipsoids).

Shapes are composed with SDF operations: union `min(a,b)`, subtraction `max(a,-b)`, intersection `max(a,b)`. The PC scenario is built this way (see SDF stamps above).

Determinism: integer-hash noise (`noise.ts`), seeded PRNG (`createRng`). No `Math.random`/`Math.sin` in generation, so the same number gives the same map on any device. The tests check this.

## Meshing (Dual Contouring / Surface Nets)

Vertex colours come from `shadeVertex` (`shading.ts`): the material of the cell's corners gives the base colour (where the corners disagree, their colours and finishes are blended, trilinear and weighted towards solid corners, so material borders follow the surface instead of stepping) (GROUND is grass on top and rock on the sides), with a little noise, darkened by scorch and by ambient occlusion. The occlusion comes from the density field itself: the mesher probes outward along the normal at 1, 2 and 3.5 cells, and where the field says something is closer than the probe, the vertex sits in a crease and gets darker (3 samples per vertex, in the worker). The mesher also writes a `pbr` attribute per vertex (roughness, metalness, glow) from the material table. Glow is signed so it blends across borders: towards +1 an RGB light, towards −1 a fan blade.

Per chunk, in three steps (`mesher.ts`):

1. **Vertices.** For each cell whose 8 corners have different signs, one vertex. Where it goes depends on the mode, chosen per scenario (`Scenario.sharpEdges`):
   - **Dual Contouring** (built scenarios, e.g. the PC): in cells that hold a sharp feature (two crossing normals more than ~37° apart), the point that best fits the tangent planes at the cell's edge crossings (a 3×3 least-squares problem, the QEF, solved around the crossings' mass point with a small bias towards it, and kept inside the cell). Box edges and corners stay sharp. The plane normals must be right: the trilinear field blurs them near an edge, so each crossing takes its normal from the most linear of the 4 cells around its grid edge (smallest trilinear cross terms): such a cell sees one face only, so its gradient is that face's normal. A test checks that a box corner off the grid comes out within 0.1 of the true corner (Surface Nets: more than 0.3 away).
   - **Surface Nets** (natural terrain, the islands): the average of the edge crossings. Smooth; it rounds every edge. Dual Contouring also uses this point in smooth cells (tubes, rounded rims): the QEF fit on a gently curved surface snaps vertices to small ridges, a saw-tooth along the curve.

   The vertex normal is the analytic gradient of the cell's trilinear interpolation. In sharp mode the terrain shader also uses the triangle's own normal where it disagrees strongly with the interpolated one, so hard edges are shaded hard.
2. **Lazy emission.** Output vertices are only created when some quad uses them.
3. **Quads.** For each grid edge with a sign change, one quad connecting the 4 cells that share it; the winding depends on which side is solid.

**Seams.** Vertices are computed over the chunk's cells `[start-1, end)` and depend only on the global grid, so two neighbouring chunks produce exactly the same vertices on their shared boundary. Each chunk emits only the quads whose source edge lies inside it, so no quad is duplicated. The tests check this (zero open edges after welding positions).

**Performance.** No allocations in hot loops; scratch buffers are reused between calls (so one mesher instance serves one thread at a time). Surface Nets ~2–3 ms per chunk; Dual Contouring about twice that (in the workers, so it does not reach the main thread).

**Known limitations.**
- Sharp round rims (a cylinder's flat top) show the grid as small steps in Dual Contouring: give round parts a rounded rim of at least ~1 cell.
- Walls thinner than ~2 cells can vanish or break up: the scenario design rule is ≥ 2 cells for parts and gaps.
- There are some non-manifold edges (≈100–200 per map); this is normal for this algorithm, and the test only checks they do not blow up.
- About 0.1% of faces end up wound against their normals in very thin geometry.
- Per-cell normals can show slight faceting; if it bothers us, smooth them with the neighbouring cells' normals.

## Collisions and picking

No mesh colliders. `raycast` does sphere tracing over `sample()` (step `max(0.25, d·0.6)`, refined by bisection) because the field is only approximately an SDF. Bugs and projectiles will test `sample()` and the gradient (`normal()`) directly: this is cheaper than rebuilding a collider after every explosion and gives normals for free. Caution: the minimum step of 0.25 can pass through walls thinner than that.

## Bugs (`src/game/`)

`src/game/` is pure like `src/terrain/`: no three.js, no DOM. It sees the terrain only through `TerrainField` (`sample`, `raycast` and the world size), which `Terrain` satisfies.

- **Species** (`species.ts`): one data object per species. Physics reads the radius and the movement numbers; the renderer reads the body proportions (legs, body length, abdomen, head, antennae, colors). A new species is new data, not new code.
- **Fixed timestep.** `Bug.step` advances one tick of `DT = 1/60` s with one discrete input (`move`, `turn`, `jump`). `main.ts` runs as many ticks as real time requires and renders between the last two ticks (interpolation), so the simulation does not depend on the frame rate.
- **Collision.** The bug is one sphere. `surfaceDistance` estimates the distance to the nearest surface as `sample / |gradient|` (central differences, half a cell). It divides only when `|gradient| > 1`: that corrects the ground, which is generated as a vertical distance and overestimates on slopes; in concave corners the gradient averages two normals (`|gradient| < 1`) and dividing would let the sphere sink into walls.
- **Contacts.** A contact with normal Y ≥ 0.64 (~50°) is ground, anything else is wall or ceiling. Ground contacts push the sphere straight up, so a bug standing on a slope does not creep downhill; walls push along their normal. Velocity into the surface is removed.
- **Walking.** While grounded, the facing is projected onto the ground plane and kept at full speed. After moving, the bug is pulled down by up to 0.3 units to stay on slopes and bumps; if there is no ground within that distance it starts falling. That is also how it reacts to craters: no special case for `carve`.
- **Climbing.** A grounded bug walking forward into an obstacle (held back, or only touching a surface too steep to stand on that faces it) climbs it at 6 units/s, as long as nothing solid is ahead at 2.6 radii above its centre and there is room above it. So it gets over cables, ledges and small parts, and walks on them; tall walls still block it. It climbs only while it keeps walking forward (the ground pull is off while it climbs).
- **Air.** Gravity, terminal speed, no air control. Moves are split into substeps of at most 0.35 radius, so the bug cannot skip through walls. The downward speed at landing is kept in `lastImpact` for fall damage later.
- **Death.** Below `y = -4` the bug has left the world. The outer shell of the box is air, so walking off the edge or falling through a hole that reaches the bottom both end there.
- **Determinism.** Only `+ - * /`, `Math.sqrt`, `Math.ceil`; turning uses a small-angle series instead of `Math.sin/cos`. A test scans `src/terrain` and `src/game` for banned `Math` functions, and another one replays 10 s of scripted input with explosions twice and compares every bit.
- **Cost.** About 0.5 µs per bug per tick (`npm run bench`).

Render side: `BugView` builds the body from spheres and cylinders, leans it into the ground normal (smoothed), and animates a tripod gait from the actual ground speed. `FollowCamera` moves the orbit camera and its target together, so the player keeps the angle and zoom; panning is off while following. `KeyboardInput` uses physical key codes (WASD works on any layout).

## Match: turns and weapons (`src/game/match.ts`)

`Match` owns the teams, the projectiles, the wind and the turn state. Like `Bug`, it advances in fixed ticks with one discrete input per tick (`MatchInput`: walk, run, turn, jump, aim, fire held, weapon). The whole match is a function of the map seed, the match seed and that input stream, which is what multiplayer will send.

- **Turn flow.** `aim` (30 s: walk, jump, aim, choose a weapon, fire) → `flight` (projectiles fly; the shooter has 3 s to retreat, without firing again) → `settle` (wait until every bug and projectile is at rest, at most 10 s; bugs at 0 health die here) → the next team that still has bugs. Teams alternate; inside a team the bugs take turns; dead bugs are skipped. Getting hurt on your own turn ends the aiming. At most one team left → `over`.
- **Aiming.** The aim pitch is a 2D unit vector `(aimH, aimV)` in the vertical plane of the bug's facing, rotated with the same small-angle series as the facing (no `sin/cos`). Holding fire charges the power for 1.2 s; releasing fires, and a full bar fires by itself.
- **Wind.** A new horizontal acceleration per turn, from the match's seeded PRNG. Each weapon says how much it feels it.
- **Projectiles** (`projectile.ts`): a point of radius 0.3 under gravity and wind, in substeps of at most 0.3 units. Shells explode on the first contact with terrain (`sample` below the radius) or with a bug (the shooter is immune for 8 ticks). Grenades bounce off the terrain (normal from `surfaceDistance`, restitution and friction per weapon), come to rest, and explode when the fuse runs out.
- **Explosions.** `carve` + damage that falls off linearly up to 1.6 blast radii from the centre (distance measured to the bug's surface) + knockback away from the centre with an upward bias. A thrown bug can take fall damage when it lands (above 15 units/s).
- **Weapons** (`weapons.ts`) are data. Short Circuit adds an arc that jumps to the nearest bugs one after another (ties go to the lower unit id, so it stays deterministic). Soldering Iron has no projectile: it carves a row of spheres along the aim.
- **Events.** Every step fills `match.events` (turn, fire, explosion, arc, dig, damage, death, over). The render reads them for effects and floating damage numbers; the game never reads them back.
- **PRNG.** `game/` uses `createRng` from `terrain/noise.ts`: a pure utility, not part of the terrain representation.

Render side: `UnitLabel` (name and health above each bug, redrawn only on change), `FloatingTexts`, `ProjectileViews`, `LineFlashes` (arcs, tunnels), `AimView` (a short pointer of fixed length along the aim: it shows the direction only, never the range, so it cannot be read as where the shot lands; plus the active-bug marker). The camera follows the first projectile in flight, otherwise the active bug. Each turn starts with a short glide to a chase view behind the active bug, looking where it walks (`FollowCamera.chase`: 15 units back and a little above; with terrain right behind the bug it first climbs, and only then comes closer). While the bug aims, the view turns with it, so forward stays into the screen; the player can still orbit and zoom. The intro glides from the scenario's start pose into that same chase view. When terrain (a floating island) is between the target and the camera, `FollowCamera.avoid` (with `raycast` against the density field) first raises the camera, in steps up to ~60° above the angle the player chose, until the view is clear; only if that is not enough does it move the camera in front of the terrain. It keeps the player's own angle and zoom apart from its corrections, and eases back to them once the view is clear. `Controls` turns keys and the on-screen pad (`[data-code]` buttons, pointer events: mouse and touch) into `MatchInput`. In dev builds, shift+click blows up the terrain under the pointer.

## Explosions

`carve(p, r)` does `d = max(d, r - dist)` in a box around the sphere, updates `scorch` and marks as dirty the touched chunks **plus their neighbours** (they share boundary vertices). On average ~3 chunks per explosion with r=6.

## Rendering

One `MeshStandardMaterial` for all terrain, patched (`onBeforeCompile`) to take roughness and metalness per vertex from the `pbr` attribute, so metal reflects and plastic does not. Light: an image-based environment (three's `RoomEnvironment` through PMREM) for soft fill and reflections, a weak hemisphere light, and one directional key light with soft shadows (4096² map over the whole map; terrain and bugs cast and receive). ACES tone mapping. `stage.ts` creates the renderer, camera and controls. `ChunkRenderer.apply(id, mesh)` replaces the `BufferGeometry` of a chunk's `THREE.Mesh`. The meshes come from the worker pool (below); `ChunkRenderer.sync(terrain)` meshes on the main thread instead (fallback, `?mesh=main`, and the benchmark button).

### Render paths

Each scenario picks a render path (`Scenario.render`); the HUD's scenario picker reloads the page when the path changes (a canvas keeps one context type). `Stage` (`render/stage.ts`) is the interface both implement: scene, camera, controls, the terrain material (`TerrainLook`), `setScenario(sc, layout)`, `render(seconds, dt)`, and an optional GPU timer.

- **`webgl`** (`stage.ts`): the classic look above.
- **`webgpu`** (`render/gpu/`, loaded with a dynamic import only when a scenario needs it): three's `WebGPURenderer` with TSL node materials. On top of the same scene graph:
  - `terrainMaterial.ts`: the terrain material in TSL (same inputs), plus glow: RGB diffusers show one shared hue that sweeps teal→magenta (render-only time, `glow.ts`; every hue is scaled to one level, a mix of luminance and the strongest channel, with pure blue lifted towards a real blue LED so it does not read dim), and fan blades carry a bright stripe that turns, so static blades read as spinning.
  - `atmosphere.ts`: distance fog measured from the camera (clear for ~40 units, the scenario's fog colour by ~150), a thin floor layer tinted by the nearby RGB lights, corners that fall to near-black, the dark-room backdrop, and the render-only glass panel (Fresnel, green edge tint, procedural smudges, the key light's highlight).
  - Post (`gpuStage.ts`): one MSAA scene pass with colour, emissive and depth; half-resolution ray-marched god rays (16 steps) from the key light's shadow map, which is fitted tightly around the enclosure so the rays stay inside it; bloom of the emissive buffer only; heat shimmer; ACES.
  - `dust.ts`: 3,000 seeded dust motes advected by an analytic airflow in a compute shader; drawn as sprites never smaller than ~1.6 px (they fade instead of flickering).
  - `heat.ts`: heat shimmer, a screen-space refraction inside the projected rectangles of the layout's `heat` boxes. `leds.ts`: blinking activity LEDs.
  - Smooth stand-ins (`lightOverlays.ts`, `heroOverlays.ts`): at one sample per unit, thin or round hero parts (fan rings, light bars, fan rotors, cooler tubes and cables, pump cap, capacitors, traces, RAM bodies, solder beads, grommets, mounting screws, dust bunnies, and the generic `part` details: ports, slots, shields, drives, connectors) mesh lumpy. A `wire` is a soft cable along a polyline the generator computes (`parts.wirePath`, a Catmull-Rom curve in plain arithmetic): the SATA cables are also in the terrain (0.3 thinner than drawn, and short of the bends into their plugs), so bugs walk on them; the antenna leads are too thin and are render-only, like the dust bunnies and the wall panels. A generic `part` feature (box or cylinder, colour, metal, roughness, glow) lets a generator add small details: the terrain gets a block just inside the render shape (no coinciding surfaces, so no z-fighting), the renderer draws the clean shape. Render-only smooth meshes sit just outside the terrain surface and hide it; the terrain under them stays the real, destructible part. Every stand-in material is cut by the craters (`craters.ts`): the main loop passes each explosion and tunnel to the stage, which keeps the carved spheres (as `Terrain.carve` makes them) in a uniform array, and a `maskNode` drops the fragments inside them, in colour and in the shadow pass. So a crater opens the same round hole in a stand-in as in the terrain under it, exactly where it was hit. The rings and bars carry the RGB glow; the rotors carry the turning light stripe.
  - Key light through window blinds: shadow-only slats above the glass (on a layer that only the key light's shadow camera sees: drawn in the scene pass, even fully transparent, they would still write the emissive target and cut the bloom behind them in bands) cut the light into slanted sheets, which makes visible god rays and soft warm stripes; the dust motes shine only between the slats (computed analytically from the slat layout). The key light on this path is warmer (0xffb878) and steeper than on the WebGL path, so the stripes cross the middle of the board in the start view.
  - Emissive target blending: the scene pass writes colour and emissive (MRT); the emissive target is set to blend like the material (`MaterialBlending`), otherwise every transparent surface (glass, light sheets, labels) overwrites the emissive under it and the glow behind it loses its bloom. Glass and light sheets write emissive 0 with alpha 0, through a material `mrtNode`. Such a material cannot draw outside that MRT pass (it has no colour output there), so these meshes live on `POST_LAYER`. The camera turns that layer on only once the post pipeline exists, and shader precompiles skip it.
  - Labels: name and health plates are in a separate `hud` scene, drawn as its own pass and composited after tone mapping and FXAA, so heat shimmer, bloom and FXAA never touch them. They keep one screen size, and they are anchored by their bottom edge above the bug and snapped to whole pixels for the exact frame drawn (`placeLabels` in `main.ts`, also before every debug capture). From afar the bugs are drawn up to 1.7× larger, and they are not fogged, so they read in the dark corners (render only; physics is unchanged).
  - Light sheets (`lightSheets.ts`): one soft additive sheet per gap between the blind slats, along the light, brighter seen edge-on; the visible shafts. The ray-marched god rays give the warm veil around them.
  - Precompile: `compileAsync` after the first frames, so the first look at something new does not stall a frame on a shader compile.

  Without WebGPU the same code runs on three's WebGL2 backend, without the motes (no compute) and without timestamps.

A generator can describe its render-only features in a `SceneLayout` (`generators/types.ts`): fans, the pump, light bars, LEDs, heat boxes, the glass height and the enclosure. Gameplay never reads it.

### Debug hooks, camera work and review tooling (`src/debug/`)

Shared by every scenario: `?pose=1..6` (a fixed pose; render-only time runs at a fixed 60 Hz step for 6 s and stops, so a pose renders the same image every run), `?flythrough=1` (a 60 s closed Catmull-Rom path, tabulated at even speed and lifted where it would come within 9 units of the terrain inside the map), `?fly=1` (free camera: WASD, Q/E, mouse look with pointer lock, Shift/Ctrl, wheel for speed, R to reset), `?perf=1` (frame intervals and GPU time per frame from timestamp queries; `__debug.perfRun(60)` returns average, p99 and max; `__debug.perfDownload()` saves JSON), `?res=WxH` (fixed drawing-buffer size) and `?hud=0|1`. Poses, start view and path come from `debug/views.ts` (per scenario, with a generic fallback), derived from the map size and the layout only. `__debug.capture(name, {t, dt, jpeg})` saves the canvas through the dev server (`captures/`, git-ignored); `scripts/capture-poses.md` and `scripts/review-pack.sh` build the packet for the visual review (poses, a 10 s fly-through as video, contact sheets, consecutive-frame bursts and their differences). `scripts/topview.ts` prints a top-down map of a layout without a browser.

### Meshing workers (`src/render/MeshWorkers.ts`, `src/workers/mesh.worker.ts`)

- After each simulation step, the dirty chunks are sent to a pool of module workers (cores − 1, at most 4), spread evenly so the chunks of one explosion mesh in parallel.
- A job carries only the samples its chunk reads: the chunk's cells plus a pad of 6 samples on each side (one cell for the mesher, the rest for the ambient-occlusion probe): a box of 44³ samples, densities, scorch and material packed in one ~510 kB buffer (`terrain/region.ts`). The buffer is transferred, and it comes back with the result for reuse. The grid itself never crosses threads.
- Each worker keeps a mirror grid in which only the regions it was sent are current. That is all the mesher reads, so it runs the same `ChunkMesher` unchanged (both modes; the request says which). A test checks that a mirror mesh is bit-identical to the original for every chunk.
- The meshes are transferred back (no copy). The whole batch is applied in one frame, so neighbouring chunks of an explosion change together and the seams never open.
- Results are dropped when a newer request for the same chunk was sent (workers can finish out of order) or when the map was regenerated (`reset`).
- Gameplay never waits for meshes: it reads the density grid on the main thread, so determinism is untouched. The new crater appears one or two frames after the carve.

Measured on a desktop browser (Ricardo's PC, 4 workers), explosions of 2–8 chunks: main thread 0.3–1.6 ms (copy, post, upload), worker 2–5 ms, on screen after 2–7 ms. On the main thread the same explosions cost 2.5–11.7 ms. Initial mesh of the 18 chunks: ~15 ms until on screen. The stats line in the menu and the frame-time readout (fps · p95 · worst) show these numbers live, also on a phone.

On a Samsung Galaxy S23 Ultra (a high-end phone, 120 Hz screen; Chrome over `npm run dev:lan`): ~65 fps, p95 16.7 ms, worst frame usually ~17 ms with rare spikes up to ~58 ms (cause not found yet); a remesh costs the main thread 1.8 ms; generating the map 145–151 ms (main thread, once per match); initial mesh 36 ms warm (308 ms on the very first load, while the workers start).

## Performance path (in this order, always measuring)

1. **Web Worker for meshing.** Done (Phase 3): see "Meshing workers" above. Explosions cost the main thread ~1–2 ms instead of up to ~16 ms.
2. **WASM (Rust)** for the mesher/noise **only if** the benchmark shows JS is the limit after the Worker.
3. **Compute shaders (WebGPU)** only if CPU/WASM meshing is still the bottleneck; this needs a CPU copy of the grid for gameplay, and GPU→CPU readback has latency (tolerable in a turn-based game).
4. On the render side: per-chunk frustum culling (three.js already does it), LOD for distant chunks, and measuring on phones.

## Multiplayer (plan)

Turn-based and deterministic: client and server exchange **events** (map seed, shots with angle/power/weapon), and everyone simulates the same result. Hence the strict determinism rule. The server (technology to be decided) manages rooms and validates turn order.
