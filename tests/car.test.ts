import { describe, expect, it } from 'vitest';
import { Bug, IDLE } from '../src/game/bug';
import { Match, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { car } from '../src/terrain/generators/car';
import {
  carScale, dashFace, dashTop, GLASS, glassFoot, GLOVE, GLOVE_THINGS, HOLDER, leaning, onLid, OPENING, openingNorm, PHONE, PLATE, STACK, STACK_ITEMS, VENT_DEPTH, VENTS, WHEEL,
} from '../src/terrain/generators/carPlan';
import { createLayout, type SceneLayout } from '../src/terrain/generators/types';
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
  it('is registered on the WebGPU path, on its own map, and spawns on any level', () => {
    const sc = scenarioById('car');
    expect(sc.id).toBe('car');
    expect(sc.mapSize).toEqual([10, 4, 5]);
    expect(carScale(320, 128, 160).s).toBe(1);
    expect(sc.render).toBe('webgpu');
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
});
