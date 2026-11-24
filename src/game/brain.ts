import { createRng } from '../terrain/noise';
import { Bug, GRAVITY, type BugInput } from './bug';
import { blastShare, CHARGE_TICKS, MIN_POWER, NO_INPUT, type Column, type Match, type MatchInput, type Unit } from './match';
import { rot, rotate2 } from './math';
import { Projectile } from './projectile';
import { WEAPONS, type Weapon } from './weapons';

/**
 * A computer opponent. Like a player, it only gives the match one input per tick: it looks at the state, tries shots
 * in its head (the same `Projectile` and `Bug` code the match runs), walks to a better place if it finds none, aims,
 * charges and lets go, then takes cover. Pure and deterministic (seeded): the same match, the same turns. Its work is
 * spread over the ticks, a few tried shots each.
 */

export interface Skill {
  readonly id: string;
  readonly label: string;
  /** How far off its aim is: to the side and up (radians, most), the charge (ticks, most), a marked spot (units, most). */
  readonly yaw: number;
  readonly pitch: number;
  readonly charge: number;
  readonly mark: number;
  /** How often it thinks of its special attack when it is loaded (0..1), and of its other choices than the best one it found. */
  readonly special: number;
  readonly whim: number;
  /** Arcs tried per target. */
  readonly arcs: number;
}

export const SKILLS: readonly Skill[] = [
  { id: 'easy', label: 'computer, easy', yaw: 0.16, pitch: 0.11, charge: 8, mark: 9, special: 0.3, whim: 0.45, arcs: 8 },
  { id: 'normal', label: 'computer, normal', yaw: 0.07, pitch: 0.05, charge: 3, mark: 5, special: 0.6, whim: 0.2, arcs: 14 },
  { id: 'hard', label: 'computer, hard', yaw: 0.008, pitch: 0.006, charge: 0, mark: 1.5, special: 0.9, whim: 0, arcs: 24 },
];

/** Tried shots and paths per tick; ticks it looks round before it thinks, and at its aim before it lets go. */
const TRIES = 10;
const LOOK_TICKS = 50;
const HOLD_TICKS = 14;
/** With less than this left of the turn (ticks) it takes what it has. */
const HURRY = 7 * 60;
/** A shot is worth taking from here at this score (points of damage, see `harmScore`). */
const GOOD = 22;
const KILL = 25;
/** What hurts its own side counts this many times. */
const OWN = 1.6;
const WALKS = 4;
/** How long a tried shot flies at most; how long it walks at most (ticks, in three steps). */
const FLIGHT = 260;
const WALK_STEP = 40;
/** It turns this fast (radians a tick). */
const TURN = 0.045;
const COS45 = 0.7071067811865476;
const WAYS: readonly (readonly [number, number])[] = [[1, 0], [COS45, COS45], [0, 1], [-COS45, COS45], [-1, 0], [-COS45, -COS45], [0, -1], [COS45, -COS45]];

interface Plan {
  weapon: number;
  fx: number;
  fz: number;
  aimH: number;
  aimV: number;
  /** Ticks of charge. */
  charge: number;
  score: number;
  target: number;
  mark: [number, number, number] | null;
}

/** A place it could walk to: which way, for how long. */
interface Spot {
  bug: Bug;
  wx: number;
  wz: number;
  ticks: number;
  best: number;
}

type State = 'look' | 'think' | 'spots' | 'walk' | 'aim' | 'charge' | 'done';

const dir = new Float64Array(3);
const vel = new Float64Array(3);
const step: BugInput = { move: 0, turn: 0, jump: false, run: false, faceX: 0, faceZ: 0 };

