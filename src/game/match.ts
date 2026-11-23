import { createRng } from '../terrain/noise';
import { Bug, DT, IDLE, TICK_RATE, type BugInput } from './bug';
import { surfaceDistance, type TerrainField } from './field';
import { rot, rotate2 } from './math';
import { Projectile } from './projectile';
import { dropNear } from './spawn';
import type { BugSpecies } from './species';
import { hasWeapon, WEAPONS, type Weapon } from './weapons';

/**
 * One match: teams of bugs taking turns on a destructible map. Pure and deterministic like Bug:
 * the whole match is a function of (map seed, match seed, the input of every tick). Multiplayer
 * only has to agree on those.
 *
 * Turn flow:
 *   aim     the active bug walks, jumps, aims, picks a weapon and fires (AIM_SECONDS)
 *   special (special attacks) the attack's scene plays before the shot leaves; nothing else moves on
 *   flight  projectiles fly; the shooter may retreat for RETREAT_SECONDS but not fire again
 *   settle  wait until every bug and projectile is at rest; bugs at 0 health die
 *   spin    (maps with a turntable) the turntable turns a quarter, carrying what rests on it
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

/** A bug held by a web walks at this fraction of its speed (and cannot jump)... */
export const WEB_SLOW = 0.12;
/** ...until it has pulled at it for this long, on its own turns: then the web tears. */
export const WEB_TEAR_TICKS = 4 * TICK_RATE;
/** A web holds a bug whose centre is nearer its surface than this many radii. */
const WEB_REACH = 1.6;

/** A sticky web lying on a surface (Web Shot): it holds every bug but those that spin silk. */
export interface Web {
  readonly id: number;
  /** Its middle, on the surface, and the surface's normal there. */
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  readonly radius: number;
  /** Burst open by a special attack (render only). */
  readonly grand: boolean;
  /** Turns left, and pulling (ticks) it still stands. */
  turns: number;
  strength: number;
}

export type Phase = 'aim' | 'special' | 'flight' | 'settle' | 'spin' | 'over';

/**
 * A turntable (a microwave's glass plate): it turns a quarter turn (+x towards +z) between turns, over
 * SPIN_TICKS, carrying the bugs that rest on it. (x, z): its axis, on a sample; `radius`: of the grid
 * cylinder that turns (whole samples); rows j0..j1 of the grid turn with it; `surface`: the plate's top.
 */
export interface TurntableSpec {
  x: number;
  z: number;
  radius: number;
  j0: number;
  j1: number;
  surface: number;
}

/** How long the turntable takes for its quarter turn. */
export const SPIN_TICKS = 90;
/** (cos, sin) of one tick's share of the quarter turn, from their series (no Math.sin/cos in gameplay). */
const SPIN_A = 1.5707963267948966 / SPIN_TICKS; // (a quarter turn: pi / 2)
const SPIN_C = 1 - (SPIN_A * SPIN_A) / 2 + (SPIN_A * SPIN_A * SPIN_A * SPIN_A) / 24;
const SPIN_S = SPIN_A - (SPIN_A * SPIN_A * SPIN_A) / 6 + (SPIN_A * SPIN_A * SPIN_A * SPIN_A * SPIN_A) / 120;

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
  /** Held by a web (its id; -1: free). */
  web: number;
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
  | { type: 'special'; unit: number; weapon: string }
  | { type: 'fire'; unit: number; weapon: string }
  | { type: 'explosion'; x: number; y: number; z: number; radius: number }
  | { type: 'arc'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }
  | { type: 'dig'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; radius: number }
  | { type: 'arrow'; x: number; y: number; z: number; dx: number; dy: number; dz: number; unit: number }
  | { type: 'web'; id: number }
  | { type: 'stuck'; unit: number }
  | { type: 'webGone'; id: number; torn: boolean }
  | { type: 'damage'; unit: number; amount: number }
  | { type: 'death'; unit: number }
  | { type: 'over'; winner: number };

const COS45 = 0.7071067811865476;
const aimed = new Float64Array(3);
/** How near two bugs' centres come, as a fraction of their radii together (nose to tail their bodies are longer than their spheres). */
const BODY = 1.15;
/** A bug that comes down on another slides off it at this speed. */
const SLIDE_OFF = 3;
const bugInput: BugInput = { move: 0, turn: 0, jump: false, run: false, faceX: 0, faceZ: 0 };

