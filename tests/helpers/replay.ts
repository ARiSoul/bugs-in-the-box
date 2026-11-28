import { Brain, SKILLS } from '../../src/game/brain';
import { Match } from '../../src/game/match';
import { computerGrowth } from '../../src/game/progress';
import { SPECIES } from '../../src/game/species';
import { SCENARIOS } from '../../src/terrain/scenarios';
import { Terrain } from '../../src/terrain/Terrain';
import { groundDigest, matchDigest as digest } from '../../src/sim/digest';

/**
 * Whole matches as a regression base: the computer plays itself on a map, and the match is boiled down to digests (a hash
 * of everything the simulation decides, every `EVERY` ticks, and of the ground at the end). A change that must leave the
 * game as it was (moving rules into the engine, say) must leave every digest as it was, tick for tick.
 */

/** A match to replay: the map, its seed, the two sides' species and levels, how long. */
export interface ReplayCase {
  readonly id: string;
  readonly scenario: string;
  readonly seed: number;
  readonly species: readonly [string, string];
  readonly levels: readonly [number, number];
  readonly ticks: number;
  /** A smaller map than the scenario's own (cx, cy, cz chunks), to keep the test quick. */
  readonly size?: readonly [number, number, number];
}

/** Ticks between two digests. */
export const EVERY = 60;

/** The cases the golden file holds. Short enough to run in the test suite; varied enough to touch every system. */
export const CASES: readonly ReplayCase[] = [
  { id: 'pc-ant-spider', scenario: 'pc-case', seed: 3, species: ['ant', 'spider'], levels: [1, 1], ticks: 14400 },
  { id: 'speaker-cockroach-bee', scenario: 'speaker', seed: 5, species: ['cockroach', 'bee'], levels: [4, 7], ticks: 14400 },
  { id: 'fridge-bee-ant', scenario: 'fridge', seed: 7, species: ['bee', 'ant'], levels: [10, 2], ticks: 14400 },
  { id: 'microwave-spider-cockroach', scenario: 'microwave', seed: 2, species: ['spider', 'cockroach'], levels: [6, 6], ticks: 14400 },
  { id: 'car-ant-bee', scenario: 'car', seed: 9, species: ['ant', 'bee'], levels: [3, 9], ticks: 14400 },
];

/** Play a case; its digests (one every `EVERY` ticks, the ground's last). */
export function replay(c: ReplayCase): string[] {
  const sc = SCENARIOS.find((s) => s.id === c.scenario);
  if (!sc) throw new Error(`no scenario ${c.scenario}`);
  const terrain = new Terrain(...((c.size ?? sc.mapSize ?? [5, 3, 5]) as [number, number, number]));
  sc.generate(terrain, c.seed);
  const species = c.species.map((id) => {
    const s = SPECIES.find((q) => q.id === id);
    if (!s) throw new Error(`no species ${id}`);
    return s;
  });
  const m = new Match(
    terrain,
    [
      { name: 'a', species: species[0], color: 0, size: 3, growth: computerGrowth(species[0].id, c.levels[0]) },
      { name: 'b', species: species[1], color: 0, size: 3, growth: computerGrowth(species[1].id, c.levels[1]) },
    ],
    c.seed * 31,
    { strictBounds: sc.strictBounds, spawnLevels: sc.spawnLevels === true, turntable: sc.turntable?.(terrain.W, terrain.H, terrain.D), confine: sc.confine?.(terrain.W, terrain.H, terrain.D) },
  );
  const skill = SKILLS.find((s) => s.id === 'normal') ?? SKILLS[1];
  const brains = [new Brain(skill, c.seed * 2), new Brain(skill, c.seed * 2 + 1)];
  const out: string[] = [];
  let events = '';
  for (let n = 1; n <= c.ticks && m.phase !== 'over'; n++) {
    m.step(brains[m.activeUnit.team].next(m));
    if (m.events.length) events += JSON.stringify(m.events);
    if (n % EVERY === 0) {
      out.push(digest(m, events));
      events = '';
    }
  }
  out.push(`end ${m.phase} ${digest(m, events)} ground ${groundDigest(terrain)}`);
  return out;
}
