import { surfaceDistance, type TerrainField } from './field';
import { rot, rotate2 } from './math';
import type { BugSpecies } from './species';

/**
 * Bug movement against the density field. Pure and deterministic: fixed timestep, discrete input,
 * only + - * / Math.sqrt Math.ceil (no Math.sin/cos/hypot/random), so the same input sequence gives
 * bit-identical results on every device. That is what lets multiplayer send inputs, not state.
 *
 * Collision model: the bug is one sphere. Contacts come from `surfaceDistance` (density / |gradient|),
 * never from the mesh. On a surface the bug crawls: see below.
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

/** How far a bug on a surface is pulled towards it each tick, to stay glued to slopes, bumps and edges. */
const SNAP = 0.3;
/** A surface this close counts as touching, without being pushed. */
const CONTACT_EPS = 0.03;
/** Largest move per substep, as a fraction of the radius (prevents tunnelling through thin walls). */
const MAX_SUBSTEP = 0.35;
const MAX_SUBSTEPS = 8;
const RESOLVE_ITERS = 4;
/**
 * Crawling: every bug walks on any surface, up and down walls and under overhangs, as real ones do. While it holds
 * on (`grounded`), it keeps to the surface's normal, whatever way that points: its facing (horizontal) turns with
 * the surface into a heading along it (facing a wall is up it, facing away from one is down it). Walking into
 * another surface (a wall, a ledge's underside, the floor at a wall's foot) takes it over onto that one; over an
 * edge it goes round. Only a jump, a push (an explosion) or the surface's disappearance makes it fall.
 */
/** Speed while on a surface too steep to stand on, as a fraction of the walking speed. */
const CLIMB_FACTOR = 0.75;
/** How squarely (cosine) a bug must walk into a surface to go over onto it; at a flatter angle it slides along. */
const TAKE_OVER = -0.45;
/** Surfaces that hang over more than this (normal Y below it) carry the heading along instead of taking it from the facing. */
const CEILING_NY = -0.8;
/** Aiming: level ground up to this steep (normal Y) aims by the world; from the second on, wholly by the surface. */
const AIM_LEVEL_NY = 0.94;
const AIM_SURFACE_NY = 0.64;
/** How near the world's sides (and, under things, its bottom) a crawling bug goes. */
const EDGE = 2.4;
/** Falling, a bug that is walking forward into a wall catches hold of it, unless it falls faster than this. */
const CATCH_SPEED = 18;

export interface BugInput {
  /** +1 forward, -1 backward. */
  move: -1 | 0 | 1;
  /** +1 turn right (clockwise seen from above) at full rate, -1 turn left; in between: slower. */
  turn: number;
  jump: boolean;
  /** Run instead of walk (forward and back). */
  run?: boolean;
  /**
   * Face this horizontal direction (any length) before moving; (0, 0) or absent: keep the facing. When
   * given, `turn` is ignored (the facing already includes it).
   */
  faceX?: number;
  faceZ?: number;
}

export const IDLE: Readonly<BugInput> = Object.freeze({ move: 0, turn: 0, jump: false, run: false, faceX: 0, faceZ: 0 });

