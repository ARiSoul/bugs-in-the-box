/**
 * Write the golden replays (tests/golden/replays.json): whole matches the computer plays against itself, as digests.
 * Run it only when the game is meant to change (`npm run golden`); the test `replays.test.ts` holds every later change to
 * them, tick for tick.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CASES, replay } from '../tests/helpers/replay';

const out: Record<string, string[]> = {};
for (const c of CASES) {
  const t0 = performance.now();
  out[c.id] = replay(c);
  console.log(`${c.id}: ${out[c.id].length} digests, ${(performance.now() - t0).toFixed(0)} ms`);
}
mkdirSync('tests/golden', { recursive: true });
writeFileSync('tests/golden/replays.json', JSON.stringify(out, null, 1) + '\n');
console.log('tests/golden/replays.json written');
