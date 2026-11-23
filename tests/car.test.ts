import { describe, expect, it } from 'vitest';
import { Bug, IDLE } from '../src/game/bug';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { car } from '../src/terrain/generators/car';
import {
  carScale, dashFace, dashTop, GLASS, glassFoot, GLOVE, GLOVE_THINGS, HOLDER, leaning, onLid, OPENING, openingNorm, PHONE, PLATE, STACK, STACK_ITEMS, SWITCH, VENT_DEPTH, VENTS, WHEEL,
} from '../src/terrain/generators/carPlan';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
import { createRng } from '../src/terrain/noise';
import { scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';

const SIZES: [string, number, number, number][] = [
  ['its own 10x4x5', 10, 4, 5],
  ['large 5x3x5', 5, 3, 5],
  ['small 3x2x3', 3, 2, 3],
];

const make = (seed: number, cx = 10, cy = 4, cz = 5): { t: Terrain; layout: SceneLayout } => {
  const t = new Terrain(cx, cy, cz);
  const layout = createLayout();
  car(t, seed, layout);
  return { t, layout };
};

describe('Car Dashboard (car)', () => {
  it('is registered on its own map, and spawns on any level', () => {
    const sc = scenarioById('car');
    expect(sc.id).toBe('car');
    expect(sc.mapSize).toEqual([10, 4, 5]);
    expect(carScale(320, 128, 160).s).toBe(1);
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
    it(`meshes watertight, outward-facing and non-degenerate, also after explosions: ${name}`, () => {
      const { t } = make(1234, cx, cy, cz);
      const { s, ox, oz } = carScale(t.W, t.H, t.D);
      for (const [x, y, z] of [[230, 80, 66], [88, 90, 80], [160, 60, 94], [88, 86, 108]]) t.carve(x * s + ox + 0.37, y * s + 0.21, z * s + oz + 0.43, 6);
      const r = analyze(meshAll(t));
      expect(r.faces).toBeGreaterThan(5_000);
      expect(r.openEdges).toBe(0);
      expect(r.degenerate).toBe(0);
      expect(r.orientedOutward).toBeGreaterThan(0.99);
    });
  }

  describe('is solid where it is drawn', () => {
    const { t } = make(9);
    const inside = (x: number, y: number, z: number): void => expect(t.sample(x, y, z), `${x} ${y} ${z}`).toBeLessThan(0.15);

    it('the dashboard: its top where the plan says, its face', () => {
      for (const x of [40, 88, 130, 160, 200, 250, 280])
        for (const z of [glassFoot(x) + 22, 56, 70]) {
          const y = dashTop(x, z);
          expect(t.sample(x, y - 0.6, z)).toBeLessThan(0);
          expect(t.sample(x, y + 0.9, z)).toBeGreaterThan(0);
          // a bug stands on it
          const bug = new Bug(ANT);
          expect(bug.drop(t, x, z, y + 5)).toBe(true);
          for (let n = 0; n < 60; n++) bug.step(t, IDLE);
          expect(Math.abs(bug.y - ANT.radius - dashTop(bug.x, bug.z))).toBeLessThan(0.45);
        }
      for (const [x, y] of [[60, 45], [210, 62], [250, 47], [160, 85 - 10]]) {
        const z = dashFace(x, y);
        expect(t.sample(x, y, z - 0.7)).toBeLessThan(0);
      }
    });

    it("the hood's opening is open down to the instruments, and no further", () => {
      for (const [dx, dy] of [[0, 0], [20, 4], [-24, -3], [0, 9]]) {
        expect(openingNorm(OPENING.x + dx, OPENING.y + dy)).toBeLessThan(1);
        expect(t.sample(OPENING.x + dx, OPENING.y + dy, 82)).toBeGreaterThan(0);
        inside(OPENING.x + dx, OPENING.y + dy, PLATE.z - 3);
      }
    });

    it('the wheel: its rim all round, its hub, spokes and column', () => {
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2;
        inside(...leaning(WHEEL, WHEEL.R * Math.cos(a), WHEEL.R * Math.sin(a), 0));
        inside(...leaning(WHEEL, (WHEEL.R + 2) * Math.cos(a), (WHEEL.R + 2) * Math.sin(a), 0));
      }
      for (const [u, w, n] of [[0, -5, 3], [15, -2, 2], [-28, -3, 0], [28, -3, 0], [0, -30, 0], [0, -2, -20], [-26, 5.4, -11], [26, 5.4, -11]]) inside(...leaning(WHEEL, u, w, n));
    });

    it('the vents, the phone and its holder, the controls on the stack', () => {
      for (const v of VENTS)
        for (const [dx, dy] of [[0, 0], [6, 0], [0, 7], [-5, -5]]) {
          inside(v.x + dx, v.y + dy, v.z - VENT_DEPTH - 0.6);
          if (dy !== 0 && v !== VENTS[1]) expect(t.sample(v.x + dx, v.y + dy, v.z + 0.6)).toBeGreaterThan(0);
        }
      for (const [dx, dy] of [[0, 0], [6.5, 14], [-6.5, -14]]) inside(PHONE.x + dx, PHONE.y + dy, PHONE.z);
      inside(HOLDER.x + 10, HOLDER.y, HOLDER.z + 2);
      for (const it of STACK_ITEMS) inside(...leaning(STACK, it.u, -it.v, STACK.out + it.out - 1));
    });

    it('the glove box is open: a cave a bug can stand in, its lid to stand on, the things in it solid', () => {
      const { x0, x1, y0 } = GLOVE;
      for (const [x, z, y] of [[264, 96, y0], [232, 84, y0 + GLOVE_THINGS.folder.h + GLOVE_THINGS.papers.h]]) {
        const bug = new Bug(ANT);
        expect(bug.drop(t, x, z, y + 5)).toBe(true);
        for (let n = 0; n < 90; n++) bug.step(t, IDLE);
        expect(Math.abs(bug.y - ANT.radius - y)).toBeLessThan(0.35);
      }
      const [lx, ly, lz] = onLid(0, 0, GLOVE.len / 2);
      const bug = new Bug(ANT);
      expect(bug.drop(t, lx, lz, ly + 8)).toBe(true);
      for (let n = 0; n < 120; n++) bug.step(t, IDLE);
      expect(bug.alive).toBe(true);
      expect(Math.abs(bug.y - ANT.radius - ly)).toBeLessThan(1);
      expect(t.sample((x0 + x1) / 2, y0 + 9, 90)).toBeGreaterThan(0);
    });

    it('the small things: the pen, the coins, the tissue, the cable with its plug and socket, the key, the light switch', () => {
      const { y0 } = GLOVE;
      inside(...onLid(-3.5, 0.4, 14.4));
      inside(...onLid(10.6, 0.1, 14.6));
      inside(GLOVE_THINGS.tissues.x, y0 + GLOVE_THINGS.tissues.h + 1.5, GLOVE_THINGS.tissues.z);
      inside(142, 9.6, 121);
      inside(PHONE.x - 2, PHONE.y - PHONE.hh - 1, PHONE.z);
      const [kx, ky, kz] = leaning(WHEEL, 12.6, -7, -14);
      inside(kx + 5.4, ky, kz);
      // (the doors' cloth, the opener in its bowl, the corner panel and the window's post)
      for (const [x, y, z] of [[24.4, 47, 118], [24.4, 40, 155], [26.2, 48, 139], [21.6, 80, 80], [19.5, 100, 94.5]]) {
        inside(x, y, z);
        inside(320 - x, y, z);
      }
      for (const [u, w, n] of [[12, 0, 0.5], [-14, 0, 0.5], [-4, 0, 4], [8.3, -0.8, 1]]) inside(...leaning(SWITCH, u, w, n));
      const { layout } = make(9);
      const wire = layout.features.filter((f) => f.kind === 'wire')[0].path;
      for (let i = 1; i + 2 < wire.length; i += 9) inside(wire[i], wire[i + 1], wire[i + 2]);
    });

    it('a bug crawls anywhere for minutes without falling, passing through anything or dying', () => {
      const rnd = createRng(5);
      for (const [x, z] of [[120, 60], [230, 70], [150, 150], [12, 90], [240, 108]]) {
        const bug = new Bug(ANT);
        expect(bug.drop(t, x, z, 112)).toBe(true);
        for (let n = 0; n < 120; n++) bug.step(t, IDLE);
        let turn = 0;
        for (let n = 0; n < 60 * 25; n++) {
          if (n % 50 === 0) turn = rnd() < 0.5 ? 0 : rnd() < 0.5 ? -1 : 1;
          bug.step(t, { move: 1, turn, jump: false, run: n % 400 < 100 });
          expect(bug.grounded, `${bug.x.toFixed(1)} ${bug.y.toFixed(1)} ${bug.z.toFixed(1)}`).toBe(true);
          expect(t.sample(bug.x, bug.y, bug.z)).toBeGreaterThan(0.3);
        }
      }
    });

    it('the windscreen keeps everybody in: solid from the pane outwards', () => {
      for (const x of [40, 100, 160, 220, 280])
        for (const l of [4, 20, 40]) {
          const y = GLASS.y + l * GLASS.s;
          const z = glassFoot(x) + l * GLASS.c;
          expect(t.sample(x, y, z - 2)).toBeLessThan(0);
          expect(t.sample(x, y, z + 5)).toBeGreaterThan(0);
        }
    });
  });

  it('spawns every bug alive, inside the car', () => {
    for (const seed of [3, 4, 5, 6]) {
      const { t } = make(seed);
      const TEAMS: TeamSpec[] = [
        { name: 'Red', species: ANT, color: 0xff0000, size: 4 },
        { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 4 },
      ];
      const m = new Match(t, TEAMS, seed, { strictBounds: true, spawnLevels: true });
      for (const u of m.units) {
        expect(u.bug.alive, `seed ${seed}: ${u.bug.x.toFixed(1)} ${u.bug.y.toFixed(1)} ${u.bug.z.toFixed(1)}`).toBe(true);
        expect(u.bug.z).toBeGreaterThan(glassFoot(u.bug.x));
      }
    }
  });

  it('spawns bugs inside the car, and they stay inside it however they walk', () => {
    const { t } = make(1234);
    const confine = scenarioById('car').confine?.(t.W, t.H, t.D);
    if (!confine) throw new Error('no confine');
    expect(confine(14, 67, 60)).toBe(false); // behind the corner panel
    expect(confine(28, 34, 158)).toBe(false); // the armrest's cut end
    expect(confine(160, 16, 28)).toBe(false); // the bulkhead under the dashboard
    expect(confine(14, 67, 130)).toBe(true); // the door's sill
    const rnd = createRng(7);
    for (let seed = 1; seed <= 8; seed++) {
      const m = new Match(t, [{ name: 'Red', species: ANT, color: 0, size: 4 }, { name: 'Blue', species: SPIDER, color: 0, size: 4 }], seed, { strictBounds: true, spawnLevels: true, confine });
      for (const { bug: b } of m.units) {
        expect(confine(b.x, b.y, b.z), `${b.x} ${b.y} ${b.z}`).toBe(true);
        for (let n = 0; n < 600; n++) {
          const on = b.grounded;
          b.step(t, { move: 1, turn: rnd() < 0.9 ? 0 : rnd() < 0.5 ? -1 : 1, jump: false });
          if (on && b.grounded) expect(confine(b.x, b.y, b.z)).toBe(true);
          if (!b.grounded) break;
        }
      }
    }
  });
});
