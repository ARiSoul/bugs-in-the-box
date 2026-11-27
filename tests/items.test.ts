import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/bug';
import { ITEM_KINDS, type Item, type ItemKind } from '../src/game/items';
import { Match, NO_INPUT } from '../src/game/match';
import { ANT, COCKROACH, SPIDER } from '../src/game/species';
import { CAPACITOR, WEAPONS } from '../src/game/weapons';
import { flat } from './helpers/worlds';

const make = (extra = {}): Match => {
  const t = flat(10);
  const m = new Match(t, [{ name: 'Red', species: ANT, color: 0, size: 1 }, { name: 'Blue', species: SPIDER, color: 0, size: 1 }], 1, { placeBugs: false, bag: 0, ...extra });
  m.units[0].bug.drop(t, 20, 32);
  m.units[1].bug.drop(t, 44, 32);
  for (let n = 0; n < TICK_RATE * 2; n++) m.step(NO_INPUT);
  return m;
};

const put = (m: Match, kind: ItemKind, x: number, y: number, z: number): Item => {
  const it: Item = { id: 900 + m.items.list.length, kind, by: 'bee', x, y, z, vy: 0, due: 0, trip: 1, path: [], resting: true };
  m.items.list.push(it);
  return it;
};

/** A box of this kind opened by the first bug. */
const opened = (kind: ItemKind, before: (m: Match) => void = () => {}): Match => {
  const m = make();
  before(m);
  const b = m.units[0].bug;
  put(m, kind, b.x + 1, b.y, b.z);
  m.step(NO_INPUT);
  expect(m.items.list.length).toBe(0);
  expect(m.events.some((e) => e.type === 'open' && e.kind === kind && e.unit === 0)).toBe(true);
  return m;
};

