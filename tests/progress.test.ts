import { describe, expect, it } from 'vitest';
import { DataCache, MemoryStore } from '../src/data';
import { Brain, SKILLS } from '../src/game/brain';
import { ITEM_KINDS } from '../src/game/items';
import { Match, NO_INPUT, type MatchEvent, type MatchInput } from '../src/game/match';
import { brings, computerGrowth, LEVELS, levelAt, levelOf, PASSIVES, passivesOf, worth, XP, xpFor } from '../src/game/progress';
import { ANT, BEE, COCKROACH, SPECIES, SPIDER, type BugSpecies } from '../src/game/species';
import { ANTHILL, COMB_WALL, HUSK, RAMPART, SHORT_CIRCUIT, SILK_CURTAIN, SOLDERING_IRON, WAX_NEST, WEAPONS, WEB_SHOT, type Weapon } from '../src/game/weapons';
import { Profile } from '../src/ui/profile';
import type { Terrain } from '../src/terrain/Terrain';
import { world } from './helpers/worlds';

interface Inside {
  damage(u: unknown, n: number): void;
  announceDeath(u: unknown): void;
  arc(x: number, y: number, z: number, w: Weapon): void;
  openWeb(x: number, y: number, z: number, w: Weapon, grand: boolean): void;
  heal(u: unknown, n: number): void;
}
const inside = (m: Match): Inside => m as unknown as Inside;
const plain = (): Terrain => world(4, 3, 2, (_i, j) => j - 10);
const at = (w: Weapon): number => WEAPONS.indexOf(w);
function run(m: Match, ticks: number, input: Partial<MatchInput> = {}): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let n = 0; n < ticks; n++) {
    m.step({ ...NO_INPUT, ...input });
    events.push(...m.events);
  }
  return events;
}
function setup(s: BugSpecies, passives: string[], size = 1, enemy: BugSpecies = ANT): Match {
  const t = plain();
  const m = new Match(t, [{ name: 'A', species: s, color: 0, size, growth: { level: 8, passives, items: {} } }, { name: 'B', species: enemy, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
  m.units.forEach((u) => u.bug.drop(t, u.team ? 44 : 20, u.team ? 32 : 32 + u.id * 2));
  run(m, 60, { faceX: 1 });
  return m;
}
const use = (m: Match, w: Weapon): MatchEvent[] => {
  run(m, 1, { weapon: at(w) });
  return run(m, 1, { fire: true });
};
const pass = (m: Match): void => {
  const n = m.turnNumber;
  for (let k = 0; k < 5000 && m.turnNumber === n && m.phase !== 'over'; k++) m.step(NO_INPUT);
};

describe('levels', () => {
  it('go up with experience, bring more, and end', () => {
    expect(levelOf(0)).toMatchObject({ level: 1, slots: 5, spaces: 5, actives: 0, points: 0, into: 0 });
    expect(levelOf(xpFor(1)).level).toBe(2);
    expect(levelOf(xpFor(1) + xpFor(2) - 1)).toMatchObject({ level: 2, into: xpFor(2) - 1 });
    expect(levelOf(1e9)).toMatchObject({ level: LEVELS, slots: 6, spaces: 9, actives: 3, points: 6, next: 0 });
    expect(levelOf(-5).level).toBe(1);
    for (let l = 1; l <= LEVELS; l++) expect(brings(l).length, `level ${l}`).toBeGreaterThan(0);
  });

  it('a match is worth something to who loses, more to who wins, less against an easy computer, never more than the most', () => {
    const t = { damage: 100, kills: 1, blocked: 40, boxes: 2 };
    expect(worth(t, true, 'human').xp).toBeGreaterThan(worth(t, false, 'human').xp);
    expect(worth(t, true, 'easy').xp).toBeLessThan(worth(t, true, 'hard').xp);
    expect(worth({ damage: 9999, kills: 9, blocked: 999, boxes: 99 }, true, 'human').xp).toBe(XP.most);
  });

  it('every species has six passives, two of a branch, and as many points as that', () => {
    for (const s of SPECIES) {
      const l = passivesOf(s.id);
      expect(l.length).toBe(6);
      for (const b of ['Attack', 'Defence', 'Body']) expect(l.filter((p) => p.branch === b).length).toBe(2);
      expect(computerGrowth(s.id, 10).passives.length).toBe(3);
      expect(computerGrowth(s.id, 1).passives.length).toBe(0);
    }
    expect(levelAt(LEVELS).points).toBe(6);
    expect(new Set(PASSIVES.map((p) => p.id)).size).toBe(PASSIVES.length);
  });
});

describe('a profile', () => {
  it('learns with points, uses a few, gains, and keeps three items', () => {
    const p = new Profile(new DataCache(new MemoryStore(), 'me'));
    expect(p.touch('spider', 'barbs')).toBe(false);
    p.gain('spider', xpFor(1), null);
    expect(p.level('spider').level).toBe(2);
    expect(p.touch('spider', 'barbs')).toBe(true);
    expect(p.growth('spider').passives).toEqual(['barbs']);
    expect(p.touch('spider', 'patience')).toBe(false);
    expect(p.touch('spider', 'sting')).toBe(false);
    p.touch('spider', 'barbs');
    expect(p.growth('spider')).toMatchObject({ level: 2, passives: [] });
    const { before, after } = p.gain('spider', xpFor(2), { patch: 2, fuse: 2, spring: 1 });
    expect([before.level, after.level]).toEqual([2, 3]);
    expect(p.growth('spider').items).toEqual({ patch: 2, fuse: 1 });
  });

  it('is kept in the client data, and read back as it was (put right by its level)', async () => {
    const store = new MemoryStore();
    const cache = new DataCache(store, 'me');
    const p = new Profile(cache);
    p.gain('ant', xpFor(1) + xpFor(2), { fuse: 1 });
    p.touch('ant', 'hot-tip');
    await cache.flushed();
    const again = new DataCache(store, 'me');
    await again.load();
    const q = new Profile(again);
    expect(q.level('ant').level).toBe(3);
    expect(q.growth('ant')).toMatchObject({ level: 3, passives: ['hot-tip'], items: { fuse: 1 } });
  });
});

describe('passives', () => {
  it('ants: hot tip, nursery, many hands, carrier', () => {
    const m = setup(ANT, ['hot-tip']);
    m.units[1].bug.drop(m.field, 26, 32);
    run(m, 30, { faceX: 1 });
    m.units[0].aimH = 1;
    m.units[0].aimV = 0;
    const was = m.units[1].bug.health;
    run(m, 1, { weapon: at(SOLDERING_IRON) });
    run(m, 1, { fire: true });
    run(m, 3);
    expect(was - m.units[1].bug.health).toBe(15);
    const n = setup(ANT, ['nursery', 'many-hands']);
    run(n, 1, { weapon: at(RAMPART) });
    run(n, 1, { place: [20, 10, 42, 0, 0, 1] });
    expect(n.built).toBe(false);
    run(n, 1, { weapon: at(RAMPART) });
    run(n, 1, { place: [20, 10, 22, 0, 0, -1] });
    expect(n.built).toBe(true);
    expect(n.works[0]).toBe(2);
    n.units[0].bug.health = 50;
    use(n, ANTHILL);
    pass(n);
    pass(n);
    expect(n.units[0].bug.health).toBe(58);
    expect(setup(ANT, ['carrier']).spaces(0)).toBe(setup(ANT, []).spaces(0) + 1);
  });

  it('spiders: strong silk, barbs, double weave, light feet, patience', () => {
    const turns = (p: string[]): number => {
      const m = setup(SPIDER, p);
      inside(m).openWeb(44, 10.5, 32, WEB_SHOT, false);
      return m.webs[0].turns;
    };
    expect(turns(['strong-silk'])).toBe(turns([]) + 3);
    const b = setup(SPIDER, ['barbs']);
    inside(b).openWeb(44, 10.5, 32, WEB_SHOT, false);
    pass(b);
    const was = b.units[1].bug.health;
    run(b, 400, { move: 1 });
    expect(was - b.units[1].bug.health).toBe(10);
    const c = setup(SPIDER, ['double-weave']);
    use(c, SILK_CURTAIN);
    expect(c.curtains[0].left).toBe(3);
    const fall = (p: string[]): number => {
      const m = setup(SPIDER, p);
      m.units[0].bug.y += 60;
      m.units[0].bug.grounded = false;
      const h = m.units[0].bug.health;
      run(m, 300);
      return h - m.units[0].bug.health;
    };
    expect(fall([])).toBeGreaterThan(0);
    expect(fall(['light-feet'])).toBe(0);
    expect(setup(SPIDER, ['patience']).skill[0]).toBeGreaterThan(setup(SPIDER, []).skill[0]);
  });

  it('cockroaches: leftovers, grounded, thick skin, scurry, survivor', () => {
    const m = setup(COCKROACH, ['leftovers']);
    m.units[0].bug.health = 30;
    inside(m).announceDeath(m.units[1]);
    expect(m.units[0].bug.health).toBe(45);
    expect(m.tally[0].kills).toBe(1);
    const g = setup(COCKROACH, ['grounded', 'thick-skin']);
    use(g, HUSK);
    expect(g.units[0].coverLeft).toBe((HUSK.coverHealth as number) + 20);
    const h = g.units[0].bug.health;
    inside(g).arc(g.units[0].bug.x + 1, g.units[0].bug.y, g.units[0].bug.z, SHORT_CIRCUIT);
    expect(g.units[0].bug.health).toBe(h);
    const way = (p: string[]): number => {
      const q = setup(COCKROACH, p);
      const x = q.units[0].bug.x;
      run(q, 60, { move: 1, faceX: 1 });
      return q.units[0].bug.x - x;
    };
    expect(way(['scurry'])).toBeGreaterThan(way([]) * 1.1);
    const s = setup(COCKROACH, ['survivor']);
    s.units[0].shell = false;
    s.units[0].bug.health = 15;
    pass(s);
    pass(s);
    expect(s.units[0].shell).toBe(true);
  });

  it('bees: sting, honey trap, warm nest, big lungs', () => {
    const m = setup(BEE, ['sting', 'big-lungs']);
    pass(m);
    pass(m);
    expect(m.units[0].bug.breath).toBeGreaterThan(Math.round((BEE.flight as number) * 60 * 1.3));
    const b = m.units[0].bug;
    b.flying = true;
    b.grounded = false;
    b.x = m.units[1].bug.x - 0.8;
    b.y = m.units[1].bug.y + 2;
    b.z = m.units[1].bug.z;
    const was = m.units[1].bug.health;
    run(m, 2);
    expect(was - m.units[1].bug.health).toBe(10);
    const n = setup(BEE, ['warm-nest'], 2);
    const friend = n.units.find((u) => u.team === 0 && u !== n.activeUnit) as Match['units'][number];
    friend.bug.drop(n.field, n.activeUnit.bug.x, n.activeUnit.bug.z + 4);
    friend.bug.health = 60;
    use(n, WAX_NEST);
    pass(n);
    pass(n);
    expect(friend.bug.health).toBe(65);
    const t = setup(BEE, ['honey-trap']);
    use(t, COMB_WALL);
    const e = t.units[1].bug;
    e.x = t.units[0].bug.x + 6.4;
    e.z = 32;
    run(t, 10);
    expect(e.slow).toBeLessThan(1);
  });

  it('what is kept from the last match comes along', () => {
    const t = plain();
    const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 1, growth: { level: 1, passives: [], items: { patch: 1 } } }, { name: 'B', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false });
    expect(m.bag[0]).toEqual({ patch: 1 });
    m.units[0].bug.drop(t, 20, 32);
    m.units[1].bug.drop(t, 44, 32);
    run(m, 60);
    m.units[0].bug.health = 50;
    run(m, 1, { item: ITEM_KINDS.indexOf('patch') });
    expect(m.units[0].bug.health).toBeGreaterThan(80);
  });

  it('the computer plays with them too, the same each time', () => {
    const play = (): string => {
      const t = plain();
      const m = new Match(t, [{ name: 'A', species: BEE, color: 0, size: 2, growth: computerGrowth('bee', 8) }, { name: 'B', species: COCKROACH, color: 0, size: 2, growth: computerGrowth('cockroach', 8) }], 5, { turnSeconds: 12 });
      const b = [new Brain(SKILLS[1], 1), new Brain(SKILLS[1], 2)];
      let n = 0;
      while (m.phase !== 'over' && n++ < 60 * 60) m.step(b[m.activeUnit.team].next(m));
      return m.units.map((u) => `${u.bug.health.toFixed(3)},${u.bug.x.toFixed(4)}`).join('|');
    };
    expect(play()).toBe(play());
  }, 30000);
});
