import { describe, expect, it } from 'vitest';
import { CONFIRM_MS, PauseState } from '../src/ui/pause';

describe('the pause box', () => {
  it('opens only when a match may pause, and closes again', () => {
    const p = new PauseState();
    expect(p.toggle(false)).toBe(false);
    expect(p.open).toBe(false);
    expect(p.toggle(true)).toBe(true);
    expect(p.open).toBe(true);
    // (closing needs no leave)
    expect(p.toggle(false)).toBe(true);
    expect(p.open).toBe(false);
  });

  it('Continue closes it at once', () => {
    const p = new PauseState();
    p.toggle(true);
    expect(p.choose('continue', 0)).toBe('continue');
    expect(p.open).toBe(false);
  });

  it('Restart and Leave ask a second click, in time', () => {
    const p = new PauseState();
    p.toggle(true);
    expect(p.choose('leave', 1000)).toBe(null);
    expect(p.open).toBe(true);
    expect(p.waits('leave', 1000 + CONFIRM_MS)).toBe(true);
    expect(p.choose('leave', 1500)).toBe('leave');
    expect(p.open).toBe(false);

    p.toggle(true);
    expect(p.choose('restart', 0)).toBe(null);
    // (too late: it asks again)
    expect(p.waits('restart', CONFIRM_MS + 1)).toBe(false);
    expect(p.choose('restart', CONFIRM_MS + 1)).toBe(null);
    expect(p.choose('restart', CONFIRM_MS + 2)).toBe('restart');
  });

  it('a click on the other choice arms that one instead; closing forgets what was armed', () => {
    const p = new PauseState();
    p.toggle(true);
    p.choose('restart', 0);
    expect(p.choose('leave', 10)).toBe(null);
    expect(p.waits('restart', 10)).toBe(false);
    p.toggle(true);
    p.toggle(true);
    expect(p.armed).toBe(null);
    expect(p.choose('leave', 20)).toBe(null);
  });

  it('nothing is chosen while it is closed', () => {
    const p = new PauseState();
    expect(p.choose('leave', 0)).toBe(null);
    expect(p.choose('continue', 0)).toBe(null);
  });
});
