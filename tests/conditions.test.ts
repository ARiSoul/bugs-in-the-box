import { describe, expect, it } from 'vitest';
import { Bug } from '../src/game/bug';
import { CONDITIONS, CRACKED, FUSE, HELD, SHELL, SHELTERED, SPRINGS } from '../src/game/conditions';
import { Effects } from '../src/game/engine';
import { Match, NO_INPUT, SKILL_FULL, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, COCKROACH, SPIDER } from '../src/game/species';
import { Unit } from '../src/game/unit';
import { ANTHILL, WEAPONS, WEB_SHOT } from '../src/game/weapons';
import { flat } from './helpers/worlds';

/** A unit on its own (no match): its states as effects. */
const lone = (): Unit => {
  const bug = new Bug(ANT);
  return new Unit(0, 0, 'ant 1', bug, new Effects(bug.stats), 0.7);
};

describe('a unit\'s states are effects', () => {
  it('the conditions are data, with tags, none running out by itself', () => {
    expect(CONDITIONS.all().map((c) => c.id)).toEqual(['fuse', 'overclock', 'springs', 'extra-time', 'held', 'shell', 'cracked', 'sheltered']);
    for (const c of CONDITIONS.all()) {
      expect(c.ticks).toBe(0);
      expect(c.tags.length).toBeGreaterThan(0);
    }
  });

  it('a flag is an effect on or off', () => {
    const u = lone();
    expect(u.fuse).toBe(false);
    u.fuse = true;
    expect(u.effects.has(FUSE.id)).toBe(true);
    expect(u.effects.tagged('electric').map((s) => s.def.id)).toEqual(['fuse']);
    u.fuse = true;
    expect(u.effects.stacks(FUSE.id)).toBe(1);
    u.fuse = false;
    expect(u.effects.list()).toEqual([]);
  });

  it('a number is what its effect carries; its "none" takes it off', () => {
    const u = lone();
    expect(u.web).toBe(-1);
    u.web = 3;
    expect(u.effects.find(HELD.id)?.value).toBe(3);
    expect(u.effects.tagged('silk').length).toBe(1);
    u.web = -1;
    expect(u.effects.has(HELD.id)).toBe(false);
    u.spring = 3;
    u.spring--;
    expect(u.spring).toBe(2);
    expect(u.effects.find(SPRINGS.id)?.value).toBe(2);
    u.spring = 0;
    expect(u.effects.has(SPRINGS.id)).toBe(false);
    u.shellTurn = 7;
    expect(u.effects.find(CRACKED.id)?.value).toBe(7);
  });

  it('a shelter carries its weapon and what it still keeps off, and what it kept off is read after it is gone', () => {
    const u = lone();
    expect(u.cover).toBe(null);
    u.cover = ANTHILL;
    u.coverLeft = 45;
    expect(u.effects.find(SHELTERED.id)).toMatchObject({ ref: 'anthill', value: 45 });
    expect(u.cover).toBe(ANTHILL);
    u.coverLeft -= 20;
    expect(u.coverLeft).toBe(25);
    u.cover = null;
    expect(u.effects.has(SHELTERED.id)).toBe(false);
    expect(u.coverLeft).toBe(25);
  });
});

describe('states in a match', () => {
  function setup(a = SPIDER, b = ANT): Match {
    const t = flat(10);
    const m = new Match(t, [{ name: 'A', species: a, color: 0, size: 1 }, { name: 'B', species: b, color: 0, size: 1 }], 1, { placeBugs: false });
    m.units[0].bug.drop(t, 20, 32);
    m.units[1].bug.drop(t, 26, 32);
    run(m, 60);
    for (const u of m.units) u.bug.health = 100;
    m.skill.fill(SKILL_FULL);
    return m;
  }
  function run(m: Match, ticks: number, input: Partial<MatchInput> = {}): MatchEvent[] {
    const events: MatchEvent[] = [];
    for (let n = 0; n < ticks; n++) {
      m.step({ ...NO_INPUT, ...input });
      events.push(...m.events);
    }
    return events;
  }

  it('a cockroach starts with its shell on, as an effect', () => {
    const m = setup(COCKROACH, ANT);
    expect(m.units[0].effects.has(SHELL.id)).toBe(true);
    expect(m.units[1].effects.has(SHELL.id)).toBe(false);
  });

  it('a web holds a bug: the held effect comes on (a trigger tells), with the web\'s id; tearing it takes it off', () => {
    const m = setup();
    const started: string[] = [];
    const ended: string[] = [];
    m.triggers.on('effectStart', (p) => started.push(`${p.unit} ${p.effect}`));
    m.triggers.on('effectEnd', (p) => ended.push(`${p.unit} ${p.effect}`));
    run(m, 1, { weapon: WEAPONS.indexOf(WEB_SHOT) });
    const s = m.units[0];
    const a = m.units[1].bug;
    run(m, 1, { faceX: a.x - s.bug.x, faceZ: a.z - s.bug.z });
    s.aimH = 1;
    s.aimV = 0;
    run(m, 60, { fire: true });
    for (let n = 0; n < 1200 && m.active === 0; n++) run(m, 1);
    expect(started).toContain('1 held');
    const held = m.units[1].effects.find(HELD.id);
    expect(held?.value).toBe(m.webs[0].id);
    // (the ant pulls until the web tears)
    for (let n = 0; n < 2000 && m.webs.length > 0; n++) run(m, 1, { move: 1 });
    expect(m.units[1].effects.has(HELD.id)).toBe(false);
    expect(ended).toContain('1 held');
  });
});
