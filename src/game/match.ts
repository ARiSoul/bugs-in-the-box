import { createRng } from '../terrain/noise';
import { Bug, DT, IDLE, TICK_RATE, type BugInput } from './bug';
import type { TerrainField } from './field';
import { rot, rotate2 } from './math';
import { Projectile } from './projectile';
import { dropNear } from './spawn';
import type { BugSpecies } from './species';
import { WEAPONS, type Weapon } from './weapons';

/**
 * One match: teams of bugs taking turns on a destructible map. Pure and deterministic like Bug:
 * the whole match is a function of (map seed, match seed, the input of every tick). Multiplayer
 * only has to agree on those.
 *
 * Turn flow:
 *   aim     the active bug walks, jumps, aims, picks a weapon and fires (AIM_SECONDS)
 *   flight  projectiles fly; the shooter may retreat for RETREAT_SECONDS but not fire again
 *   settle  wait until every bug and projectile is at rest; bugs at 0 health die
 *   -> next team's turn, or 'over' when at most one team has bugs left
 */

export const AIM_TICKS = 30 * TICK_RATE;
export const RETREAT_TICKS = 3 * TICK_RATE;
/** Everything must be at rest for this long before the next turn starts... */
const SETTLE_HOLD_TICKS = 20;
/** ...unless it takes longer than this (e.g. a bug sliding forever). */
const SETTLE_MAX_TICKS = 10 * TICK_RATE;
/** Holding fire fills the power bar in this many ticks; it fires by itself when full. */
export const CHARGE_TICKS = 72;
/** Projectiles leave at no less than this fraction of their full speed. */
const MIN_POWER = 0.12;
/** Pitch rate of the aim, radians per second. */
const AIM_RATE = 1.2;
/**
 * Fine control with keys: turning and aiming start at this fraction of their full rate and reach it after
 * RAMP_TICKS of holding, so a tap moves a fraction of a degree and a long press still sweeps fast.
 */
const RAMP_START = 0.15;
const RAMP_TICKS = Math.round(0.6 * TICK_RATE);
/** Aim pitch limits, as the vertical component of the aim vector. */
const AIM_MAX_UP = 0.995;
const AIM_MAX_DOWN = -0.8;
/** Strongest wind, as a horizontal acceleration per axis (world units / s²). */
export const WIND_MAX = 5;
/** Damage reaches this many blast radii from the centre, falling off linearly. */
export const BLAST_REACH = 1.6;
/** Knockback speed at the blast centre for a 45-damage weapon. */
const KNOCKBACK = 14;
/** Landing faster than this (world units / s) hurts; each unit above it costs FALL_DAMAGE health. */
export const FALL_SAFE_SPEED = 15;
const FALL_DAMAGE = 2.5;
/** Bugs are placed at least this far apart at the start. */
const SPAWN_SPACING = 14;
const SPAWN_SETTLE_TICKS = 3 * TICK_RATE;
/** After bugs die at the end of a turn, wait this long (their death on screen) before the next turn. */
export const DEATH_HOLD_TICKS = Math.round(1.6 * TICK_RATE);

export type Phase = 'aim' | 'flight' | 'settle' | 'over';

export interface TeamSpec {
  readonly name: string;
  readonly species: BugSpecies;
  /** Render only. */
  readonly color: number;
  readonly size: number;
}

export interface Unit {
  readonly id: number;
  readonly team: number;
  readonly name: string;
  readonly bug: Bug;
  /** Aim pitch as a unit vector in the vertical plane of the facing: (horizontal, vertical). */
  aimH: number;
  aimV: number;
  /** Set once the death has been announced. */
  dead: boolean;
}

export interface MatchInput {
  move: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  /**
   * Face this horizontal direction (the camera's, while the player turns the view); (0, 0): keep the
   * facing. Plain numbers, so they travel with the other input of the tick.
   */
  faceX: number;
  faceZ: number;
  jump: boolean;
  /** Run instead of walk. */
  run: boolean;
  /** +1 aim higher, -1 aim lower. */
  aim: -1 | 0 | 1;
  /** Held down: charge; released: fire. */
  fire: boolean;
  /** Weapon index to select, or -1 to keep the current one. */
  weapon: number;
}