export class Brain {
  private readonly out: MatchInput = { ...NO_INPUT };
  private rng: () => number = createRng(1);
  private turn = -1;
  private state: State = 'look';
  private timer = 0;
  private walks = 0;
  private plans: Plan[] = [];
  private plan: Plan | null = null;
  private tuned = false;
  private queue: (() => void)[] = [];
  private spots: Spot[] = [];
  private walkTo: Spot | null = null;
  private hidden: Spot | null = null;
  private hiding = false;
  /** A shot that hurts nobody but comes down nearest to an enemy: it clears the way. And where the last tried one came down. */
  private clearing: Plan | null = null;
  private nearest = 0;
  private readonly end = new Float64Array(3);
  private specials = false;

  constructor(
    readonly skill: Skill,
    private readonly seed: number,
  ) {}

  /** What it does this tick (reused: read it, do not keep it). Call it only while it is its turn. */
  next(match: Match): Readonly<MatchInput> {
    const o = this.out;
    o.move = o.turn = o.aim = 0;
    o.faceX = o.faceZ = 0;
    o.jump = o.run = o.fire = false;
    o.weapon = -1;
    o.pitch = 0;
    o.mark = null;
    if (match.turnNumber !== this.turn) this.reset(match);
    const u = match.activeUnit;
    if (!u.bug.alive) return o;
    if (match.phase === 'flight') {
      if (match.column) this.steer(match, match.column, u);
      else if (match.retreatTicks > 0) this.hide(match, u);
      return o;
    }
    if (match.phase !== 'aim' || (!u.bug.grounded && this.state !== 'walk')) return o;
    switch (this.state) {
      case 'look':
        if (--this.timer <= 0) this.think(match, u);
        break;
      case 'think':
      case 'spots':
        this.work();
        if (this.queue.length === 0) this.decide(match, u);
        break;
      case 'walk':
        this.walk(match, u);
        break;
      case 'aim':
        this.aim(match, u);
        break;
      case 'charge':
        this.charge(match);
        break;
      default:
        break;
    }
    return o;
  }

  private reset(match: Match): void {
    this.turn = match.turnNumber;
    this.rng = createRng(this.seed * 7919 + match.turnNumber * 104729 + 13);
    this.state = 'look';
    this.timer = LOOK_TICKS;
    this.walks = 0;
    this.plan = null;
    this.hidden = null;
    this.hiding = false;
    this.specials = this.rng() < this.skill.special;
  }

  private work(): void {
    for (let k = 0; k < TRIES && this.queue.length > 0; k++) (this.queue.pop() as () => void)();
  }

  // ---------------------------------------------------------------- shots, tried

  /** Queue every shot worth a try from where it stands. */
  private think(match: Match, u: Unit): void {
    this.state = 'think';
    this.plans = [];
    this.clearing = null;
    this.nearest = 1e9;
    this.queue = [];
    this.tuned = false;
    const bugs = match.units.map((q) => q.bug);
    const enemies = this.enemies(match, u);
    WEAPONS.forEach((w, index) => {
      if (!match.canUse(u, index) || (w.sceneTicks > 0 && !this.specials)) return;
      if (w.kind === 'tunnel') return;
      if (w.kind === 'brood') {
        for (const e of enemies) this.queue.push(() => this.tryMark(match, u, w, index, e));
      } else if (w.kind === 'column') {
        for (const e of enemies) this.queue.push(() => this.tryColumn(match, u, index, e));
      } else {
        for (const e of enemies) for (let k = 0; k < this.skill.arcs; k++) this.queue.push(() => this.tryArc(match, u, u.bug, bugs, w, index, e, k / this.skill.arcs, this.plans));
      }
    });
  }

  private enemies(match: Match, u: Unit): Unit[] {
    const b = u.bug;
    const d = (q: Unit): number => (q.bug.x - b.x) * (q.bug.x - b.x) + (q.bug.y - b.y) * (q.bug.y - b.y) + (q.bug.z - b.z) * (q.bug.z - b.z);
    return match.units.filter((q) => q.team !== u.team && q.bug.alive && q.bug.health > 0).sort((p, q) => d(p) - d(q) || p.id - q.id);
  }

