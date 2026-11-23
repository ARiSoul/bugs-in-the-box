import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bug, IDLE, RUN_FACTOR, TICK_RATE, type BugInput } from '../src/game/bug';
import { ANT } from '../src/game/species';
import { floatingIslands } from './helpers/floatingIslands';
import { createRng } from '../src/terrain/noise';
import { Terrain } from '../src/terrain/Terrain';
import { flat, world } from './helpers/worlds';

function run(bug: Bug, t: Terrain, ticks: number, input: Readonly<BugInput> = IDLE): void {
  for (let n = 0; n < ticks; n++) bug.step(t, input);
}

function settled(t: Terrain, x: number, z: number): Bug {
  const bug = new Bug(ANT);
  expect(bug.drop(t, x, z)).toBe(true);
  run(bug, t, TICK_RATE * 2);
  expect(bug.grounded).toBe(true);
  return bug;
}

const face = (bug: Bug, fx: number, fz: number): void => {
  bug.fx = fx;
  bug.fz = fz;
};

const FORWARD: BugInput = { move: 1, turn: 0, jump: false };
const JUMP: BugInput = { move: 0, turn: 0, jump: true };

describe('bug on the ground', () => {
  it('drops onto flat ground and rests one radius above it', () => {
    const t = flat(10);
    const bug = settled(t, 32, 32);
    expect(bug.alive).toBe(true);
    expect(bug.y).toBeCloseTo(10 + ANT.radius, 1);
    expect(bug.ny).toBeGreaterThan(0.99);
  });

  it('stays perfectly still when idle, on flat ground and on a slope', () => {
    for (const t of [flat(10), world(2, 1, 2, (i, j) => (j - 8 - 0.5 * i) / Math.sqrt(1.25))]) {
      const bug = settled(t, 30, 30);
      const [x, y, z] = [bug.x, bug.y, bug.z];
      run(bug, t, TICK_RATE * 3);
      expect(bug.grounded).toBe(true);
      expect(bug.x).toBeCloseTo(x, 6);
      expect(bug.y).toBeCloseTo(y, 6);
      expect(bug.z).toBeCloseTo(z, 6);
    }
  });

  it('runs faster than it walks (shift)', () => {
    const t = flat(10);
    const walker = settled(t, 16, 32);
    const runner = settled(t, 16, 32);
    face(walker, 1, 0);
    face(runner, 1, 0);
    run(walker, t, TICK_RATE, FORWARD);
    run(runner, t, TICK_RATE, { ...FORWARD, run: true });
    expect(walker.x - 16).toBeCloseTo(ANT.walkSpeed, 1);
    expect(runner.x - 16).toBeCloseTo(ANT.walkSpeed * RUN_FACTOR, 1);
    expect(runner.grounded).toBe(true);
  });

  it('walks up a gentle slope at full speed and stays on the ground', () => {
    const t = world(2, 1, 2, (i, j) => (j - 8 - 0.5 * i) / Math.sqrt(1.25));
    const bug = settled(t, 20, 32);
    face(bug, 1, 0);
    const [x0, y0] = [bug.x, bug.y];
    for (let n = 0; n < TICK_RATE; n++) {
      bug.step(t, FORWARD);
      expect(bug.grounded).toBe(true);
    }
    const along = Math.sqrt((bug.x - x0) ** 2 + (bug.y - y0) ** 2);
    expect(along).toBeCloseTo(ANT.walkSpeed, 0);
    expect(bug.y).toBeGreaterThan(y0 + 1.5);
  });

  it('turns without moving', () => {
    const t = flat(10);
    const bug = settled(t, 32, 32);
    face(bug, 0, 1);
    const [x, z] = [bug.x, bug.z];
    // a quarter turn to the right (clockwise seen from above) takes (pi/2) / turnRate seconds;
    // facing +z, the bug's right-hand side is -x
    run(bug, t, Math.round((Math.PI / 2 / ANT.turnRate) * TICK_RATE), { move: 0, turn: 1, jump: false });
    expect(bug.fx).toBeCloseTo(-1, 1);
    expect(bug.fz).toBeCloseTo(0, 1);
    expect(Math.hypot(bug.fx, bug.fz)).toBeCloseTo(1, 9);
    expect(bug.x).toBeCloseTo(x, 6);
    expect(bug.z).toBeCloseTo(z, 6);
  });
});