export const NO_INPUT: Readonly<MatchInput> = Object.freeze({ move: 0, turn: 0, faceX: 0, faceZ: 0, jump: false, run: false, aim: 0, fire: false, weapon: -1 });

export type MatchEvent =
  | { type: 'turn'; unit: number }
  | { type: 'fire'; unit: number; weapon: string }
  | { type: 'explosion'; x: number; y: number; z: number; radius: number }
  | { type: 'arc'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }
  | { type: 'dig'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; radius: number }
  | { type: 'damage'; unit: number; amount: number }
  | { type: 'death'; unit: number }
  | { type: 'over'; winner: number };

const COS45 = 0.7071067811865476;
const bugInput: BugInput = { move: 0, turn: 0, jump: false, run: false, faceX: 0, faceZ: 0 };

/** Fraction of the full rate after holding a key for `held` ticks (see RAMP_START). */
function ramp(held: number): number {
  return held >= RAMP_TICKS ? 1 : RAMP_START + ((1 - RAMP_START) * held) / RAMP_TICKS;
}

export interface MatchOptions {
  /** false: skip random placement (tests place the bugs themselves). Default true. */
  placeBugs?: boolean;
  /** Discard projectiles as soon as they leave the map box (sides and top). Default: a 20-unit margin, no top. */
  strictBounds?: boolean;
}

export class Match {
  readonly units: Unit[] = [];
  readonly projectiles: Projectile[] = [];
  /** What happened during the last `step` (cleared at the start of every step). */
  readonly events: MatchEvent[] = [];
  phase: Phase = 'aim';
  /** Index into `units` of the bug whose turn it is. */
  active = 0;
  /** Ticks left to aim and fire. */
  turnTicks = AIM_TICKS;
  /** Ticks left for the shooter to walk away after firing. */
  retreatTicks = 0;
  windX = 0;
  windZ = 0;
  weapon = 0;
  charging = false;
  /** 0..1 while charging. */
  power = 0;
  /** Team index of the winner once over, -1 for a draw. */
  winner = -1;
  turnNumber = 0;
  tick = 0;

  private readonly rng: () => number;
  private readonly nextInTeam: number[];
  private settleTicks = 0;
  private stillTicks = 0;
  /** Ticks left of the pause after deaths (-1: none). */
  private deathTicks = -1;
  /** How long the turn and aim keys have been held in the same direction (ticks). */
  private turnHeld = 0;
  private turnDir = 0;
  private aimHeld = 0;
  private aimDir = 0;
  private fireWasDown = false;
  private nextProjectileId = 1;
  private readonly bugs: Bug[] = [];

  constructor(
    readonly field: TerrainField,
    readonly teams: readonly TeamSpec[],
    seed: number,
    readonly options: MatchOptions = {},
  ) {
    this.rng = createRng(seed * 2654435761 + 97);
    let id = 0;
    const maxSize = teams.reduce((m, t) => Math.max(m, t.size), 0);
    // interleave teams so the spawn order (and so the spread over the map) is fair
    for (let i = 0; i < maxSize; i++)
      for (let t = 0; t < teams.length; t++) {
        if (i >= teams[t].size) continue;
        const bug = new Bug(teams[t].species);
        this.units.push({ id: id++, team: t, name: `${teams[t].species.id} ${i + 1}`, bug, aimH: COS45, aimV: COS45, dead: false });
        this.bugs.push(bug);
      }
    this.nextInTeam = teams.map(() => 0);
    if (options.placeBugs !== false) this.placeBugs();
    this.beginTurn(0);
  }

  get activeUnit(): Unit {
    return this.units[this.active];
  }

  get currentWeapon(): Weapon {
    return WEAPONS[this.weapon];
  }

  /** Bugs still alive per team. */
  teamAlive(team: number): number {
    let n = 0;
    for (const u of this.units) if (u.team === team && u.bug.alive) n++;
    return n;
  }

  /** Total health left per team. */
  teamHealth(team: number): number {
    let h = 0;
    for (const u of this.units) if (u.team === team && u.bug.alive) h += u.bug.health;
    return h;
  }

