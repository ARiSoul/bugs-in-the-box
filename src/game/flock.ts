import { DT, TICK_RATE, type Bug } from './bug';
import { surfaceDistance, type TerrainField } from './field';
import { rot, rotate2 } from './math';

/** A ring of pollen in the air (Queen's Flight). */
export interface Ring {
  x: number;
  y: number;
  z: number;
  /** The way through it (unit). */
  nx: number;
  ny: number;
  nz: number;
  taken: boolean;
}

/** What steers a flock in a tick: to the right, up (-1..1); the view's own turn and raise, if it turns with it. */
export interface FlockInput {
  turn: number;
  up: number;
  faceX: number;
  faceZ: number;
  pitch: number;
}

export const RINGS = 5;
/** Through it: the flock passes this near its middle. */
export const RING_RADIUS = 2.6;
/** How long a flock flies (ticks), and how fast (units a second): a little faster with every ring. */
export const FLOCK_TICKS = 8 * TICK_RATE;
const SPEED = 15;
const RING_SPEED = 1.1;
/** How fast it turns and raises its head (radians a second), and how quickly it takes to a new turn. */
const YAW = 2.4;
const PITCH = 2;
const GRIP = 0.14;
/** It stays this flat (the sine of its steepest way). */
const STEEP = 0.86;
/** The view turns it at most this much in a tick. */
const VIEW = 0.05;
/** How near it comes to a solid before it bursts on it. */
const THICK = 0.55;
/** How near its head comes to a bug. */
const TOUCH = 1.35;
/** Room a ring needs around it. */
const ROOM = 1.5;
/** Ways it tries for the rings. */
const TRIES = 3;
/** How far apart two rings are, at least. */
const APART = 6.5;
/** In these ticks after it set out it bursts on no wall: it slips along. */
const CLEAR = 75;
/** It sets out slower: its first speed (a part of SPEED), and the ticks until it has all of it. */
const SLOW = 0.55;
const SPEED_UP = 80;
/** It bursts on what it meets more head on than this (the cosine); along the rest it slips. */
const BLUNT = 0.75;
/** How far the computer thinks ahead of it (ticks), and how long it would keep a key. */
const FORESIGHT = 60;
const HELD = [12, 44] as const;

const normal = new Float64Array(3);

export type FlockEnd = 'bug' | 'ground' | 'spent' | 'lost';

/** A swarm in the air that a player flies (Queen's Flight). Pure: a tick of it depends on its state and its input only. */
export class Flock {
  /** Which way it flies: level (unit), and raised (level part, upward part). */
  fx = 0;
  fz = 1;
  h = 1;
  v = 0;
  px = 0;
  py = 0;
  pz = 0;
  left = FLOCK_TICKS;
  age = 0;
  taken = 0;
  /** The bug it flew into. */
  touched: Bug | null = null;
  private yaw = 0;
  private pitch = 0;

  constructor(
    public x: number,
    public y: number,
    public z: number,
    readonly rings: Ring[],
  ) {
    this.px = x;
    this.py = y;
    this.pz = z;
  }

  /** The way it flies (unit). */
  get dx(): number {
    return this.fx * this.h;
  }
  get dz(): number {
    return this.fz * this.h;
  }

  copy(o: Flock): void {
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    this.fx = o.fx;
    this.fz = o.fz;
    this.h = o.h;
    this.v = o.v;
    this.left = o.left;
    this.age = o.age;
    this.taken = o.taken;
    this.yaw = o.yaw;
    this.pitch = o.pitch;
  }

