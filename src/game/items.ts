import { Bug, DT, GRAVITY, IDLE, KILL_Y, type BugInput } from './bug';
import type { TerrainField } from './field';
import { dropNear } from './spawn';
import { ANT } from './species';

/** What a box may hold (see `Match.take`). */
export const ITEM_KINDS = ['battery', 'patch', 'fuse', 'overclock', 'spring', 'paste', 'crystal', 'magnet', 'scrap', 'dud'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** How often each turns up, against the others. */
const ODDS: Readonly<Record<ItemKind, number>> = { battery: 5, patch: 5, fuse: 3, overclock: 4, spring: 3, paste: 3, crystal: 2, magnet: 2, scrap: 2, dud: 3 };

/** A box on the map, or on its way to it. What is in it shows when it is opened. */
export interface Item {
  readonly id: number;
  readonly kind: ItemKind;
  /** Who brings it: small ants on foot, or a bee that lets it fall. */
  readonly by: 'ants' | 'bee';
  /** Its middle. */
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Ticks until it is there (0: it is), and how long it took in all. */
  due: number;
  readonly trip: number;
  /** The ants' way to it, PATH_STEP numbers a tick (place and normal); empty for a bee. */
  readonly path: readonly number[];
  /** It lies on something. */
  resting: boolean;
}

/** Half the size of a box. */
export const BOX = 0.62;
/** Numbers a tick in the ants' way. */
export const WAY_STEP = 6;
/** No more than this many on a map; how likely one sets out at the start of a turn. */
const MOST = 8;
const CHANCE = 0.9;
/** How often it comes down near a bug, and how near. */
const BY_BUG = 0.75;
const BUG_NEAR = 8;
const BUG_FAR = 30;
/** From this turn on. */
const FIRST_TURN = 2;
const TRIP_ANTS = 260;
const TRIP_BEE = 170;
/** How high a bee lets go. */
const BEE_HIGH = 20;
/** Boxes lie this far apart, and from the edge of the map. */
const APART = 9;
const EDGE = 10;
const TRIES = 30;
/** Ticks between two looks at what a box lies on. */
const LOOK = 6;

const walk: BugInput = { move: 1, turn: 0, jump: false, run: false, faceX: 0, faceZ: 0 };
const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0.7071067811865476, 0.7071067811865476], [0, 1], [-0.7071067811865476, 0.7071067811865476], [-1, 0], [-0.7071067811865476, -0.7071067811865476], [0, -1], [0.7071067811865476, -0.7071067811865476]];

/** The boxes of a match: where they come from, how they fall. Deterministic from its own seed (the match's draws do not move). */
export class Items {
  readonly list: Item[] = [];
  private nextId = 1;

  constructor(
    private readonly field: TerrainField,
    private readonly rng: () => number,
    private readonly spawnLevels: boolean,
    private readonly confine: ((x: number, y: number, z: number) => boolean) | null,
  ) {}

  /** A turn starts: a box may set out (`bugs`: where there are any). Returns it, if one does. */
  turn(turnNumber: number, bugs: readonly Bug[] = []): Item | null {
    if (turnNumber < FIRST_TURN || this.list.length >= MOST || this.rng() > CHANCE) return null;
    const kind = this.draw();
    const ants = this.rng() < 0.55;
    for (let t = 0; t < TRIES; t++) {
      const b = this.ground(bugs);
      const way = DIRS[Math.floor(this.rng() * DIRS.length)];
      if (!b) continue;
      const path: number[] = [];
      if (ants) {
        // (small ants walk it there: whatever they can walk over, and end on something level)
        for (let n = 0; n < TRIP_ANTS && b.alive; n++) {
          walk.faceX = way[0];
          walk.faceZ = way[1];
          b.step(this.field, walk);
          if (!b.grounded && b.airTicks > 40) break;
          path.push(b.x, b.y, b.z, b.nx, b.ny, b.nz);
        }
        if (path.length < TRIP_ANTS * WAY_STEP || !b.grounded || b.ny < 0.8) continue;
      }
      if (b.ny < 0.8 || !this.free(b)) continue;
      const top = b.y + BOX - b.species.radius + 0.02;
      const item: Item = { id: this.nextId++, kind, by: ants ? 'ants' : 'bee', x: b.x, y: ants ? top : this.roomOver(b) + top, z: b.z, vy: 0, due: ants ? TRIP_ANTS : TRIP_BEE, trip: ants ? TRIP_ANTS : TRIP_BEE, path, resting: ants };
      this.list.push(item);
      return item;
    }
    return null;
  }