// Scratch buffers: no allocations per tick.
const n = new Float64Array(3);
const contact = new Float64Array(3);
/** Which contact `resolve` keeps: the one whose normal is nearest this direction. */
const prefer = new Float64Array(3);
/** Which way the bug is moving (unit), and the contact it moves into most squarely (from `resolve`). */
const going = new Float64Array(3);
const ahead = new Float64Array(3);
let aheadDot = 0;
/** Contacts a bug can stand on push it straight up (else along their normal, like the others). */
let pushUp = true;

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
  /** Heading: the facing turned along the surface (unit; equal to the facing on level ground and in the air). */
  hx = 0;
  hy = 0;
  hz = 1;
  /** On a surface (of any slope), not falling. */
  grounded = false;
  /** The surface's normal, valid while grounded. */
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
  /** Hanging under a ceiling (see `turnHeading`). */
  private hung = false;

  constructor(readonly species: BugSpecies) {}

  /**
   * Drop the bug from the top of the world (or from `fromY`) onto the first surface below (x, z), facing
   * the map centre. Returns false if there is no ground under that column, if `fromY` is not in open air
   * (room for the bug), or if, dropped from `fromY`, it would land right under the top of the world.
   */
  drop(field: TerrainField, x: number, z: number, fromY = field.H - 1): boolean {
    const top = fromY;
    const r = this.species.radius;
    if (top < field.H - 1 && field.sample(x, top, z) <= r * 1.5) return false;
    const t = field.raycast(x, top, z, 0, -1, 0);
    if (t < 0) return false;
    // (the bug lands below its starting point, and not on a ledge right under the top of the world)
    if (top < field.H - 1 && (t < r * 1.5 || top - t > field.H - 5)) return false;
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

    const f0x = this.fx;
    const f0z = this.fz;
    const faceX = input.faceX ?? 0;
    const faceZ = input.faceZ ?? 0;
    const faceL = Math.sqrt(faceX * faceX + faceZ * faceZ);
    if (faceL > 1e-6) {
      this.fx = faceX / faceL;
      this.fz = faceZ / faceL;
    }
    // (a facing from the view wins over the turn keys: the view already turned with them)
    if (input.turn !== 0 && faceL <= 1e-6) this.rotate(-input.turn * sp.turnRate * DT);

    const wasGrounded = this.grounded;
    this.turnHeading(f0x, f0z);

    let stick = false;
    let fallSpeed = 0;
    const n0x = this.nx;
    const n0y = this.ny;
    const n0z = this.nz;
    if (this.grounded && input.jump) {
      if (this.ny >= WALKABLE_NY) {
        this.vx = this.fx * sp.jumpForward;
        this.vy = sp.jumpSpeed;
        this.vz = this.fz * sp.jumpForward;
      } else {
        // off a wall: away from it and up (off a ceiling: just down)
        const up = this.ny > -0.2 ? sp.jumpSpeed * 0.7 : 0;
        this.vx = this.nx * sp.jumpForward;
        this.vy = this.ny * sp.jumpForward + up;
        this.vz = this.nz * sp.jumpForward;
      }
      this.grounded = false;
    } else if (this.grounded) {
      const walk = input.run ? sp.walkSpeed * RUN_FACTOR : sp.walkSpeed;
      const v = (input.move > 0 ? walk : input.move < 0 ? -walk * WALK_BACK_FACTOR : 0) * (this.ny < WALKABLE_NY ? CLIMB_FACTOR : 1);
      this.vx = this.hx * v;
      this.vy = this.hy * v;
      this.vz = this.hz * v;
      stick = true;
    } else {
      this.vy -= GRAVITY * DT;
      if (this.vy < -MAX_FALL_SPEED) this.vy = -MAX_FALL_SPEED;
      fallSpeed = -this.vy;
    }

    // Which way it goes, and which of several contacts counts as the one it is on.
    const sign = input.move < 0 ? -1 : 1;
    going[0] = stick ? this.hx * sign : this.fx;
    going[1] = stick ? this.hy * sign : 0;
    going[2] = stick ? this.hz * sign : this.fz;
    pushUp = !stick || this.ny >= WALKABLE_NY;
    prefer[0] = stick ? this.nx : 0;
    prefer[1] = stick ? this.ny : 1;
    prefer[2] = stick ? this.nz : 0;

    // Integrate in substeps short enough not to skip through walls.
    const dx = this.vx * DT;
    const dy = this.vy * DT;
    const dz = this.vz * DT;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxStep = sp.radius * MAX_SUBSTEP;
    let steps = len > maxStep ? Math.ceil(len / maxStep) : 1;
    if (steps > MAX_SUBSTEPS) steps = MAX_SUBSTEPS;
    let touched = false;
    let groundNy = -2;
    aheadDot = 0;
    for (let s = 0; s < steps; s++) {
      this.x += dx / steps;
      this.y += dy / steps;
      this.z += dz / steps;
      if (this.resolve(field)) {
        touched = true;
        if (contact[1] > groundNy) groundNy = contact[1];
        if (stick) this.setNormal();
      }
    }

    if (stick) {
      // walked into another surface: over onto it
      if (input.move !== 0 && aheadDot < TAKE_OVER) {
        this.nx = ahead[0];
        this.ny = ahead[1];
        this.nz = ahead[2];
      }
      this.grounded = this.holdOn(field, touched, n0x, n0y, n0z);
      // (the outer layers of the world are no ground: a crawling bug turns back at them, it does not fall off)
      if (input.move !== 0 && (this.x < EDGE || this.z < EDGE || this.x > field.W - EDGE || this.z > field.D - EDGE || (this.y < EDGE && this.ny < 0))) {
        this.x = this.px;
        this.y = this.py;
        this.z = this.pz;
        this.nx = n0x;
        this.ny = n0y;
        this.nz = n0z;
        this.grounded = true;
      }
    } else if (touched) {
      if (groundNy >= WALKABLE_NY && this.vy <= 0.001) {
        // landed
        this.setNormal();
        this.grounded = true;
      } else if (wasGrounded === false && input.move > 0 && aheadDot < TAKE_OVER && fallSpeed < CATCH_SPEED) {
        // falling (or jumping) against a wall it walks into: it catches hold
        this.nx = ahead[0];
        this.ny = ahead[1];
        this.nz = ahead[2];
        this.grounded = true;
      }
      if (this.grounded) {
        this.lastImpact = fallSpeed > 0 ? fallSpeed : 0;
        this.justLanded = true;
        this.vx = this.vy = this.vz = 0;
      }
    }
    if (this.grounded) this.airTicks = 0;
    else this.airTicks++;

    if (this.y < KILL_Y) this.alive = false;
  }

  private setNormal(): void {
    this.nx = contact[0];
    this.ny = contact[1];
    this.nz = contact[2];
  }

  /**
   * Turn the facing along the surface into the heading. On anything but a ceiling: the facing turned by the least
   * turn that takes the vertical to the surface's normal, so facing a wall is up, away from it down, along it level.
   * Under a ceiling that turn is not defined: the heading is carried along, turned as much as the facing turned
   * since (f0x, f0z), and the facing is taken back from it on the way out.
   */
  private turnHeading(f0x: number, f0z: number): void {
    if (!this.grounded) {
      this.hx = this.fx;
      this.hy = 0;
      this.hz = this.fz;
      this.hung = false;
      return;
    }
    const { nx, ny, nz } = this;
    if (ny > CEILING_NY) {
      if (this.hung) {
        // out from under a ceiling: face where it is heading
        this.hung = false;
        const on = this.hx * nx + this.hy * ny + this.hz * nz;
        const tx = this.hx - nx * on;
        const ty = this.hy - ny * on;
        const tz = this.hz - nz * on;
        const k = ty / (1 + ny);
        const gx = tx - k * nx;
        const gz = tz - k * nz;
        const gl = Math.sqrt(gx * gx + gz * gz);
        if (gl > 1e-6) {
          this.fx = gx / gl;
          this.fz = gz / gl;
        }
      }
      const k = (this.fx * nx + this.fz * nz) / (1 + ny);
      this.hx = this.fx - k * nx;
      this.hy = -k * (1 + ny);
      this.hz = this.fz - k * nz;
    } else {
      this.hung = true;
      const c = this.fx * f0x + this.fz * f0z;
      const s = this.fx * f0z - this.fz * f0x;
      const ox = this.hx;
      const oy = this.hy;
      const oz = this.hz;
      this.hx = ox * c + (ny * oz - nz * oy) * s;
      this.hy = oy * c + (nz * ox - nx * oz) * s;
      this.hz = oz * c + (nx * oy - ny * ox) * s;
      const on = this.hx * nx + this.hy * ny + this.hz * nz;
      this.hx -= nx * on;
      this.hy -= ny * on;
      this.hz -= nz * on;
    }
    const l = Math.sqrt(this.hx * this.hx + this.hy * this.hy + this.hz * this.hz);
    if (l > 1e-6) {
      this.hx /= l;
      this.hy /= l;
      this.hz /= l;
    } else {
      this.hx = this.fx;
      this.hy = 0;
      this.hz = this.fz;
    }
  }

  /**
   * Stay on the surface. On one it can stand on: pull straight down (so it does not creep down a slope) and keep the
   * contact. On a steeper one, or past an edge: touching, it stays as it is; off it by a little (a surface that curves
   * away), it closes exactly that gap, along the way to the nearest point, so it goes round edges without slipping.
   * Further off than that (and nothing found back along the surface it was on, normal n0): false, it falls.
   */
  private holdOn(field: TerrainField, touching: boolean, n0x: number, n0y: number, n0z: number): boolean {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    prefer[0] = this.nx;
    prefer[1] = this.ny;
    prefer[2] = this.nz;
    if (this.ny >= WALKABLE_NY) {
      pushUp = true;
      this.y -= SNAP;
      if (this.resolve(field) && contact[1] >= WALKABLE_NY) {
        this.setNormal();
        return true;
      }
      this.x = x;
      this.y = y;
      this.z = z;
    }
    pushUp = false;
    if (touching && this.ny < WALKABLE_NY) return true;
    const r = this.species.radius;
    for (let k = 0; k <= 3; k++) {
      // (from where it is; then further in along the surface it was on, and a little back the way it came)
      this.x = x - n0x * SNAP * k - going[0] * 0.08 * k;
      this.y = y - n0y * SNAP * k - going[1] * 0.08 * k;
      this.z = z - n0z * SNAP * k - going[2] * 0.08 * k;
      const gap = surfaceDistance(field, this.x, this.y, this.z, n) - r;
      if (gap > SNAP * 1.2) continue;
      if (gap > 0) {
        this.x -= n[0] * gap;
        this.y -= n[1] * gap;
        this.z -= n[2] * gap;
        contact[0] = n[0];
        contact[1] = n[1];
        contact[2] = n[2];
      } else this.resolve(field);
      this.setNormal();
      return true;
    }
    this.x = x;
    this.y = y;
    this.z = z;
    return false;
  }

  /** Throw the bug (explosion knockback): adds to its velocity and makes it airborne. */
  push(vx: number, vy: number, vz: number): void {
    if (!this.alive) return;
    this.vx += vx;
    this.vy += vy;
    this.vz += vz;
    this.grounded = false;
  }

  /**
   * A direction in the bug's own frame: `along` its front, `out` away from what it stands on (a unit vector in the
   * plane of the two). On level and gently sloping ground, and in the air, that is the world's level and up; on
   * a steep surface (a wall, a ceiling) it is the surface's, easing from one to the other in between.
   */
  direction(along: number, out: number, dir: Float64Array): Float64Array {
    let ux = 0;
    let uy = 1;
    let uz = 0;
    let hx = this.fx;
    let hy = 0;
    let hz = this.fz;
    if (this.grounded && this.ny < AIM_LEVEL_NY) {
      const t = this.ny <= AIM_SURFACE_NY ? 1 : (AIM_LEVEL_NY - this.ny) / (AIM_LEVEL_NY - AIM_SURFACE_NY);
      ux = this.nx * t;
      uy = 1 - t + this.ny * t;
      uz = this.nz * t;
      const l = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= l;
      uy /= l;
      uz /= l;
      if (uy > CEILING_NY) {
        const k = (this.fx * ux + this.fz * uz) / (1 + uy);
        hx = this.fx - k * ux;
        hy = -k * (1 + uy);
        hz = this.fz - k * uz;
      } else {
        const on = this.hx * ux + this.hy * uy + this.hz * uz;
        hx = this.hx - ux * on;
        hy = this.hy - uy * on;
        hz = this.hz - uz * on;
      }
      const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
      hx /= hl;
      hy /= hl;
      hz /= hl;
    }
    dir[0] = hx * along + ux * out;
    dir[1] = hy * along + uy * out;
    dir[2] = hz * along + uz * out;
    return dir;
  }

  /** Move it (out of another bug's way): along the surface if it is on one, and never into the terrain. */
  shove(field: TerrainField, dx: number, dy: number, dz: number): void {
    const on = this.grounded ? dx * this.nx + dy * this.ny + dz * this.nz : 0;
    this.x += dx - this.nx * on;
    this.y += dy - this.ny * on;
    this.z += dz - this.nz * on;
    prefer[0] = this.grounded ? this.nx : 0;
    prefer[1] = this.grounded ? this.ny : 1;
    prefer[2] = this.grounded ? this.nz : 0;
    going[0] = going[1] = going[2] = 0;
    pushUp = !this.grounded || this.ny >= WALKABLE_NY;
    this.resolve(field);
  }

  /** True when standing still on the ground (or dead): nothing left to simulate for this bug. */
  get settled(): boolean {
    return !this.alive || (this.grounded && this.vx === 0 && this.vy === 0 && this.vz === 0);
  }

  /**
   * Push the sphere out of the terrain. Contacts it can stand on push straight up (so a bug standing on a slope
   * does not creep downhill); walls and ceilings push along their normal. Velocity into the surface is removed.
   * True if anything touches: the normal nearest `prefer` in `contact`, the one most against `going` in `ahead`.
   */
  private resolve(field: TerrainField): boolean {
    const r = this.species.radius;
    let best = -2;
    for (let it = 0; it < RESOLVE_ITERS; it++) {
      const d = surfaceDistance(field, this.x, this.y, this.z, n);
      if (d >= r + CONTACT_EPS) break;
      const like = n[0] * prefer[0] + n[1] * prefer[1] + n[2] * prefer[2];
      if (like > best) {
        best = like;
        contact[0] = n[0];
        contact[1] = n[1];
        contact[2] = n[2];
      }
      const into = n[0] * going[0] + n[1] * going[1] + n[2] * going[2];
      if (into < aheadDot) {
        aheadDot = into;
        ahead[0] = n[0];
        ahead[1] = n[1];
        ahead[2] = n[2];
      }
      if (d >= r) break;
      const p = r - d;
      if (pushUp && n[1] >= WALKABLE_NY) {
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
    return best > -2;
  }

  /** Rotate the facing about +Y by `a` radians (counter-clockwise seen from above). */
  private rotate(a: number): void {
    // In (x, z) with y up, a rotation about +Y by a is a 2D rotation of (x, z) by -a.
    rotate2(this.fx, this.fz, -a);
    this.fx = rot[0];
    this.fz = rot[1];
  }
}
