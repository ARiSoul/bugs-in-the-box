import { Brain, SKILLS } from '../game/brain';
import { TUNING } from '../game/tuning';
import { Match, NO_INPUT, type MatchInput } from '../game/match';
import { SPECIES } from '../game/species';
import { SCENARIOS } from '../terrain/scenarios';
import { Terrain } from '../terrain/Terrain';
import { groundDigest, matchDigest } from './digest';
import { EVERY, Recorder, withChange, type MatchRecord, type MatchSetup } from './record';

/** The map and the match a setup makes (the map anew, from its seed). */
export function setUp(setup: MatchSetup): { terrain: Terrain; match: Match } {
  const sc = SCENARIOS.find((s) => s.id === setup.scenario);
  if (!sc) throw new Error(`no scenario '${setup.scenario}'`);
  const terrain = new Terrain(...(setup.size as [number, number, number]));
  sc.generate(terrain, setup.seed);
  const tuning = TUNING.make(setup.tuning.changed, setup.tuning.version);
  if (tuning.hash !== setup.tuning.hash) throw new Error(`its settings are not these (${tuning.hash}, not ${setup.tuning.hash}): another version of the game`);
  const teams = setup.teams.map((t) => {
    const species = SPECIES.find((s) => s.id === t.species);
    if (!species) throw new Error(`no species '${t.species}'`);
    return { name: t.name, species, special: t.special, color: t.color, size: t.size, growth: t.growth };
  });
  const r = setup.rules;
  const match = new Match(terrain, teams, setup.seed, {
    tuning,
    turnSeconds: r.turnSeconds,
    wind: r.wind,
    turned: r.turned,
    bag: r.bag,
    items: r.items,
    placeBugs: r.placeBugs,
    strictBounds: sc.strictBounds,
    spawnLevels: sc.spawnLevels === true,
    turntable: sc.turntable?.(terrain.W, terrain.H, terrain.D),
    confine: sc.confine?.(terrain.W, terrain.H, terrain.D),
  });
  return { terrain, match };
}

/** What playing a record again gave: its checkpoints, the ground's, and where it first went another way (-1: nowhere). */
export interface Replayed {
  readonly checkpoints: string[];
  readonly ground: { start: string; end: string };
  /** The first checkpoint that differs from the record's (as a tick), -1 if none; the ground's: `ground` below. */
  readonly firstDiff: number;
  readonly sameGround: boolean;
  readonly same: boolean;
}

/** Play `record` again, tick for tick, and compare it with itself (stops at the first checkpoint that differs, unless `whole`). */
export function replay(record: MatchRecord, whole = false): Replayed {
  if (!record.setup.fresh) throw new Error('its map was left in pieces by an earlier match: it cannot be made again from the seed');
  const { terrain, match } = setUp(record.setup);
  const start = groundDigest(terrain);
  const checkpoints: string[] = [];
  let input: Readonly<MatchInput> = NO_INPUT;
  let next = 0;
  let events = '';
  let firstDiff = -1;
  for (let tick = 0; tick < record.ticks; tick++) {
    while (next < record.inputs.length && record.inputs[next][0] === tick) input = withChange(input, record.inputs[next++][1]);
    match.step(input);
    if (match.events.length) events += JSON.stringify(match.events);
    if ((tick + 1) % EVERY === 0) {
      const d = matchDigest(match, events);
      events = '';
      checkpoints.push(d);
      if (firstDiff < 0 && d !== record.checkpoints[checkpoints.length - 1]) {
        firstDiff = tick + 1;
        if (!whole) break;
      }
    }
  }
  const end = groundDigest(terrain);
  const sameGround = start === record.ground.start && (firstDiff >= 0 || end === record.ground.end);
  return { checkpoints, ground: { start, end }, firstDiff, sameGround, same: firstDiff < 0 && sameGround && checkpoints.length === record.checkpoints.length };
}

/** A whole match the computer plays against itself, recorded (for checks between clients, and the golden replays). */
export function playRecorded(setup: MatchSetup, ticks: number, skill = 'normal'): MatchRecord {
  const { terrain, match } = setUp(setup);
  const s = SKILLS.find((q) => q.id === skill) ?? SKILLS[1];
  const brains = setup.teams.map((_, i) => new Brain(s, setup.seed * 2 + i));
  const rec = new Recorder(setup, match, () => groundDigest(terrain));
  for (let n = 0; n < ticks && match.phase !== 'over'; n++) rec.step(brains[match.activeUnit.team].next(match));
  return rec.finish(match.phase === 'over' ? 'over' : 'left');
}