  /** The arc that takes time `part` (of what it may take) to the target: aim and charge it, and see where it goes. */
  private tryArc(match: Match, u: Unit, b: Bug, bugs: readonly Bug[], w: Weapon, index: number, e: Unit, part: number, plans: Plan[]): number {
    const gx = match.windX * w.windFactor;
    const gy = -GRAVITY * w.gravityFactor;
    const gz = match.windZ * w.windFactor;
    const out = b.species.radius + 0.5;
    const tx = e.bug.x;
    const ty = e.bug.y - (w.kind === 'grenade' ? e.bug.species.radius * 0.5 : 0);
    const tz = e.bug.z;
    let ox = b.x;
    let oy = b.y;
    let oz = b.z;
    const far = Math.sqrt((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy) + (tz - oz) * (tz - oz));
    const least = far / w.maxSpeed;
    const time = least * 1.02 + part * part * (least + (w.kind === 'arrow' ? 0.4 : 2.2)) + 0.05;
    let speed = 0;
    // (twice: the shot leaves from beside the bug, the way it points)
    for (let k = 0; k < 2; k++) {
      vel[0] = (tx - ox) / time - 0.5 * gx * time;
      vel[1] = (ty - oy) / time - 0.5 * gy * time;
      vel[2] = (tz - oz) / time - 0.5 * gz * time;
      speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
      if (speed < 1e-6) return -1e9;
      ox = b.x + (vel[0] / speed) * out;
      oy = b.y + (vel[1] / speed) * out;
      oz = b.z + (vel[2] / speed) * out;
    }
    const charge = Math.round((speed / w.maxSpeed) * CHARGE_TICKS);
    if (charge > CHARGE_TICKS || charge < Math.ceil(MIN_POWER * CHARGE_TICKS)) return -1e9;
    const plan: Plan = { weapon: index, fx: 0, fz: 0, aimH: 1, aimV: 0, charge, score: 0, target: e.id, mark: null };
    if (!toAim(b, vel[0] / speed, vel[1] / speed, vel[2] / speed, plan)) return -1e9;
    plan.score = this.shotScore(match, u, b, bugs, w, vel[0] / speed, vel[1] / speed, vel[2] / speed, charge);
    if (plan.score > 0) plans.push(plan);
    else if (plan.score === 0 && plans === this.plans && w.kind === 'shell') {
      const [x, y, z] = this.end;
      const d = Math.sqrt((x - tx) * (x - tx) + (y - ty) * (y - ty) + (z - tz) * (z - tz));
      const own = Math.sqrt((x - b.x) * (x - b.x) + (y - b.y) * (y - b.y) + (z - b.z) * (z - b.z));
      if (d < this.nearest && own > w.blastRadius * 2.5) {
        this.nearest = d;
        this.clearing = plan;
      }
    }
    return plan.score;
  }

