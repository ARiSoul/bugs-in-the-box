import { describe, expect, it } from 'vitest';
import { Bug, IDLE, TICK_RATE, type BugInput } from '../src/game/bug';
import { LINGER_TICKS, Match, NO_INPUT, WEB_TEAR_TICKS, type MatchEvent, type MatchInput } from '../src/game/match';
import { ANT, SPIDER } from '../src/game/species';
import { SOLDER_BLOB, WEAPONS, WEB_BOW, WEB_SHOT } from '../src/game/weapons';
import { flat, world } from './helpers/worlds';

const WEB = WEAPONS.indexOf(WEB_SHOT);

/** A match with a spider (first) and an ant on flat ground at the given places. */
function setup(spider: [number, number], ant: [number, number]): Match {
  const t = flat(10);
  const m = new Match(
    t,
    [
      { name: 'S', species: SPIDER, color: 0, size: 1 },
      { name: 'A', species: ANT, color: 0, size: 1 },
    ],
    1,
    { placeBugs: false },
  );
  m.units[0].bug.drop(t, ...spider);
  m.units[1].bug.drop(t, ...ant);
  run(m, 60);
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

/** Fire the web straight at the ant, and wait for the ant's turn. */
function web(m: Match): MatchEvent[] {
  run(m, 1, { weapon: WEB });
  const s = m.units[0];
  const a = m.units[1].bug;
  const dx = a.x - s.bug.x;
  const dz = a.z - s.bug.z;
  run(m, 1, { faceX: dx, faceZ: dz });
  s.aimH = 1;
  s.aimV = 0;
  const events = run(m, 60, { fire: true });
  for (let n = 0; n < 1200 && m.active === 0; n++) events.push(...run(m, 1));
  return events;
}

describe('Web Shot', () => {
  it('only spiders have it', () => {
    const m = setup([20, 32], [26, 32]);
    expect(m.canUse(m.units[0], WEB)).toBe(true);
    expect(m.canUse(m.units[1], WEB)).toBe(false);
    run(m, 1, { weapon: WEB });
    expect(m.currentWeapon).toBe(WEB_SHOT);
    web(m);
    expect(m.active).toBe(1);
    expect(m.currentWeapon).not.toBe(WEB_SHOT);
    run(m, 1, { weapon: WEB });
    expect(m.currentWeapon).not.toBe(WEB_SHOT);
  });

  it('leaves the terrain whole, makes a web, and holds the ant it hits', () => {
    const m = setup([20, 32], [26, 32]);
    const t = m.field;
    const before = t.sample(26, 9.5, 32);
    const events = web(m);
    expect(events.some((e) => e.type === 'web')).toBe(true);
    expect(events.some((e) => e.type === 'stuck' && e.unit === 1)).toBe(true);
    expect(events.some((e) => e.type === 'explosion')).toBe(false);
    expect(t.sample(26, 9.5, 32)).toBe(before);
    expect(m.webs.length).toBe(1);
    expect(m.webs[0].ny).toBeGreaterThan(0.9);
    const x = m.units[1].bug.x;
    const z = m.units[1].bug.z;
    run(m, TICK_RATE * 2, { move: 1, jump: true });
    expect(m.units[1].bug.grounded).toBe(true);
    expect(Math.hypot(m.units[1].bug.x - x, m.units[1].bug.z - z)).toBeLessThan(2);
  });

  it('tears after enough pulling, and the ant walks off', () => {
    const m = setup([20, 32], [26, 32]);
    web(m);
    const events = run(m, WEB_TEAR_TICKS + 2, { move: 1 });
    expect(events.some((e) => e.type === 'webGone' && e.torn)).toBe(true);
    expect(m.webs.length).toBe(0);
    const x = m.units[1].bug.x;
    const z = m.units[1].bug.z;
    run(m, 60, { move: 1 });
    expect(Math.hypot(m.units[1].bug.x - x, m.units[1].bug.z - z)).toBeGreaterThan(3);
  });

  it('a held bug can still fire; a blast takes the web away; a spider is not held', () => {
    const m = setup([20, 32], [26, 32]);
    web(m);
    expect(m.units[1].web).toBeGreaterThanOrEqual(0);
    expect(run(m, 40, { fire: true }).length + run(m, 1).length).toBeGreaterThan(0);
    expect(m.phase).toBe('flight');
    const s = m.units[0].bug;
    s.x = s.px = m.webs[0].x;
    s.z = s.pz = m.webs[0].z + 3;
    run(m, 5);
    expect(m.units[0].web).toBe(-1);
    expect(s.slow).toBe(1);
    const w = m.webs[0];
    if (w) m.explode(w.x, w.y, w.z, SOLDER_BLOB);
    expect(m.webs.length).toBe(0);
  });

  it('goes by itself after its turns', () => {
    const m = setup([20, 32], [26, 32]);
    web(m);
    const start = m.turnNumber;
    for (let n = 0; n < TICK_RATE * 60 * 8 && m.webs.length > 0; n++) m.step(NO_INPUT);
    expect(m.webs.length).toBe(0);
    expect(m.turnNumber - start).toBeLessThanOrEqual(WEB_SHOT.webTurns);
  });
});

describe('the thread', () => {
  const step = (b: Bug, t: ReturnType<typeof world>, input: Partial<BugInput>, n = 1): void => {
    for (let k = 0; k < n; k++) b.step(t, { ...IDLE, ...input });
  };
  // a table 40 high over ground at 4
  const table = () => world(2, 2, 2, (i, j) => Math.min(j - 4, Math.max(i - 30, j - 44, 36 - j)));
  const off = (species: typeof SPIDER): { b: Bug; t: ReturnType<typeof world> } => {
    const t = table();
    const b = new Bug(species);
    b.drop(t, 29, 32);
    b.fx = 1;
    b.fz = 0;
    step(b, t, {}, 60);
    step(b, t, { jump: true });
    step(b, t, {}, 25);
    expect(b.grounded).toBe(false);
    return { b, t };
  };

  it('a spider in the air takes hold of it and comes down slowly, unhurt', () => {
    const { b, t } = off(SPIDER);
    step(b, t, { jump: true });
    expect(b.thread).toBe(true);
    let impact = 0;
    for (let n = 0; n < TICK_RATE * 12 && !b.grounded; n++) {
      step(b, t, {});
      expect(b.vy).toBeGreaterThanOrEqual(-6.001);
      if (b.justLanded) impact = b.lastImpact;
    }
    expect(b.grounded).toBe(true);
    expect(b.thread).toBe(false);
    expect(b.y).toBeLessThan(8);
    expect(impact).toBeLessThan(7);
  });

  it('a second jump lets go; a push cuts it; an ant has none', () => {
    const { b, t } = off(SPIDER);
    step(b, t, { jump: true });
    step(b, t, { jump: true });
    expect(b.thread).toBe(false);
    step(b, t, { jump: true });
    expect(b.thread).toBe(true);
    b.push(1, 0, 0);
    expect(b.thread).toBe(false);
    const a = off(ANT);
    step(a.b, a.t, { jump: true });
    expect(a.b.thread).toBe(false);
  });

  it('on it, a spider takes hold of a wall it touches', () => {
    const t = world(2, 2, 2, (i, j) => Math.min(j - 4, Math.max(i - 30, j - 44), 34 - i));
    const b = new Bug(SPIDER);
    b.drop(t, 29, 32);
    b.fx = 1;
    b.fz = 0;
    step(b, t, {}, 60);
    step(b, t, { jump: true });
    step(b, t, {}, 15);
    step(b, t, { jump: true });
    step(b, t, {}, TICK_RATE * 3);
    expect(b.grounded).toBe(true);
    expect(b.thread).toBe(false);
  });

  it('is cut when the place it hangs from is blown away', () => {
    const { b, t } = off(SPIDER);
    step(b, t, { jump: true });
    expect(b.thread).toBe(true);
    t.carve(b.tx, b.ty, b.tz, 4);
    step(b, t, {}, 2);
    expect(b.thread).toBe(false);
  });
});

describe('Web Bow', () => {
  const BOW = WEAPONS.indexOf(WEB_BOW);
  const shoot = (m: Match, ticks: number, up: number): MatchEvent[] => {
    run(m, WEB_BOW.sceneTicks + 1, { weapon: BOW });
    expect(m.currentWeapon).toBe(WEB_BOW);
    expect(m.stance).toBe(true);
    const s = m.units[0];
    const a = m.units[1].bug;
    run(m, 1, { faceX: a.x - s.bug.x, faceZ: a.z - s.bug.z });
    s.aimH = Math.sqrt(1 - up * up);
    s.aimV = up;
    const events = run(m, ticks, { fire: true });
    events.push(...run(m, 90));
    return events;
  };

  it('hurts the bug it hits, more at full draw, holds it in a web, and leaves no crater', () => {
    const hurt = (ticks: number): number => {
      const m = setup([20, 32], [27, 32]);
      const before = m.units[1].bug.x;
      const events = shoot(m, ticks, 0.05);
      expect(events.some((e) => e.type === 'arrow' && e.unit === 1)).toBe(true);
      expect(events.some((e) => e.type === 'explosion')).toBe(false);
      expect(m.units[1].bug.x).toBeCloseTo(before, 1);
      expect(m.webs.length).toBe(1);
      expect(m.units[1].web).toBe(m.webs[0].id);
      return 100 - m.units[1].bug.health;
    };
    const full = hurt(80);
    const weak = hurt(30);
    expect(full).toBeGreaterThan(35);
    expect(weak).toBeLessThan(full);
    expect(weak).toBeGreaterThan(0);
  });

  it('a miss hurts nobody, whatever it comes down next to', () => {
    const m = setup([20, 32], [27, 32]);
    const events = shoot(m, 20, -0.3);
    expect(events.some((e) => e.type === 'arrow' && e.unit === -1)).toBe(true);
    expect(m.units.every((u) => u.bug.health === 100)).toBe(true);
  });

  it('plays its scene when it is picked, then stands and aims on the spot, and the clock waits for the scene', () => {
    const m = setup([20, 32], [27, 32]);
    const b = m.units[0].bug;
    const clock = m.turnTicks;
    expect(run(m, 1, { weapon: BOW }).some((e) => e.type === 'special')).toBe(true);
    expect(m.phase).toBe('special');
    run(m, WEB_BOW.sceneTicks - 1, { move: 1, fire: true });
    expect(m.phase).toBe('special');
    run(m, 1);
    expect(m.phase).toBe('aim');
    expect(m.stance).toBe(true);
    expect(m.turnTicks).toBe(clock);
    const [x, z, fx, up] = [b.x, b.z, b.fx, m.units[0].aimV];
    run(m, 60, { move: 1, jump: true, turn: 1, pitch: 0.01 });
    expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(0.01);
    expect(b.grounded).toBe(true);
    expect(b.fx).not.toBe(fx);
    expect(m.units[0].aimV).toBeGreaterThan(up);
    run(m, 30, { fire: true });
    expect(m.charging).toBe(true);
    expect(run(m, 1).some((e) => e.type === 'fire')).toBe(true);
    expect(m.stance).toBe(false);
  });

  it('another weapon calls it off, in the scene and in the stance', () => {
    for (const ticks of [20, WEB_BOW.sceneTicks + 10]) {
      const m = setup([20, 32], [27, 32]);
      run(m, 1, { weapon: BOW });
      run(m, ticks);
      run(m, 1, { weapon: 1 });
      expect(m.phase).toBe('aim');
      expect(m.stance).toBe(false);
      expect(m.weapon).toBe(1);
      const x = m.units[0].bug.x;
      run(m, 30, { move: 1 });
      expect(m.units[0].bug.x).not.toBe(x);
    }
  });

  it('its hit is looked at before the turn goes on, and it is not picked any more on the next turn', () => {
    const m = setup([20, 32], [27, 32]);
    shoot(m, 80, 0.05);
    let n = 0;
    for (; n < 2000 && m.active === 0; n++) run(m, 1);
    expect(n).toBeGreaterThan(LINGER_TICKS);
    for (n = 0; n < 4000 && m.active !== 0; n++) run(m, 1);
    expect(m.phase).toBe('aim');
    expect(m.currentWeapon).not.toBe(WEB_BOW);
  });

  it('ants do not have it', () => {
    const m = setup([20, 32], [27, 32]);
    expect(m.canUse(m.units[1], BOW)).toBe(false);
  });
});
