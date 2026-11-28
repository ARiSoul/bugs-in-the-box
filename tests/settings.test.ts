import { describe, expect, it } from 'vitest';
import { DataCache, MemoryStore, Settings as Kept } from '../src/data';
import { Settings } from '../src/game/engine';
import { Match, NO_INPUT, RETREAT_TICKS, WIND_MAX } from '../src/game/match';
import { ANT, COCKROACH, SPIDER } from '../src/game/species';
import { physicsOf, physicsSetting, RULE, speciesSetting, TUNING, tunedWeapons, weaponSetting } from '../src/game/tuning';
import { Bug, GRAVITY, PHYSICS } from '../src/game/bug';
import { Projectile } from '../src/game/projectile';
import { CAPACITOR, SOLDER_BLOB, WEAPONS, weaponIndex } from '../src/game/weapons';
import { keptOf, readKept } from '../src/ui/tuning';
import { flat } from './helpers/worlds';

const two = (): Settings => {
  const s = new Settings();
  s.define({ id: 'a', group: 'G', label: 'A', min: 0, max: 10, step: 1, value: 5 });
  s.define({ id: 'b', group: 'G', label: 'B', min: 0, max: 1, step: 0.1, value: 0.5 });
  return s;
};

describe('settings (engine)', () => {
  it('are defined once, each inside its range', () => {
    const s = two();
    expect(() => s.define({ id: 'a', group: 'G', label: 'A', min: 0, max: 1, step: 1, value: 0 })).toThrow();
    expect(() => s.define({ id: 'c', group: 'G', label: 'C', min: 0, max: 1, step: 1, value: 2 })).toThrow();
    expect(() => s.define({ id: 'd', group: 'G', label: 'D', min: 0, max: 1, step: 0, value: 0 })).toThrow();
    expect(s.all().map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('a set keeps only what differs, inside each range, and drops what is unknown', () => {
    const s = two();
    const set = s.make({ a: 99, b: 0.5, z: 3 }, 4);
    expect(set.changed).toEqual({ a: 10 });
    expect([set.get('a'), set.get('b'), set.version]).toEqual([10, 0.5, 4]);
    expect(set.shipped).toBe(false);
    expect(s.defaults().shipped).toBe(true);
    expect(Object.isFrozen(set)).toBe(true);
  });

  it('its hash is the same for the same numbers, and changes with any of them', () => {
    const s = two();
    expect(s.make({ a: 7 }).hash).toBe(s.make({ a: 7 }, 9).hash);
    expect(s.make({ a: 7 }).hash).not.toBe(s.make({ a: 8 }).hash);
    expect(s.make({ b: 0.6 }).hash).not.toBe(s.defaults().hash);
    // (back as shipped is as shipped)
    expect(s.make({ a: 5 }).hash).toBe(s.defaults().hash);
  });

  it('a change makes the next version; a setting goes back as shipped by itself', () => {
    const s = two();
    const one = s.defaults().with({ a: 2 });
    const next = one.with({ b: 0.1 });
    expect([one.version, next.version]).toEqual([1, 2]);
    expect(next.changed).toEqual({ a: 2, b: 0.1 });
    const back = next.without('a');
    expect([back.version, back.changed]).toEqual([3, { b: 0.1 }]);
  });
});

describe("the game's settings", () => {
  it('are the data as shipped: every weapon that hurts, every species, the rules', () => {
    for (const w of WEAPONS) if (w.damage > 0) expect(TUNING.get(weaponSetting(w, 'damage')).value, w.id).toBe(w.damage);
    expect(TUNING.get(weaponSetting(SOLDER_BLOB, 'blast')).value).toBe(SOLDER_BLOB.blastRadius);
    expect(TUNING.get(speciesSetting(COCKROACH, 'toughness')).value).toBe(COCKROACH.toughness);
    expect(TUNING.get(speciesSetting(ANT, 'walk')).value).toBe(ANT.walkSpeed);
    expect(TUNING.get(RULE.knockback).value).toBe(14);
    // (as shipped, the weapons are the very same objects)
    expect(tunedWeapons(TUNING.defaults())).toBe(WEAPONS);
  });

  it('a changed weapon is a copy in its place; the others stay as they are', () => {
    const arsenal = tunedWeapons(TUNING.make({ [weaponSetting(SOLDER_BLOB, 'damage')]: 84 }));
    const i = weaponIndex(SOLDER_BLOB);
    expect(arsenal[i]).not.toBe(SOLDER_BLOB);
    expect([arsenal[i].id, arsenal[i].damage, arsenal[i].blastRadius]).toEqual([SOLDER_BLOB.id, 84, SOLDER_BLOB.blastRadius]);
    expect(weaponIndex(arsenal[i])).toBe(i);
    expect(arsenal[weaponIndex(CAPACITOR)]).toBe(CAPACITOR);
  });
});

describe('a match tuned by a set', () => {
  const play = (changed: Record<string, number>): Match => {
    const t = flat(10);
    const m = new Match(t, [{ name: 'a', species: ANT, color: 0, size: 1 }, { name: 'b', species: SPIDER, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0, tuning: TUNING.make(changed) });
    m.units[0].bug.drop(t, 20, 32);
    m.units[1].bug.drop(t, 60, 32);
    for (let n = 0; n < 60; n++) m.step(NO_INPUT);
    return m;
  };
  const blast = (m: Match): { took: number; vx: number } => {
    const b = m.units[1].bug;
    m.explode(b.x - 1, b.y, b.z, m.arsenal[weaponIndex(CAPACITOR)]);
    return { took: 100 - b.health, vx: b.vx };
  };

  it('plays as shipped with no set, and the same with the shipped one', () => {
    expect(play({}).tuning.hash).toBe(TUNING.defaults().hash);
    expect(blast(play({}))).toEqual(blast(play({ [RULE.knockback]: 14 })));
  });

  it("its weapons, its species' numbers and its rules are the set's", () => {
    const base = blast(play({}));
    const harder = blast(play({ [weaponSetting(CAPACITOR, 'damage')]: 110 }));
    expect(harder.took).toBeGreaterThan(base.took);
    const tougher = blast(play({ [speciesSetting(SPIDER, 'toughness')]: 220 }));
    expect(tougher.took).toBeLessThan(base.took);
    const still = blast(play({ [RULE.knockback]: 0 }));
    expect(base.vx).toBeGreaterThan(1);
    expect(still.vx).toBe(0);
    const m = play({ [speciesSetting(ANT, 'walk')]: 9 });
    expect(m.units[0].bug.stats.get('speed')).toBe(9);
    expect(m.currentWeapon.id).toBe(WEAPONS[m.weapon].id);
  });
});

describe('a set kept on this device', () => {
  it('goes into the settings and comes back the same; junk reads as shipped', () => {
    const kept = new Kept(new DataCache(new MemoryStore(), 'me'));
    const set = TUNING.make({ [weaponSetting(SOLDER_BLOB, 'damage')]: 60, [RULE.patch]: 0.5 }, 3);
    kept.set('tuning', keptOf(set));
    const back = readKept(TUNING, kept.get('tuning'));
    expect([back.hash, back.version]).toEqual([set.hash, 3]);
    for (const junk of [undefined, 7, 'x', { changed: 'no', version: -2 }, { changed: { [RULE.patch]: 'a', nothing: 3 } }]) expect(readKept(TUNING, junk).hash).toBe(TUNING.defaults().hash);
  });
});

describe('the rules in the settings', () => {
  const match = (changed: Record<string, number>, wind = 1): Match => {
    const t = flat(10);
    const m = new Match(t, [{ name: 'a', species: ANT, color: 0, size: 1 }, { name: 'b', species: SPIDER, color: 0, size: 1 }], 3, { placeBugs: false, wind, tuning: TUNING.make(changed) });
    m.units[0].bug.drop(t, 40, 32);
    m.units[1].bug.drop(t, 90, 32);
    for (let n = 0; n < 30; n++) m.step(NO_INPUT);
    return m;
  };

  it('are listed by what they are about, each with its value as shipped', () => {
    const groups = new Set(TUNING.all().map((d) => d.group));
    for (const g of ['Rules', 'Specials', 'Webs', 'Ant Column', 'Blackout Swarm', 'Burrow', 'Boxes']) expect(groups.has(g), g).toBe(true);
    expect(TUNING.all().length).toBeGreaterThan(60);
    // (what other files still read as a number is the shipped value, from the one place)
    expect(WIND_MAX).toBe(TUNING.get(RULE.wind).value);
    expect(RETREAT_TICKS).toBe(TUNING.get(RULE.retreat).value * 60);
  });

  it("a match plays with its set's: the wind, what a turn loads, a burrow's length", () => {
    const calm = match({ [RULE.wind]: 0 });
    expect(Math.abs(calm.windX) + Math.abs(calm.windZ)).toBe(0);
    expect(match({}).windX).not.toBe(0);
    expect(match({ [RULE.skillTurn]: 500 }).skill[0]).toBe(500);
    expect(match({}).skill[0]).toBe(200);
    const reach = (m: Match): number => {
      const p = m.burrowPath(m.units[0], 1, []);
      return Math.hypot(p[9] - p[0], p[11] - p[2]);
    };
    expect(reach(match({ [RULE.burrowLong]: 40 }))).toBeGreaterThan(reach(match({})) + 8);
  });
});

describe('physics in the settings', () => {
  it('are the shipped numbers of motion; as shipped, the very same object', () => {
    for (const k of Object.keys(PHYSICS) as (keyof typeof PHYSICS)[]) expect(TUNING.get(physicsSetting(k)).value, k).toBe(PHYSICS[k]);
    expect(physicsOf(TUNING.defaults())).toBe(PHYSICS);
    expect(GRAVITY).toBe(PHYSICS.gravity);
  });

  it("a match's bugs, shots and boxes move by its own: more gravity, a jump comes down sooner, a shot falls faster", () => {
    const heavy = TUNING.make({ [physicsSetting('gravity')]: 50 });
    const air = (changed: Record<string, number>): { up: number; shot: number } => {
      const t = flat(10);
      const m = new Match(t, [{ name: 'a', species: ANT, color: 0, size: 1 }, { name: 'b', species: SPIDER, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0, tuning: TUNING.make(changed) });
      m.units[0].bug.drop(t, 30, 32);
      m.units[1].bug.drop(t, 80, 32);
      for (let n = 0; n < 60; n++) m.step(NO_INPUT);
      const b = m.units[0].bug;
      const y0 = b.y;
      // (a jump: its highest point)
      let up = 0;
      m.step({ ...NO_INPUT, jump: true });
      for (let n = 0; n < 60; n++) {
        m.step(NO_INPUT);
        up = Math.max(up, b.y - y0);
      }
      // (a shot as the match flies one)
      const p = new Projectile(0, m.arsenal[0], null, m.physics).launch(30, 40, 32, 5, 0, 0);
      for (let n = 0; n < 20; n++) p.step(m.field, 0, 0, [], false);
      expect(b.physics).toBe(m.physics);
      return { up, shot: 40 - p.y };
    };
    const light = air({});
    const hard = air({ [physicsSetting('gravity')]: 50 });
    expect(hard.up).toBeLessThan(light.up * 0.7);
    expect(hard.shot).toBeGreaterThan(light.shot * 1.8);
    expect(physicsOf(heavy).gravity).toBe(50);
    // (a bug the computer makes in its head moves by them too)
    const probe = new Bug(ANT);
    probe.physics = physicsOf(heavy);
    const copy = new Bug(ANT);
    copy.copy(probe);
    expect(copy.physics.gravity).toBe(50);
  });
});
