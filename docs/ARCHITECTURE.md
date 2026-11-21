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

## Bugs (`src/game/`)

`src/game/` is pure like `src/terrain/`: no three.js, no DOM. It sees the terrain only through `TerrainField` (`sample`, `raycast` and the world size), which `Terrain` satisfies.

- **Species** (`species.ts`): one data object per species. Physics reads the radius and the movement numbers; the renderer reads the body proportions (legs, body length, abdomen, head, antennae, colors). A new species is new data, not new code.
- **Fixed timestep.** `Bug.step` advances one tick of `DT = 1/60` s with one discrete input (`move`, `turn`, `jump`). `main.ts` runs as many ticks as real time requires and renders between the last two ticks (interpolation), so the simulation does not depend on the frame rate.
- **Collision.** The bug is one sphere. `surfaceDistance` estimates the distance to the nearest surface as `sample / |gradient|` (central differences, half a cell). It divides only when `|gradient| > 1`: that corrects the ground, which is generated as a vertical distance and overestimates on slopes; in concave corners the gradient averages two normals (`|gradient| < 1`) and dividing would let the sphere sink into walls.
- **Contacts.** A contact with normal Y ≥ 0.64 (~50°) is ground, anything else is wall or ceiling. Ground contacts push the sphere straight up, so a bug standing on a slope does not creep downhill; walls push along their normal. Velocity into the surface is removed.
- **Walking.** While grounded, the facing is projected onto the ground plane and kept at full speed. After moving, the bug is pulled down by up to 0.3 units to stay on slopes and bumps; if there is no ground within that distance it starts falling. That is also how it reacts to craters: no special case for `carve`.
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

Render side: `UnitLabel` (name and health above each bug, redrawn only on change), `FloatingTexts`, `ProjectileViews`, `LineFlashes` (arcs, tunnels), `AimView` (a short pointer of fixed length along the aim: it shows the direction only, never the range, so it cannot be read as where the shot lands; plus the active-bug marker). The camera follows the first projectile in flight, otherwise the active bug. When terrain (a floating island) is between the target and the camera, `FollowCamera.avoid` moves the camera in front of it at once, with a `raycast` against the density field, and eases back to the player's zoom distance once the view is clear. `Controls` turns keys and the on-screen pad (`[data-code]` buttons, pointer events: mouse and touch) into `MatchInput`. In dev builds, shift+click blows up the terrain under the pointer.

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
