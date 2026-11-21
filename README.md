# Bugs in the Box

Turn-based 3D artillery game in the browser. Bugs (ants, spiders, cockroaches and made-up creatures) wage war inside electronic devices: the insides of PCs, speakers, fridges, guitars, microwaves. Destructible, procedurally generated terrain.

> Status: prototype (Phase 2). Local hot-seat matches: two teams take turns on one device, with wind and four weapons. No online play yet.

## Getting started

Requires Node 20.19+ (or 22+).

```bash
npm install
npm run dev
```

Open the address that Vite prints.

- **W / S**: walk (hold **shift** to run) · **A / D** or **← / →**: turn · **↑ / ↓**: aim higher / lower
- **Space**: jump · **hold F** to charge, release to fire · **1–4**: weapon · **N**: new match
- **Drag** to orbit the camera · **scroll** to zoom
- On a touch screen (or with the mouse), use the pad in the bottom-right corner and tap a weapon.
- The menu lets you pick the seed (the same seed gives the same map and match) and run a benchmark.

Each turn lasts 30 s. After a shot, the bug has 3 s to walk away. The last team with bugs left wins.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server with hot reload |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run preview` | serves the production build |
| `npm run test` | tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run bench` | CPU benchmark of the terrain pipeline and the bug physics |

## How it works (summary)

The terrain is a 3D density grid (negative = solid). Each 32³ chunk is turned into a mesh with Surface Nets; an explosion subtracts a sphere from the grid and only the affected chunks are re-meshed (~3 per explosion, ~5–7 ms). Maps are generated deterministically from a seed.

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), the plan in [`docs/ROADMAP.md`](docs/ROADMAP.md), and ideas for scenarios and bugs in [`docs/IDEAS.md`](docs/IDEAS.md). To work on the code with Claude Code, see [`CLAUDE.md`](CLAUDE.md).

## License

To be decided.