describe('boxes', () => {
  it('turn up in a match, the same for the same seed, on the ground, and come to rest', () => {
    const run = (): { log: string; rested: number } => {
      const m = new Match(flat(10), [{ name: 'a', species: ANT, color: 0, size: 2 }, { name: 'b', species: COCKROACH, color: 0, size: 2 }], 7, { turnSeconds: 5 });
      const log: string[] = [];
      for (let n = 0; n < TICK_RATE * 90 && m.phase !== 'over'; n++) {
        m.step(NO_INPUT);
        for (const e of m.events) if (e.type === 'box') log.push(`${m.tick}:${e.id}:${JSON.stringify(m.items.list.find((q) => q.id === e.id)?.kind)}`);
      }
      return { log: log.join(), rested: m.items.list.filter((q) => q.resting).length };
    };
    const a = run();
    expect(a.log.length).toBeGreaterThan(0);
    expect(a.rested).toBeGreaterThan(1);
    expect(run()).toEqual(a);
  });

  it('do not turn up where the tests place the bugs, and a match with them has the same winds', () => {
    expect(make().items.list.length).toBe(0);
    const winds = (items: boolean): number[] => {
      const m = new Match(flat(10), [{ name: 'a', species: ANT, color: 0, size: 1 }, { name: 'b', species: ANT, color: 0, size: 1 }], 3, { turnSeconds: 5, items });
      const out: number[] = [];
      for (let n = 0; n < TICK_RATE * 40; n++) {
        m.step(NO_INPUT);
        for (const e of m.events) if (e.type === 'turn') out.push(m.windX);
      }
      return out;
    };
    expect(winds(true)).toEqual(winds(false));
  });

  it('battery loads the special, patch heals', () => {
    expect(opened('battery').skill[0]).toBeGreaterThanOrEqual(400);
    const m = opened('patch', (q) => (q.units[0].bug.health = 50));
    expect(m.units[0].bug.health).toBe(90);
  });

  it('a fuse halves the next blow, once; an overclocked shot hurts half as much again', () => {
    const m = opened('fuse');
    const hit = (q: Match, u: number, n: number): number => {
      const was = q.units[u].bug.health;
      (q as unknown as { damage(u: unknown, n: number): void }).damage(q.units[u], n);
      return was - q.units[u].bug.health;
    };
    expect(hit(m, 0, 30)).toBe(15);
    expect(hit(m, 0, 30)).toBe(30);
    const o = opened('overclock');
    expect(o.units[0].boost).toBe(true);
    o.step({ ...NO_INPUT, fire: true });
    o.step(NO_INPUT);
    expect(o.units[0].boost).toBe(false);
    const b = o.units[1].bug;
    const was = b.health;
    o.explode(b.x, b.y, b.z, CAPACITOR);
    expect(was - b.health).toBe(Math.round(CAPACITOR.damage * 1.5));
  });

  it('a shock blows a fuse (electric meets its electric tag): it takes all of the blow, once', () => {
    const m = opened('fuse');
    const shock = (q: Match, u: number, n: number): number => {
      const was = q.units[u].bug.health;
      (q as unknown as { damage(u: unknown, n: number, electric: boolean): void }).damage(q.units[u], n, true);
      return was - q.units[u].bug.health;
    };
    expect(m.units[0].effects.tags()).toContain('electric');
    expect(shock(m, 0, 30)).toBe(0);
    expect(m.units[0].fuse).toBe(false);
    expect(shock(m, 0, 30)).toBe(30);
  });

  it('springs, crystal, paste, scrap, magnet and dud do what they say', () => {
    expect(opened('spring').units[0].bug.leap).toBeGreaterThan(1.3);
    const c = make();
    const left = c.turnTicks;
    put(c, 'crystal', c.units[0].bug.x, c.units[0].bug.y, c.units[0].bug.z);
    c.step(NO_INPUT);
    expect(c.turnTicks).toBeGreaterThan(left + 14 * TICK_RATE);
    const paste = WEAPONS.findIndex((w) => w.kind === 'trap');
    const p = opened('paste');
    expect(p.has(p.units[0], paste)).toBe(true);
    expect(p.has(p.units[1], paste)).toBe(false);
    p.step({ ...NO_INPUT, weapon: paste });
    p.step({ ...NO_INPUT, weapon: paste, fire: true });
    expect(p.webs.length).toBe(1);
    expect(p.webs[0].paste).toBe(0);
    expect(p.has(p.units[0], paste)).toBe(false);
    // (it does not hold its own team; it holds the other's, spiders too)
    p.step(NO_INPUT);
    expect(p.units[0].web).toBe(-1);
    const s = p.units[1].bug;
    s.x = s.px = p.webs[0].x;
    s.z = s.pz = p.webs[0].z + 1.5;
    p.step(NO_INPUT);
    expect(p.units[1].web).toBe(p.webs[0].id);
    expect(opened('scrap').stock[0].reduce((a, b, i) => a + (WEAPONS[i].start === undefined ? b : 0), 0)).toBe(2);
    const g = opened('magnet');
    expect(g.units[1].bug.vx).toBeLessThan(-3);
    const d = opened('dud');
    expect(d.units[0].bug.health).toBeLessThan(ANT.health);
  });

  it('what is kept is used later, one a turn, and only as many kinds as there are spaces', () => {
    const m = make({ bag: 2 });
    const b = m.units[0].bug;
    const open = (kind: ItemKind): void => {
      put(m, kind, b.x + 1, b.y, b.z);
      m.step(NO_INPUT);
    };
    // (of use now: at once; of none now: kept)
    b.health = 40;
    open('patch');
    expect(b.health).toBeGreaterThan(70);
    expect(m.bag[0]).toEqual({});
    b.health = b.species.health;
    open('patch');
    open('patch');
    open('fuse');
    expect(m.units[0].fuse).toBe(true);
    open('fuse');
    expect(m.bag[0]).toEqual({ patch: 2, fuse: 1 });
    // (no space: at once)
    open('magnet');
    expect(m.bag[0].magnet).toBeUndefined();
    b.health = 40;
    m.step({ ...NO_INPUT, item: ITEM_KINDS.indexOf('patch') });
    expect(m.events.some((e) => e.type === 'use' && e.kind === 'patch')).toBe(true);
    expect(b.health).toBeGreaterThan(70);
    m.step({ ...NO_INPUT, item: ITEM_KINDS.indexOf('patch') });
    expect(m.bag[0]).toEqual({ patch: 1, fuse: 1 });
  });

  it('a blast destroys a box, and one that loses its ground falls', () => {
    const m = make();
    put(m, 'patch', 30, 11, 30);
    m.explode(30, 10, 30, CAPACITOR);
    expect(m.items.list.length).toBe(0);
    const it = put(m, 'patch', 50, 10.62, 50);
    m.field.carve(50, 6, 50, 4.4);
    for (let n = 0; n < 60; n++) m.step(NO_INPUT);
    expect(it.y).toBeLessThan(9);
  });

  it('every kind is drawn sooner or later', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 12 && seen.size < ITEM_KINDS.length; seed++) {
      const m = new Match(flat(10), [{ name: 'a', species: ANT, color: 0, size: 1 }, { name: 'b', species: ANT, color: 0, size: 1 }], seed, { placeBugs: false });
      for (let t = 2; t < 60; t++) {
        const it = m.items.turn(t);
        if (it) {
          seen.add(it.kind);
          m.items.remove(it);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ITEM_KINDS].sort());
  });
});

describe('more than two teams', () => {
  it('take turns in order, and the last one left wins', () => {
    const t = flat(10);
    const m = new Match(t, [0, 1, 2, 3].map((i) => ({ name: `p${i}`, species: [ANT, SPIDER, COCKROACH, ANT][i], color: 0, size: 1 })), 5, { turnSeconds: 1, items: false });
    const order: number[] = [m.activeUnit.team];
    for (let n = 0; n < TICK_RATE * 12; n++) {
      m.step(NO_INPUT);
      for (const e of m.events) if (e.type === 'turn') order.push(m.units[e.unit].team);
    }
    expect(order.slice(0, 6)).toEqual([0, 1, 2, 3, 0, 1]);
    for (const i of [0, 2, 3]) m.units[i].bug.health = 0;
    for (let n = 0; n < TICK_RATE * 12 && m.phase !== 'over'; n++) m.step(NO_INPUT);
    expect(m.phase).toBe('over');
    expect(m.winner).toBe(1);
  });
});