  /** What a shot this way, charged this long, does. */
  private shotScore(match: Match, u: Unit, b: Bug, bugs: readonly Bug[], w: Weapon, dx: number, dy: number, dz: number, charge: number): number {
    const speed = Math.max(MIN_POWER, charge / CHARGE_TICKS) * w.maxSpeed;
    const out = b.species.radius + 0.5;
    const p = new Projectile(0, w, b).launch(b.x + dx * out, b.y + dy * out, b.z + dz * out, dx * speed, dy * speed, dz * speed);
    for (let n = 0; n < FLIGHT; n++) {
      const r = p.step(match.field, match.windX, match.windZ, bugs, match.options.strictBounds === true);
      if (r === 'lost') return -1;
      if (r === 'fly') continue;
      this.end[0] = p.x;
      this.end[1] = p.y;
      this.end[2] = p.z;
      if (w.kind === 'arrow') {
        const hit = p.touched(bugs);
        const v = hit ? match.units.find((q) => q.bug === hit) : undefined;
        if (!v) return -1;
        return this.harmScore(u, v, Math.round(w.damage * Math.min(1, Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) / w.maxSpeed)));
      }
      if (w.kind === 'web') {
        // (held for some turns: worth a little)
        let s = 0;
        for (const q of match.units) {
          if (!q.bug.alive || q.bug.species.silk || q.web >= 0) continue;
          const d2 = (q.bug.x - p.x) * (q.bug.x - p.x) + (q.bug.y - p.y) * (q.bug.y - p.y) + (q.bug.z - p.z) * (q.bug.z - p.z);
          if (d2 < w.webRadius * w.webRadius) s += q.team === u.team ? -14 : 9;
          if (q !== u && d2 < (q.bug.species.radius + 0.8) * (q.bug.species.radius + 0.8)) s += this.harmScore(u, q, w.damage);
        }
        return s;
      }
      return this.blastScore(match, u, b, w, p.x, p.y, p.z);
    }
    return -1;
  }

  private blastScore(match: Match, u: Unit, at: Bug, w: Weapon, x: number, y: number, z: number): number {
    let s = 0;
    for (const q of match.units) {
      if (!q.bug.alive) continue;
      s += this.harmScore(u, q, Math.round(w.damage * blastShare(q === u ? at : q.bug, x, y, z, w)));
    }
    let fx = x;
    let fy = y;
    let fz = z;
    const hit = new Set<Unit>();
    for (let k = 0; k < w.arcs; k++) {
      let best: Unit | null = null;
      let bestD = w.arcRange * w.arcRange;
      for (const q of match.units) {
        const b = q === u ? at : q.bug;
        if (!q.bug.alive || hit.has(q)) continue;
        const d2 = (b.x - fx) * (b.x - fx) + (b.y - fy) * (b.y - fy) + (b.z - fz) * (b.z - fz);
        if (d2 < bestD) {
          bestD = d2;
          best = q;
        }
      }
      if (!best) break;
      hit.add(best);
      s += this.harmScore(u, best, w.arcDamage);
      const b = best === u ? at : best.bug;
      fx = b.x;
      fy = b.y;
      fz = b.z;
    }
    return s;
  }

  /** What hurting unit `q` by `harm` is worth. */
  private harmScore(u: Unit, q: Unit, harm: number): number {
    if (harm <= 0 || q.bug.health <= 0) return 0;
    const kills = harm >= q.bug.health && !q.shell;
    const s = Math.min(harm, q.bug.health) + (kills ? KILL : 0);
    return q.team === u.team ? -s * OWN : s;
  }

  private tryMark(match: Match, u: Unit, w: Weapon, index: number, e: Unit): void {
    const b = e.bug;
    const r = b.species.radius;
    const x = b.x - b.nx * r;
    const y = b.y - b.ny * r;
    const z = b.z - b.nz * r;
    const d2 = (x - u.bug.x) * (x - u.bug.x) + (y - u.bug.y) * (y - u.bug.y) + (z - u.bug.z) * (z - u.bug.z);
    if (!b.grounded || d2 > w.markRange * w.markRange * 0.96) return;
    let score = 0;
    for (const q of match.units) {
      if (q.team === u.team || !q.bug.alive) continue;
      const d = Math.max(0, Math.sqrt((q.bug.x - x) * (q.bug.x - x) + (q.bug.y - y) * (q.bug.y - y) + (q.bug.z - z) * (q.bug.z - z)) - q.bug.species.radius);
      if (d < w.coverRadius) score += this.harmScore(u, q, Math.round(w.damage * (1 - (0.6 * d) / w.coverRadius)));
    }
    this.plans.push({ weapon: index, fx: u.bug.fx, fz: u.bug.fz, aimH: u.aimH, aimV: u.aimV, charge: 0, score: score * 0.9, target: e.id, mark: [x, y, z] });
  }

  private tryColumn(match: Match, u: Unit, index: number, e: Unit): void {
    const b = u.bug;
    let fx = e.bug.x - b.x;
    let fz = e.bug.z - b.z;
    const l = Math.sqrt(fx * fx + fz * fz);
    if (l < 1e-3) return;
    fx /= l;
    fz /= l;
    const h = match.columnHead(u);
    h.fx = fx;
    h.fz = fz;
    for (let n = 0; n < 350; n++) {
      steerTo(h, e.bug);
      h.step(match.field, step);
      if (!h.alive || h.airTicks > 50) return;
      const r = e.bug.species.radius + 1.5;
      if ((h.x - e.bug.x) * (h.x - e.bug.x) + (h.y - e.bug.y) * (h.y - e.bug.y) + (h.z - e.bug.z) * (h.z - e.bug.z) > r * r) continue;
      this.plans.push({ weapon: index, fx, fz, aimH: u.aimH, aimV: u.aimV, charge: CHARGE_TICKS, score: this.harmScore(u, e, 55) * 0.9, target: e.id, mark: null });
      return;
    }
  }

  // ---------------------------------------------------------------- what to do

  private decide(match: Match, u: Unit): void {
    if (this.state === 'spots') {
      this.walkTo = null;
      let best = this.bestOf(this.plans)?.score ?? 0;
      for (const s of this.spots)
        if (s.best > best + 4) {
          best = s.best;
          this.walkTo = s;
        }
      // (nothing to shoot at from anywhere: at least nearer to the next enemy)
      const near = this.enemies(match, u)[0];
      if (best <= 0 && near) {
        const d = (b: Bug): number => Math.sqrt((b.x - near.bug.x) * (b.x - near.bug.x) + (b.y - near.bug.y) * (b.y - near.bug.y) + (b.z - near.bug.z) * (b.z - near.bug.z));
        let least = d(u.bug) - 2;
        for (const s of this.spots)
          if (s.bug.ny >= 0.3 && d(s.bug) < least) {
            least = d(s.bug);
            this.walkTo = s;
          }
      }
      // (nor that: anywhere else it can stand)
      if (best <= 0 && !this.walkTo) {
        const open = this.spots.filter((s) => s.bug.ny >= 0.64);
        this.walkTo = open[Math.floor(this.rng() * open.length)] ?? null;
      }
      if (this.walkTo) {
        this.state = 'walk';
        this.timer = this.walkTo.ticks;
        this.walks++;
        return;
      }
    } else {
      const best = this.bestOf(this.plans);
      if ((!best || best.score < GOOD) && this.walks < WALKS && match.turnTicks > HURRY && u.web < 0) {
        this.seekSpots(match, u);
        return;
      }
    }
    this.choose(match, u);
  }

  private bestOf(plans: readonly Plan[]): Plan | null {
    let best: Plan | null = null;
    for (const p of plans) if (!best || p.score > best.score) best = p;
    return best;
  }

  /** The plan it goes with: the best one, or, on a whim, one not much worse; then its hand is not quite steady. */
  private choose(match: Match, u: Unit): void {
    const best = this.bestOf(this.plans);
    this.plan = best;
    if (best && this.rng() < this.skill.whim) {
      const fair = this.plans.filter((p) => p.score > best.score * 0.6);
      this.plan = fair[Math.floor(this.rng() * fair.length)] ?? best;
    }
    this.state = 'aim';
    this.timer = HOLD_TICKS;
    if (!this.plan) {
      if (this.clearing) {
        // nothing to hit: it blows away what stands between
        this.plan = this.clearing;
        return;
      }
      // nothing at all: it digs towards the next enemy (not the hold under its own feet, on a wall)
      const e = this.enemies(match, u)[0];
      const iron = WEAPONS.findIndex((w) => w.kind === 'tunnel');
      if (!e || iron < 0 || u.bug.ny < 0.64) {
        this.state = 'done';
        return;
      }
      const p: Plan = { weapon: iron, fx: u.bug.fx, fz: u.bug.fz, aimH: u.aimH, aimV: u.aimV, charge: 0, score: 0, target: e.id, mark: null };
      const dx = e.bug.x - u.bug.x;
      const dy = e.bug.y - u.bug.y;
      const dz = e.bug.z - u.bug.z;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      toAim(u.bug, dx / l, dy / l, dz / l, p);
      this.plan = p;
      return;
    }
    if (this.plan.mark) {
      const m = this.skill.mark;
      this.plan.mark = [this.plan.mark[0] + this.spread() * m, this.plan.mark[1], this.plan.mark[2] + this.spread() * m];
    }
  }

  /** -1..1, mostly near 0. */
  private spread(): number {
    return this.rng() - this.rng();
  }

  // ---------------------------------------------------------------- places

  /** Where it could walk to, and the shots from there. */
  private seekSpots(match: Match, u: Unit): void {
    this.state = 'spots';
    this.spots = [];
    this.queue = [];
    const enemies = this.enemies(match, u).slice(0, 2);
    for (const way of WAYS) {
      this.queue.push(() => {
        for (const s of this.walkWay(match, u, way[0], way[1], 5)) {
          this.spots.push(s);
          const bugs = match.units.map((q) => (q === u ? s.bug : q.bug));
          for (const e of enemies)
            for (const index of [0, 1])
              for (let k = 0; k < 7; k++)
                this.queue.push(() => {
                  const score = this.tryArc(match, u, s.bug, bugs, WEAPONS[index], index, e, k / 7, []);
                  // (a shot that may change on the way counts less)
                  if (score * 0.9 > s.best) s.best = score * 0.9;
                });
        }
      });
    }
  }

  /** Walk this way in its head: the places it comes by, as long as the way is safe. */
  private walkWay(match: Match, u: Unit, wx: number, wz: number, legs: number): Spot[] {
    const b = new Bug(u.bug.species);
    b.copy(u.bug);
    step.run = true;
    const out: Spot[] = [];
    for (let n = 1; n <= legs * WALK_STEP; n++) {
      step.move = 1;
      step.turn = 0;
      step.jump = false;
      step.run = true;
      step.faceX = wx;
      step.faceZ = wz;
      b.step(match.field, step);
      if (!b.alive || b.airTicks > 22 || (b.justLanded && b.lastImpact > 12)) break;
      if (n % WALK_STEP !== 0 || !b.grounded) continue;
      // (not into another bug, not under a ceiling)
      if (b.ny < -0.5 || match.units.some((q) => q !== u && q.bug.alive && near2(q.bug, b) < 9)) continue;
      const at = new Bug(b.species);
      at.copy(b);
      out.push({ bug: at, wx, wz, ticks: n, best: 0 });
    }
    return out;
  }

  private walk(match: Match, u: Unit): void {
    const s = this.walkTo as Spot;
    if (--this.timer < 0 || match.turnTicks < HURRY) {
      if (!u.bug.grounded) return;
      this.think(match, u);
      return;
    }
    this.out.move = 1;
    this.out.run = true;
    this.out.faceX = s.wx;
    this.out.faceZ = s.wz;
  }

  // ---------------------------------------------------------------- aiming

  private aim(match: Match, u: Unit): void {
    const o = this.out;
    const p = this.plan as Plan;
    const w = WEAPONS[p.weapon];
    if (match.weapon !== p.weapon) {
      o.weapon = p.weapon;
      return;
    }
    if (w.sceneTicks > 0 && !match.stance) return;
    if (p.mark) {
      o.mark = p.mark;
      if (--this.timer < -45) {
        if (match.mark) o.fire = true;
        else {
          // (no such spot: something else, then)
          this.specials = false;
          this.think(match, u);
        }
      }
      return;
    }
    // ---- turn, a little at a time
    const b = u.bug;
    const cross = b.fx * p.fz - b.fz * p.fx;
    const dot = b.fx * p.fx + b.fz * p.fz;
    if (dot < 1 - 0.5 * TURN * TURN) {
      rotate2(b.fx, b.fz, cross >= 0 ? TURN : -TURN);
      o.faceX = rot[0];
      o.faceZ = rot[1];
      return;
    }
    if (dot < 0.9999999) {
      o.faceX = p.fx;
      o.faceZ = p.fz;
    }
    // ---- raise or lower the aim
    const up = u.aimH * p.aimV - u.aimV * p.aimH;
    if (w.kind !== 'column' && Math.abs(up) > 0.0035) {
      if (match.stance) o.pitch = Math.max(-0.02, Math.min(0.02, up));
      else if (Math.abs(up) > 0.06 || match.tick % 2 === 0) o.aim = up > 0 ? 1 : -1;
      return;
    }
    if (--this.timer > 0) return;
    if (!this.tuned) {
      this.tuned = true;
      this.timer = 8;
      if (w.kind !== 'tunnel' && w.kind !== 'column') this.tune(match, u, w, p);
      return;
    }
    o.fire = true;
    if (w.kind !== 'tunnel') {
      this.state = 'charge';
      this.timer = p.charge;
    } else this.state = 'done';
  }

  /** Aimed: the best charge for the aim as it is now; then off by what its hand is off by. */
  private tune(match: Match, u: Unit, w: Weapon, p: Plan): void {
    const bugs = match.units.map((q) => q.bug);
    match.aimDirection(u, dir);
    const [dx, dy, dz] = dir;
    let best = -1e9;
    let charge = p.charge;
    for (let k = 0; k <= 6; k++)
      for (const s of k === 0 ? [0] : [-k, k]) {
        const c = p.charge + s;
        if (c < 9 || c > CHARGE_TICKS) continue;
        const score = this.shotScore(match, u, u.bug, bugs, w, dx, dy, dz, c);
        if (score <= best + 0.01) continue;
        best = score;
        charge = c;
      }
    // (what it thought of does not work from here after all, and there is time: again)
    if (best < 0 && match.turnTicks > HURRY && !match.stance && this.walks < WALKS + 2) {
      this.walks = WALKS + 2;
      this.specials = false;
      this.think(match, u);
      return;
    }
    const s = this.skill;
    // (a sight to aim by: a steadier hand)
    const hand = w.kind === 'arrow' ? 0.12 : 1;
    p.charge = Math.max(9, Math.min(CHARGE_TICKS, charge + Math.round(this.spread() * s.charge * hand)));
    rotate2(u.bug.fx, u.bug.fz, this.spread() * s.yaw * hand);
    const fx = rot[0];
    const fz = rot[1];
    rotate2(p.aimH, p.aimV, this.spread() * s.pitch * hand);
    if (rot[0] > 0.02 && rot[1] > -0.78) {
      p.aimH = rot[0];
      p.aimV = rot[1];
    }
    // (an unsteady hand, but it does not blow itself up: the shot as it will go is looked at once more)
    const was = [u.bug.fx, u.bug.fz];
    p.fx = fx;
    p.fz = fz;
    const probe = new Bug(u.bug.species);
    probe.copy(u.bug);
    probe.fx = fx;
    probe.fz = fz;
    probe.direction(p.aimH, p.aimV, dir);
    const own = bugs.map((q) => (q === u.bug ? probe : q));
    if (this.shotScore(match, u, probe, own, w, dir[0], dir[1], dir[2], p.charge) < -12) {
      p.fx = was[0];
      p.fz = was[1];
      p.aimH = u.aimH;
      p.aimV = u.aimV;
      p.charge = charge;
    }
  }

  private charge(match: Match): void {
    // (held for the plan's ticks, then let go; the first tick of it only starts the charge)
    if (!match.charging) {
      this.state = 'done';
      return;
    }
    this.out.fire = this.timer-- > 0;
  }

  // ---------------------------------------------------------------- after the shot

  private steer(match: Match, c: Column, u: Unit): void {
    if (c.victim >= 0) return;
    const t = this.plan && this.plan.target >= 0 ? match.units[this.plan.target] : this.enemies(match, u)[0];
    if (!t) return;
    steerTo(c.head, t.bug);
    this.out.turn = step.turn > 0.2 ? 1 : step.turn < -0.2 ? -1 : 0;
  }

  /** Where the fewest enemies see it, a short walk away (or it stays). */
  private hide(match: Match, u: Unit): void {
    if (!this.hiding) {
      if (!u.bug.grounded || u.web >= 0) return;
      this.hiding = true;
      const enemies = this.enemies(match, u);
      const seen = (b: Bug): number => {
        let n = 0;
        for (const e of enemies) {
          const dx = e.bug.x - b.x;
          const dy = e.bug.y - b.y;
          const dz = e.bug.z - b.z;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (l < 1e-3 || match.field.raycast(b.x, b.y, b.z, dx / l, dy / l, dz / l, l - 1) < 0) n += 10;
        }
        // (and not where its own shot comes down)
        for (const p of match.projectiles) n -= Math.min(6, Math.sqrt((p.x - b.x) * (p.x - b.x) + (p.z - b.z) * (p.z - b.z)) * 0.4);
        return n;
      };
      let best = seen(u.bug) - 2;
      for (const way of WAYS)
        for (const s of this.walkWay(match, u, way[0], way[1], 2)) {
          const n = seen(s.bug);
          if (n >= best) continue;
          best = n;
          this.hidden = s;
          this.timer = s.ticks;
        }
    }
    if (!this.hidden || --this.timer < 0) return;
    this.out.move = 1;
    this.out.run = true;
    this.out.faceX = this.hidden.wx;
    this.out.faceZ = this.hidden.wz;
  }
}