  aim(dx: number, dy: number, dz: number): this {
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-4) {
      this.fx = dx / l;
      this.fz = dz / l;
    }
    this.v = Math.max(-STEEP, Math.min(STEEP, dy));
    this.h = Math.sqrt(1 - this.v * this.v);
    return this;
  }

  /** One tick; `bugs`: what it bursts on. Returns how it ended, or null. `ring`: the one it just took (-1: none). */
  ring = -1;
  step(field: TerrainField, input: Readonly<FlockInput>, bugs: readonly Bug[]): FlockEnd | null {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.age++;
    this.left--;
    this.ring = -1;
    this.yaw += (input.turn * YAW * DT - this.yaw) * GRIP;
    this.pitch += (input.up * PITCH * DT - this.pitch) * GRIP;
    let turn = this.yaw;
    const fl = Math.sqrt(input.faceX * input.faceX + input.faceZ * input.faceZ);
    if (fl > 1e-6) {
      const cross = (this.fx * input.faceZ - this.fz * input.faceX) / fl;
      turn += Math.max(-VIEW, Math.min(VIEW, cross));
    }
    rotate2(this.fx, this.fz, turn);
    const l = Math.sqrt(rot[0] * rot[0] + rot[1] * rot[1]);
    this.fx = rot[0] / l;
    this.fz = rot[1] / l;
    rotate2(this.h, this.v, this.pitch + Math.max(-VIEW, Math.min(VIEW, input.pitch)));
    if (rot[0] > 0 && rot[1] > -STEEP && rot[1] < STEEP) {
      const k = Math.sqrt(rot[0] * rot[0] + rot[1] * rot[1]);
      this.h = rot[0] / k;
      this.v = rot[1] / k;
    }
    const step = (SPEED + RING_SPEED * this.taken) * DT * (this.age < SPEED_UP ? SLOW + ((1 - SLOW) * this.age) / SPEED_UP : 1);
    this.x += this.dx * step;
    this.y += this.v * step;
    this.z += this.dz * step;
    // (a lid over the world: it flies along under it)
    if (this.y > field.H - 1.5) this.y = field.H - 1.5;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.taken) continue;
      const ax = this.x - r.x;
      const ay = this.y - r.y;
      const az = this.z - r.z;
      if (ax * ax + ay * ay + az * az > RING_RADIUS * RING_RADIUS) continue;
      r.taken = true;
      this.taken++;
      this.ring = i;
    }
    for (const b of bugs) {
      if (!b.alive) continue;
      const r = b.species.radius + TOUCH;
      if ((b.x - this.x) * (b.x - this.x) + (b.y - this.y) * (b.y - this.y) + (b.z - this.z) * (b.z - this.z) > r * r) continue;
      this.touched = b;
      return 'bug';
    }
    if (this.x < 0 || this.z < 0 || this.x > field.W || this.z > field.D || this.y < -8) return 'lost';
    const gap = field.sample(this.x, this.y, this.z);
    if (gap < THICK) {
      surfaceDistance(field, this.x, this.y, this.z, normal);
      const into = -(this.dx * normal[0] + this.v * normal[1] + this.dz * normal[2]);
      if (this.age > CLEAR && (into > BLUNT || gap < -0.8)) return 'ground';
      // (off it again, and along it)
      const out = THICK - gap;
      this.x += normal[0] * out;
      this.y += normal[1] * out;
      this.z += normal[2] * out;
      if (into > 0) {
        const k = into + 0.04;
        const ax = this.dx + normal[0] * k;
        const ay = this.v + normal[1] * k;
        const az = this.dz + normal[2] * k;
        const l = Math.sqrt(ax * ax + ay * ay + az * az);
        if (l > 1e-3) this.aim(ax / l, ay / l, az / l);
      }
    }
    return this.left <= 0 ? 'spent' : null;
  }
}

/**
 * The rings from a place to a target: along a way a flock can fly (one is flown in the head, as the computer would),
 * evenly apart, each square to it. Fewer where the way is short.
 */
