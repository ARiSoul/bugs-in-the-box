# Roadmap

Each phase must end with something playable or measurable. Do not move on to the next one without green tests and benchmark.

## Phase 0 · Terrain (done)
- [x] Density grid + chunked Surface Nets
- [x] Deterministic procedural generation from a seed (`floatingIslands`)
- [x] Carving with spheres, re-meshing only the affected chunks
- [x] Mesh integrity tests, CPU benchmark, HUD with timings

## Phase 1 · First bug (done)
- [x] Generic bug (an ant made of spheres/cylinders), with proportions configurable for other species (ant, spider, cockroach)
- [x] Movement against the density field: walk on the surface (normal/gradient), jump, fall
- [x] React to craters (falls if the ground disappears); dies when leaving the map
- [x] Camera that follows the active bug
- [x] Tests: bug settles on the ground, does not pass through walls, falls after `carve`

## Phase 2 · Turns and weapons (done)
- [x] Turn manager, teams, health and damage (local hot-seat: two players on one device)
- [x] Ballistic projectiles with wind; explosion = `carve` + distance-based damage and knockback; fall damage
- [x] 4 original weapons: Solder Blob, Capacitor, Short Circuit, Soldering Iron (see IDEAS.md)
- [x] Usable 3D aiming (keyboard, plus an on-screen pad for mouse and touch): camera that follows the projectile and does not get hidden behind islands, aim direction pointer
- Not done yet: aiming by dragging on the screen, a computer opponent, a match setup screen (teams and sizes are fixed in `main.ts`)

## Phase 3 · Performance
- [x] Meshing in a Web Worker pool (removes the ~16 ms spikes): main thread ~1–2 ms per explosion
- [x] Live measurements on screen: frame time (fps, p95, worst), remesh cost on the main thread and on the workers, time until on screen; `?mesh=main` to compare; `npm run dev:lan` to open the game on a phone
- [x] Measure on a high-end phone: a Samsung S23 Ultra (Chrome) holds 60 fps (p95 16.7 ms), remesh 1.8 ms on the main thread, map generation ~150 ms once per match (numbers in ARCHITECTURE.md). Frame budget: 16.7 ms per frame, of which an explosion may use at most ~2 ms on the main thread
- [x] WASM: not now. Meshing is off the main thread and costs it < 2 ms; nothing measured points at JS as the limit. Revisit if a larger map or the mid-range phone says otherwise
- [ ] Measure on a mid-range phone too (the S23 Ultra is high-end): the real target
- [ ] Find the rare frame spikes (~58 ms) seen on the phone
- [ ] Move map generation (~150 ms on the phone) off the main thread, if the pause at match start becomes a problem
- [ ] Larger maps (e.g. 5×3×5 chunks) and LOD for distant chunks

## Phase 4 · Procedural scenarios
- [ ] Library of SDF primitives (box, cylinder, cone, torus) and boolean operations
- [ ] First themed scenario: the inside of a PC (PCB, heatsinks, capacitors, fans)
- [ ] Palette/shading per scenario
- [ ] More scenarios: speaker, fridge, guitar, microwave

## Phase 5 · Multiplayer
- [ ] Deterministic simulation validated across clients (same seed + same events = same map)
- [ ] Turn-based room server; map sharing by seed/link
- [ ] Asynchronous mode (play when you can)

## Phase 6 · Audio and polish
- [ ] Music and sound effects; scenario elements that react to the beat
- [ ] Menus, team screen, settings
- [ ] Acceptance tests on real browsers and devices

## Open questions
- Final name, art/visual style of the bugs, license.
- Whether the server is .NET or another stack (no preference: the criteria are performance and simplicity).