  /** Advance one tick. */
  step(input: Readonly<MatchInput>): void {
    this.events.length = 0;
    this.tick++;
    const unit = this.units[this.active];
    const fireDown = input.fire && !this.fireWasDown;
    this.fireWasDown = input.fire;
    this.turnHeld = input.turn !== 0 && input.turn === this.turnDir ? this.turnHeld + 1 : 0;
    this.turnDir = input.turn;
    this.aimHeld = input.aim !== 0 && input.aim === this.aimDir ? this.aimHeld + 1 : 0;
    this.aimDir = input.aim;

    let move: Readonly<BugInput> = IDLE;
    if (this.phase === 'aim') {
      move = this.aimTick(unit, input, fireDown);
    } else if (this.phase === 'flight') {
      if (this.retreatTicks > 0) {
        this.retreatTicks--;
        move = this.movement(input);
      }
      if (this.projectiles.length === 0 && this.retreatTicks === 0) this.startSettle();
    } else if (this.phase === 'settle') {
      this.settleTick();
    }

    for (const u of this.units) {
      const b = u.bug;
      b.step(this.field, u === unit ? move : IDLE);
      if (b.justLanded && b.lastImpact > FALL_SAFE_SPEED) this.damage(u, Math.round((b.lastImpact - FALL_SAFE_SPEED) * FALL_DAMAGE));
      if (!b.alive && !u.dead) this.announceDeath(u);
    }
    if (this.phase === 'aim' && !unit.bug.alive) this.endAim();

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      const r = p.step(this.field, this.windX, this.windZ, this.bugs, this.options.strictBounds === true);
      if (r === 'fly') continue;
      if (r === 'explode') this.explode(p.x, p.y, p.z, p.weapon);
      this.projectiles.splice(i--, 1);
    }
  }

  /** Aim direction of a unit (unit vector), written into `out`. */
  aimDirection(u: Unit, out: Float64Array): Float64Array {
    out[0] = u.bug.fx * u.aimH;
    out[1] = u.aimV;
    out[2] = u.bug.fz * u.aimH;
    return out;
  }

  // ---------------------------------------------------------------- turn flow

  private aimTick(unit: Unit, input: Readonly<MatchInput>, fireDown: boolean): Readonly<BugInput> {
    if (!this.charging && input.weapon >= 0 && input.weapon < WEAPONS.length) this.weapon = input.weapon;
    if (input.aim !== 0) {
      rotate2(unit.aimH, unit.aimV, input.aim * AIM_RATE * ramp(this.aimHeld) * DT);
      if (rot[1] <= AIM_MAX_UP && rot[1] >= AIM_MAX_DOWN) {
        unit.aimH = rot[0];
        unit.aimV = rot[1];
      }
    }
    this.turnTicks--;
    const w = this.currentWeapon;
    if (this.charging) {
      if (input.fire) this.power += 1 / CHARGE_TICKS;
      if (!input.fire || this.power >= 1) {
        if (this.power > 1) this.power = 1;
        this.fire(unit, w);
      }
      return IDLE;
    }
    if (fireDown && unit.bug.grounded) {
      if (w.kind === 'tunnel') this.fire(unit, w);
      else {
        this.charging = true;
        this.power = 0;
      }
      return IDLE;
    }
    if (this.turnTicks <= 0) this.endAim();
    return this.movement(input);
  }

  private movement(input: Readonly<MatchInput>): Readonly<BugInput> {
    bugInput.move = input.move;
    bugInput.turn = input.turn * ramp(this.turnHeld);
    bugInput.faceX = input.faceX;
    bugInput.faceZ = input.faceZ;
    bugInput.jump = input.jump;
    bugInput.run = input.run;
    return bugInput;
  }

  private fire(unit: Unit, w: Weapon): void {
    this.charging = false;
    this.events.push({ type: 'fire', unit: unit.id, weapon: w.id });
    if (w.kind === 'tunnel') this.dig(unit, w);
    else this.projectiles.push(this.makeProjectile(unit, w, this.power));
    this.phase = 'flight';
    this.retreatTicks = RETREAT_TICKS;
  }

  /** Time ran out, or the active bug got hurt or died: no more aiming this turn. */
  private endAim(): void {
    this.charging = false;
    this.phase = 'flight';
    this.retreatTicks = 0;
  }

  private startSettle(): void {
    this.phase = 'settle';
    this.settleTicks = 0;
    this.stillTicks = 0;
    this.deathTicks = -1;
  }

  private settleTick(): void {
    if (this.deathTicks >= 0) {
      if (this.deathTicks-- === 0) {
        this.deathTicks = -1;
        this.beginTurn(this.units[this.active].team + 1);
      }
      return;
    }
    this.settleTicks++;
    let still = this.projectiles.length === 0;
    for (const b of this.bugs) if (!b.settled) still = false;
    this.stillTicks = still ? this.stillTicks + 1 : 0;
    if (this.stillTicks < SETTLE_HOLD_TICKS && this.settleTicks < SETTLE_MAX_TICKS) return;
    let died = false;
    for (const u of this.units)
      if (u.bug.alive && u.bug.health <= 0) {
        u.bug.alive = false;
        this.announceDeath(u);
        died = true;
      }
    if (died) this.deathTicks = DEATH_HOLD_TICKS;
    else this.beginTurn(this.units[this.active].team + 1);
  }

  /** Give the turn to the next team (from `team` on) that still has bugs, or end the match. */
  private beginTurn(team: number): void {
    const n = this.teams.length;
    let alive = 0;
    let last = -1;
    for (let t = 0; t < n; t++)
      if (this.teamHealth(t) > 0) {
        alive++;
        last = t;
      }
    if (alive <= 1 && n > 1) {
      this.phase = 'over';
      this.winner = alive === 1 ? last : -1;
      this.events.push({ type: 'over', winner: this.winner });
      return;
    }
    for (let k = 0; k < n; k++) {
      const t = (team + k) % n;
      if (this.teamHealth(t) <= 0) continue;
      const members = this.units.filter((u) => u.team === t);
      for (let j = 0; j < members.length; j++) {
        const u = members[(this.nextInTeam[t] + j) % members.length];
        if (!u.bug.alive || u.bug.health <= 0) continue;
        this.nextInTeam[t] = (members.indexOf(u) + 1) % members.length;
        this.active = this.units.indexOf(u);
        this.phase = 'aim';
        this.turnTicks = AIM_TICKS;
        this.retreatTicks = 0;
        this.charging = false;
        this.power = 0;
        this.windX = (this.rng() * 2 - 1) * WIND_MAX;
        this.windZ = (this.rng() * 2 - 1) * WIND_MAX;
        this.turnNumber++;
        this.events.push({ type: 'turn', unit: u.id });
        return;
      }
    }
  }

  // ---------------------------------------------------------------- weapons

  private makeProjectile(u: Unit, w: Weapon, power: number): Projectile {
    const b = u.bug;
    const dx = b.fx * u.aimH;
    const dy = u.aimV;
    const dz = b.fz * u.aimH;
    const speed = (power < MIN_POWER ? MIN_POWER : power) * w.maxSpeed;
    const off = b.species.radius + 0.5;
    return new Projectile(this.nextProjectileId++, w, b).launch(
      b.x + dx * off,
      b.y + dy * off,
      b.z + dz * off,
      dx * speed,
      dy * speed,
      dz * speed,
    );
  }

  private dig(u: Unit, w: Weapon): void {
    const b = u.bug;
    const dx = b.fx * u.aimH;
    const dy = u.aimV;
    const dz = b.fz * u.aimH;
    const stepLen = w.tunnelRadius * 0.7;
    const start = b.species.radius * 0.5;
    for (let s = start; s <= w.tunnelLength; s += stepLen) this.field.carve(b.x + dx * s, b.y + dy * s, b.z + dz * s, w.tunnelRadius);
    const end = w.tunnelLength;
    this.events.push({
      type: 'dig',
      x1: b.x + dx * start,
      y1: b.y + dy * start,
      z1: b.z + dz * start,
      x2: b.x + dx * end,
      y2: b.y + dy * end,
      z2: b.z + dz * end,
      radius: w.tunnelRadius,
    });
    // the bug may be standing where the tunnel starts: let it fall in
    b.push(0, 0, 0);
  }

  /** Carve the crater, hurt and throw every bug in reach, then let a Short Circuit arc jump on. */
  explode(x: number, y: number, z: number, w: Weapon): void {
    this.field.carve(x, y, z, w.blastRadius);
    this.events.push({ type: 'explosion', x, y, z, radius: w.blastRadius });
    const reach = w.blastRadius * BLAST_REACH;
    for (const u of this.units) {
      const b = u.bug;
      if (!b.alive) continue;
      const ex = b.x - x;
      const ey = b.y - y;
      const ez = b.z - z;
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const d = dist - b.species.radius;
      if (d >= reach) continue;
      const f = d <= 0 ? 1 : 1 - d / reach;
      this.damage(u, Math.round(w.damage * f));
      // thrown away from the blast, with an upward bias so it does not just slide
      let kx = 0;
      let ky = 1;
      let kz = 0;
      if (dist > 1e-6) {
        kx = ex / dist;
        ky = ey / dist + 0.6;
        kz = ez / dist;
        const kl = Math.sqrt(kx * kx + ky * ky + kz * kz);
        kx /= kl;
        ky /= kl;
        kz /= kl;
      }
      const speed = KNOCKBACK * f * (w.damage / 45);
      b.push(kx * speed, ky * speed, kz * speed);
    }
    if (w.arcs > 0) this.arc(x, y, z, w);
  }

  /** Chain to the nearest bugs within range, one after another. Ties go to the lower unit id. */
  private arc(x: number, y: number, z: number, w: Weapon): void {
    const hit = new Set<Unit>();
    let fx = x;
    let fy = y;
    let fz = z;
    for (let a = 0; a < w.arcs; a++) {
      let best: Unit | null = null;
      let bestD = w.arcRange * w.arcRange;
      for (const u of this.units) {
        const b = u.bug;
        if (!b.alive || hit.has(u)) continue;
        const dx = b.x - fx;
        const dy = b.y - fy;
        const dz = b.z - fz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD) {
          bestD = d2;
          best = u;
        }
      }
      if (!best) return;
      hit.add(best);
      const b = best.bug;
      this.events.push({ type: 'arc', x1: fx, y1: fy, z1: fz, x2: b.x, y2: b.y, z2: b.z });
      this.damage(best, w.arcDamage);
      b.push(0, 5, 0);
      fx = b.x;
      fy = b.y;
      fz = b.z;
    }
  }

  private damage(u: Unit, amount: number): void {
    if (amount <= 0 || !u.bug.alive) return;
    const b = u.bug;
    b.health = b.health > amount ? b.health - amount : 0;
    this.events.push({ type: 'damage', unit: u.id, amount });
    // getting hurt on your own turn ends it (no more aiming)
    if (this.phase === 'aim' && u === this.units[this.active]) this.endAim();
  }

  private announceDeath(u: Unit): void {
    u.dead = true;
    u.bug.health = 0;
    this.events.push({ type: 'death', unit: u.id });
  }

  // ---------------------------------------------------------------- setup

  /** Spread the bugs over the map (deterministic from the match seed) and let them land. */
  private placeBugs(): void {
    const { W, D } = this.field;
    const margin = 8;
    const placed: Bug[] = [];
    for (const u of this.units) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = margin + this.rng() * (W - 2 * margin);
        const z = margin + this.rng() * (D - 2 * margin);
        if (!dropNear(u.bug, this.field, x, z)) continue;
        let ok = true;
        for (const o of placed) {
          const dx = o.x - u.bug.x;
          const dz = o.z - u.bug.z;
          if (dx * dx + dz * dz < SPAWN_SPACING * SPAWN_SPACING) ok = false;
        }
        if (ok || attempt === 39) break;
      }
      placed.push(u.bug);
    }
    for (let t = 0; t < SPAWN_SETTLE_TICKS; t++) for (const b of this.bugs) b.step(this.field, IDLE);
    for (const b of this.bugs) {
      b.health = 100;
      b.lastImpact = 0;
    }
  }
}
