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
- Not done yet: turning the bug by dragging on a touch screen (the right mouse button does it on PC), a computer opponent, a match setup screen (teams and sizes are fixed in `main.ts`)

## Phase 3 · Performance (done for PC)

Goal now: a PC demo first, as a proof of concept. The phone items below are postponed, not dropped.

- [x] Meshing in a Web Worker pool (removes the ~16 ms spikes): main thread ~1–2 ms per explosion
- [x] Live measurements on screen: frame time (fps, p95, worst), remesh cost on the main thread and on the workers, time until on screen; `?mesh=main` to compare; `npm run dev:lan` to open the game on a phone
- [x] Measure on a high-end phone: a Samsung S23 Ultra (Chrome) holds 60 fps (p95 16.7 ms), remesh 1.8 ms on the main thread, map generation ~150 ms once per match (numbers in ARCHITECTURE.md). Frame budget: 16.7 ms per frame, of which an explosion may use at most ~2 ms on the main thread
- [x] WASM: not now. Meshing is off the main thread and costs it < 2 ms; nothing measured points at JS as the limit. Revisit if a larger map or the mid-range phone says otherwise
- [ ] Later (phones): measure on a mid-range phone too (the S23 Ultra is high-end)
- [ ] Later (phones): find the rare frame spikes (~58 ms) seen on the phone
- [ ] Move map generation off the main thread (~350 ms on PC for the large map), if the pause at match start becomes a problem
- [x] Larger maps: 5×3×5 is now the default (`?map=3x2x3` for the small one) (75 chunks, 160×96×160, ~340k triangles). The generator scales the number of islands with the floor area. On desktop: 60 fps, explosions cost the same as on the small map, generation ~350 ms and initial mesh ~120 ms in the browser
- [ ] Later (phones): measure the large map on phones
- [ ] LOD for distant chunks: not now. Desktop draws ~340k triangles at 60 fps
- [x] Camera: when terrain hides the bug it first rises (up to ~60° above the player's angle) to look over it, and only comes closer if that is not enough

## Phase 4 · Procedural scenarios
- [x] Library of SDF primitives (sphere, box, rotated box, cylinder, capsule, torus) and boolean stamps (union, smooth union, subtraction), written only into each shape's bounding box
- [x] First themed scenario: the inside of a PC (motherboard, traces, CPU cooler and fan, RAM, graphics card, PSU, capacitors, chips, cables as bridges); later replaced by Tower Case, now the default, and removed
- [x] Palette/shading per scenario: a material id per sample, a colour per material, and a background and fog colour per scenario; scenario picker in the menu (`?scenario=`)
- [x] Visual quality, step 1: shadows, image-based light and reflections, per-material roughness/metalness, ambient occlusion from the field, ACES tone mapping; design rule of at least ~2 cells for every part and gap
- [x] Visual quality, step 2: sharp edges with Dual Contouring for built scenarios (normals from the most linear neighbouring cell), hard-edge shading; Surface Nets stays for natural terrain
- [x] Tower Case (`pc-case`): a gaming tower on its side under a glass panel (AIO cooler, vertical GPU, RGB RAM, VRM heatsinks, PCIe slots, audio corner, Wi-Fi and LAN, rear I/O, SATA drives and a drive cage on the PSU shroud, rear exhaust fan), on the new WebGPU render path (height fog, god rays, bloom, glass, dust compute, heat shimmer, RGB that cycles); shared debug hooks (`?pose`, `?flythrough`, `?fly`, `?perf`, `?res`) and visual-review tooling for every later map
- [x] Studio Monitor (`?scenario=speaker`): a speaker opened up on a desk, the woofer's back as the central hill, the port as a drop into the void, the amp plate on the desk, a screwdriver as the ramp; visual-critic loop to "none"
- [x] Mini Fridge (`?scenario=fridge`): a bar fridge in a kitchen corner, door open; levels (glass shelf, wire rack, ice box, top, door bins) joined by ramps (a chopping board, a cucumber, the ice box flap); bugs spawn on any level; visual critic to "none", detail critic to "accept"
- [x] Microwave (`?scenario=microwave`): a red retro microwave with its cover off on a marble worktop; the glass turntable turns a quarter between turns, carrying the bugs on it (lossless grid quarter turns); visual critic to "none", detail critic to "accept"
- [x] Desk (`?scenario=desk`): the owner's real desk from photos (an L-shaped standing desk, three curved monitors and two laptops with pictures on them, keyboards, vertical mice, two studio speakers, a bottle, small things, cables), at twice the scale on its own 10×3×5 map (`Scenario.mapSize`) so the bugs keep their size; visual critic to "none", detail critic (macro close-ups against the owner's photos) to "accept"
- [x] Car Dashboard (`?scenario=car`): the owner's car from photos and a video, door to door, ignition on (lit instruments, flashing hazard button, the radio behind its cracked glass, a phone with a map), the steering wheel, the open glove box with its papers, on its own map (10x4x5)
- [x] Cinematic camera in the menu, for every map (the scripted flight, with pause, skip and restart)
- [ ] Abilities per species: spider done (Web Shot, the thread, Web Bow), the ant's first done (Ant Column; three more and an unlock system in IDEAS); the cockroach done (Hard Shell, Blackout Swarm; the other ideas in IDEAS); each team's species is picked in the menu

## Phase 5 · Multiplayer
- [ ] Deterministic simulation validated across clients (same seed + same events = same map)
- [ ] Turn-based room server; map sharing by seed/link
- [ ] Asynchronous mode (play when you can)

## Phase 6 · Audio and polish
- [x] Sound effects: every weapon, the bugs, the turns, both special attacks' scenes, an ambience and an echo per map; all computed in code (no audio files)
- [x] Computer opponent (`game/brain.ts`): easy, normal, hard; either team, or both
- [ ] Music; scenario elements that react to the beat
- [ ] Menus, team screen, settings
- [ ] Acceptance tests on real browsers and devices

## Open questions
- Final name, art/visual style of the bugs, license.
- Whether the server is .NET or another stack (no preference: the criteria are performance and simplicity).