/** Facing and aim (into `p`) that point this way from where the bug stands; false: it cannot. */
function toAim(b: Bug, dx: number, dy: number, dz: number, p: Plan): boolean {
  // the frame it aims in (see Bug.direction): its up, for this bug now
  b.direction(0, 1, dir);
  const ux = dir[0];
  const uy = dir[1];
  const uz = dir[2];
  if (uy < -0.75) return false;
  const v = dx * ux + dy * uy + dz * uz;
  if (v < -0.79) return false;
  const tx = dx - ux * v;
  const ty = dy - uy * v;
  const tz = dz - uz * v;
  const k = ty / (1 + uy);
  const gx = tx - k * ux;
  const gz = tz - k * uz;
  const l = Math.sqrt(gx * gx + gz * gz);
  if (l < 0.03) return false;
  p.fx = gx / l;
  p.fz = gz / l;
  p.aimV = v;
  p.aimH = Math.sqrt(1 - v * v);
  return true;
}

/** The turn (into `step`) that heads `h` for `to`: by its heading along the surface it is on. */
function steerTo(h: Bug, to: Bug): void {
  const dx = to.x - h.x;
  const dy = to.y - h.y;
  const dz = to.z - h.z;
  // its right: the heading across the normal
  const rx = h.hy * h.nz - h.hz * h.ny;
  const ry = h.hz * h.nx - h.hx * h.nz;
  const rz = h.hx * h.ny - h.hy * h.nx;
  const side = dx * rx + dy * ry + dz * rz;
  const along = dx * h.hx + dy * h.hy + dz * h.hz;
  const l = Math.sqrt(side * side + along * along);
  step.move = 1;
  step.run = false;
  step.jump = false;
  step.faceX = step.faceZ = 0;
  step.turn = l < 1 ? 0 : along < 0 ? (side >= 0 ? 1 : -1) : Math.max(-1, Math.min(1, (side / l) * 3));
}

function near2(a: Bug, b: Bug): number {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z);
}