export function layRings(field: TerrainField, rng: () => number, x: number, y: number, z: number, tx: number, ty: number, tz: number): Ring[] {
  const dx = tx - x;
  const dz = tz - z;
  const level = Math.sqrt(dx * dx + dz * dz) || 1;
  let best: number[] = [];
  let bestScore = 1e9;
  for (let t = 0; t < TRIES; t++) {
    // (each time it sets out another way, higher or more to a side)
    const f = new Flock(x, y, z, []);
    f.left = 1e6;
    const side = (rng() - 0.5) * 0.8;
    const way0 = side < 0 ? 1 : -1;
    f.aim(dx / level - (dz / level) * side, 0.15 + 0.45 * rng(), dz / level + (dx / level) * side);
    const way: number[] = [x, y, z];
    let near = 1e9;
    let far = level;
    for (let n = 0; n < FLOCK_TICKS - 60; n++) {
      // (in an arch, down on it at the end)
      if (n > 8 && n % 12 === 0) {
        // (and from side to side)
        const beat = (n % 120) / 60;
        const weave = (beat < 1 ? 4 * beat * (1 - beat) : -4 * (beat - 1) * (2 - beat)) * Math.max(0, Math.min(11, (far - 14) * 0.5)) * way0;
        steerFlock(f, field, tx - (dz / level) * weave, ty + Math.max(0, Math.min(10, (far - 16) * 0.3)), tz + (dx / level) * weave, flown);
      }
      if (n <= 8) flown.turn = flown.up = 0;
      const end = f.step(field, flown, nobody);
      if (n % 3 === 0) way.push(f.x, f.y, f.z);
      const d = (tx - f.x) * (tx - f.x) + (ty - f.y) * (ty - f.y) + (tz - f.z) * (tz - f.z);
      if (d < near) near = d;
      far = Math.sqrt(d);
      if (end || d < 9) break;
    }
    const score = near > 16 ? near * 10 + 1e4 : way.length;
    if (score < bestScore) {
      bestScore = score;
      best = way;
    }
    if (near <= 16) break;
  }
  // ---- along it
  let long = 0;
  for (let i = 3; i < best.length; i += 3) long += gapOf(best, i);
  const from = Math.min(0.5 * long, Math.max(9, 0.16 * long));
  const to = long - 5;
  const step = Math.max(APART, (to - from) / (RINGS - 1));
  const out: Ring[] = [];
  let at = 0;
  let next = from;
  for (let i = 3; i + 3 < best.length && out.length < RINGS; i += 3) {
    at += gapOf(best, i);
    if (at < next || at > to + 2) continue;
    if (field.sample(best[i], best[i + 1], best[i + 2]) < ROOM) continue;
    const k = Math.min(best.length - 3, i + 9);
    const p = Math.max(0, i - 9);
    const nx = best[k] - best[p];
    const ny = best[k + 1] - best[p + 1];
    const nz = best[k + 2] - best[p + 2];
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out.push({ x: best[i], y: best[i + 1], z: best[i + 2], nx: nx / l, ny: ny / l, nz: nz / l, taken: false });
    next = Math.max(next + step, at + APART);
  }
  return out;
}

const gapOf = (w: readonly number[], i: number): number => Math.sqrt((w[i] - w[i - 3]) * (w[i] - w[i - 3]) + (w[i + 1] - w[i - 2]) * (w[i + 1] - w[i - 2]) + (w[i + 2] - w[i - 1]) * (w[i + 2] - w[i - 1]));
const flown: FlockInput = { turn: 0, up: 0, faceX: 0, faceZ: 0, pitch: 0 };
const scout = new Flock(0, 0, 0, []);
const tried: FlockInput = { turn: 0, up: 0, faceX: 0, faceZ: 0, pitch: 0 };
const nobody: Bug[] = [];
const WAYS = [0, 1, -1] as const;

/**
 * Steer a flock towards a place (what the computer does): it tries every key in its head for a moment, and takes the
 * one that ends nearest and facing it. Writes into `out`.
 */
export function steerFlock(f: Flock, field: TerrainField, tx: number, ty: number, tz: number, out: FlockInput): FlockInput {
  let best = 1e9;
  out.faceX = out.faceZ = out.pitch = 0;
  for (const turn of WAYS)
    for (const up of WAYS)
      for (const held of HELD) {
      if (held === HELD[1] && turn === 0 && up === 0) continue;
      scout.copy(f);
      tried.turn = turn;
      tried.up = up;
      let score = 0;
      let near = 1e9;
      for (let n = 0; n < FORESIGHT; n++) {
        // (it keeps a key for a moment only, then flies straight)
        if (n === held) tried.turn = tried.up = 0;
        const end = scout.step(field, tried, nobody);
        const ax = tx - scout.x;
        const ay = ty - scout.y;
        const az = tz - scout.z;
        const d = Math.sqrt(ax * ax + ay * ay + az * az);
        if (d < near) near = d;
        // (it would be there)
        if (d < 1.8) {
          score -= 40 - n * 0.3;
          break;
        }
        if (end) {
          score += 60 - n;
          break;
        }
      }
      const ax = tx - scout.x;
      const ay = ty - scout.y;
      const az = tz - scout.z;
      const d = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      const ahead = (ax * scout.dx + ay * scout.v + az * scout.dz) / d;
      score += 0.4 * d + near + 4 * (1 - ahead) + (turn !== 0 ? 0.1 : 0) + (up !== 0 ? 0.1 : 0);
      if (field.raycast(scout.x, scout.y, scout.z, ax / d, ay / d, az / d, d - 1.5) >= 0) score += 4;
      if (score >= best) continue;
      best = score;
      out.turn = turn;
      out.up = up;
    }
  return out;
}
