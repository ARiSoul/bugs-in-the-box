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
- **Cockroaches** are hard to kill: **Hard Shell** takes the first blow that would kill one, once a match. **Blackout Swarm** (5), their special attack, puts the lights out. Only eyes show: point at a spot, click (or the fire key) to call the swarm (**W / S** move the view, right drag turns it, scroll zooms). It covers every enemy in the ring. Pick each team's species in the menu.
- **Building** (does not cost the shot, once a turn): a **Solder Wall** before the bug, or a **Solder Bridge** along its aim; a ghost shows where. **Hiding** (instead of a shot, until that bug's next turn or until it breaks): ants **Burrow**, cockroaches **Flatten**, bees make a **Wax Cell**, spiders put up a **Silk Screen** that catches two enemy shots. Two of each kind a match, four in all per team.
- **Bees** fly (jump again in the air, three seconds a turn). **Queen's Flight** (5), their special attack: the bee is crowned, and you fly its swarm yourself: move the mouse (or **A/D** turn, **W/S** up and down), eight seconds. Every ring of pollen it flies through brings more bees and more damage. It slips along a wall it only brushes, and bursts on one it meets head on.
- **Special attacks have to load**: each team has a card that fills clockwise, a little at every turn of the team and more with the damage it does and takes. Full, any bug of the team can use it (5 or 6, or click the card); using it empties it, calling it off does not.
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
