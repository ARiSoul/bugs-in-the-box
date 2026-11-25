# Bugs in the Box

Turn-based 3D artillery game in the browser. Bugs (ants, spiders, cockroaches and made-up creatures) wage war inside electronic devices: the insides of PCs, speakers, fridges, guitars, microwaves. Destructible, procedurally generated terrain.

> Status: prototype (Phase 4 in progress). Local hot-seat matches: two teams take turns on one device, with wind and four weapons, from a PC's tower case to a car's dashboard. Meshing runs on Web Workers. No online play yet.

## Getting started

Requires Node 20.19+ (or 22+).

```bash
npm install
npm run dev
```

Open the address that Vite prints.

- **W / S**: walk (hold **shift** to run) · **A / D** or **← / →**: turn · **↑ / ↓**: aim higher / lower
- **Space**: jump · **hold Q** to charge, release to fire · **1–9**: weapon (the last ones are the species' own: 5, Ant Column, for ants; 5 and 6, Web Shot and Web Bow, for spiders; 5, Blackout Swarm, for cockroaches; 5, Queen's Flight, for bees) · **N**: new match · **M**: sound on/off (volume, music and room in the menu)
- Bugs crawl on anything: walk into a wall to go up it, face away from it (or walk back) to go down, over edges and under ledges. A jump lets go; so does an explosion.
- **Ants** call their nest. **Ant Column** (5), their special attack, plays a short scene, then the ant aims on the spot (**A / D**; another weapon calls it off); hold fire, release to send the column (a longer hold, a longer march). Steer it with **A / D**; it climbs what it meets, swarms the first enemy it reaches and digs the ground away under it.
- **Cockroaches** are hard to kill: **Hard Shell** takes the first blow that would kill one, once a match. **Blackout Swarm**, their special attack, puts the lights out. Only eyes show: point at a spot, click (or the fire key) to call the swarm (**W / S** move the view, right drag turns it, scroll zooms). It covers every enemy in the ring. Pick each team's species in the menu.
- **Building** (does not cost the shot, once a turn): a wall before the bug, or a bridge (a ramp) along its aim; a ghost shows where. **Hiding** (instead of a shot, until that bug's next turn or until it breaks). Every species has its own: ants **Rampart**, **Living Bridge**, **Anthill**; spiders **Silk Curtain** (it catches the first two enemy shots), **Silk Span**, **Silk Funnel**; cockroaches **Shield Wall**, **Scale Walk**, **Husk**; bees **Comb Wall**, **Comb Span**, **Wax Nest**. Two of each a match, four in all. They follow the pointer (blue: they fit, red: they do not): click to put them down, the wheel turns a wall, a bridge takes two clicks (its near end, its far end), a shelter sends the bug there; right click drops it, the fire key builds right here.
- **What things are of matters**: the Solder Blob and the Soldering Iron are fire, the Capacitor and the Short Circuit electric. Fire burns silk and splinters (from piece to piece, for two turns; soil puts it out) and melts comb into honey that holds the others. Chitin does not burn and stops arcs, but blasts tear more out of it. Thermal paste conducts a shock to everyone in it; a fuse takes all of one. A swarm that comes through webs, silk or honey loses a third of its bite. A living bridge closes a gap a turn. The aim line says what a weapon would do to what it points at.
- **Burst** (its slot, **9**): every bug may throw itself along its aim, far and fast, and land softly; twice a match, once a turn, also while getting away after a shot.
- **Mini-map** (top left): the ground from above, turned with the view, both teams' bugs and the boxes. **M** opens the whole map large, with names and health (time stands still for it too, as for reading); the sound is **K** in a match.
- **Reading**: on your turn, with the inventory or the map open (**I**, **P**, **M**), time stands still: you can read and arrange the slots, nothing else. 20 seconds of it a turn, 90 a match.
- **Boxes**: what is of use right now takes effect at once (a patch when hurt, a fuse, an overclock, springs, the crystal on your turn); the rest is kept.
- **The camera** stays where you put it: what hides the bug is drawn as thin lines, so it is seen through (**V**, or the menu, makes it move out of the way instead, as before).
- **Levels**: each species grows by itself, ten levels, with experience for every match to its end (won or lost). A level brings slots, spaces or points; a point learns a passive (six a species), and up to three are in use at once. The button on a team's card opens the page. `Levels: Equal` in the setup plays without any (the default for two players at one PC). Up to three items are kept from one match to the next. The computer is as high as its rival.
- **The hand, the slots, the inventory**: four cards are what every bug has (**1-4**). The quick slots beside them (**5-9**) hold the special attack, a wall, a bridge, a shelter and Burst to begin with; the keys stay with the places. The inventory (**I**) has a tab each for the creature's own weapons, its special attacks, its defence and the items kept: drag from it to a slot. Some boxes' content is kept (five kinds) and used later, one a turn.
- **Bees** fly (jump again in the air, three seconds a turn). **Queen's Flight** (5), their special attack: the bee is crowned, and you fly its swarm yourself: move the mouse (or **A/D** turn, **W/S** up and down), eight seconds. Every ring of pollen it flies through brings more bees and more damage. It slips along a wall it only brushes, and bursts on one it meets head on.
- **Special attacks have to load**: each team has a card that fills clockwise, a little at every turn of the team and more with the damage it does and takes. Full, any bug of the team can use it (its slot); using it empties it, calling it off does not.
- **The computer** plays the blue team unless you choose otherwise: in the menu, each team is a player or the computer (easy, normal, hard).
- **Spiders** spin silk. **Web Shot** (5) opens a web that holds any other bug: it can aim and fire, and 4 s of pulling tears it. **Web Bow** (6), its special attack, plays a short scene, then it stands and aims on the spot (**A / D**, **↑ / ↓**, or drag with the mouse; another weapon calls it off); hold fire to draw the string, release to shoot a fast, flat dart that hurts only what it hits and bursts into a great web. In the air, **jump** again to hang on a thread and come down slowly, unhurt; again to let go.
- **Right drag** to turn the view (the active bug turns with it, for fine aiming); **A / D** keep turning it while the button is held · **scroll** to zoom
- The **keys** section of the menu changes the keys (saved in the browser); **default keys** brings them back.
- **free camera** (in the menu) flies freely round the current map, just to look at it: click the view to look with the mouse, **W/S/A/D** move, **Q/E** down/up, **Shift** faster, **Ctrl** slower, scroll for speed, **R** back to the start; **back to the game** leaves. The seed stays in the address, so a reload keeps the same map.
- **cinematic camera** (in the menu) flies a film-like path over the current map on its own: **Space** pauses, **← / →** skip 3 s, **R** restarts, **Esc** (or **back to the game**) leaves. Its bar hides while the mouse rests.
- On a touch screen (or with the mouse), use the pad in the bottom-right corner and tap a weapon.
- The menu lets you pick the scenario (Tower Case, Studio Monitor, Mini Fridge, Microwave, Desk, Car Dashboard) and the seed (the same seed gives the same map and match) and run a benchmark. It also shows the meshing cost; the frame time is at the top. Add `?mesh=main` to the URL to mesh on the main thread instead of the workers, to compare, and `?map=3x2x3` for the small map (size in chunks of 32; the default is 5x3x5, the Desk and the Car Dashboard, at twice the scale, have their own 10x3x5 and 10x4x5).

Each turn lasts 30 s. After a shot, the bug has 3 s to walk away. The last team with bugs left wins. On the Microwave, the glass turntable turns a quarter between turns and carries the bugs standing on it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server with hot reload |
| `npm run dev:lan` | the same, reachable from other devices on the network (open the "Network" URL on a phone) |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run preview` | serves the production build |
| `npm run test` | tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run bench` | CPU benchmark of the terrain pipeline and the bug physics |

## How it works (summary)

The terrain is a 3D density grid (negative = solid). Each 32³ chunk is turned into a mesh on Web Workers, with Dual Contouring (sharp edges, for built scenarios like the PC) or Surface Nets (smooth, for natural terrain); an explosion subtracts a sphere from the grid and only the affected chunks are re-meshed (~3 per explosion, ~5–7 ms). Maps are generated deterministically from a seed.

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), the plan in [`docs/ROADMAP.md`](docs/ROADMAP.md), and ideas for scenarios and bugs in [`docs/IDEAS.md`](docs/IDEAS.md). To work on the code with Claude Code, see [`CLAUDE.md`](CLAUDE.md).

## License

To be decided.