/** Fraction of the full rate after holding a key for `held` ticks (see RAMP_START). */
function ramp(held: number): number {
  return held >= RAMP_TICKS ? 1 : RAMP_START + ((1 - RAMP_START) * held) / RAMP_TICKS;
}

export interface MatchOptions {
  /** false: skip random placement (tests place the bugs themselves). Default true. */
  placeBugs?: boolean;
  /** Discard projectiles as soon as they leave the map box by its sides; at its top they stop and fall back. Default: a 20-unit margin, no top. */
  strictBounds?: boolean;
  /**
   * Spawn on any level, not only on the topmost surface: each try drops from a random height (a map with
   * floors under floors, such as shelves). Default false.
   */
  spawnLevels?: boolean;
  /** A turntable that turns between turns (see TurntableSpec). */
  turntable?: TurntableSpec;
  /** Where a bug may spawn, stand and walk: it turns back at the limit (default: the whole map). Pure. */
  confine?: (x: number, y: number, z: number) => boolean;
}

export class Match {
  readonly units: Unit[] = [];
  readonly projectiles: Projectile[] = [];
  readonly webs: Web[] = [];
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
  /** Ticks left of a special attack's scene. */
  specialTicks = 0;
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
  /** Quarter turns the turntable has made, and the ticks into the current one. */
  private quarterTurns = 0;
  private spinTicks = 0;
  private spinC = 1;
  private spinS = 0;
  /** What the turntable carries this spin: the unit and its offset from the axis and facing at the start. */
  private readonly carried: { u: Unit; dx: number; dz: number; fx: number; fz: number }[] = [];
  /** How long the turn and aim keys have been held in the same direction (ticks). */
  private turnHeld = 0;
  private turnDir = 0;
  private aimHeld = 0;
  private aimDir = 0;
  private fireWasDown = false;
  private nextProjectileId = 1;
  private nextWebId = 1;
  /** Webs on the turntable this spin, with their offset and normal at the start. */
  private readonly carriedWebs: { w: Web; dx: number; dz: number; nx: number; nz: number }[] = [];
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
        bug.confine = options.confine ?? null;
        this.units.push({ id: id++, team: t, name: `${teams[t].species.id} ${i + 1}`, bug, aimH: COS45, aimV: COS45, dead: false, web: -1 });
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
    } else if (this.phase === 'special') {
      if (!unit.bug.alive) this.endAim();
      else if (--this.specialTicks <= 0) this.fire(unit, this.currentWeapon);
    } else if (this.phase === 'settle') {
      this.settleTick();
    } else if (this.phase === 'spin') {
      this.spinTick();
    }

    this.holdInWebs(unit, move);
    if (unit.web >= 0 && move.jump) {
      bugInput.jump = false;
    }

    for (const u of this.units) {
      const b = u.bug;
      // (what rides the turntable is moved by it, not by its own physics)
      if (this.phase === 'spin' && this.isCarried(u)) continue;
      b.step(this.field, u === unit ? move : IDLE);
      if (b.justLanded && b.lastImpact > FALL_SAFE_SPEED) this.damage(u, Math.round((b.lastImpact - FALL_SAFE_SPEED) * FALL_DAMAGE));
      if (!b.alive && !u.dead) this.announceDeath(u);
    }
    if (this.phase !== 'spin') this.keepApart();
    if (this.phase === 'aim' && !unit.bug.alive) this.endAim();

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      const r = p.step(this.field, this.windX, this.windZ, this.bugs, this.options.strictBounds === true);
      if (r === 'fly') continue;
      if (r === 'explode') {
        if (p.weapon.kind === 'arrow') this.arrowHit(p);
        else if (p.weapon.kind === 'web') this.castWeb(p.x, p.y, p.z, p.weapon, p.owner);
        else this.explode(p.x, p.y, p.z, p.weapon);
      }
      this.projectiles.splice(i--, 1);
    }
  }

  /**
   * Aim direction of a unit (unit vector), written into `out`: from its front, raised by its aim away from what it
   * stands on. On a wall or a ceiling it follows the bug's own front, not the level.
   */
  aimDirection(u: Unit, out: Float64Array): Float64Array {
    return u.bug.direction(u.aimH, u.aimV, out);
  }

  /** Bugs are solid to each other: whoever moved into another is put back beside it (both, if both moved). */
  private keepApart(): void {
    const { bugs } = this;
    for (let i = 0; i < bugs.length; i++) {
      const a = bugs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bugs.length; j++) {
        const b = bugs[j];
        if (!b.alive) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        const reach = (a.species.radius + b.species.radius) * BODY;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= reach * reach) continue;
        let d = Math.sqrt(d2);
        // (right on top of each other: one way aside, the same on every device)
        if (d < 1e-4 || dx * dx + dz * dz < 1e-4 * d2) {
          dx = (i + j) % 2 ? 0.3 : -0.3;
          dz = 0.2;
          d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        dx /= d;
        dy /= d;
        dz /= d;
        const over = reach - Math.sqrt(d2);
        const ma = (a.x - a.px) * (a.x - a.px) + (a.y - a.py) * (a.y - a.py) + (a.z - a.pz) * (a.z - a.pz);
        const mb = (b.x - b.px) * (b.x - b.px) + (b.y - b.py) * (b.y - b.py) + (b.z - b.pz) * (b.z - b.pz);
        const wa = ma > 1e-8 === mb > 1e-8 ? 0.5 : ma > 1e-8 ? 1 : 0;
        if (wa > 0) this.aside(a, dx, dy, dz, over * wa);
        if (wa < 1) this.aside(b, -dx, -dy, -dz, over * (1 - wa));
      }
    }
  }

  /** Put a bug `over` further along (dx, dy, dz); in the air it also loses its speed against that, and slides off. */
  private aside(b: Bug, dx: number, dy: number, dz: number, over: number): void {
    b.shove(this.field, dx * over, dy * over, dz * over);
    if (b.grounded) return;
    // (a thread does not hold it up on another bug)
    b.thread = false;
    const vn = b.vx * dx + b.vy * dy + b.vz * dz;
    if (vn < 0) {
      b.vx -= dx * vn;
      b.vy -= dy * vn;
      b.vz -= dz * vn;
    }
    if (dy > 0.5) {
      const l = Math.sqrt(dx * dx + dz * dz);
      b.vx = (dx / l) * SLIDE_OFF;
      b.vz = (dz / l) * SLIDE_OFF;
    }
  }

  // ---------------------------------------------------------------- turn flow

  private aimTick(unit: Unit, input: Readonly<MatchInput>, fireDown: boolean): Readonly<BugInput> {
    if (!this.charging && input.weapon >= 0 && input.weapon < WEAPONS.length && this.canUse(unit, input.weapon)) this.weapon = input.weapon;
    if (input.aim !== 0) {
      rotate2(unit.aimH, unit.aimV, input.aim * AIM_RATE * ramp(this.aimHeld) * DT);
      if (rot[0] <= 0 && rot[1] > 0) {
        // straight up, and no further
        unit.aimH = 0;
        unit.aimV = 1;
      } else if (rot[1] >= AIM_MAX_DOWN) {
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
        if (w.sceneTicks > 0) {
          this.charging = false;
          this.phase = 'special';
          this.specialTicks = w.sceneTicks;
          this.events.push({ type: 'special', unit: unit.id, weapon: w.id });
        } else this.fire(unit, w);
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

  /** Whether the unit has weapon `index`. */
  canUse(u: Unit, index: number): boolean {
    return hasWeapon(u.bug.species.id, WEAPONS[index]);
  }

  /** Which bugs the webs hold now; the active one pulls at its web while it tries to walk or jump. */
  private holdInWebs(active: Unit, move: Readonly<BugInput>): void {
    for (const u of this.units) {
      const w = u.bug.alive && !u.bug.species.silk ? this.webAt(u.bug) : null;
      if (w && u.web !== w.id) this.events.push({ type: 'stuck', unit: u.id });
      u.web = w ? w.id : -1;
      u.bug.slow = w ? WEB_SLOW : 1;
      if (!w || u !== active || (move.move === 0 && !move.jump)) continue;
      if (--w.strength > 0) continue;
      this.removeWeb(w, true);
      u.web = -1;
      u.bug.slow = 1;
    }
  }

  /** The web a bug stands in (the oldest, if several), or null. */
  private webAt(b: Bug): Web | null {
    if (!b.grounded) return null;
    for (const w of this.webs) {
      const dx = b.x - w.x;
      const dy = b.y - w.y;
      const dz = b.z - w.z;
      if (dx * dx + dy * dy + dz * dz > w.radius * w.radius) continue;
      // (over the same surface, not on the other side of a thin wall or on a ledge well above it)
      const up = dx * w.nx + dy * w.ny + dz * w.nz;
      if (b.nx * w.nx + b.ny * w.ny + b.nz * w.nz < 0 || up < -b.species.radius || up > b.species.radius * WEB_REACH + w.radius * 0.5) continue;
      return w;
    }
    return null;
  }

  private removeWeb(w: Web, torn: boolean): void {
    this.webs.splice(this.webs.indexOf(w), 1);
    this.events.push({ type: 'webGone', id: w.id, torn });
  }

  /** A dart ends: a bug it hits is hurt, the faster the more, and held by the web it bursts into. */
  private arrowHit(p: Projectile): void {
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    const l = speed > 1e-6 ? speed : 1;
    const dx = p.vx / l;
    const dy = p.vy / l;
    const dz = p.vz / l;
    const b = p.touched(this.bugs);
    const u = b ? this.units[this.bugs.indexOf(b)] : null;
    this.events.push({ type: 'arrow', x: p.x, y: p.y, z: p.z, dx, dy, dz, unit: u ? u.id : -1 });
    if (u) {
      this.damage(u, Math.max(1, Math.round(p.weapon.damage * Math.min(1, speed / p.weapon.maxSpeed))));
      this.openWeb(u.bug.x, u.bug.y, u.bug.z, p.weapon, true);
    } else this.openWeb(p.x, p.y, p.z, p.weapon, true);
  }

  /** A ball of silk lands: a web on the surface there; a bug it hits is hurt a little. */
  private castWeb(x: number, y: number, z: number, w: Weapon, owner: Bug | null): void {
    for (const u of this.units) {
      const b = u.bug;
      if (!b.alive || b === owner) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      const dz = b.z - z;
      const reach = b.species.radius + 0.8;
      if (dx * dx + dy * dy + dz * dz < reach * reach) {
        this.damage(u, w.damage);
        // (it hit the bug: the web opens on what that bug stands on)
        x = b.x;
        y = b.y;
        z = b.z;
        break;
      }
    }
    this.openWeb(x, y, z, w, false);
  }

  /** A web on the surface nearest (x, y, z), if there is one near. */
  private openWeb(x: number, y: number, z: number, w: Weapon, grand: boolean): void {
    // onto the surface: a few steps along the way to the nearest point
    for (let k = 0; k < 4; k++) {
      const d = surfaceDistance(this.field, x, y, z, aimed);
      x -= aimed[0] * d;
      y -= aimed[1] * d;
      z -= aimed[2] * d;
    }
    const d = surfaceDistance(this.field, x, y, z, aimed);
    const l = Math.sqrt(aimed[0] * aimed[0] + aimed[1] * aimed[1] + aimed[2] * aimed[2]);
    // (nothing near to hold on to: a bug hit in the air)
    if (d > 1 || d < -1 || l < 0.5) return;
    const id = this.nextWebId++;
    this.webs.push({ id, x, y, z, nx: aimed[0] / l, ny: aimed[1] / l, nz: aimed[2] / l, radius: w.webRadius, turns: w.webTurns, strength: WEB_TEAR_TICKS, grand });
    this.events.push({ type: 'web', id });
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
        this.endTurn();
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
    else this.endTurn();
  }

  /** The turn is over: the turntable turns first (if there is one and the match goes on), then the next team. */
  private endTurn(): void {
    const tt = this.options.turntable;
    let alive = 0;
    for (let t = 0; t < this.teams.length; t++) if (this.teamHealth(t) > 0) alive++;
    if (!tt || alive <= 1) {
      this.beginTurn(this.units[this.active].team + 1);
      return;
    }
    this.phase = 'spin';
    this.spinTicks = 0;
    this.spinC = 1;
    this.spinS = 0;
    this.carried.length = 0;
    this.carriedWebs.length = 0;
    for (const w of this.webs) {
      const dx = w.x - tt.x;
      const dz = w.z - tt.z;
      if (dx * dx + dz * dz < tt.radius * tt.radius && w.y > tt.surface - 1.5 && w.y < tt.surface + 6) this.carriedWebs.push({ w, dx, dz, nx: w.nx, nz: w.nz });
    }
    const r = tt.radius - 0.5;
    for (const u of this.units) {
      const b = u.bug;
      const dx = b.x - tt.x;
      const dz = b.z - tt.z;
      if (dx * dx + dz * dz > r * r || b.y < tt.surface - 0.5 || b.y > tt.surface + 6) continue;
      this.carried.push({ u, dx, dz, fx: b.fx, fz: b.fz });
    }
  }

  private isCarried(u: Unit): boolean {
    for (const c of this.carried) if (c.u === u) return true;
    return false;
  }

  /** One tick of the quarter turn: carry the riders round the axis; at the end, turn the grid with them. */
  private spinTick(): void {
    const tt = this.options.turntable as TurntableSpec;
    this.spinTicks++;
    const last = this.spinTicks >= SPIN_TICKS;
    if (last) {
      // (exactly a quarter at the end: the grid turns by whole samples)
      this.spinC = 0;
      this.spinS = 1;
    } else {
      const c = this.spinC * SPIN_C - this.spinS * SPIN_S;
      this.spinS = this.spinS * SPIN_C + this.spinC * SPIN_S;
      this.spinC = c;
    }
    const c = this.spinC;
    const sn = this.spinS;
    for (const k of this.carried) {
      const b = k.u.bug;
      b.px = b.x;
      b.py = b.y;
      b.pz = b.z;
      b.x = tt.x + k.dx * c - k.dz * sn;
      b.z = tt.z + k.dx * sn + k.dz * c;
      b.fx = k.fx * c - k.fz * sn;
      b.fz = k.fx * sn + k.fz * c;
      b.vx = 0;
      b.vz = 0;
    }
    for (const k of this.carriedWebs) {
      k.w.x = tt.x + k.dx * c - k.dz * sn;
      k.w.z = tt.z + k.dx * sn + k.dz * c;
      k.w.nx = k.nx * c - k.nz * sn;
      k.w.nz = k.nx * sn + k.nz * c;
    }
    if (!last) return;
    this.field.rotateQuarter?.(tt.x, tt.z, tt.j0, tt.j1, tt.radius);
    this.quarterTurns++;
    this.carried.length = 0;
    this.beginTurn(this.units[this.active].team + 1);
  }

  /** The turntable's turn so far, in quarter turns (render: interpolate and draw the plate turned). */
  get turntableTurns(): number {
    return this.quarterTurns + (this.phase === 'spin' ? this.spinTicks / SPIN_TICKS : 0);
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
        if (!this.canUse(u, this.weapon)) this.weapon = 0;
        for (let q = this.webs.length - 1; q >= 0; q--) if (--this.webs[q].turns < 0) this.removeWeb(this.webs[q], false);
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
    const [dx, dy, dz] = this.aimDirection(u, aimed);
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
    const [dx, dy, dz] = this.aimDirection(u, aimed);
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
    // (a web whose surface is blown away goes with it)
    for (let q = this.webs.length - 1; q >= 0; q--) {
      const s = this.webs[q];
      const sx = s.x - x;
      const sy = s.y - y;
      const sz = s.z - z;
      const near = w.blastRadius + s.radius * 0.5;
      if (sx * sx + sy * sy + sz * sz < near * near) this.removeWeb(s, true);
    }
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

  /** Does a bug dropped where this one is come to rest, and not fall out of the map? */
  private staysUp(bug: Bug): boolean {
    const probe = new Bug(bug.species);
    probe.x = bug.x;
    probe.y = bug.y;
    probe.z = bug.z;
    for (let t = 0; t < SPAWN_SETTLE_TICKS && probe.alive && !probe.settled; t++) probe.step(this.field, IDLE);
    return probe.alive && probe.settled && (!this.options.confine || this.options.confine(probe.x, probe.y, probe.z));
  }

  /** Spread the bugs over the map (deterministic from the match seed) and let them land. */
  private placeBugs(): void {
    const { W, H, D } = this.field;
    const margin = 8;
    const placed: Bug[] = [];
    for (const u of this.units) {
      const tries = this.options.confine ? 200 : 40;
      for (let attempt = 0; attempt < tries; attempt++) {
        const x = margin + this.rng() * (W - 2 * margin);
        const z = margin + this.rng() * (D - 2 * margin);
        const fromY = this.options.spawnLevels ? 4 + this.rng() * (H - 5) : H - 1;
        if (!dropNear(u.bug, this.field, x, z, fromY)) continue;
        let ok = true;
        for (const o of placed) {
          const dx = o.x - u.bug.x;
          const dz = o.z - u.bug.z;
          if (dx * dx + dz * dz < SPAWN_SPACING * SPAWN_SPACING) ok = false;
        }
        // (on a ledge it slips off, with a drop under it: somewhere else)
        if (ok && this.options.spawnLevels && !this.staysUp(u.bug)) ok = false;
        if (ok || attempt === tries - 1) break;
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
