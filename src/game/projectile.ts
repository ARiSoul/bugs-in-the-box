import { DT, GRAVITY, KILL_Y, type Bug } from './bug';
import { surfaceDistance, type TerrainField } from './field';
import type { Weapon } from './weapons';

/** Collision radius of every projectile. */
export const PROJECTILE_RADIUS = 0.3;
/** The shooter cannot be hit by its own projectile during its first ticks (it starts next to it). */
const OWNER_GRACE_TICKS = 8;
/** Largest move per substep: keeps fast shells from skipping through thin walls. */
const MAX_SUBSTEP = 0.3;
const MAX_SUBSTEPS = 12;
/** A grenade slower than this after a bounce comes to rest. */
const REST_SPEED = 1.2;
/** Tangential speed kept after a bounce. */
const BOUNCE_FRICTION = 0.8;

export type ProjectileResult = 'fly' | 'explode' | 'lost';

const n = new Float64Array(3);

/** A flying shot. Same determinism rules as Bug: fixed tick, + - * / sqrt only. */
export class Projectile {
  x = 0;
  y = 0;
  z = 0;
  px = 0;
  py = 0;
  pz = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  age = 0;
  resting = false;

  constructor(
    readonly id: number,
    readonly weapon: Weapon,
    readonly owner: Bug | null,
  ) {}

  launch(x: number, y: number, z: number, vx: number, vy: number, vz: number): this {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.age = 0;
    this.resting = false;
    return this;
  }

  /**
   * Advance one tick under gravity and wind (wind is an acceleration). Shells explode on the first
   * contact with terrain or a bug; grenades bounce off terrain and explode when the fuse runs out.
   * On 'explode' the projectile sits at the explosion point.
   */
  step(field: TerrainField, windX: number, windZ: number, bugs: readonly Bug[]): ProjectileResult {
    const w = this.weapon;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.age++;
    if (w.kind === 'grenade' && this.age >= w.fuseTicks) return 'explode';

    this.vx += windX * w.windFactor * DT;
    this.vy -= GRAVITY * DT;
    this.vz += windZ * w.windFactor * DT;

    const dx = this.vx * DT;
    const dy = this.vy * DT;
    const dz = this.vz * DT;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let steps = len > MAX_SUBSTEP ? Math.ceil(len / MAX_SUBSTEP) : 1;
    if (steps > MAX_SUBSTEPS) steps = MAX_SUBSTEPS;
    for (let s = 0; s < steps; s++) {
      this.x += dx / steps;
      this.y += dy / steps;
      this.z += dz / steps;
      if (w.kind === 'shell') {
        if (field.sample(this.x, this.y, this.z) < PROJECTILE_RADIUS) return 'explode';
        if (this.hitsBug(bugs)) return 'explode';
      } else if (this.bounceOffTerrain(field)) {
        break; // velocity changed: finish this tick from the bounce point
      }
    }

    if (this.y < KILL_Y || this.x < -20 || this.z < -20 || this.x > field.W + 20 || this.z > field.D + 20) return 'lost';
    return 'fly';
  }

  private hitsBug(bugs: readonly Bug[]): boolean {
    for (const b of bugs) {
      if (!b.alive || (b === this.owner && this.age <= OWNER_GRACE_TICKS)) continue;
      const ex = b.x - this.x;
      const ey = b.y - this.y;
      const ez = b.z - this.z;
      const r = b.species.radius + PROJECTILE_RADIUS;
      if (ex * ex + ey * ey + ez * ez < r * r) return true;
    }
    return false;
  }

  /** Returns true if it touched the terrain (and bounced or came to rest). */
  private bounceOffTerrain(field: TerrainField): boolean {
    const d = surfaceDistance(field, this.x, this.y, this.z, n);
    if (d >= PROJECTILE_RADIUS) {
      this.resting = false;
      return false;
    }
    const p = PROJECTILE_RADIUS - d;
    this.x += n[0] * p;
    this.y += n[1] * p;
    this.z += n[2] * p;
    const vn = this.vx * n[0] + this.vy * n[1] + this.vz * n[2];
    if (vn < 0) {
      // split into normal and tangential parts: reflect the first, rub the second
      const tx = this.vx - n[0] * vn;
      const ty = this.vy - n[1] * vn;
      const tz = this.vz - n[2] * vn;
      const bn = -vn * this.weapon.bounce;
      this.vx = tx * BOUNCE_FRICTION + n[0] * bn;
      this.vy = ty * BOUNCE_FRICTION + n[1] * bn;
      this.vz = tz * BOUNCE_FRICTION + n[2] * bn;
    }
    const sp = this.vx * this.vx + this.vy * this.vy + this.vz * this.vz;
    if (sp < REST_SPEED * REST_SPEED) {
      this.vx = this.vy = this.vz = 0;
      this.resting = true;
    }
    return true;
  }
}
