import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CASES, EVERY, replay } from './helpers/replay';

/**
 * Regression: whole matches, tick for tick. The golden file is written by `npm run golden`, and only when the game is
 * meant to change; any other change must play every match exactly as before.
 */
const golden = JSON.parse(readFileSync(new URL('./golden/replays.json', import.meta.url), 'utf8')) as Record<string, string[]>;

describe('golden replays', () => {
  for (const c of CASES) {
    it(`${c.id} plays as before, every ${EVERY} ticks`, { timeout: 120_000 }, () => {
      const want = golden[c.id];
      expect(want, `no golden replay for ${c.id}: run npm run golden`).toBeDefined();
      const got = replay(c);
      // (the first tick that differs, to find what changed)
      const at = got.findIndex((d, i) => d !== want[i]);
      expect(at, at < 0 ? '' : `first differs at digest ${at} (tick ${(at + 1) * EVERY}): ${got[at]} vs ${want[at]}`).toBe(-1);
      expect(got.length).toBe(want.length);
    });
  }
});
