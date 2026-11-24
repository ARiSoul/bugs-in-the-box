/**
 * Balance: the computer plays itself, every pair of species, both ways round, on every map.
 * npx tsx scripts/balance.ts [seeds] [chance to use a loaded special, 0..1, default the skill's] [skill] [scenario]
 */
import { Brain, SKILLS } from '../src/game/brain';
import { Match } from '../src/game/match';
import { SPECIES } from '../src/game/species';
import { SCENARIOS } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';

const seeds = Number(process.argv[2] ?? 2);
const skill = { ...(SKILLS.find((s) => s.id === (process.argv[4] ?? 'normal')) ?? SKILLS[1]) };
if (process.argv[3]) skill.special = Number(process.argv[3]);
const only = process.argv[5];

const wins: Record<string, [number, number]> = {};
const species: Record<string, [number, number]> = {};
const first: [number, number] = [0, 0];
const weapons: Record<string, { shots: number; harm: number; own: number; hits: number; kills: number }> = {};
let matches = 0;
let ticks = 0;
let turns = 0;
let fell = 0;
for (const sc of SCENARIOS) {
  if (only && sc.id !== only) continue;
  const terrain = new Terrain(...((sc.mapSize ?? [5, 3, 5]) as [number, number, number]));
  for (let seed = 1; seed <= seeds; seed++)
    for (const a of SPECIES)
      for (const b of SPECIES) {
        if (a === b) continue;
        sc.generate(terrain, seed);
        const m = new Match(
          terrain,
          [
            { name: 'a', species: a, color: 0, size: 3 },
            { name: 'b', species: b, color: 0, size: 3 },
          ],
          seed * 31,
          { strictBounds: sc.strictBounds, spawnLevels: sc.spawnLevels === true, turntable: sc.turntable?.(terrain.W, terrain.H, terrain.D), confine: sc.confine?.(terrain.W, terrain.H, terrain.D) },
        );
        const brains = [new Brain(skill, seed * 2), new Brain(skill, seed * 2 + 1)];
        let shot = '';
        let hit = false;
        for (let n = 0; n < 60 * 60 * 20 && m.phase !== 'over'; n++) {
          const unit = m.activeUnit;
          m.step(brains[unit.team].next(m));
          ticks++;
          for (const e of m.events) {
            if (e.type === 'fire') {
              shot = e.weapon;
              hit = false;
              (weapons[shot] ??= { shots: 0, harm: 0, own: 0, hits: 0, kills: 0 }).shots++;
            } else if (e.type === 'damage' && shot) {
              const w = weapons[shot];
              if (m.units[e.unit].team === unit.team) w.own += e.amount;
              else {
                w.harm += e.amount;
                if (!hit) w.hits++;
                hit = true;
              }
            } else if (e.type === 'death') {
              if (m.units[e.unit].bug.y < -3) fell++;
              if (shot && m.units[e.unit].team !== unit.team) weapons[shot].kills++;
            } else if (e.type === 'turn') {
              turns++;
              shot = '';
            }
          }
        }
        matches++;
        if (m.phase !== 'over' || m.winner < 0) continue;
        const win = m.winner === 0 ? a : b;
        const lose = m.winner === 0 ? b : a;
        first[m.winner === 0 ? 0 : 1]++;
        (wins[`${win.id} over ${lose.id}`] ??= [0, 0])[0]++;
        (species[win.id] ??= [0, 0])[0]++;
        (species[lose.id] ??= [0, 0])[1]++;
      }
}
const pct = (x: number, n: number): string => `${((100 * x) / Math.max(1, n)).toFixed(0)}%`;
console.log(`${matches} matches, ${(ticks / 3600 / matches).toFixed(1)} min, ${(turns / matches).toFixed(1)} turns each, first team wins ${pct(first[0], first[0] + first[1])}, fell ${(fell / matches).toFixed(2)} a match`);
for (const [id, [w, l]] of Object.entries(species)) console.log(id.padEnd(10), pct(w, w + l));
console.log(Object.entries(wins).map(([k, v]) => `${k} ${v[0]}`).join(' · '));
let all = 0;
for (const w of Object.values(weapons)) all += w.shots;
for (const [id, w] of Object.entries(weapons).sort((p, q) => q[1].shots - p[1].shots))
  console.log(id.padEnd(15), pct(w.shots, all).padStart(4), 'of shots · harm', (w.harm / w.shots).toFixed(1).padStart(5), '· hits', pct(w.hits, w.shots).padStart(4), '· kills', (w.kills / w.shots).toFixed(2), '· own', (w.own / w.shots).toFixed(1));
