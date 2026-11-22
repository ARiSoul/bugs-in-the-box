import { surfaceDistance, type TerrainField } from './field';
import { rot, rotate2 } from './math';
import type { BugSpecies } from './species';

/**
 * Bug movement against the density field. Pure and deterministic: fixed timestep, discrete input,
 * only + - * / Math.sqrt Math.ceil (no Math.sin/cos/hypot/random), so the same input sequence gives
 * bit-identical results on every device. That is what lets multiplayer send inputs, not state.
 *
 * Collision model: the bug is one sphere. Contacts come from `surfaceDistance` (density / |gradient|),
 * never from the mesh.
 */

/** Simulation ticks per second. Every gameplay constant below assumes this rate. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const GRAVITY = 25;
export const MAX_FALL_SPEED = 40;
/** A contact whose normal has at least this Y component is ground; below it is wall (~50°). */
export const WALKABLE_NY = 0.64;
export const WALK_BACK_FACTOR = 0.6;
/** Speed multiplier while running (shift held). */
export const RUN_FACTOR = 1.8;
/** Below this height the bug has left the world and dies. */
export const KILL_Y = -4;

/** How far a grounded bug is pulled down each tick to stay glued to slopes and bumps. */
const SNAP = 0.3;
/** A surface this close counts as touching, without being pushed. */
const CONTACT_EPS = 0.03;
/** Largest move per substep, as a fraction of the radius (prevents tunnelling through thin walls). */
const MAX_SUBSTEP = 0.35;
const MAX_SUBSTEPS = 8;
const RESOLVE_ITERS = 4;
/**
 * Climbing: a bug walking forward into an obstacle that is low or thin (nothing solid ahead at this many
 * radii above its centre: a cable, a ledge, a small part) climbs up it at CLIMB_SPEED; tall walls still
 * block it. It only climbs while it keeps walking forward.
 */
export const CLIMB_HEIGHT = 2.6;
const CLIMB_SPEED = 6;

export interface BugInput {
  /** +1 forward, -1 backward. */
  move: -1 | 0 | 1;
  /** +1 turn right (clockwise seen from above), -1 turn left. */
  turn: -1 | 0 | 1;
  jump: boolean;
  /** Run instead of walk (forward and back). */
  run?: boolean;
}

export const IDLE: Readonly<BugInput> = Object.freeze({ move: 0, turn: 0, jump: false, run: false });

// Scratch buffers: no allocations per tick.
const n = new Float64Array(3);
const contact = new Float64Array(3);

export class Bug {
  // Position of the sphere centre, and the previous tick's (for render interpolation).
  x = 0;
  y = 0;
  z = 0;
  px = 0;
  py = 0;
  pz = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Facing: horizontal unit vector. */
  fx = 0;
  fz = 1;
  grounded = false;
  /** Ground normal, valid while grounded. */
  nx = 0;
  ny = 1;
  nz = 0;
  alive = true;
  /** Ticks since the bug last stood on the ground (0 while grounded). */
  airTicks = 0;
  /** Downward speed at the last landing. */
  lastImpact = 0;
  /** True only during the tick in which the bug landed (read it for fall damage). */
  justLanded = false;
  health = 100;

  constructor(readonly species: BugSpecies) {}

  /**
   * Drop the bug from the top of the world onto the first surface below (x, z), facing the map centre.
   * Returns false if there is no ground under that column.
   */
  drop(field: TerrainField, x: number, z: number): boolean {
    const top = field.H - 1;
    const t = field.raycast(x, top, z, 0, -1, 0);
    if (t < 0) return false;
    this.x = this.px = x;
    this.y = this.py = top - t + this.species.radius * 1.5;
    this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    this.alive = true;
    this.airTicks = 0;
    this.lastImpact = 0;
    this.justLanded = false;
    const cx = field.W * 0.5 - x;
    const cz = field.D * 0.5 - z;
    const l = Math.sqrt(cx * cx + cz * cz);
    if (l > 1e-6) {
      this.fx = cx / l;
      this.fz = cz / l;
    } else {
      this.fx = 0;
      this.fz = 1;
    }
    return true;
  }

