import { describe, expect, it } from 'vitest';
import { Bug, IDLE } from '../src/game/bug';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { CAP_OUT, fullLayout, laptopLayout } from '../src/terrain/generators/keyboards';
import { desk, deskPlan } from '../src/terrain/generators/desk';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
import { scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SIZES: [string, number, number, number][] = [
  ['its own 10x3x5', 10, 3, 5],
  ['large 5x3x5', 5, 3, 5],
  ['small 3x2x3', 3, 2, 3],
];

const make = (seed: number, cx = 10, cy = 3, cz = 5): { t: Terrain; layout: SceneLayout } => {
  const t = new Terrain(cx, cy, cz);
  const layout = createLayout();
  desk(t, seed, layout);
  return { t, layout };
};

const surfaceUnder = (t: Terrain, x: number, fromY: number, z: number): number => {
  const d = t.raycast(x, fromY, z, 0, -1, 0);
  return d < 0 ? -1 : fromY - d;
};

describe('Desk (desk)', () => {
  it('is registered on its own larger map, and spawns on any level', () => {
    const sc = scenarioById('desk');
    expect(sc.id).toBe('desk');
    expect(sc.mapSize).toEqual([10, 3, 5]);
    // (on its own map, twice the scale of the other maps: a bug keeps its size next to a keyboard)
    expect(deskPlan(320, 96, 160).scale).toBe(2);
    expect(sc.spawnLevels).toBe(true);
  });

  it('is deterministic for a given seed (grid, materials and layout), and the seed changes it', () => {
    const a = make(42);
    const b = make(42);
    const c = make(43);
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(b.t.dens.buffer))).toBe(true);
    expect(Buffer.from(a.t.material.buffer).equals(Buffer.from(b.t.material.buffer))).toBe(true);
    expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout));
    expect(JSON.stringify(a.layout)).not.toBe(JSON.stringify(c.layout));
  });

  for (const [name, cx, cy, cz] of SIZES) {
    describe(name, () => {
      it('meshes watertight, outward-facing and non-degenerate, also after explosions', () => {
        const { t } = make(1234, cx, cy, cz);
        const p = deskPlan(t.W, t.H, t.D);
        const top = p.top;
        for (const [x, z] of [[(p.main[0] + p.main[2]) / 2, (p.main[1] + p.main[3]) / 2], [p.wing[0], p.wing[1]], [p.main[2] - 6, p.main[3] - 4]]) {
          t.carve(x + 0.37, top + 0.21, z + 0.43, 6);
        }
        const r = analyze(meshAll(t));
        expect(r.faces).toBeGreaterThan(5_000);
        expect(r.openEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.orientedOutward).toBeGreaterThan(0.99);
      });

      it('has its tops where the plan says: the main top, the wing, the speaker shelf; nothing under the desk', () => {
        const { t } = make(7, cx, cy, cz);
        const p = deskPlan(t.W, t.H, t.D);
        const top = p.top;
        // the main top, in front of the mat's left edge (clear of the things on it)
        const [mx0, mz0, , mz1] = p.main;
        expect(surfaceUnder(t, mx0 + 3 * p.scale, top + 6, mz1 - 2 * p.scale)).toBeCloseTo(top, 0);
        // the white table (the wing), at a clear spot towards its front left corner
        expect(surfaceUnder(t, p.wing[0] - 7 * p.scale, top + 2.5, p.wing[1] + 21 * p.scale)).toBeCloseTo(top, 0);
        // the shelf, at its front corner
        expect(surfaceUnder(t, p.shelf[2] - 1.5 * p.scale, t.H - 3, p.shelf[3] - 1 * p.scale)).toBeCloseTo(p.shelf[4], 0);
        // in front of the desk, the void all the way down
        expect(surfaceUnder(t, (mx0 + p.main[2]) / 2, top + 4, mz1 + 6)).toBe(-1);
        void mz0;
      });
    });
  }

  describe('is solid where things are drawn', () => {
    const { t, layout } = make(9);
    const p = deskPlan(t.W, t.H, t.D);

    it('the inside of every boxy or round part big enough for a bug to be in', () => {
      const open: string[] = [];
      for (const f of layout.features) {
        if (f.kind !== 'part' && f.kind !== 'keyboard') continue;
        const c = [0, 1, 2].map((a) => (f.box[a] + f.box[a + 3]) / 2);
        const h = [0, 1, 2].map((a) => (f.box[a + 3] - f.box[a]) / 2);
        if (Math.min(h[0], h[2]) < 1.5 || h[1] < 1 || f.box[1] < p.top - 2 || (f.opacity ?? 1) < 1) continue;
        const [cy, sy] = f.yaw ?? [1, 0];
        const [ct, st] = f.kind === 'part' && f.path.length === 2 ? f.path : [1, 0];
        const round = f.shape === 'cylY' || f.shape === 'ball';
        let n = 0;
        let air = 0;
        for (let x = 0.5 - h[0]; x <= h[0] - 0.5; x += 0.5)
          for (let y = 0.5 - h[1]; y <= h[1] - 0.5; y += 0.5)
            for (let z = 0.5 - h[2]; z <= h[2] - 0.5; z += 0.5) {
              if (round && (x / h[0]) ** 2 + (z / h[2]) ** 2 + (f.shape === 'ball' ? (y / h[1]) ** 2 : 0) > 0.75) continue;
              const ty = y * ct - z * st;
              const tz = y * st + z * ct;
              n++;
              if (t.sample(c[0] + x * cy - tz * sy, c[1] + ty, c[2] + x * sy + tz * cy) > 0.25) air++;
            }
        if (n > 0 && air / n > 0.15) open.push(`${f.shape} #${f.color.toString(16)} at ${c.map(Math.round).join(',')}: ${Math.round((100 * air) / n)}% air`);
      }
      expect(open).toEqual([]);
    });

    it("the monitors' curved panels, from edge to edge", () => {
      for (const f of layout.features.filter((g) => g.kind === 'screen' && g.radius > 0)) {
        const [cy, sy] = f.yaw ?? [1, 0];
        const half = (f.box[3] - f.box[0]) / 2;
        const [mx, my, mz] = [(f.box[0] + f.box[3]) / 2, (f.box[1] + f.box[4]) / 2, (f.box[2] + f.box[5]) / 2];
        for (let u = -0.95; u <= 0.96; u += 0.19) {
          // (a point of the arc, just behind the panel)
          const a = (u * half) / f.radius;
          const lx = (f.radius + 0.6) * Math.sin(a);
          const lz = f.radius - (f.radius + 0.6) * Math.cos(a);
          expect(t.sample(mx + lx * cy - lz * sy, my, mz + lx * sy + lz * cy)).toBeLessThan(0.1);
        }
      }
    });

    it("a bug stands on every keyboard's keys, sinks between them and steps down where there are none", () => {
      for (const f of layout.features.filter((g) => g.kind === 'keyboard')) {
        const full = f.look === 'full';
        const { keys, uw, ud } = full ? fullLayout((f.glow ?? 0) > 0) : laptopLayout();
        const [c, s] = f.yaw ?? [1, 0];
        // (a key's height over the deck: where a bug dropped at (u, v), in key units, comes to rest)
        const rest = (u: number, v: number): number => {
          const lx = (u / uw - 0.5) * (f.box[3] - f.box[0]);
          const lz = (v / ud - 0.5) * (f.box[5] - f.box[2]);
          const bug = new Bug(ANT);
          expect(bug.drop(t, (f.box[0] + f.box[3]) / 2 + lx * c - lz * s, (f.box[2] + f.box[5]) / 2 + lx * s + lz * c, f.box[4] + 5)).toBe(true);
          for (let n = 0; n < 90; n++) bug.step(t, IDLE);
          return bug.y - ANT.radius - f.box[4];
        };
        const high = f.radius * CAP_OUT;
        // (a key's middle and its edges, along its row)
        let tops = 0;
        let edges = 0;
        const plain = keys.filter(([x, z, w, d]) => w === 1 && d === 1 && x > 1 && x < 12 && z > ud * 0.3 && z < ud * 0.7);
        expect(plain.length).toBeGreaterThan(8);
        for (const [x, z] of plain) {
          const top = rest(x + 0.5, z + 0.5);
          expect(top).toBeGreaterThan(high * 0.5);
          expect(top).toBeLessThan(high + 0.05);
          tops += top / plain.length;
          edges += rest(x + 1, z + 0.5) / plain.length;
        }
        // (a laptop's keys stand a fifth of a unit out of the deck, two cells apart: no groove to speak of)
        if (full) {
          expect(tops - edges).toBeGreaterThan(high * 0.1);
          const g = ud - 6;
          // (beside and above the up arrow, and the column right of the Enter: the bug is down at the deck or near it)
          expect(rest(17, g + 3.5)).toBeLessThan(0.15);
          expect(rest(16, g + 4.5)).toBeLessThan(0.3 * high);
          expect(rest(15.25, g + 3.5)).toBeLessThan(0.5 * high);
        }
      }
    });

    it('a lying cable is solid up to its top', () => {
      const [mx0, mz0, mx1, mz1] = p.main;
      const lying: number[] = [];
      for (const g of layout.features.filter((f) => f.kind === 'wire')) {
        for (let i = 1; i + 2 < g.path.length; i += 3) {
          const [x, y, z] = [g.path[i], g.path[i + 1], g.path[i + 2]];
          if (Math.abs(y - (p.top + 0.3)) < 0.05 && x > mx0 + 4 && x < mx1 - 4 && z > mz0 + 4 && z < mz1 - 4) lying.push(surfaceUnder(t, x, p.top + 4, z));
        }
      }
      expect(lying.length).toBeGreaterThan(20);
      for (const y of lying) expect(y).toBeGreaterThan(p.top + 0.3);
    });
  });

  it('spawns every bug alive on some level', () => {
    const { t } = make(5);
    const TEAMS: TeamSpec[] = [
      { name: 'Red', species: ANT, color: 0xff0000, size: 4 },
      { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 4 },
    ];
    const m = new Match(t, TEAMS, 3, { strictBounds: true, spawnLevels: true });
    for (const u of m.units) expect(u.bug.alive, `${u.bug.x.toFixed(1)} ${u.bug.y.toFixed(1)} ${u.bug.z.toFixed(1)}`).toBe(true);
  });
});
