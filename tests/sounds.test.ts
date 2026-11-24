import { describe, expect, it } from 'vitest';
import { makeEcho, makeSound, SOUND_IDS, SOUNDS } from '../src/audio/sounds';
import { SCENARIOS } from '../src/terrain/scenarios';

describe('sounds', () => {
  for (const id of SOUND_IDS)
    it(`${id} is clean`, () => {
      const takes = makeSound(id);
      expect(takes.length).toBe(SOUNDS[id].variants ?? 1);
      for (const b of takes) {
        let top = 0;
        let sum = 0;
        let energy = 0;
        let finite = true;
        for (const v of b) {
          if (!Number.isFinite(v)) finite = false;
          top = Math.max(top, Math.abs(v));
          sum += v;
          energy += v * v;
        }
        expect(finite).toBe(true);
        expect(top).toBeLessThanOrEqual(1);
        expect(Math.sqrt(energy / b.length)).toBeGreaterThan(0.03);
        expect(Math.abs(sum / b.length)).toBeLessThan(0.02);
        if (!SOUNDS[id].loop) {
          // (no click where it starts or ends)
          expect(Math.abs(b[0])).toBeLessThan(0.01);
          expect(Math.abs(b[b.length - 1])).toBeLessThan(0.01);
          continue;
        }
        // (the step over the seam is like the steps before it)
        let step = 0;
        for (let i = 1; i < b.length; i++) step = Math.max(step, Math.abs(b[i] - b[i - 1]));
        expect(Math.abs(b[0] - b[b.length - 1])).toBeLessThanOrEqual(step);
      }
    });

  it('are the same on every run', () => {
    expect(makeSound('blast')[0]).toEqual(makeSound('blast')[0]);
  });

  it('has an ambience for every map', () => {
    for (const s of SCENARIOS) expect(SOUND_IDS).toContain(`room:${s.id}`);
  });

  it('makes an echo of two channels', () => {
    const [l, r] = makeEcho(0.5, 3000);
    expect(l.length).toBe(22050);
    expect(l).not.toEqual(r);
  });
});
