import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/bug';
import { Match, NO_INPUT, type MatchEvent, type MatchInput, type TeamSpec } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { WEAPONS } from '../src/game/weapons';
import { pcCase } from '../src/terrain/generators/pcCase';
import { createLayout } from '../src/terrain/generators/types';
import { Terrain } from '../src/terrain/Terrain';

const TEAMS: TeamSpec[] = [
  { name: 'Red', species: ANT, color: 0xff0000, size: 3 },
  { name: 'Blue', species: SPIDER, color: 0x0000ff, size: 3 },
];

/** Number of solid samples: changes when an explosion carves the terrain. */
function solidCount(t: Terrain): number {
  let n = 0;
  for (let y = 0; y < t.H; y++) for (let z = 0; z < t.D; z++) for (let x = 0; x < t.W; x++) if (t.sample(x, y, z) < 0) n++;
  return n;
}

interface Played {
  events: MatchEvent[];
  match: Match;
  terrain: Terrain;
  solidBefore: number;
}

/**
 * A scripted hot-seat match on the Tower Case: every turn the active bug picks the next weapon, walks,
 * turns, aims a little higher and fires at a power that changes from turn to turn; then nobody touches
 * anything until the next turn starts.
 */
function play(seed: number, size: [number, number, number], turns: number): Played {
  const terrain = new Terrain(...size);
  pcCase(terrain, seed, createLayout());
  const solidBefore = solidCount(terrain);
  const match = new Match(terrain, TEAMS, seed, { strictBounds: true });
  const events: MatchEvent[] = [];
  const over = (): boolean => match.phase === 'over';
  const step = (input: Readonly<MatchInput>, ticks: number): void => {
    for (let n = 0; n < ticks && !over(); n++) {
      match.step(input);
      events.push(...match.events);
    }
  };
  for (let turn = 0; turn < turns && !over(); turn++) {
    const start = events.length;
    step({ ...NO_INPUT, weapon: turn % WEAPONS.length }, 1);
    step({ ...NO_INPUT, move: 1, run: turn % 2 === 0 }, TICK_RATE);
    step({ ...NO_INPUT, turn: turn % 3 === 0 ? 1 : -1 }, (turn % 4) * 6);
    step({ ...NO_INPUT, aim: 1 }, 10 + (turn % 3) * 8);
    step({ ...NO_INPUT, fire: true }, 20 + ((turn * 17) % 60));
    step(NO_INPUT, 1); // release: fire
    // wait for the next turn (or the end), at most a minute of game time
    for (let n = 0; n < 60 * TICK_RATE && !over(); n++) {
      match.step(NO_INPUT);
      events.push(...match.events);
      if (match.events.some((e) => e.type === 'turn')) break;
    }
    expect(events.slice(start).some((e) => e.type === 'turn' || e.type === 'over')).toBe(true);
  }
  return { events, match, terrain, solidBefore };
}

describe('Tower Case (pc-case): a played match', () => {
  for (const [name, size] of [
    ['large 5x3x5', [5, 3, 5]],
    ['small 3x2x3', [3, 2, 3]],
  ] as [string, [number, number, number]][]) {
    it(`${name}: turns pass, every weapon fires, explosions carve and hurt, bugs stay in the map or die`, () => {
      const { events, match, terrain, solidBefore } = play(7, size, 12);
      const turns = events.filter((e) => e.type === 'turn').length;
      const over = events.some((e) => e.type === 'over');
      expect(turns >= 11 || over).toBe(true);
      const fired = new Set(events.filter((e): e is Extract<MatchEvent, { type: 'fire' }> => e.type === 'fire').map((e) => e.weapon));
      if (!over) expect(fired.size).toBe(WEAPONS.length);
      expect(events.some((e) => e.type === 'explosion' || e.type === 'dig')).toBe(true);
      expect(solidCount(terrain)).toBeLessThan(solidBefore);
      expect(events.some((e) => e.type === 'damage')).toBe(true);
      for (const u of match.units) {
        const b = u.bug;
        expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)).toBe(true);
        if (!b.alive) continue;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThanOrEqual(terrain.W);
        expect(b.z).toBeGreaterThanOrEqual(0);
        expect(b.z).toBeLessThanOrEqual(terrain.D);
        expect(b.y).toBeLessThan(terrain.H);
        expect(b.health).toBeGreaterThan(0);
      }
      // no shell is left flying after the last turn changed hands
      expect(match.phase === 'over' || match.projectiles.length === 0).toBe(true);
    });
  }

  it('is the same match every time (events and the carved terrain)', () => {
    const a = play(11, [3, 2, 3], 6);
    const b = play(11, [3, 2, 3], 6);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(b.terrain.material).toEqual(a.terrain.material);
    expect(solidCount(b.terrain)).toBe(solidCount(a.terrain));
  });
});
