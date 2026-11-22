import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/bug';
import { AIM_TICKS, Match, NO_INPUT, type TurntableSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { TILE } from '../src/terrain/materials';
import { add, boxMinMax, cylinder } from '../src/terrain/sdf';
import { Terrain } from '../src/terrain/Terrain';

/** A floor with a round plate on it (top at y 9), centred on the sample (48, 48). */
function plateWorld(): Terrain {
  const t = new Terrain(3, 2, 3);
  t.beginGeneration();
  add(t, boxMinMax(2.5, 2.5, 2.5, t.W - 2.5, 6, t.D - 2.5), TILE);
  add(t, cylinder(48, 8, 48, 20, 1, 1, 0.4), TILE);
  t.commitGeneration();
  return t;
}

const SPEC: TurntableSpec = { x: 48, z: 48, radius: 22, j0: 7, j1: 16, surface: 9 };

const teams = [
  { name: 'Red', species: ANT, color: 0xff0000, size: 1 },
  { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 1 },
];

/** A match with the red bug on the plate at (58, 48) and the blue one off it; run until the second turn. */
function runOneTurn(): { m: Match; t: Terrain; phases: Set<string> } {
  const t = plateWorld();
  const m = new Match(t, teams, 3, { placeBugs: false, turntable: SPEC });
  expect(m.units[0].bug.drop(t, 58.3, 48.2)).toBe(true);
  expect(m.units[1].bug.drop(t, 85, 85)).toBe(true);
  const phases = new Set<string>();
  for (let n = 0; n < AIM_TICKS + 20 * TICK_RATE && m.turnNumber < 2; n++) {
    m.step(NO_INPUT);
    phases.add(m.phase);
  }
  return { m, t, phases };
}

describe('turntable', () => {
  it('turns the grid a quarter (+x to +z), losslessly: four turns give back every sample', () => {
    const t = plateWorld();
    t.carve(60.3, 9.2, 48.1, 3);
    const before = Float32Array.from(t.dens);
    const mats = Uint8Array.from(t.material);
    // the crater, at +x of the axis, is at +z after one quarter turn
    expect(t.sample(60, 8, 48)).toBeGreaterThan(0);
    expect(t.sample(48, 8, 60)).toBeLessThan(0);
    t.rotateQuarter(48, 48, 7, 16, 22);
    expect(t.sample(48, 8, 60)).toBeGreaterThan(0);
    expect(t.sample(60, 8, 48)).toBeLessThan(0);
    for (let i = 0; i < 3; i++) t.rotateQuarter(48, 48, 7, 16, 22);
    expect(Buffer.from(t.dens.buffer).equals(Buffer.from(before.buffer))).toBe(true);
    expect(Buffer.from(t.material.buffer).equals(Buffer.from(mats.buffer))).toBe(true);
  });

  it('spins between turns and carries the bugs on the plate a quarter round its axis', () => {
    const { m, phases } = runOneTurn();
    expect(phases.has('spin')).toBe(true);
    expect(m.turnNumber).toBe(2);
    expect(m.turntableTurns).toBe(1);
    const red = m.units[0].bug;
    // (58.3, 48.2) is (+10.3, +0.2) from the axis: a quarter turn puts it at (-0.2, +10.3)
    expect(red.x).toBeCloseTo(47.8, 1);
    expect(red.z).toBeCloseTo(58.3, 1);
    expect(red.alive).toBe(true);
    // the bug off the plate stays where it was
    const blue = m.units[1].bug;
    expect(Math.abs(blue.x - 85)).toBeLessThan(1);
    expect(Math.abs(blue.z - 85)).toBeLessThan(1);
  });

  it('is deterministic: the same match twice ends in the same state', () => {
    const a = runOneTurn();
    const b = runOneTurn();
    for (let i = 0; i < 2; i++) {
      expect(a.m.units[i].bug.x).toBe(b.m.units[i].bug.x);
      expect(a.m.units[i].bug.z).toBe(b.m.units[i].bug.z);
      expect(a.m.units[i].bug.fx).toBe(b.m.units[i].bug.fx);
    }
    expect(Buffer.from(a.t.dens.buffer).equals(Buffer.from(b.t.dens.buffer))).toBe(true);
  });
});
