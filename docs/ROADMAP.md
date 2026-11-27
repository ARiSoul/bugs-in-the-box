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
- Not done yet: turning the bug by dragging on a touch screen (the right mouse button does it on PC), a computer opponent, an editor for teams' names

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
- [x] Building and hiding: a wall, a bridge and a shelter of each species' own, limits per kind and in all, the hand in three parts; the other ideas one prototype at a time (IDEAS); boxes that give more
- [ ] Abilities per species: spider done (Web Shot, the thread, Web Bow), the ant's done (Ant Column and Titan Lift, its own Burrow; Acid Charge and Lightning Mandible for later, in IDEAS; a team takes one special, picked on its setup card; unlocking by playing still to come); the cockroach done (Hard Shell, Blackout Swarm; the other ideas in IDEAS); the bee done (flight, Queen's Flight); each team's species is picked in the menu

## Settings and admins (proposed)

- [ ] One registry of settings (id, value, unit, range, what it does), by module, instead of constants spread over the code: limits, times, speeds, damage, texts
- [x] The client's data, offline first: IndexedDB (Dexie) under a cache, an outbox and a sync engine for any server (`src/data/`); the old `localStorage` values brought in
- [ ] A match takes a frozen, numbered set of settings (as it takes a seed): every client must simulate with the same
- [ ] An admin page that edits a set live (first local, in dev; then behind a server with accounts and roles, with history and undo). Numbers of the simulation change from the next match on; looks, sounds and texts at once

## One linked engine, RPG style (begun: one list of actions with tags, quick slots, an inventory, kept items, levels and passives, the first tags that meet)

Everything that affects something else goes through the same five pieces, as data in the settings registry:

- **Attributes** of a bug: a base and modifiers (health, speed, jump, damage, defence, luck)
- **Effects**: states with a duration, stacks and rules (held, burnt, wet, sheltered, overclocked)
- **Triggers**: "when X, do Y" (hit, box opened, turn begins), in a fixed order, so every client simulates the same
- **Abilities**: attacks, specials, building and hiding in one format (cost, charge, limit, target, effects); limits become resources that items and levels change
- **Progression**: what stays between matches (experience, levels, skills chosen, items kept); it enters a match at its start, like the seed
- **Tags** (fire, electric, silk, wax, resin, metal, wet) link them: a rule looks at the tag, not at the weapon's name

Order: 1 the base, the game unchanged (whole matches compared tick by tick; **done**: `src/game/engine/`, golden replays) · 2 items, shelters, webs and shell moved over, one at a time (**done**: `conditions.ts`, `unit.ts`) · 3 every attack in the one format (**done**: `AbilityDef`, `Resources`, `abilities.ts`) · 4 tags and the first five combinations (**done** as an engine piece, `Reactions`, reaching bugs' effects too; new combinations to come one at a time) · 5 the local settings page · 6 progression.

To be decided: who evolves (recommended: the species, per player) · whether levels give power (recommended: options, not strength) · whether interactions reach one's own team (recommended: yes).

## Backlog (from playing)

- [x] **Burst** (every species, twice a match, once a turn, also while getting away): it throws itself along its aim, far and fast, and lands softly; the computer uses it too, and lays bridges
- [x] **Mini-map**: the ground from above, turned with the view, the bugs by team, the boxes
- [ ] Perks for the mini-map: a ghost that does not show on the others' (`Minimap.shows`)
- [ ] Reading time over the network: the pause is an event of the match's, with its limits
- [x] **Explosions like the builds' holes**: every crater uneven, its own shape for the place (deterministic, the same in the simulation and in what is drawn over the terrain), its walls the material's broken inside (matte), and lumps of the ground thrown out round it
- [x] **Burrow and the ground**: the tunnel keeps solid ground under it (it runs shallower under thin ground, ends short where the ground gives out, and cannot start on a thin top); hard materials (metal, marble, ferrite; `HARD` in `terrain/materials.ts`) cannot be dug, and blasts still break them; the tunnel stays a part of the map: bugs walk in at either mouth and through it by their own physics (its ways down and up gentle, their tops open cuts; a bug in it drawn gently to its middle line), seen from above with the ground over it seen through
- [ ] Burrow, later: the computer using tunnels; the microwave has nothing an ant can dig (all metal and marble)

## Phase 5 · Multiplayer
- [ ] Deterministic simulation validated across clients (same seed + same events = same map)
- [ ] Turn-based room server; map sharing by seed/link
- [ ] Asynchronous mode (play when you can)

## Phase 6 · Audio and polish
- [x] Sound effects: every weapon, the bugs, the turns, both special attacks' scenes, an ambience and an echo per map; all computed in code (no audio files)
- [x] Skill loader: special attacks load (by turn, damage done and taken) on a card per team
- [x] Computer opponent (`game/brain.ts`): easy, normal, hard; either team, or both
- [x] Music: a theme per map, computed in code, in three layers that follow the match
- [ ] Scenario elements that react to the beat (`MusicEngine.beat`)
- [ ] Menus, team screen, settings
- [ ] Acceptance tests on real browsers and devices

## Open questions
- Final name, art/visual style of the bugs, license.
- Whether the server is .NET or another stack (no preference: the criteria are performance and simplicity).
