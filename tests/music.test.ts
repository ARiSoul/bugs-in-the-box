import { describe, expect, it } from 'vitest';
import { loopOf, makeTheme, STEMS, THEMES } from '../src/audio/music';
import { SCENARIOS } from '../src/terrain/scenarios';

const RATE = 8000;

describe('music', () => {
  it('has a theme for every map', () => {
    for (const s of SCENARIOS) expect(Object.keys(THEMES)).toContain(s.id);
  });

  for (const id of Object.keys(THEMES))
    it(`${id}: its stems are clean, loop together and are not silent`, () => {
      const t = makeTheme(id, RATE);
      const n = Math.round(loopOf(THEMES[id]).seconds * RATE);
      for (const s of STEMS)
        for (const c of t[s]) {
          expect(c.length).toBe(n);
          let top = 0;
          let energy = 0;
          let step = 0;
          let finite = true;
          for (let i = 0; i < n; i++) {
            if (!Number.isFinite(c[i])) finite = false;
            top = Math.max(top, Math.abs(c[i]));
            energy += c[i] * c[i];
            if (i > 0) step = Math.max(step, Math.abs(c[i] - c[i - 1]));
          }
          expect(finite).toBe(true);
          expect(top).toBeLessThanOrEqual(1);
          expect(Math.sqrt(energy / n)).toBeGreaterThan(0.008);
          // (the step over the seam is like the steps inside)
          expect(Math.abs(c[0] - c[n - 1])).toBeLessThanOrEqual(step);
        }
    });

  it('is the same on every run', () => {
    expect(makeTheme('car', 4000).groove[0]).toEqual(makeTheme('car', 4000).groove[0]);
  });
});
