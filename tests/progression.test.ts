import { describe, expect, it } from 'vitest';
import { DataCache, MemoryStore } from '../src/data';
import { TICK_RATE } from '../src/game/bug';
import { Match, NO_INPUT } from '../src/game/match';
import { LEVELS, PASSIVES, xpFor, type Growth } from '../src/game/progress';
import { ANT, BEE, COCKROACH, type BugSpecies } from '../src/game/species';
import { passiveSetting, TUNING } from '../src/game/tuning';
import { ANT_COLUMN, BLACKOUT_SWARM, SPECIAL_AT, specialsAt, TITAN_LIFT, WEAPONS } from '../src/game/weapons';
import { Profile } from '../src/ui/profile';
import { flat } from './helpers/worlds';

const match = (s: BugSpecies, growth: Growth | undefined, extra: { special?: string; tuning?: Record<string, number> } = {}): Match =>
  new Match(flat(10), [{ name: 'a', species: s, color: 0, size: 2, growth, special: extra.special }, { name: 'b', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, tuning: TUNING.make(extra.tuning ?? {}) });
const grown = (level: number, passives: string[] = []): Growth => ({ level, passives, items: {} });

describe('passives through the engine', () => {
  it('one that multiplies an attribute is a modifier on every bug of its team, by its number', () => {
    const m = match(COCKROACH, grown(8, ['scurry']));
    for (const u of m.units.filter((q) => q.team === 0)) {
      expect(u.bug.stats.has('passive:scurry')).toBe(true);
      expect(u.bug.stats.get('speed')).toBeCloseTo(COCKROACH.walkSpeed * 1.16, 9);
    }
    expect(m.units.find((q) => q.team === 1)?.bug.stats.has('passive:scurry')).toBe(false);
    const b = match(BEE, grown(8, ['big-lungs']));
    expect(b.units[0].bug.breath).toBe(Math.round((BEE.flight ?? 0) * 1.33 * TICK_RATE));
    expect(match(BEE, undefined).units[0].bug.breath).toBe(Math.round((BEE.flight ?? 0) * TICK_RATE));
  });

  it('its number is the tuning\'s: a passive tuned up does more', () => {
    for (const q of PASSIVES) {
      if (q.value > 0) expect(TUNING.get(passiveSetting(q.id)).value, q.id).toBe(q.value);
      else expect(TUNING.has(passiveSetting(q.id)), q.id).toBe(false);
    }
    expect(match(COCKROACH, grown(8, ['scurry']), { tuning: { [passiveSetting('scurry')]: 2 } }).units[0].bug.stats.get('speed')).toBe(COCKROACH.walkSpeed * 2);
    const m = match(COCKROACH, grown(8, ['leftovers', 'grounded']), { tuning: { [passiveSetting('leftovers')]: 30 } });
    expect(m.passive(0, 'leftovers')).toBe(30);
    // (one with no number is on, or off)
    expect(m.passive(0, 'grounded')).toBe(1);
    expect(m.passive(0, 'scurry')).toBe(0);
  });

  it('one that acts when something happens hangs on a trigger: Leftovers heals who finishes off an enemy', () => {
    const m = match(COCKROACH, grown(8, ['leftovers']));
    const roach = m.units[m.active];
    expect(roach.team).toBe(0);
    roach.bug.health = 50;
    const enemy = m.units.find((q) => q.team === 1)!;
    m.triggers.emit('death', { unit: enemy.id });
    expect(roach.bug.health).toBe(50 + Math.round(15 / (COCKROACH.toughness / 100)));
    // (not for a friend)
    const friend = m.units.find((q) => q.team === 0 && q !== roach)!;
    m.triggers.emit('death', { unit: friend.id });
    expect(roach.bug.health).toBe(50 + Math.round(15 / (COCKROACH.toughness / 100)));
  });
});

describe('specials, played to', () => {
  it('the first at once, the second at its level', () => {
    expect(SPECIAL_AT[0]).toBe(1);
    expect(specialsAt('ant', 1)).toEqual([ANT_COLUMN]);
    expect(specialsAt('ant', SPECIAL_AT[1] - 1)).toEqual([ANT_COLUMN]);
    expect(specialsAt('ant', SPECIAL_AT[1])).toEqual([ANT_COLUMN, TITAN_LIFT]);
    expect(specialsAt('ant', Infinity)).toEqual([ANT_COLUMN, TITAN_LIFT]);
    expect(specialsAt('cockroach', 1)).toEqual([BLACKOUT_SWARM]);
  });

  it('a team takes the one it asks for only if it has played to it; with no levels, any', () => {
    const at = (w: typeof ANT_COLUMN): number => WEAPONS.indexOf(w);
    expect(match(ANT, grown(1), { special: 'titan-lift' }).special(0)).toBe(at(ANT_COLUMN));
    expect(match(ANT, grown(SPECIAL_AT[1]), { special: 'titan-lift' }).special(0)).toBe(at(TITAN_LIFT));
    expect(match(ANT, undefined, { special: 'titan-lift' }).special(0)).toBe(at(TITAN_LIFT));
  });
});

describe('growth for testing', () => {
  it('a level is set at its start, keeping only what it allows; a species is put back as never played', () => {
    const p = new Profile(new DataCache(new MemoryStore(), 'me'));
    p.setLevel('ant', 4);
    expect(p.level('ant').level).toBe(4);
    expect(p.of('ant').xp).toBe(xpFor(1) + xpFor(2) + xpFor(3));
    expect(p.touch('ant', 'hot-tip')).toBe(true);
    p.setLevel('ant', 1);
    expect(p.of('ant').known).toEqual([]);
    p.setLevel('ant', 99);
    expect(p.level('ant').level).toBe(LEVELS);
    p.reset('ant');
    expect(p.of('ant')).toEqual({ xp: 0, known: [], active: [], items: {} });
    // (a match is not changed by it: what the match took stays)
    expect(match(ANT, p.growth('ant')).teams[0].growth?.level).toBe(1);
    const m = match(ANT, grown(1));
    m.step(NO_INPUT);
    expect(m.teams[0].growth?.level).toBe(1);
  });
});