  /** One tick: those on their way come nearer; those in the air fall; what lost its ground falls. */
  step(tick: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      if (it.due > 0) {
        it.due--;
        continue;
      }
      if (it.resting) {
        if ((tick + it.id) % LOOK === 0 && this.field.raycast(it.x, it.y, it.z, 0, -1, 0, BOX + 0.6) < 0 && this.field.sample(it.x, it.y, it.z) > 0.3) it.resting = false;
        continue;
      }
      it.vy -= GRAVITY * DT;
      const drop = -it.vy * DT;
      const t = this.field.raycast(it.x, it.y, it.z, 0, -1, 0, drop + BOX);
      if (t >= 0 && t <= drop + BOX) {
        it.y -= t - BOX;
        it.vy = 0;
        it.resting = true;
      } else it.y -= drop;
      if (it.y < KILL_Y) this.list.splice(i, 1);
    }
  }

  /** The box a bug touches, if any. */
  touchedBy(b: Bug): Item | null {
    for (const it of this.list) {
      if (it.due > 0) continue;
      const r = b.species.radius + BOX + 0.35;
      const dx = b.x - it.x;
      const dy = b.y - it.y;
      const dz = b.z - it.z;
      if (dx * dx + dy * dy + dz * dz < r * r) return it;
    }
    return null;
  }

  /** The boxes within `r` of a place. */
  near(x: number, y: number, z: number, r: number): Item[] {
    return this.list.filter((it) => it.due === 0 && (it.x - x) * (it.x - x) + (it.y - y) * (it.y - y) + (it.z - z) * (it.z - z) < r * r);
  }

  remove(it: Item): void {
    this.list.splice(this.list.indexOf(it), 1);
  }

  private draw(): ItemKind {
    let sum = 0;
    for (const k of ITEM_KINDS) sum += ODDS[k];
    let at = this.rng() * sum;
    for (const k of ITEM_KINDS) {
      at -= ODDS[k];
      if (at < 0) return k;
    }
    return 'battery';
  }

  /** Somewhere a bug comes to rest. */
  private ground(bugs: readonly Bug[]): Bug | null {
    const { W, H, D } = this.field;
    const b = new Bug(ANT);
    b.confine = this.confine;
    let x = EDGE + this.rng() * (W - 2 * EDGE);
    let z = EDGE + this.rng() * (D - 2 * EDGE);
    let fromY = this.spawnLevels ? 4 + this.rng() * (H - 5) : H - 1;
    if (bugs.length > 0 && this.rng() < BY_BUG) {
      const o = bugs[Math.floor(this.rng() * bugs.length)];
      const way = DIRS[Math.floor(this.rng() * DIRS.length)];
      const far = BUG_NEAR + this.rng() * (BUG_FAR - BUG_NEAR);
      x = Math.max(EDGE, Math.min(W - EDGE, o.x + way[0] * far));
      z = Math.max(EDGE, Math.min(D - EDGE, o.z + way[1] * far));
      if (this.spawnLevels) fromY = Math.min(H - 1, o.y + 6);
    }
    if (!dropNear(b, this.field, x, z, fromY)) return null;
    for (let n = 0; n < 90 && b.alive && !b.settled; n++) b.step(this.field, IDLE);
    if (!b.alive || !b.grounded || b.ny < 0.64) return null;
    return this.confine && !this.confine(b.x, b.y, b.z) ? null : b;
  }

  private free(b: Bug): boolean {
    if (b.x < EDGE / 2 || b.z < EDGE / 2 || b.x > this.field.W - EDGE / 2 || b.z > this.field.D - EDGE / 2) return false;
    return this.list.every((it) => (it.x - b.x) * (it.x - b.x) + (it.z - b.z) * (it.z - b.z) > APART * APART);
  }

  /** How high above a place a bee can let go. */
  private roomOver(b: Bug): number {
    const t = this.field.raycast(b.x, b.y, b.z, 0, 1, 0, BEE_HIGH + 3);
    return t < 0 ? BEE_HIGH : Math.max(0, t - 3);
  }
}