describe('bug against walls and slopes', () => {
  it('climbs a tall wall, goes over its top and down the other side, never letting go or passing through', () => {
    // ground at y=10 plus a 4-cell slab at x in [40, 44], 14 high
    const t = world(2, 1, 2, (i, j) => Math.min(j - 10, Math.max(40 - i, i - 44, j - 24)));
    const bug = settled(t, 30, 32);
    face(bug, 1, 0);
    let top = 0;
    for (let n = 0; n < TICK_RATE * 14 && bug.x < 52; n++) {
      bug.step(t, FORWARD);
      expect(bug.grounded).toBe(true);
      expect(t.sample(bug.x, bug.y, bug.z)).toBeGreaterThan(ANT.radius * 0.6);
      top = Math.max(top, bug.y);
    }
    expect(top).toBeCloseTo(24 + ANT.radius, 0);
    expect(bug.x).toBeGreaterThan(50);
    expect(bug.y).toBeCloseTo(10 + ANT.radius, 0);
  });

  it('climbs on past a ledge that sticks out of a wall, under it and round it', () => {
    // a wall for x >= 40, up to y = 30, with a shelf 4 wide and 3 thick sticking out of it at y = 18
    const t = world(2, 1, 2, (i, j) => Math.min(j - 8, Math.max(40 - i, j - 30), Math.max(36 - i, j - 21, 18 - j)));
    const bug = settled(t, 28, 32);
    face(bug, 1, 0);
    let under = false;
    for (let n = 0; n < TICK_RATE * 20 && bug.y < 30; n++) {
      bug.step(t, FORWARD);
      expect(bug.grounded).toBe(true);
      if (bug.ny < -0.8) under = true;
    }
    expect(under).toBe(true);
    expect(bug.y).toBeGreaterThan(29);
  });

  it('walks down a wall backwards and forwards, and turns along it', () => {
    const t = world(2, 1, 2, (i, j) => Math.min(j - 6, Math.max(40 - i, j - 28)));
    const bug = settled(t, 30, 32);
    face(bug, 1, 0);
    while (bug.y < 18) bug.step(t, FORWARD);
    const [y0, z0] = [bug.y, bug.z];
    run(bug, t, 60, { ...FORWARD, move: -1 });
    expect(bug.y).toBeLessThan(y0 - 1.5); // (facing the wall, back is down)
    face(bug, 0, 1);
    const y1 = bug.y;
    run(bug, t, 60, FORWARD);
    expect(bug.z).toBeGreaterThan(z0 + 3); // along it: level
    expect(bug.y).toBeCloseTo(y1, 1);
    face(bug, -1, 0);
    run(bug, t, 30, FORWARD);
    expect(bug.y).toBeLessThan(y1 - 1); // facing away from it: down
    expect(bug.grounded).toBe(true);
  });

  it('rests on a wall and under a ceiling without moving, and stays at the end of its turn', () => {
    const t = world(2, 1, 2, (i, j) => Math.min(j - 6, Math.max(40 - i, j - 28), Math.max(34 - i, 22 - j, j - 26)));
    for (const until of [(b: Bug) => b.y > 14, (b: Bug) => b.ny < -0.95]) {
      const bug = settled(t, 30, 32);
      face(bug, 1, 0);
      for (let n = 0; n < 1200 && !until(bug); n++) bug.step(t, FORWARD);
      expect(until(bug)).toBe(true);
      bug.step(t, IDLE);
      const at = [bug.x, bug.y, bug.z];
      run(bug, t, TICK_RATE * 5);
      expect(bug.grounded).toBe(true);
      expect(bug.settled).toBe(true);
      expect(Math.hypot(bug.x - at[0], bug.y - at[1], bug.z - at[2])).toBeLessThan(0.15);
    }
  });

  it('falls off a wall when pushed, when it jumps, and when the wall is blown away', () => {
    for (const how of ['push', 'jump', 'carve']) {
      const t = world(2, 1, 2, (i, j) => Math.min(j - 6, Math.max(40 - i, j - 30)));
      const bug = settled(t, 34, 32);
      face(bug, 1, 0);
      while (bug.y < 20) bug.step(t, FORWARD);
      if (how === 'push') bug.push(-6, 2, 0);
      if (how === 'carve') t.carve(41, 20, 32, 6);
      bug.step(t, how === 'jump' ? JUMP : IDLE);
      expect(bug.grounded).toBe(false);
      run(bug, t, TICK_RATE * 3);
      expect(bug.grounded).toBe(true);
      expect(bug.y).toBeLessThan(how === 'carve' ? 18.5 : 8);
    }
  });

  it('falling against a wall it walks into, it catches hold', () => {
    const t = world(2, 1, 2, (i, j) => Math.min(j - 4, Math.max(40 - i, j - 30)));
    const bug = new Bug(ANT);
    bug.x = bug.px = 37;
    bug.y = bug.py = 22;
    bug.z = bug.pz = 32;
    bug.vx = 4;
    face(bug, 1, 0);
    run(bug, t, 60, FORWARD);
    expect(bug.grounded).toBe(true);
    expect(bug.y).toBeGreaterThan(10);
  });

  it('climbs over a cable lying on the ground and walks on', () => {
    // ground at y=10, a cable of radius 1 along z at x=40 (its top 2 above the ground)
    const t = world(2, 1, 2, (i, j) => Math.min(j - 10, Math.sqrt((i - 40) * (i - 40) + (j - 11) * (j - 11)) - 1));
    const bug = settled(t, 30, 32);
    face(bug, 1, 0);
    for (let n = 0; n < TICK_RATE * 6; n++) bug.step(t, FORWARD);
    expect(bug.x).toBeGreaterThan(45);
    expect(bug.alive).toBe(true);
    expect(bug.grounded).toBe(true);
  });

  it('climbs onto a low ledge and stays on top of it', () => {
    // ground at y=10, a ledge 2 high for x >= 40
    const t = world(2, 1, 2, (i, j) => Math.min(j - 10, Math.max(40 - i, j - 12)));
    const bug = settled(t, 30, 32);
    face(bug, 1, 0);
    for (let n = 0; n < TICK_RATE * 5; n++) bug.step(t, FORWARD);
    expect(bug.x).toBeGreaterThan(45);
    expect(bug.y).toBeCloseTo(12 + ANT.radius, 0);
    expect(bug.grounded).toBe(true);
  });

  it('cannot stand on a slope that is too steep and slides down to the floor', () => {
    // ~63° slope falling towards +x, meeting a floor at y=8 at x=20
    const t = world(2, 1, 2, (i, j) => Math.min((j - 48 + 2 * i) / Math.sqrt(5), j - 8));
    const bug = new Bug(ANT);
    expect(bug.drop(t, 14, 32)).toBe(true);
    run(bug, t, TICK_RATE * 4);
    expect(bug.grounded).toBe(true);
    expect(bug.y).toBeCloseTo(8 + ANT.radius, 0);
    expect(bug.x).toBeGreaterThan(17);
  });
});

