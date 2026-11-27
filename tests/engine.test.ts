import { describe, expect, it } from 'vitest';
import { Attributes, Effects, Reactions, Registry, Triggers, speciesBase, type EffectDef, type MatchTriggers } from '../src/game/engine';
import { Match, NO_INPUT } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { world } from './helpers/worlds';

const base = speciesBase(ANT);

describe('attributes', () => {
  it('with no modifiers, each is its base, bit for bit', () => {
    const a = new Attributes(base);
    expect(a.get('speed')).toBe(ANT.walkSpeed);
    expect(a.get('jump')).toBe(ANT.jumpSpeed);
    expect(a.get('health')).toBe(ANT.health);
    expect(a.get('damage')).toBe(1);
  });

  it('adds first, then multiplies, in a fixed order (by order, then id), whatever order they were put on in', () => {
    const one = new Attributes(base);
    const two = new Attributes(base);
    const mods = [
      { id: 'b', attr: 'speed' as const, mul: 1.1 },
      { id: 'a', attr: 'speed' as const, add: 0.3 },
      { id: 'c', attr: 'speed' as const, mul: 0.7, order: -1 },
      { id: 'd', attr: 'speed' as const, add: 0.1, order: 2 },
    ];
    for (const m of mods) one.add(m);
    for (const m of [...mods].reverse()) two.add(m);
    expect(one.get('speed')).toBe((ANT.walkSpeed + 0.3 + 0.1) * 0.7 * 1.1);
    expect(two.get('speed')).toBe(one.get('speed'));
    expect(one.list().map((m) => m.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('a modifier comes off by its id, and one with the same id replaces it', () => {
    const a = new Attributes(base);
    a.add({ id: 'x', attr: 'jump', add: 2 });
    a.add({ id: 'x', attr: 'jump', add: 3 });
    expect(a.get('jump')).toBe(ANT.jumpSpeed + 3);
    expect(a.remove('x')).toBe(true);
    expect(a.remove('x')).toBe(false);
    expect(a.get('jump')).toBe(ANT.jumpSpeed);
  });

  it('copies another: its bases and its modifiers', () => {
    const a = new Attributes(base);
    a.setBase('luck', 2);
    a.add({ id: 'm', attr: 'defence', mul: 0.5 });
    const b = new Attributes(speciesBase(SPIDER));
    b.copy(a);
    expect(b.get('luck')).toBe(2);
    expect(b.get('defence')).toBe(0.5);
    expect(b.get('speed')).toBe(ANT.walkSpeed);
  });
});

describe('effects', () => {
  const slow: EffectDef = { id: 'wet', tags: ['wet'], maxStacks: 3, ticks: 5, modifiers: [{ attr: 'speed', mul: 0.5 }, { attr: 'jump', add: -1 }] };

  it('puts its modifiers on, scaled by its stacks (up to its most), and takes them off when it runs out', () => {
    const a = new Attributes(base);
    const ended: string[] = [];
    const e = new Effects(a, { ended: (d) => ended.push(d.id) });
    e.apply(slow, { stacks: 2 });
    expect(e.stacks('wet')).toBe(2);
    expect(a.get('speed')).toBe(ANT.walkSpeed * 0.25);
    expect(a.get('jump')).toBe(ANT.jumpSpeed - 2);
    e.apply(slow, { stacks: 5 });
    expect(e.stacks('wet')).toBe(3);
    expect(a.get('speed')).toBe(ANT.walkSpeed * 0.125);
    for (let i = 0; i < 4; i++) e.tick();
    expect(e.has('wet')).toBe(true);
    e.tick();
    expect(e.has('wet')).toBe(false);
    expect(ended).toEqual(['wet']);
    expect(a.get('speed')).toBe(ANT.walkSpeed);
    expect(a.get('jump')).toBe(ANT.jumpSpeed);
  });

  it('one that lasts until taken off stays; found by its tag', () => {
    const a = new Attributes(base);
    const e = new Effects(a);
    e.apply({ id: 'sheltered', tags: ['cover'], maxStacks: 1, ticks: 0 });
    for (let i = 0; i < 100; i++) e.tick();
    expect(e.tagged('cover').map((s) => s.def.id)).toEqual(['sheltered']);
    e.clear();
    expect(e.list()).toEqual([]);
  });
});

describe('triggers', () => {
  it('run by priority, then in the order added; one removed no longer runs', () => {
    const t = new Triggers<MatchTriggers>();
    const got: string[] = [];
    t.on('death', () => got.push('b'), 1);
    const off = t.on('death', () => got.push('a'), 0);
    t.on('death', () => got.push('c'), 1);
    t.emit('death', { unit: 0 });
    expect(got).toEqual(['a', 'b', 'c']);
    off();
    got.length = 0;
    t.emit('death', { unit: 0 });
    expect(got).toEqual(['b', 'c']);
    expect(t.count('death')).toBe(2);
  });

  it('one added while an event runs waits for the next', () => {
    const t = new Triggers<MatchTriggers>();
    const got: number[] = [];
    t.on('damage', (p) => {
      got.push(p.amount);
      t.on('damage', (q) => got.push(q.amount * 10));
    });
    t.emit('damage', { unit: 0, amount: 1, team: 0 });
    expect(got).toEqual([1]);
    t.emit('damage', { unit: 0, amount: 2, team: 0 });
    expect(got).toEqual([1, 2, 20]);
  });
});

describe('reactions', () => {
  const rules = new Reactions([
    { id: 'burn', by: 'fire', on: ['silk', 'wood'], value: 1, word: 'burning' },
    { id: 'conduct', by: 'electric', on: ['metal'], value: 12, word: 'conducts' },
    { id: 'regrow', by: null, on: ['alive'], value: 0.5, word: 'regrows' },
  ]);

  it('one is found where its tag meets any of the tags it acts on; one by nothing acts on its own', () => {
    expect(rules.find('burn', ['fire', 'blast'], ['wood'])?.value).toBe(1);
    expect(rules.find('burn', ['blast'], ['wood'])).toBeNull();
    expect(rules.find('burn', ['fire'], ['metal'])).toBeNull();
    expect(rules.find('regrow', [], ['alive'])?.word).toBe('regrows');
    expect(rules.find('regrow', ['fire'], ['alive'])).not.toBeNull();
  });

  it('every reaction between two sets of tags, in the order they were given', () => {
    expect(rules.between(['fire', 'electric'], ['silk', 'metal', 'alive']).map((r) => r.id)).toEqual(['burn', 'conduct', 'regrow']);
    expect(rules.between([], ['silk'])).toEqual([]);
  });

  it('the effects of a bug give the tags they react by, each once, in order', () => {
    const e = new Effects(new Attributes(base));
    e.apply({ id: 'a', tags: ['electric', 'item'], maxStacks: 1, ticks: 0 });
    e.apply({ id: 'b', tags: ['silk', 'electric'], maxStacks: 1, ticks: 0 });
    expect(e.tags()).toEqual(['electric', 'item', 'silk']);
  });
});

describe('registry', () => {
  it('holds frozen definitions by id, in the order registered; twice the same id is an error', () => {
    const r = new Registry<EffectDef>('effect');
    r.register({ id: 'a', tags: [], maxStacks: 1, ticks: 0 });
    r.register({ id: 'b', tags: [], maxStacks: 1, ticks: 0 });
    expect(r.all().map((d) => d.id)).toEqual(['a', 'b']);
    expect(Object.isFrozen(r.get('a'))).toBe(true);
    expect(() => r.register({ id: 'a', tags: [], maxStacks: 1, ticks: 0 })).toThrow();
    expect(() => r.get('z')).toThrow();
    expect(r.find('z')).toBeUndefined();
  });
});

describe('the engine in a match', () => {
  const setup = (): Match => {
    const t = world(4, 2, 2, (_i, j) => j - 10);
    const m = new Match(t, [{ name: 'A', species: ANT, color: 0, size: 1 }, { name: 'B', species: SPIDER, color: 0, size: 1 }], 1, { placeBugs: false, wind: 0 });
    m.units[0].bug.drop(t, 20, 32);
    m.units[1].bug.drop(t, 44, 32);
    for (let k = 0; k < 60; k++) m.step({ ...NO_INPUT, faceX: 1 });
    return m;
  };

  it('an effect on a bug changes how fast it really walks, and comes off in time', () => {
    const fast = setup();
    const slow = setup();
    const ended: number[] = [];
    slow.triggers.on('effectEnd', (p) => ended.push(p.unit));
    slow.units[0].effects.apply({ id: 'mud', tags: ['wet'], maxStacks: 1, ticks: 90, modifiers: [{ attr: 'speed', mul: 0.5 }] });
    const x0 = fast.units[0].bug.x;
    for (let k = 0; k < 60; k++) {
      fast.step({ ...NO_INPUT, move: 1, faceX: 1 });
      slow.step({ ...NO_INPUT, move: 1, faceX: 1 });
    }
    const went = fast.units[0].bug.x - x0;
    const crept = slow.units[0].bug.x - x0;
    expect(went).toBeGreaterThan(2);
    expect(crept).toBeGreaterThan(went * 0.4);
    expect(crept).toBeLessThan(went * 0.6);
    for (let k = 0; k < 40; k++) slow.step(NO_INPUT);
    expect(slow.units[0].effects.has('mud')).toBe(false);
    expect(ended).toEqual([0]);
    expect(slow.units[0].bug.stats.get('speed')).toBe(ANT.walkSpeed);
  });

  it('hangs rules on the match: a turn begins (the last one ran out)', () => {
    const m = setup();
    const turns: number[] = [];
    m.triggers.on('turnStart', (p) => turns.push(p.unit));
    for (let k = 0; k < 6000 && turns.length === 0; k++) m.step(NO_INPUT);
    expect(turns).toEqual([1]);
  });

  it('hangs rules on the match: a bug dies', () => {
    const m = setup();
    const deaths: number[] = [];
    m.triggers.on('death', (p) => deaths.push(p.unit));
    // (the spider falls off the world)
    m.units[1].bug.y = -10;
    for (let k = 0; k < 600 && deaths.length === 0; k++) m.step(NO_INPUT);
    expect(deaths).toEqual([1]);
  });
});
