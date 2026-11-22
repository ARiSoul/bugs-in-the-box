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
 * Climbing: a surface too steep to stand on can still be climbed if the obstacle is low or thin (nothing
 * solid at this many radii above the bug's centre, just behind the surface: a cable, a ledge, a small
 * part); tall walls still block. A bug walking forward into such a surface clings to it and walks up
 * along it, its body turned to the surface; it keeps clinging when it stops.
 */
export const CLIMB_HEIGHT = 2.6;
/** Speed while climbing, as a fraction of the walking speed. */
const CLIMB_FACTOR = 0.75;
/** Contacts with a normal Y below this are ceilings: never climbed. */
const CEILING_NY = -0.3;

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
/** The steep contact the bug faces most (from `resolve`), and how much it faces it (facing · normal). */
const wall = new Float64Array(3);
let wallFacing = 0;

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
    /** Holding on to a surface too steep to stand on (climbing). */
    const clinging = wasGrounded && this.ny < WALKABLE_NY;
    const n0x = this.nx;
    const n0y = this.ny;
    const n0z = this.nz;
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
        let tx = this.fx - this.nx * dot;
        let ty = -this.ny * dot;
        let tz = this.fz - this.nz * dot;
        let v = speed;
        if (clinging) {
          // on a steep surface, walking into it means walking up it (along its steepest ascent)
          v *= CLIMB_FACTOR;
          const ul = Math.sqrt(1 - this.ny * this.ny);
          const into = speed > 0 ? Math.max(0, -dot) : 0;
          if (ul > 1e-6) {
            tx += ((-this.nx * this.ny) / ul) * into;
            ty += ((1 - this.ny * this.ny) / ul) * into;
            tz += ((-this.nz * this.ny) / ul) * into;
          }
        }
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const k = tl > 1e-6 ? v / tl : 0;
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
    wallFacing = 0;
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

    // Climbing: walking forward into a climbable steep surface, or already clinging to one.
    let climbing = false;
    if (wasGrounded && stick) {
      if (input.move > 0 && wallFacing < -0.2 && this.climbable(field, wall[0], wall[1], wall[2])) {
        this.nx = wall[0];
        this.ny = wall[1];
        this.nz = wall[2];
        climbing = true;
      } else if (clinging && groundNy > -2 && groundNy < WALKABLE_NY && this.climbable(field, this.nx, this.ny, this.nz)) {
        climbing = true;
      }
    }

    if (climbing) {
      // stay glued to the surface: pull towards it; if it is gone, let go
      const ax = this.nx;
      const ay = this.ny;
      const az = this.nz;
      this.x -= ax * SNAP;
      this.y -= ay * SNAP;
      this.z -= az * SNAP;
      const g = this.resolve(field);
      if (g > -2 && (g >= WALKABLE_NY || (g > CEILING_NY && this.climbable(field, contact[0], contact[1], contact[2])))) {
        this.nx = contact[0];
        this.ny = contact[1];
        this.nz = contact[2];
        this.grounded = true;
        this.airTicks = 0;
      } else {
        this.x += ax * SNAP;
        this.y += ay * SNAP;
        this.z += az * SNAP;
        this.grounded = false;
        this.airTicks++;
      }
    } else {
      // Stay glued to the ground while walking; if there is no ground within SNAP, start falling.
      if (stick) {
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
          // over a rounded edge (the top of a cable, a ledge): hold on along the surface it was on, if the
          // drop below is short; over a real cliff or hole the bug falls
          if (input.move !== 0 && this.holdOn(field, n0x, n0y, n0z)) climbing = true;
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
    }

    if (this.y < KILL_Y) this.alive = false;
  }

  /**
   * Hold on to the surface with normal (nx, ny, nz) the bug was on: pull towards it, and keep a contact
   * there that it can stand on or climb, if solid ground lies within CLIMB_HEIGHT + 1 radii below the
   * point it is heading over. Otherwise nothing moves (it falls).
   */
  private holdOn(field: TerrainField, nx: number, ny: number, nz: number): boolean {
    const r = this.species.radius;
    const h = Math.sqrt(nx * nx + nz * nz);
    const ox = h > 1e-6 ? (nx / h) * r : 0;
    const oz = h > 1e-6 ? (nz / h) * r : 0;
    if (field.sample(this.x + ox, this.y - (CLIMB_HEIGHT + 1) * r, this.z + oz) > 0) return false; // a real drop
    const x = this.x;
    const y = this.y;
    const z = this.z;
    this.x -= nx * SNAP;
    this.y -= ny * SNAP;
    this.z -= nz * SNAP;
    const g = this.resolve(field);
    if (g > CEILING_NY && (g >= WALKABLE_NY || this.climbable(field, contact[0], contact[1], contact[2]))) {
      this.nx = contact[0];
      this.ny = contact[1];
      this.nz = contact[2];
      return true;
    }
    this.x = x;
    this.y = y;
    this.z = z;
    return false;
  }

  /**
   * Can the bug climb the surface with normal (nx, ny, nz) it touches? Not a ceiling, and the obstacle is
   * low or thin: just behind the surface, CLIMB_HEIGHT radii above the bug's centre, there is air.
   */
  private climbable(field: TerrainField, nx: number, ny: number, nz: number): boolean {
    if (ny <= CEILING_NY) return false;
    const h = Math.sqrt(nx * nx + nz * nz);
    if (h < 1e-6) return false;
    const r = this.species.radius;
    const ax = this.x - (nx / h) * (r + 0.6);
    const az = this.z - (nz / h) * (r + 0.6);
    return field.sample(ax, this.y + CLIMB_HEIGHT * r, az) > 0;
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
      if (n[1] < WALKABLE_NY && n[1] > CEILING_NY) {
        const facing = n[0] * this.fx + n[2] * this.fz;
        if (facing < wallFacing) {
          wallFacing = facing;
          wall[0] = n[0];
          wall[1] = n[1];
          wall[2] = n[2];
        }
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
