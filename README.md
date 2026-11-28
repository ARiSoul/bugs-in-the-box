# Bugs in the Box

Turn-based 3D artillery game in the browser. Bugs (ants, spiders, cockroaches, bees) wage war inside electronic devices: a PC's tower case, an opened studio monitor, a bar fridge, a microwave, a desk, a car's dashboard. The terrain is fully destructible and generated from a seed.

> **Status: a PC proof of concept** (desktop browser, keyboard and mouse). Local matches against a friend or the computer, and online matches between two players through a room server. Phones come later.

## What is in the game

- **Six maps** (Tower Case, Studio Monitor, Mini Fridge, Microwave, Desk, Car Dashboard), each with its own look, sound and music. The same seed gives the same map and the same match.
- **Four species**, each with its own trait, defences and special attacks:
  - **Ants**: Burrow (a tunnel under the ground); specials Ant Column and Titan Lift.
  - **Spiders**: Web Shot and a thread to hang by; special Web Bow.
  - **Cockroaches**: Hard Shell (outlives one blow); specials Blackout Swarm and Wing Storm.
  - **Bees**: they fly; special Queen's Flight.
- **Every bug has 100 health.** What tells the species apart is how hard each is to hurt (its toughness), its speed and its jump.
- **Weapons and tags**: fire, electricity, silk, wax, chitin... meet and react (fire burns a web free, a whole shell stops an arc, a blast shatters chitin).
- **Building and hiding**: a wall, a bridge and a shelter of each species' own.
- **Boxes** turn up on the map with items to use at once or keep.
- **Levels**: each species grows with play (ten levels, passives to learn, the second special unlocked at level 3).
- **A computer opponent** at three levels (easy, normal, hard), which uses everything a player can.
- **Online play**: rooms by a code or a link, matches in lockstep (only the inputs travel), checked by the server.
- **Settings**: every number the game is tuned by (85 of them: weapons, species, passives, rules, physics) on a page, for testing and balance.

## Getting started

You need **Node 20.19 or newer** (22+ recommended) and a desktop browser with WebGPU (recent Chrome or Edge; others fall back to WebGL2).

```bash
npm install
npm run dev
```

Open the address Vite prints (`http://localhost:5173`). The setup screen comes first: pick the map, each team's species and special, who plays each team (you or the computer), and the rules, then **PLAY**.

### Two players on one PC

Set both teams to **You** on the setup screen. The teams take turns on the same keyboard.

### Against the computer

Set a team to **Easy**, **Normal** or **Hard**.

### Online (two players, two computers)

1. Start the room server in a second terminal:

   ```bash
   npm run server
   ```

   It listens on `ws://localhost:8787` (`PORT=9000 npm run server` for another port).
2. On the setup screen, press **Online**, type your name and press **Make a room**. The page waits for the other player and shows a four-letter code and a link.
3. The other player opens the link, or presses **Online** and types the code.
4. To play from another computer on your network, start the game with `npm run dev:lan` and open its "Network" address there. The game looks for the room server on the same host, port 8787; another server is given in the address: `?server=ws://host:port`.

The match starts when both players are in. On your turn you play; on the other's turn you watch (their hand, exact aim and previews are hidden). A player who loses the connection comes back to the same seat by reloading the page.

## Controls

| | |
|---|---|
| **W / S** | walk forward / back (hold **Shift** to run) |
| **A / D** or **← / →** | turn |
| **↑ / ↓** | aim higher / lower |
| **Space** | jump (bees: again in the air to fly; spiders: again to hang on a thread) |
| **Q** (hold) | charge, release to fire |
| **1–4** | the hand: weapons every bug has |
| **5–9** | quick slots: the special attack, a wall, a bridge, a shelter, Burst (another order can be set in the inventory). A slot acts from its key or a click: Burst throws at once; a special, when loaded, starts, and its key again fires it (not loaded, it says how far it is) |
| **I** or **P** | inventory (drag weapons and items to the slots) |
| **M** | the large map |
| **K** | sound on / off |
| **V** | camera: see through walls, or move out of their way |
| **Esc** | pause (Continue, Restart, Leave match) |
| **Right drag** | turn the view (the bug turns with it, for fine aiming) · **scroll** zooms |

