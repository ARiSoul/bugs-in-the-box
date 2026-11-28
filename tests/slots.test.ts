import { describe, expect, it } from 'vitest';
import { Controls } from '../src/input/controls';
import { BURST_AT, Match, NO_INPUT, SKILL_FULL } from '../src/game/match';
import { ANT, COCKROACH } from '../src/game/species';
import { WEAPONS, WING_STORM } from '../src/game/weapons';
import { world } from './helpers/worlds';

/** Controls listening to a target of their own (no page). */
const controls = (): Controls => new Controls(new EventTarget() as unknown as Window);

describe('the slots act', () => {
  it('a special fired from its slot holds fire for its charge, then lets go; a click is one tick', () => {
    const c = controls();
    c.fireFor(3);
    expect([c.next().fire, c.next().fire, c.next().fire, c.next().fire]).toEqual([true, true, true, false]);
    c.click();
    expect([c.next().fire, c.next().fire]).toEqual([true, false]);
  });

  /** A cockroach and an ant on level ground, the cockroach's turn. */
  const match = (): Match => {
    const t = world(4, 2, 2, (_i, j) => j - 10);
    const m = new Match(t, [{ name: 'R', species: COCKROACH, color: 0, size: 1, special: 'wing-storm' }, { name: 'A', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    m.units[0].bug.drop(t, 30, 32);
    m.units[1].bug.drop(t, 42, 32);
    for (let n = 0; n < 60; n++) m.step({ ...NO_INPUT, faceX: 1, faceZ: 0 });
    return m;
  };

  it('Burst picked and fired in the same tick throws the bug at once', () => {
    const m = match();
    const x = m.units[0].bug.x;
    m.step({ ...NO_INPUT, weapon: BURST_AT, fire: true });
    expect(m.events.some((e) => e.type === 'burst')).toBe(true);
    for (let n = 0; n < 60; n++) m.step(NO_INPUT);
    expect(Math.abs(m.units[0].bug.x - x)).toBeGreaterThan(5);
  });

  it('a special picked again in its stance (one tick of fire) goes at once: the gale', () => {
    const m = match();
    m.skill.fill(SKILL_FULL);
    const at = WEAPONS.indexOf(WING_STORM);
    m.step({ ...NO_INPUT, weapon: at });
    for (let n = 0; n < WING_STORM.sceneTicks + 2; n++) m.step(NO_INPUT);
    expect(m.stance).toBe(true);
    m.step({ ...NO_INPUT, fire: true });
    expect(m.events.some((e) => e.type === 'gale')).toBe(true);
    expect(m.skill[0]).toBe(0);
  });
});