describe('bug in the air', () => {
  it('jumps forward and lands again', () => {
    const t = flat(10);
    const bug = settled(t, 32, 32);
    face(bug, 0, 1);
    const [y0, z0] = [bug.y, bug.z];
    bug.step(t, JUMP);
    expect(bug.grounded).toBe(false);
    let top = bug.y;
    for (let n = 0; n < TICK_RATE * 2; n++) {
      bug.step(t, IDLE);
      top = Math.max(top, bug.y);
    }
    expect(top).toBeGreaterThan(y0 + 1.2);
    expect(bug.grounded).toBe(true);
    expect(bug.y).toBeCloseTo(y0, 1);
    expect(bug.z - z0).toBeGreaterThan(2);
  });

  it('falls when an explosion removes the ground, then lands in the crater', () => {
    const t = world(2, 1, 2, (_i, j) => j - 20);
    const bug = settled(t, 32, 32);
    t.carve(32, 20, 32, 6);
    bug.step(t, IDLE);
    expect(bug.grounded).toBe(false);
    run(bug, t, TICK_RATE * 3);
    expect(bug.grounded).toBe(true);
    expect(bug.y).toBeLessThan(20 - 3);
    expect(bug.lastImpact).toBeGreaterThan(5);
  });

  it('turns back at the edge of the world instead of walking off it, and dies when thrown off', () => {
    const t = flat(10);
    const bug = settled(t, 12, 32);
    face(bug, -1, 0);
    run(bug, t, TICK_RATE * 6, FORWARD);
    expect(bug.alive).toBe(true);
    expect(bug.grounded).toBe(true);
    bug.push(-25, 8, 0);
    run(bug, t, TICK_RATE * 4);
    expect(bug.alive).toBe(false);
    // a dead bug no longer moves
    const y = bug.y;
    run(bug, t, 10, FORWARD);
    expect(bug.y).toBe(y);
  });
});

describe('determinism', () => {
  /** Ten seconds of scripted random input with explosions, on a generated map. Returns the full state. */
  function simulate(): number[] {
    const t = new Terrain(3, 2, 3);
    floatingIslands(t, 1234);
    const bug = new Bug(ANT);
    expect(bug.drop(t, 48, 48)).toBe(true);
    const rnd = createRng(7);
    const input: BugInput = { move: 0, turn: 0, jump: false };
    const trace: number[] = [];
    for (let n = 0; n < TICK_RATE * 10; n++) {
      if (n % 20 === 0) {
        input.move = rnd() < 0.75 ? 1 : 0;
        input.turn = rnd() < 0.3 ? -1 : rnd() < 0.4 ? 1 : 0;
      }
      input.jump = rnd() < 0.02;
      if (n % 150 === 75) t.carve(bug.x + 3, bug.y - 2, bug.z, 5);
      bug.step(t, input);
      trace.push(bug.x, bug.y, bug.z, bug.vx, bug.vy, bug.vz, bug.fx, bug.fz);
    }
    return trace;
  }

  it('gives bit-identical results for the same seed and inputs', () => {
    const a = simulate();
    const b = simulate();
    expect(Buffer.from(new Float64Array(a).buffer).equals(Buffer.from(new Float64Array(b).buffer))).toBe(true);
    // and the scenario actually moved the bug around
    const n = a.length;
    expect(Math.hypot(a[n - 8] - a[0], a[n - 6] - a[2])).toBeGreaterThan(5);
  });

  it('game and terrain code use no device-dependent Math functions', () => {
    const banned = /Math\.(random|sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|exp|expm1|log\w*|pow|cbrt|hypot)\b/;
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
      });
    const offenders: string[] = [];
    for (const file of [...files('src/terrain'), ...files('src/game')]) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const m = code.match(banned);
      if (m) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
