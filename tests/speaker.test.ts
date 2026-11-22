import { describe, expect, it } from 'vitest';
import { Bug, IDLE, type BugInput } from '../src/game/bug';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { CAB_X0, DESK_TOP, speaker } from '../src/terrain/generators/speaker';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
import { CONE, DAMPER, FERRITE, FOAM, MDF, VINYL, WOOD } from '../src/terrain/materials';
import { scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SIZES: [string, number, number, number][] = [
  ['large 5x3x5', 5, 3, 5],
  ['small 3x2x3', 3, 2, 3],
];

const make = (seed: number, cx = 5, cy = 3, cz = 5): { t: Terrain; layout: SceneLayout } => {
  const t = new Terrain(cx, cy, cz);
  const layout = createLayout();
  speaker(t, seed, layout);
  return { t, layout };
};

const all = (layout: SceneLayout, kind: string) => layout.features.filter((f) => f.kind === kind);

describe('Studio Monitor (speaker)', () => {
  it('is registered on the WebGPU path with strict bounds', () => {
    const sc = scenarioById('speaker');
    expect(sc.id).toBe('speaker');
    expect(sc.sharpEdges).toBe(true);
    expect(sc.render).toBe('webgpu');
    expect(sc.strictBounds).toBe(true);
  });

  it('is deterministic for a given seed (grid, materials and layout), and the seed changes it', () => {
    const a = make(42);
    const b = make(42);
    const c = make(43);
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(b.t.dens.buffer))).toBe(true);
    expect(Buffer.from(a.t.material.buffer).equals(Buffer.from(b.t.material.buffer))).toBe(true);
    expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout));
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(c.t.dens.buffer))).toBe(false);
  });

  for (const [name, cx, cy, cz] of SIZES) {
    describe(name, () => {
      it('meshes watertight, outward-facing and non-degenerate, also after explosions', () => {
        const { t } = make(1234, cx, cy, cz);
        for (const [fx, fz] of [[0.3, 0.55], [0.31, 0.2], [0.8, 0.3], [0.5, 0.9]]) {
          const x = t.W * fx;
          const z = t.D * fz;
          const hit = t.raycast(x, t.H - 3, z, 0, -1, 0);
          if (hit >= 0) t.carve(x, t.H - 3 - hit, z, 6);
        }
        const r = analyze(meshAll(t));
        expect(r.faces).toBeGreaterThan(20_000);
        expect(r.openEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.orientedOutward).toBeGreaterThan(0.99);
      });

      it('has the cabinet on the desk, the drivers, the port into the void and the amp plate', () => {
        const { t, layout } = make(7, cx, cy, cz);
        const used = new Set(t.material);
        for (const m of [WOOD, VINYL, MDF, FOAM, CONE, DAMPER, FERRITE]) expect(used.has(m)).toBe(true);
        const [woofer, tweeter] = all(layout, 'driver');
        expect(all(layout, 'driver')).toHaveLength(2);
        expect(woofer.path).toHaveLength(4);
        const [coneTop, spiderTop, plateY, magnetTop] = woofer.path;
        // the magnet tower stands on the cone; under its bottom plate, above the spider, a bug fits
        expect(t.sample(woofer.x, magnetTop - 1, woofer.z)).toBeLessThan(0);
        // the cone's shell (from 29 down to 9 radius units over 12, scaled with the basket)
        const k = woofer.radius / 33;
        expect(coneTop).toBeGreaterThan(woofer.y);
        expect(t.sample(woofer.x, woofer.y + (12 * k * (29 - 23)) / 20 - 1.2, woofer.z + 23 * k)).toBeLessThan(0);
        if (cx === 5) {
          const gapX = woofer.x + woofer.radius * 0.45;
          expect(plateY - spiderTop).toBeGreaterThan(4);
          expect(t.sample(gapX, (spiderTop + plateY) / 2 + 0.4, woofer.z)).toBeGreaterThan(0.9);
        }
        expect(tweeter.z).toBeLessThan(woofer.z);
        // the port slot: nothing solid below its middle, down out of the map
        const [port] = all(layout, 'port');
        expect(t.raycast(port.x, port.y + 3, port.z, 0, -1, 0)).toBe(-1);
        // the desk: solid wood beside the cabinet, and the cabinet floor above it
        expect(t.sample(t.W * 0.66, DESK_TOP - 1, t.D * 0.5)).toBeLessThan(0);
        expect(t.material[t.idx(Math.round(t.W * 0.66), DESK_TOP - 1, Math.round(t.D * 0.5))]).toBe(WOOD);
        // the cabinet walls stand to the rim; the inside is open from above
        const rim = layout.inner[4];
        expect(t.sample(CAB_X0 + 2, rim - 1, t.D / 2)).toBeLessThan(0);
        // nothing of the lining comes through the walls: the outer faces stay flat vinyl
        const cx1 = Math.round(t.W * 0.625);
        for (let z = 18; z < t.D - 12; z += 2) {
          for (let y = DESK_TOP + 8; y < rim - 4; y += 2) {
            expect(t.sample(CAB_X0 - 1.5, y, z)).toBeGreaterThan(0);
            // (the outer face at high x, except where the speaker cable hangs down it)
            if (Math.abs(z - woofer.z + 30 * k) > 14) expect(t.sample(cx1 + 1.5, y, z)).toBeGreaterThan(0);
          }
        }
        expect(t.raycast(woofer.x, t.H - 3, woofer.z - woofer.radius - 2, 0, -1, 0)).toBeGreaterThan(t.H - 3 - rim);
        expect(all(layout, 'capacitor').length).toBeGreaterThan(cx === 5 ? 4 : 1);
        expect(all(layout, 'heat')).toHaveLength(1);
        expect(all(layout, 'led').length).toBeGreaterThan(0);
      });

      it('has a screwdriver from the desk up to the rim, solid along its length', () => {
        const { t, layout } = make(7, cx, cy, cz);
        const rods = all(layout, 'rod');
        expect(rods).toHaveLength(3);
        for (const r of rods) {
          const [x0, y0, z0, x1, y1, z1] = r.path;
          for (let u = 0.1; u < 1; u += 0.2) expect(t.sample(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * u)).toBeLessThan(0);
        }
        expect(rods[0].path[1]).toBeLessThan(DESK_TOP + 4);
        expect(rods[2].path[4]).toBeGreaterThan(layout.inner[4]);
      });

      it('a match places every bug on it, alive and standing', () => {
        const { t } = make(1234, cx, cy, cz);
        const teams: TeamSpec[] = [
          { name: 'A', species: ANT, color: 0, size: 3 },
          { name: 'B', species: SPIDER, color: 0, size: 3 },
        ];
        const m = new Match(t, teams, 1234, { strictBounds: true });
        for (const u of m.units) {
          expect(u.bug.alive).toBe(true);
          expect(u.bug.grounded).toBe(true);
          expect(u.bug.y).toBeGreaterThan(DESK_TOP - 1);
        }
      });
    });
  }

  it('a bug walks up the screwdriver from the desk onto the rim', () => {
    const { t, layout } = make(7);
    const [shaft, , handle] = all(layout, 'rod');
    const bug = new Bug(ANT);
    // on the desk just behind the tip, facing up the screwdriver (towards -x)
    expect(bug.drop(t, shaft.path[0] + 4, shaft.path[2])).toBe(true);
    bug.fx = -1;
    bug.fz = 0;
    for (let i = 0; i < 60; i++) bug.step(t, IDLE);
    const up: BugInput = { move: 1, turn: 0, jump: false };
    let best = bug.y;
    for (let i = 0; i < 60 * 20 && bug.alive; i++) {
      bug.step(t, up);
      best = Math.max(best, bug.y);
    }
    expect(bug.alive).toBe(true);
    expect(best).toBeGreaterThan(handle.path[4]);
  });
});