  /** Advance one tick (DT seconds). */
  step(field: TerrainField, input: Readonly<BugInput>): void {
    this.justLanded = false;
    if (!this.alive) return;
    const sp = this.species;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;

    if (input.turn !== 0) this.rotate(-input.turn * sp.turnRate * DT);

    let stick = false;
    let fallSpeed = 0;
    const wasGrounded = this.grounded;
    if (this.grounded && input.jump) {
      this.vx = this.fx * sp.jumpForward;
      this.vy = sp.jumpSpeed;
      this.vz = this.fz * sp.jumpForward;
      this.grounded = false;
    } else if (this.grounded) {
      // Walk along the ground plane: project the facing onto it, keep the full speed on slopes.
      const walk = input.run ? sp.walkSpeed * RUN_FACTOR : sp.walkSpeed;
      const speed = input.move > 0 ? walk : input.move < 0 ? -walk * WALK_BACK_FACTOR : 0;
      if (speed !== 0) {
        const dot = this.fx * this.nx + this.fz * this.nz;
        const tx = this.fx - this.nx * dot;
        const ty = -this.ny * dot;
        const tz = this.fz - this.nz * dot;
        const k = speed / Math.sqrt(tx * tx + ty * ty + tz * tz);
        this.vx = tx * k;
        this.vy = ty * k;
        this.vz = tz * k;
      } else {
        this.vx = this.vy = this.vz = 0;
      }
      stick = true;
    } else {
      this.vy -= GRAVITY * DT;
      if (this.vy < -MAX_FALL_SPEED) this.vy = -MAX_FALL_SPEED;
      fallSpeed = -this.vy;
    }

    // Integrate in substeps short enough not to skip through walls.
    const dx = this.vx * DT;
    const dy = this.vy * DT;
    const dz = this.vz * DT;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxStep = sp.radius * MAX_SUBSTEP;
    let steps = len > maxStep ? Math.ceil(len / maxStep) : 1;
    if (steps > MAX_SUBSTEPS) steps = MAX_SUBSTEPS;
    let groundNy = -2;
    for (let s = 0; s < steps; s++) {
      this.x += dx / steps;
      this.y += dy / steps;
      this.z += dz / steps;
      const g = this.resolve(field);
      if (g > groundNy) {
        groundNy = g;
        this.nx = contact[0];
        this.ny = contact[1];
        this.nz = contact[2];
      }
    }

    // Blocked while walking forward: climb if the obstacle ahead is low or thin enough.
    let climbing = false;
    if (wasGrounded && stick && input.move > 0) {
      const want = Math.sqrt(dx * dx + dz * dz);
      const ox = this.x - this.px;
      const oz = this.z - this.pz;
      // held back (hardly any progress), or only touching a surface too steep to stand on that faces the bug
      const held = want > 0 && Math.sqrt(ox * ox + oz * oz) < want * 0.5;
      const steep = groundNy > -2 && groundNy < WALKABLE_NY && this.nx * this.fx + this.nz * this.fz < -0.1;
      if (held || steep) climbing = this.climb(field);
    }

    // Stay glued to the ground while walking (not while climbing); if there is no ground within SNAP, start falling.
    if (stick && !climbing) {
      this.y -= SNAP;
      const g = this.resolve(field);
      if (g >= WALKABLE_NY) {
        groundNy = g;
        this.nx = contact[0];
        this.ny = contact[1];
        this.nz = contact[2];
      } else {
        this.y += SNAP;
        groundNy = -2;
      }
    }

    if (climbing) {
      this.grounded = true;
      this.airTicks = 0;
    } else if (groundNy >= WALKABLE_NY && (stick || this.vy <= 0)) {
      if (!this.grounded) {
        this.lastImpact = fallSpeed;
        this.justLanded = true;
        this.vx = this.vy = this.vz = 0;
      }
      this.grounded = true;
      this.airTicks = 0;
    } else {
      this.grounded = false;
      this.airTicks++;
    }

    if (this.y < KILL_Y) this.alive = false;
  }

  /**
   * One tick of climbing: if nothing solid is ahead at CLIMB_HEIGHT radii above the centre, and there is
   * room above, rise by CLIMB_SPEED * DT (the next forward step then carries the bug over the edge).
   */
  private climb(field: TerrainField): boolean {
    const r = this.species.radius;
    const ax = this.x + this.fx * (r + 0.6);
    const az = this.z + this.fz * (r + 0.6);
    if (field.sample(ax, this.y + CLIMB_HEIGHT * r, az) <= 0) return false; // a tall wall
    const rise = CLIMB_SPEED * DT;
    if (field.sample(this.x, this.y + r + rise, this.z) <= 0) return false; // no room above
    this.y += rise;
    this.resolve(field);
    this.vx = this.vy = this.vz = 0;
    this.nx = 0;
    this.ny = 1;
    this.nz = 0;
    return true;
  }

  /** Throw the bug (explosion knockback): adds to its velocity and makes it airborne. */
  push(vx: number, vy: number, vz: number): void {
    if (!this.alive) return;
    this.vx += vx;
    this.vy += vy;
    this.vz += vz;
    this.grounded = false;
  }

  /** True when standing still on the ground (or dead): nothing left to simulate for this bug. */
  get settled(): boolean {
    return !this.alive || (this.grounded && this.vx === 0 && this.vy === 0 && this.vz === 0);
  }

  /**
   * Push the sphere out of the terrain. Ground contacts push straight up (so a bug standing on a slope
   * does not creep downhill); walls and ceilings push along their normal. Velocity into the surface is
   * removed. Returns the highest contact normal Y (or -2 if nothing is touching), normal in `contact`.
   */
  private resolve(field: TerrainField): number {
    const r = this.species.radius;
    let best = -2;
    for (let it = 0; it < RESOLVE_ITERS; it++) {
      const d = surfaceDistance(field, this.x, this.y, this.z, n);
      if (d >= r + CONTACT_EPS) break;
      if (n[1] > best) {
        best = n[1];
        contact[0] = n[0];
        contact[1] = n[1];
        contact[2] = n[2];
      }
      if (d >= r) break;
      const p = r - d;
      if (n[1] >= WALKABLE_NY) {
        this.y += p / n[1];
      } else {
        this.x += n[0] * p;
        this.y += n[1] * p;
        this.z += n[2] * p;
      }
      const vn = this.vx * n[0] + this.vy * n[1] + this.vz * n[2];
      if (vn < 0) {
        this.vx -= n[0] * vn;
        this.vy -= n[1] * vn;
        this.vz -= n[2] * vn;
      }
    }
    return best;
  }

  /** Rotate the facing about +Y by `a` radians (counter-clockwise seen from above). */
  private rotate(a: number): void {
    // In (x, z) with y up, a rotation about +Y by a is a 2D rotation of (x, z) by -a.
    rotate2(this.fx, this.fz, -a);
    this.fx = rot[0];
    this.fz = rot[1];
  }
}
