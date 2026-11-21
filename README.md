# Bugs in the Box

Turn-based 3D artillery game in the browser. Bugs (ants, spiders, cockroaches and made-up creatures) wage war inside electronic devices: the insides of PCs, speakers, fridges, guitars, microwaves. Destructible, procedurally generated terrain.

> Status: technical prototype (Phase 1). Destructible terrain and one controllable bug. No turns or weapons yet.

## Getting started

Requires Node 20.19+ (or 22+).

```bash
npm install
npm run dev
```

Open the address that Vite prints.

- **WASD / arrows**: walk and turn the bug · **space**: jump · **R**: respawn
- **Click the terrain** to blow it up · **drag** to orbit the camera · **scroll** to zoom
- The panel lets you pick the seed, the blast radius and the bug species, and run a benchmark.

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