On your turn, with the inventory or the map open, the clock stands still (20 s a turn, 90 s a match) so you can read. Keys can be changed in the debug menu (**keys**). On a touch screen, use the pad in the bottom-right corner.

Each turn lasts 30 s (a rule on the setup screen). After a shot, the bug has 3 s to walk away. The last team with bugs left wins.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | development server with hot reload (`http://localhost:5173`) |
| `npm run dev:lan` | the same, reachable from other devices on the network |
| `npm run server` | the room server for online play (`ws://localhost:8787`; `/health` answers `{ ok, rooms }`) |
| `npm run build` | typecheck and production build into `dist/` |
| `npm run preview` | serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | all tests (Vitest), the golden replays included |
| `npm run golden` | rewrite the golden replays (only when a change is meant to change how the game plays) |
| `npm run bench` | CPU benchmark of the terrain pipeline and the bug physics |
| `npm run balance -- [seeds]` | the computer plays itself on every map, every pair of species; prints who wins, and each weapon's use. `LEVELS=3,3` plays at level 3, `SPECIALS=titan-lift,wing-storm` picks second specials |
| `npm run crosscheck -- [port] [ticks]` | with the dev server running: whole matches recorded in Node are played again in a headless Chrome and back; they must be identical, bit for bit |

Before a commit: `npm run typecheck && npm run test`.

## Address options

The game reads these from the address (the setup screen writes most of them itself):

| Option | Meaning |
|---|---|
| `?play=1` | skip the setup screen, straight into a match |
| `?scenario=desk` | the map: `pc-case`, `speaker`, `fridge`, `microwave`, `desk`, `car` |
| `?seed=1234` | the map's seed |
| `?teams=ant,cockroach` | each team's species |
| `?specials=titan-lift,wing-storm` | each team's special (empty: its species' first) |
| `?players=human,normal` | who plays each team: `human`, `easy`, `normal`, `hard` |
| `?size=3&turn=30&wind=1` | bugs a team, seconds a turn, how strong the wind may be |
| `?equal=1` | no levels in this match |
| `?room=K7QF` | an online room; `?server=ws://host:port` for another room server |
| `?map=3x2x3` | another map size, in chunks of 32 |
| `?mesh=main` | mesh on the main thread instead of the workers (to compare) |
| `?perf=1`, `?flythrough=1`, `?fly=1`, `?pose=N`, `?res=`, `?hud=0` | debug and review hooks (see `src/debug/hooks.ts`) |

## Tools for development

The **menu** box in the top-left corner of a match is for development:

- **settings**: every number the game is tuned by, by group, with search, sliders, a mark on what is changed, back as shipped, export and import as JSON. Changes apply from the next match (Restart in the pause box plays the same match with them). **Your growth (testing)** sets each species' level, and **Load both specials now** fills both teams' special cards in the match (to try a special at once; `Specials → Load a turn` at 1000 loads them every turn).
- **setup**, **new match**, **random**: back to the setup screen, the same map anew, another seed.
- **free camera** and **cinematic camera**: fly round the map by hand, or along a scripted path.
- **benchmark**: the terrain pipeline in the browser.
- **sound**, **keys**: volume and the keys.

## How it works

- The terrain is a 3D density grid (negative = solid). Each 32³ chunk is meshed on Web Workers with Dual Contouring (sharp edges, built maps) or Surface Nets (smooth); an explosion carves a sphere and only the chunks it touched are meshed again.
- Gameplay (`src/game/`) is pure and deterministic: fixed 60 Hz ticks, no `Math.random`, no `sin`/`cos`. Bugs and shots collide with the density field, not with the mesh.
- A linked engine (`src/game/engine/`) carries attributes, effects, triggers, abilities, reactions between tags, and settings.
- A match is its setup and its inputs (`src/sim/`): that is what is recorded, replayed, checked across clients and sent over the network (`src/net/`, `server/`).
- The player's data (growth, slots, settings, the last matches) is kept in the browser first, in IndexedDB (`src/data/`), ready to sync with a server.
- Rendering is three.js with WebGPU (`src/render/`); sound and music are computed in code, with no audio files (`src/audio/`).

More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the plan in [`docs/ROADMAP.md`](docs/ROADMAP.md); ideas in [`docs/IDEAS.md`](docs/IDEAS.md). To work on the code with Claude Code, see [`CLAUDE.md`](CLAUDE.md).

## License

To be decided.
