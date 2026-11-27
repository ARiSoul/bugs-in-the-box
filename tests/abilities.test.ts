import { describe, expect, it } from 'vitest';
import { ABILITIES, abilityAt, AGAIN_POOL, CHARGE_POOL, costFor, SKILL_FULL, usesPool, WORKS_POOL } from '../src/game/abilities';
import { pay, Resources, usesIn, type Cost } from '../src/game/engine';
import { Match, NO_INPUT, type MatchInput } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { ANTHILL, BURROW, BURST, CAPACITOR, QUEENS_FLIGHT, RAMPART, SHORT_CIRCUIT, SOLDER_BLOB, THERMAL_PASTE, WEAPONS, WEB_SHOT, WORKS } from '../src/game/weapons';
import { world } from './helpers/worlds';

describe('resources', () => {
  it('pools are added to and taken from; a spend needs as much', () => {
    const r = new Resources();
    expect(r.amount('x')).toBe(0);
    r.give('x', 3);
    expect(r.spend('x', 2)).toBe(true);
    expect(r.spend('x', 2)).toBe(false);
    expect(r.amount('x')).toBe(1);
    r.set('y', 5);
    expect(r.entries()).toEqual([['x', 1], ['y', 5]]);
  });

  it('a cost is paid only whole: every pool, or none', () => {
    const r = new Resources();
    r.set('uses', 1);
    r.set('works', 0);
    const cost: Cost[] = [{ pool: 'uses', amount: 1 }, { pool: 'works', amount: 1 }];
    expect(usesIn(cost, r)).toBe(0);
    expect(pay(cost, r)).toBe(false);
    expect(r.amount('uses')).toBe(1);
    r.set('works', 4);
    expect(usesIn(cost, r)).toBe(1);
    expect(pay(cost, r)).toBe(true);
    expect([r.amount('uses'), r.amount('works')]).toEqual([0, 3]);
  });

  it('a cost that takes all of a pool needs at least its amount, and empties it', () => {
    const r = new Resources();
    const cost: Cost[] = [{ pool: 'charge', amount: 100, all: true }];
    r.set('charge', 99);
    expect(usesIn(cost, r)).toBe(0);
    r.set('charge', 130);
    expect(pay(cost, r)).toBe(true);
    expect(r.amount('charge')).toBe(0);
    expect(usesIn([], r)).toBe(Infinity);
  });
});

describe('every weapon is an ability', () => {
  it('one each, in the same order, by the same id', () => {
    expect(ABILITIES.all().map((a) => a.id)).toEqual(WEAPONS.map((w) => w.id));
    for (let i = 0; i < WEAPONS.length; i++) expect(abilityAt(i).id).toBe(WEAPONS[i].id);
  });

  it('costs: nothing for a weapon every bug has; a use for one found; a use and a work for a build; all the charge for a special', () => {
    expect(abilityAt(WEAPONS.indexOf(SOLDER_BLOB)).cost).toEqual([]);
    expect(abilityAt(WEAPONS.indexOf(THERMAL_PASTE)).cost).toEqual([{ pool: usesPool('thermal-paste'), amount: 1 }]);
    expect(abilityAt(WEAPONS.indexOf(RAMPART)).cost).toEqual([{ pool: usesPool('rampart'), amount: 1 }, { pool: WORKS_POOL, amount: 1 }]);
    expect(abilityAt(WEAPONS.indexOf(BURST)).cost).toEqual([{ pool: usesPool('burst'), amount: 1 }]);
    expect(abilityAt(WEAPONS.indexOf(QUEENS_FLIGHT)).cost).toEqual([{ pool: CHARGE_POOL, amount: SKILL_FULL, all: true }]);
  });

  it('another creature\'s weapon costs one of its uses too', () => {
    const web = abilityAt(WEAPONS.indexOf(WEB_SHOT));
    expect(costFor(web, 'spider')).toEqual([]);
    expect(costFor(web, 'ant')).toEqual([{ pool: usesPool('web-shot'), amount: 1 }]);
  });

  it('limits, aims and what each does', () => {
    expect(abilityAt(WEAPONS.indexOf(BURST)).perTurn).toBe(1);
    expect(abilityAt(WEAPONS.indexOf(BURROW)).perTurn).toBe(1);
    expect(abilityAt(WEAPONS.indexOf(SOLDER_BLOB)).perTurn).toBeUndefined();
    expect(abilityAt(WEAPONS.indexOf(SOLDER_BLOB))).toMatchObject({ target: 'aim', charged: true, effects: [{ kind: 'blast', radius: SOLDER_BLOB.blastRadius, damage: SOLDER_BLOB.damage }] });
    expect(abilityAt(WEAPONS.indexOf(CAPACITOR)).tags).toContain('electric');
    expect(abilityAt(WEAPONS.indexOf(SHORT_CIRCUIT)).effects.some((e) => e.kind === 'arcs')).toBe(true);
    expect(abilityAt(WEAPONS.indexOf(ANTHILL))).toMatchObject({ target: 'place', effects: [{ kind: 'shelter', cover: ANTHILL.cover, health: ANTHILL.coverHealth }] });
    expect(abilityAt(WEAPONS.indexOf(RAMPART)).effects).toEqual([{ kind: 'build' }]);
  });
});

describe('a side\'s pools in a match', () => {
  const setup = (): Match => {
    const t = world(4, 2, 2, (_i, j) => j - 10);
    const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 1 }, { name: 'B', species: SPIDER, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    m.units[0].bug.drop(t, 20, 32);
    m.units[1].bug.drop(t, 44, 32);
    for (let k = 0; k < 60; k++) m.step({ ...NO_INPUT, faceX: 1 });
    return m;
  };
  const run = (m: Match, ticks: number, input: Partial<MatchInput> = {}): void => {
    for (let n = 0; n < ticks; n++) m.step({ ...NO_INPUT, ...input });
  };

  it('start as the weapons say, and the old arrays read and write them', () => {
    const m = setup();
    const r = m.resources(0);
    expect(r.amount(WORKS_POOL)).toBe(WORKS);
    expect(r.amount(usesPool('rampart'))).toBe(RAMPART.start);
    // (the spider's own builds are not the ant's)
    expect(r.amount(usesPool('silk-span'))).toBe(0);
    expect(r.amount(AGAIN_POOL)).toBe(0);
    expect(m.works[0]).toBe(WORKS);
    expect(m.stock[0][WEAPONS.indexOf(RAMPART)]).toBe(RAMPART.start);
    m.skill[0] = 400;
    expect(r.amount(CHARGE_POOL)).toBe(400);
    m.skill.fill(SKILL_FULL);
    expect(m.resources(1).amount(CHARGE_POOL)).toBe(SKILL_FULL);
    expect(m.stock[0].join()).toBe(WEAPONS.map((w) => r.amount(usesPool(w.id))).join());
  });

  it('a web found in a box costs the ant a use each time it fires it', () => {
    const m = setup();
    const web = WEAPONS.indexOf(WEB_SHOT);
    m.resources(0).set(usesPool('web-shot'), 2);
    expect(m.canUse(m.units[0], web)).toBe(true);
    run(m, 1, { weapon: web });
    run(m, 2, { fire: true });
    run(m, 1);
    expect(m.resources(0).amount(usesPool('web-shot'))).toBe(1);
  });
});
