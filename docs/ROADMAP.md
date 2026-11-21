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
- [ ] Meshing in a Web Worker (removes the ~16 ms spikes)
- [ ] Measure on a mid-range phone; set the frame budget
- [ ] Decide on WASM based on the numbers, not on instinct
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
