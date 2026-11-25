import { describe, expect, it } from 'vitest';
import { Bug, IDLE, TICK_RATE, type BugInput } from '../src/game/bug';
import { Match, NO_INPUT } from '../src/game/match';
import { ANT, BEE } from '../src/game/species';
import { flat } from './helpers/worlds';

const step = (b: Bug, t: ReturnType<typeof flat>, input: Partial<BugInput>, n = 1): void => {
  for (let k = 0; k < n; k++) b.step(t, { ...IDLE, ...input });
};
const up = (species: typeof BEE): { b: Bug; t: ReturnType<typeof flat> } => {
  const t = flat(10);
  const b = new Bug(species);
  b.drop(t, 20, 32);
  b.fx = 1;
  b.fz = 0;
  step(b, t, {}, 60);
  step(b, t, { jump: true });
  step(b, t, {}, 10);
  return { b, t };
};

describe('the bee flies', () => {
  it('a second jump starts it; it goes ahead and up, and sinks slowly', () => {
    const { b, t } = up(BEE);
    const y = b.y;
    step(b, t, { jump: true, move: 1, run: true });
    expect(b.flying).toBe(true);
    step(b, t, { move: 1, run: true }, 60);
    expect(b.y).toBeGreaterThan(y + 3);
    expect(b.x).toBeGreaterThan(26);
    const high = b.y;
    step(b, t, { move: 1 }, 45);
    expect(b.y).toBeLessThan(high + 1);
    expect(b.vy).toBeGreaterThan(-2);
  });

  it('only while its breath lasts, which a new turn gives back; then it falls and lands', () => {
    const { b, t } = up(BEE);
    step(b, t, { jump: true, run: true });
    step(b, t, { run: true }, TICK_RATE * 3);
    expect(b.flying).toBe(false);
    expect(b.breath).toBe(0);
    step(b, t, { jump: true });
    expect(b.flying).toBe(false);
    step(b, t, {}, TICK_RATE * 4);
    expect(b.grounded).toBe(true);
    const m = new Match(flat(10), [{ name: 'a', species: BEE, color: 0, size: 1 }, { name: 'b', species: BEE, color: 0, size: 1 }], 1, { turnSeconds: 2 });
    for (const u of m.units) u.bug.breath = 5;
    for (let n = 0; n < TICK_RATE * 6; n++) m.step(NO_INPUT);
    expect(m.units[1].bug.breath).toBe(TICK_RATE * 3);
  });

  it('a push ends it, an ant cannot, and it does not leave the map', () => {
    const { b, t } = up(BEE);
    step(b, t, { jump: true, run: true });
    b.push(1, 0, 0);
    expect(b.flying).toBe(false);
    const a = up(ANT);
    step(a.b, a.t, { jump: true, run: true });
    expect(a.b.flying).toBe(false);
    const c = up(BEE);
    c.b.x = c.b.px = 5;
    c.b.fx = -1;
    step(c.b, c.t, { jump: true, run: true, move: 1 });
    step(c.b, c.t, { run: true, move: 1 }, TICK_RATE * 2);
    expect(c.b.x).toBeGreaterThan(0);
    expect(c.b.alive).toBe(true);
  });
});
