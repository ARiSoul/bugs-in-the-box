import { describe, expect, it } from 'vitest';
import { Match, NO_INPUT, type MatchEvent, type MatchInput, type Structure } from '../src/game/match';
import { BURN_HURTS, reaction, REACTIONS, tagsOf, wordFor } from '../src/game/reactions';
import { ANT, BEE, COCKROACH, SPIDER, type BugSpecies } from '../src/game/species';
import { HUSK, SILK_FUNNEL, WAX_NEST } from '../src/game/weapons';
import { CAPACITOR, COMB_WALL, LIVING_BRIDGE, RAMPART, SHIELD_WALL, SHORT_CIRCUIT, SILK_CURTAIN, SOLDER_BLOB, WEAPONS, WEB_SHOT, type Weapon } from '../src/game/weapons';
import type { Terrain } from '../src/terrain/Terrain';
import { analyze, meshAll } from './helpers/meshIntegrity';
import { world } from './helpers/worlds';

interface Inside {
  struck(u: unknown, amount: number, by: readonly string[]): void;
  openWeb(x: number, y: number, z: number, w: Weapon, grand: boolean, paste?: number): void;
  arc(x: number, y: number, z: number, w: Weapon): void;
  bite(x: number, y: number, z: number, r: number): number;
}
const inside = (m: Match): Inside => m as unknown as Inside;
const at = (w: Weapon): number => WEAPONS.indexOf(w);
const plain = (): Terrain => world(4, 3, 2, (_i, j) => j - 10);
function run(m: Match, ticks: number, input: Partial<MatchInput> = {}): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let n = 0; n < ticks; n++) {
    m.step({ ...NO_INPUT, ...input });
    events.push(...m.events);
  }
  return events;
}
function setup(s: BugSpecies, w: Weapon, t = plain()): Match {
  const m = new Match(t, [{ name: 'A', species: s, color: 0, size: 1 }, { name: 'B', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
  m.units[0].bug.drop(t, 20, 32);
  m.units[1].bug.drop(t, 50, 32);
  run(m, 60, { faceX: 1 });
  run(m, 1, { weapon: at(w) });
  run(m, 1, { fire: true });
  return m;
}
const pass = (m: Match): MatchEvent[] => {
  const n = m.turnNumber;
  const e: MatchEvent[] = [];
  for (let k = 0; k < 5000 && m.turnNumber === n && m.phase !== 'over'; k++) {
    m.step(NO_INPUT);
    e.push(...m.events);
  }
  return e;
};
/** Solid samples above the ground. */
const solid = (t: Terrain): number => {
  let n = 0;
  for (let i = 0; i < t.sx; i++) for (let j = 11; j < 20; j++) for (let k = 0; k < t.sz; k++) if (t.dens[t.idx(i, j, k)] < 0) n++;
  return n;
};
const middle = (s: Structure, slot: number): number[] => {
  for (let i = 0; i < s.pieces.length; i += 11) if (s.pieces[i + 10] === slot) return s.pieces.slice(i, i + 3);
  return [];
};

describe('tags that meet', () => {
  it('are data: every rule can be found, and says a word', () => {
    for (const r of REACTIONS) expect(reaction(r.id, r.by ? [r.by] : [], [...r.on])).toBe(r);
    expect(reaction('burn', tagsOf('solder-blob'), tagsOf('shield-wall'))).toBeNull();
    expect(wordFor('solder-blob', 'silk-curtain')).toBe('burns it');
    expect(wordFor('solder-blob', 'comb-wall')).toBe('melts it');
    expect(wordFor('capacitor', 'shield-wall')).toBe('shatters it');
    expect(wordFor('capacitor', 'silk-curtain')).toBe('');
  });

  it('silk burns from slot to slot, hurts who touches it, stops, and the mesh stays whole', () => {
    const t = plain();
    const m = setup(SPIDER, SILK_CURTAIN, t);
    const s = m.structures[0];
    const [x, y, z] = middle(s, 3);
    const before = solid(t);
    m.explode(x + 0.8, y + 2, z, { ...SOLDER_BLOB, blastRadius: 1.2, damage: 0 });
    expect([...s.fire.keys()]).toEqual([3]);
    m.units[1].bug.drop(t, x + 2, z);
    run(m, 20);
    const h = m.units[1].bug.health;
    pass(m);
    expect(h - m.units[1].bug.health).toBe(BURN_HURTS);
    expect(s.gone.has(3)).toBe(true);
    expect([...s.fire.keys()].sort()).toEqual([2, 4]);
    pass(m);
    expect([...s.gone].sort()).toEqual([2, 3, 4]);
    expect(s.fire.size).toBe(0);
    pass(m);
    expect(s.gone.size).toBe(3);
    expect(solid(t)).toBeLessThan(before * 0.75);
    expect(analyze(meshAll(t)).openEdges).toBe(0);
  });

  it('earth smothers it: only the splinters go', () => {
    const t = plain();
    const m = setup(ANT, RAMPART, t);
    const s = m.structures[0];
    const [x, y, z] = middle(s, 3);
    m.explode(x + 0.8, y + 2, z, { ...SOLDER_BLOB, blastRadius: 1, damage: 0 });
    pass(m);
    expect(s.gone.size).toBe(0);
    expect(t.sample(x, 11.5, z)).toBeLessThan(0);
    expect(t.sample(x, 14.2, z)).toBeGreaterThan(0);
  });

  it('a web burns at once', () => {
    const m = setup(SPIDER, SILK_CURTAIN);
    inside(m).openWeb(44, 10.5, 20, WEB_SHOT, false);
    m.explode(48.5, 10, 20, { ...CAPACITOR, blastRadius: 1 });
    expect(m.webs.length).toBe(1);
    m.explode(48.5, 10, 20, { ...SOLDER_BLOB, blastRadius: 1 });
    expect(m.webs.length).toBe(0);
  });

  it('wax melts wider, into honey that holds the others', () => {
    const hole = (w: Weapon): number => {
      const t = plain();
      const m = setup(BEE, COMB_WALL, t);
      const [x, y, z] = middle(m.structures[0], 3);
      const was = solid(t);
      m.explode(x, y + 1, z, { ...w, blastRadius: 2, damage: 0 });
      if (w === SOLDER_BLOB) {
        expect(m.webs.length).toBe(1);
        expect(m.webs[0].honey).toBe(true);
        expect(m.webs[0].paste).toBe(0);
      } else expect(m.webs.length).toBe(0);
      return was - solid(t);
    };
    expect(hole(SOLDER_BLOB)).toBeGreaterThan(hole(CAPACITOR) * 1.3);
  });

  it('chitin does not burn, shatters, and lets no arc through', () => {
    const m = setup(COCKROACH, SHIELD_WALL);
    const s = m.structures[0];
    const [x, y, z] = middle(s, 3);
    m.explode(x + 1, y + 2, z, { ...SOLDER_BLOB, blastRadius: 1, damage: 0 });
    expect(s.fire.size).toBe(0);
    const k = setup(COCKROACH, SHIELD_WALL);
    const p = middle(k.structures[0], 3);
    k.explode(p[0] + 1, p[1] + 2, p[2], { ...CAPACITOR, blastRadius: 1, damage: 0 });
    expect(k.events.some((q) => q.type === 'worn' && q.word === 'shattered')).toBe(true);
    const n = setup(COCKROACH, SHIELD_WALL);
    const b = n.units[0].bug;
    const h = b.health;
    inside(n).arc(b.x + 9, b.y + 0.5, b.z, SHORT_CIRCUIT);
    expect(b.health).toBe(h);
    n.field.erase?.(n.structures[0].pieces);
    // (its own shell, whole, insulates it too: once it is broken, the arc gets through)
    inside(n).arc(b.x + 9, b.y + 0.5, b.z, SHORT_CIRCUIT);
    expect(b.health).toBe(h);
    n.units[0].shell = false;
    inside(n).arc(b.x + 9, b.y + 0.5, b.z, SHORT_CIRCUIT);
    expect(b.health).toBeLessThan(h);
  });

  it('paste conducts to everyone in it; a fuse takes all of a shock', () => {
    const t = plain();
    const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 3 }, { name: 'B', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    m.units.forEach((u, i) => u.bug.drop(t, u.team ? 50 : 20 + i * 1.4, 32));
    run(m, 60);
    const paste = WEAPONS.find((w) => w.kind === 'trap') as Weapon;
    inside(m).openWeb(21.5, 10.5, 32, paste, false, 1);
    m.units[0].fuse = true;
    const was = m.units.map((u) => u.bug.health);
    m.explode(24.6, 10.6, 32, { ...SHORT_CIRCUIT, blastRadius: 0.5, damage: 0 });
    const lost = m.units.map((u, i) => was[i] - u.bug.health);
    expect(lost[0]).toBe(0);
    expect(m.units[0].fuse).toBe(false);
    expect(lost.filter((n) => n >= SHORT_CIRCUIT.arcDamage).length).toBeGreaterThanOrEqual(2);
    expect(lost[m.units.findIndex((u) => u.team === 1)]).toBe(0);
  });

  it('a living bridge closes a gap a turn, while over half of it stands', () => {
    const t = world(4, 3, 2, (i, j) => Math.max(j - 20, 4 - Math.abs(i - 28)));
    const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 1 }, { name: 'B', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    m.units[0].bug.drop(t, 18, 32);
    m.units[1].bug.drop(t, 50, 32);
    run(m, 60, { faceX: 1 });
    run(m, 1, { weapon: at(LIVING_BRIDGE) });
    run(m, 1, { place: [22, 20, 32, 13, 0, 0] });
    const s = m.structures[0];
    const [x, y, z] = middle(s, 5);
    m.explode(x, y, z, { ...CAPACITOR, blastRadius: 1.6, damage: 0 });
    expect(t.sample(x, y, z)).toBeGreaterThan(0);
    let e: MatchEvent[] = [];
    for (let k = 0; k < 4 && t.sample(x, y, z) > 0; k++) e = e.concat(pass(m));
    expect(t.sample(x, y, z)).toBeLessThan(0);
    expect(e.some((q) => q.type === 'regrown')).toBe(true);
    m.explode(x, y, z, { ...CAPACITOR, blastRadius: 7, damage: 0 });
    e = [];
    for (let k = 0; k < 3; k++) e = e.concat(pass(m));
    expect(e.some((q) => q.type === 'regrown')).toBe(false);
  });

  it('a swarm that comes through a web has lost a third of its bite', () => {
    const m = setup(SPIDER, SILK_CURTAIN);
    inside(m).openWeb(44, 10.5, 20, WEB_SHOT, false);
    expect(inside(m).bite(44, 10.5, 20, 0.5)).toBeCloseTo(2 / 3);
    expect(inside(m).bite(44, 10.5, 50, 0.5)).toBe(1);
  });
});

describe('tags that meet on bugs', () => {
  /** A side of `s` hidden in `w` (or out in the open with no shelter), and a blast right by it; what it took, and said. */
  function hit(s: BugSpecies, w: Weapon | null, blast: Weapon): { took: number; words: string[]; m: Match } {
    const t = plain();
    const m = w ? setup(s, w, t) : new Match(t, [{ name: 'A', species: s, color: 0, size: 1 }, { name: 'B', species: ANT, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    if (!w) {
      m.units[0].bug.drop(t, 20, 32);
      m.units[1].bug.drop(t, 50, 32);
      run(m, 60);
    }
    const u = m.units[0];
    u.bug.health = 100;
    m.explode(u.bug.x + 1, u.bug.y, u.bug.z, { ...blast, blastRadius: 3 });
    const words = m.events.filter((e): e is Extract<MatchEvent, { type: 'reacted' }> => e.type === 'reacted').map((e) => e.word);
    return { took: 100 - u.bug.health, words, m };
  }

  it('fire burns a bug free of the web that holds it, and hurts it a little', () => {
    const blast = (w: Weapon): { took: number; free: boolean; words: string[] } => {
      const m = setup(SPIDER, SOLDER_BLOB);
      const u = m.units[1];
      inside(m).openWeb(u.bug.x, u.bug.y, u.bug.z, WEB_SHOT, false);
      run(m, 1);
      expect(u.web).toBeGreaterThanOrEqual(0);
      u.bug.health = 100;
      inside(m).struck(u, 10, tagsOf(w.id));
      const words = m.events.filter((e): e is Extract<MatchEvent, { type: 'reacted' }> => e.type === 'reacted').map((e) => e.word);
      return { took: 100 - u.bug.health, free: u.web < 0, words };
    };
    const fire = blast(SOLDER_BLOB);
    expect(fire.free).toBe(true);
    expect(fire.words).toContain('burnt free');
    expect(fire.took).toBe(10 + BURN_HURTS);
    const shock = blast(CAPACITOR);
    expect(shock.free).toBe(false);
    expect(shock.took).toBe(10);
  });

  it('fire burns a shelter of silk or wax at once: the blow comes through whole', () => {
    for (const [s, w] of [[SPIDER, SILK_FUNNEL], [BEE, WAX_NEST]] as const) {
      const burnt = hit(s, w, SOLDER_BLOB);
      expect(burnt.m.units[0].cover).toBeNull();
      expect(burnt.words.length).toBe(1);
      const kept = hit(s, w, { ...SOLDER_BLOB, id: 'capacitor' });
      expect(kept.m.units[0].cover).toBe(w);
      expect(burnt.took).toBeGreaterThan(kept.took);
    }
  });

  it('a blast shatters more through a shelter of chitin', () => {
    const husk = hit(COCKROACH, HUSK, CAPACITOR);
    expect(husk.words).toContain('shattered');
    const plainBlast = Math.round(CAPACITOR.damage * 1);
    expect(husk.took).toBeGreaterThan(0);
    expect(husk.took).toBeLessThan(plainBlast);
    // (the same blast, its harm not raised: what the husk keeps off of it is less than of the raised one)
    const n = setup(COCKROACH, HUSK);
    const u = n.units[0];
    u.bug.health = 100;
    inside(n).struck(u, 50, ['electric']);
    const without = 100 - u.bug.health;
    const k = setup(COCKROACH, HUSK);
    const v = k.units[0];
    v.bug.health = 100;
    inside(k).struck(v, 50, ['blast']);
    expect(100 - v.bug.health).toBeGreaterThan(without);
  });

  it('a whole shell lets no arc through; a broken one does', () => {
    const m = setup(COCKROACH, SOLDER_BLOB);
    const b = m.units[0].bug;
    const h = b.health;
    inside(m).arc(b.x + 3, b.y + 0.5, b.z, SHORT_CIRCUIT);
    expect(b.health).toBe(h);
    expect(m.events.some((e) => e.type === 'reacted' && e.word === 'insulated')).toBe(true);
    m.units[0].shell = false;
    inside(m).arc(b.x + 3, b.y + 0.5, b.z, SHORT_CIRCUIT);
    expect(b.health).toBeLessThan(h);
  });

  it('a swarm bites less through the silk that holds a bug', () => {
    const bite = (held: boolean): number => {
      const m = setup(SPIDER, SOLDER_BLOB);
      const u = m.units[1];
      if (held) {
        inside(m).openWeb(u.bug.x, u.bug.y, u.bug.z, WEB_SHOT, false);
        run(m, 1);
      }
      u.bug.health = 100;
      inside(m).struck(u, 30, ['swarm']);
      return 100 - u.bug.health;
    };
    expect(bite(false)).toBe(30);
    expect(bite(true)).toBe(20);
  });
});
