import { Brain, SKILLS } from '../../src/game/brain';
import { Match } from '../../src/game/match';
import { computerGrowth } from '../../src/game/progress';
import { SPECIES } from '../../src/game/species';
import { SCENARIOS } from '../../src/terrain/scenarios';
import { Terrain } from '../../src/terrain/Terrain';

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

/** FNV-1a over 32-bit words. */
class Hash {
  private h = 0x811c9dc5;
  private readonly f = new Float64Array(1);
  private readonly w = new Uint32Array(this.f.buffer);
  int(v: number): void {
    this.h = Math.imul(this.h ^ (v | 0), 0x01000193) >>> 0;
  }
  /** A number by its exact bits (the simulation is deterministic: the bits must match, not just the value). */
  num(v: number): void {
    this.f[0] = v;
    this.int(this.w[0]);
    this.int(this.w[1]);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
  }
  get hex(): string {
    return this.h.toString(16).padStart(8, '0');
  }
}

/** Everything the simulation decided by now, as one hash. */
function digest(m: Match, events: string): string {
  const h = new Hash();
  h.str(m.phase);
  h.int(m.active);
  h.int(m.turnNumber);
  h.num(m.windX);
  h.num(m.windZ);
  for (const u of m.units) {
    const b = u.bug;
    for (const v of [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.hx, b.hz, b.health]) h.num(v);
    h.int(b.alive ? 1 : 0);
    h.int(b.grounded ? 1 : 0);
  }
  h.str(events);
  return h.hex;
}

/** The ground's own hash: every density and material. */
function groundDigest(t: Terrain): string {
  const h = new Hash();
  const d = new Uint32Array(t.dens.buffer, t.dens.byteOffset, t.dens.byteLength >> 2);
  for (let i = 0; i < d.length; i++) h.int(d[i]);
  for (let i = 0; i < t.material.length; i++) h.int(t.material[i]);
  return h.hex;
}

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
