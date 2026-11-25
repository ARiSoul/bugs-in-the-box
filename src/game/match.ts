import { createRng } from '../terrain/noise';
import { Bug, DT, IDLE, TICK_RATE, type BugInput } from './bug';
import { surfaceDistance, type TerrainField } from './field';
import { rot, rotate2 } from './math';
import { Projectile } from './projectile';
import { dropNear } from './spawn';
import { MARCHER, type BugSpecies } from './species';
import { before, bridgePieces, laid, PIECE, SPAN, SPANS, toPiece, WALL_DEEP, wallPieces, type Site } from './build';
import { Flock, layRings, type FlockInput, type Ring } from './flock';
import { KEPT, type Tag } from './actions';
import { BURN_HURTS, HONEY_TURNS, HONEY_WIDE, reaction, SMOTHERED, tagsOf } from './reactions';
import { levelAt, passive, type Growth, type Tally } from './progress';
import { BOX, ITEM_KINDS, Items, type Item, type ItemKind } from './items';
import { CATCHES, DUD, hasWeapon, SILK_CURTAIN, WORKS, RING_DAMAGE, WEAPONS, type Weapon } from './weapons';

/**
 * One match: teams of bugs taking turns on a destructible map. Pure and deterministic like Bug:
 * the whole match is a function of (map seed, match seed, the input of every tick). Multiplayer
 * only has to agree on those.
 *
 * Turn flow:
 *   aim     the active bug walks, jumps, aims, picks a weapon and fires (AIM_SECONDS)
 *   special (special attacks) the attack's scene plays; then back to aim, the bug in its stance: it turns and aims on
 *           the spot, charges and fires (the turn's clock stands still meanwhile)
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
/** What a shot did stays in view this long before the next turn: after damage, after a blast that hurt nobody. */
export const LOOK_DAMAGE_TICKS = Math.round(1.8 * TICK_RATE);
export const LOOK_BLAST_TICKS = TICK_RATE;
/** Holding fire fills the power bar in this many ticks; it fires by itself when full. */
export const CHARGE_TICKS = 72;
/** Projectiles leave at no less than this fraction of their full speed. */
export const MIN_POWER = 0.12;
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
  /** Smeared by this team, not spun: it holds every other team's bugs, spiders too (-1: a web). */
  readonly paste: number;
  /** Whose it is. */
  readonly team: number;
  /** Honey from a melted comb. */
  readonly honey?: boolean;
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

/** What stands on a turntable goes round with it, a quarter (+x to +z). */
function turnPieces(p: number[], tt: TurntableSpec): void {
  for (let i = 0; i < p.length; i += PIECE) {
    const dx = p[i] - tt.x;
    const dz = p[i + 2] - tt.z;
    if (dx * dx + dz * dz > tt.radius * tt.radius || p[i + 1] < tt.j0 || p[i + 1] > tt.j1) continue;
    p[i] = tt.x - dz;
    p[i + 2] = tt.z + dx;
    for (const k of [3, 6]) {
      const x = p[i + k];
      p[i + k] = -p[i + k + 2];
      p[i + k + 2] = x;
    }
  }
}

/** Something built, and what of it burns (slot to how many more times its fire spreads). */
export interface Structure {
  readonly id: number;
  readonly team: number;
  readonly weapon: Weapon;
  readonly tags: readonly Tag[];
  readonly pieces: number[];
  readonly fire: Map<number, number>;
  /** Slots taken away (burnt), not blown up. */
  readonly gone: Set<number>;
}

export interface TeamSpec {
  /** Its level, passives and kept items (none: a first level). */
  readonly growth?: Growth;
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
  /** Its shell is whole: it takes the next blow that would kill it... */
  shell: boolean;
  /** ...and nothing more hurts it in that turn (its number; -1: never yet). */
  shellTurn: number;
  /** From boxes: a fuse that halves the next blow; its next shot hurts more; turns left on springs; seconds its next turn has more. */
  fuse: boolean;
  boost: boolean;
  spring: number;
  extra: number;
  /** It hides (until its next turn): in which shelter, and how much that still keeps off. */
  cover: Weapon | null;
  coverLeft: number;
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
  /** In a stance: raise the aim by this much (radians; the view's, while the player turns it). */
  pitch?: number;
  /** In a brood's stance: the spot under the player's pointer. */
  mark?: readonly [number, number, number] | null;
  /**
   * Put what is picked (a wall, a bridge, a shelter) there: a place on a surface, and a way: what a wall faces, from a
   * bridge's near end to its far one (as long as it is to be).
   */
  place?: Place | null;
  /** Use an item the team keeps (an index into ITEM_KINDS, -1 or nothing: none). */
  item?: number;
}

export type Place = readonly [number, number, number, number, number, number];
/** Why something cannot be put somewhere. */
export type NoPlace = '' | 'too far' | 'no ground' | 'no room' | 'once a turn' | 'too short' | 'no way there' | 'nothing to bridge';

export const NO_INPUT: Readonly<MatchInput> = Object.freeze({ move: 0, turn: 0, faceX: 0, faceZ: 0, jump: false, run: false, aim: 0, fire: false, weapon: -1 });

export type MatchEvent =
  | { type: 'turn'; unit: number }
  | { type: 'special'; unit: number; weapon: string }
  | { type: 'fire'; unit: number; weapon: string }
  | { type: 'explosion'; x: number; y: number; z: number; radius: number }
  | { type: 'arc'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }
  | { type: 'dig'; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; radius: number }
  | { type: 'arrow'; x: number; y: number; z: number; dx: number; dy: number; dz: number; unit: number }
  | { type: 'swarm'; unit: number }
  | { type: 'collapse'; x: number; y: number; z: number; unit: number }
  | { type: 'cover'; x: number; y: number; z: number; units: readonly number[] }
  | { type: 'lights'; x: number; y: number; z: number; units: readonly number[] }
  | { type: 'shell'; unit: number }
  | { type: 'skill'; team: number }
  | { type: 'web'; id: number }
  | { type: 'stuck'; unit: number }
  | { type: 'webGone'; id: number; torn: boolean }
  | { type: 'damage'; unit: number; amount: number }
  | { type: 'death'; unit: number }
  | { type: 'ring'; index: number; x: number; y: number; z: number }
  | { type: 'sting'; x: number; y: number; z: number; unit: number; rings: number }
  | { type: 'box'; id: number }
  | { type: 'open'; unit: number; kind: ItemKind; x: number; y: number; z: number; id: number; gain: number; kept: boolean }
  | { type: 'burning'; build: number; slot: number; x: number; y: number; z: number; high: number }
  | { type: 'fireOut'; build: number; slot: number }
  | { type: 'pieceGone'; build: number; slot: number; upper: boolean; x: number; y: number; z: number; burnt: boolean }
  | { type: 'worn'; build: number; x: number; y: number; z: number; radius: number; word: string }
  | { type: 'regrown'; build: number; slot: number; gone: readonly number[]; x: number; y: number; z: number }
  | { type: 'conducts'; x: number; y: number; z: number }
  | { type: 'tired'; x: number; y: number; z: number }
  | { type: 'burst'; unit: number }
  | { type: 'heal'; unit: number; amount: number }
  | { type: 'use'; unit: number; kind: ItemKind; gain: number }
  | { type: 'boxGone'; id: number; x: number; y: number; z: number }
  | { type: 'fuse'; unit: number }
  | { type: 'built'; build: number; unit: number; weapon: string; pieces: readonly number[] }
  | { type: 'noRoom'; unit: number }
  | { type: 'hide'; unit: number; weapon: string }
  | { type: 'bared'; unit: number; broken: boolean }
  | { type: 'caught'; x: number; y: number; z: number }
  | { type: 'over'; winner: number };

/** An ant column marches this long at full power, swarms a bug this long, biting this many times this hard. */
export const MARCH_TICKS = 6 * TICK_RATE;
export const SWARM_TICKS = Math.round(3.1 * TICK_RATE);
const SWARM_BITES = 8;
const SWARM_BITE = 7;
/** How near its head comes to an enemy before the column swarms it. */
const SWARM_REACH = 1.5;
/** Numbers per tick in a column's path: place, normal, heading. */
export const PATH_STEP = 9;

/** An ant column on its way (Ant Column). */
export interface Column {
  /** What leads it. */
  readonly head: Bug;
  /** Every tick of the head so far: x, y, z, its normal, its heading. */
  readonly path: number[];
  /** Ticks of march left; ticks into the swarm; ticks without getting on. */
  left: number;
  swarm: number;
  still: number;
  /** The unit it swarms (-1: none yet). */
  victim: number;
}

/** A brood called in the dark: ticks until it covers the mark, between bites, until the light is back; its bites. */
export const BROOD_COVER = 108;
const BROOD_BITES = 6;
const BROOD_BITE_TICKS = 14;
export const BROOD_LIGHT = 216;
/** The damage at the edge of what a brood covers, as a fraction of the full one; how it throws them as it flees. */
const BROOD_EDGE = 0.4;
const BROOD_THROW = 5;

/**
 * The skill loader: a team's special attack must be loaded (to SKILL_FULL) before it can be used, and using it empties
 * it. It loads at every turn of the team, with the damage it does (not by the special itself) and takes.
 */
export const SKILL_FULL = 1000;
const SKILL_TURN = 200;
/** Ticks a burst hardly falls. */
const BURST_TICKS = 50;
const SKILL_DONE = 2.5;
const SKILL_TAKEN = 1.8;

/** A place on a surface: where, and its normal. */
export interface Mark {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

/** A brood on its way to the mark, and over it (Blackout Swarm). */
export interface Brood {
  readonly at: Mark;
  ticks: number;
  /** The units it covers, and each one's damage in all (set when it arrives). */
  readonly units: number[];
  readonly harm: number[];
}

/** How long a special attack's hit is looked at before the turn goes on. */
export const LINGER_TICKS = Math.round(4.5 * TICK_RATE);
/** In a stance, turning and aiming are this much slower (the view is close, the aim fine)... */
const STANCE_RATE = 0.4;
/** ...and the view turns the aim at most this much in a tick. */
const PITCH_MAX = 0.06;
/** Boxes: how much a battery loads, a patch heals (of the full health, and how far over it), a crystal adds (seconds); an overclocked shot's damage; a spring's jump; a magnet's reach. */
const BATTERY = 400;
const PATCH = 0.35;
const PATCH_OVER = 0.15;
const CRYSTAL = 15;
const OVERCLOCK = 1.5;
const SPRING = 1.42;
const MAGNET = 45;
const PASTE = WEAPONS.findIndex((w) => w.kind === 'trap');
const WEB = WEAPONS.findIndex((w) => w.kind === 'web');
/** After hiding there is a moment to see it (ticks). */
const HIDE_TICKS = 70;
/** Hiding loads the special attack a little. */
const SKILL_HIDE = 120;
/** A curtain catches a shot this near to it. */
const CURTAIN_NEAR = 0.45;
/** A caught shot counts as this much kept off. */
const CAUGHT_WORTH = 20;
/** A warm nest reaches this far. */
const BESIDE = 6;
const near = new Float64Array(3);
const site: Site = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, fx: 1, fy: 0, fz: 0 };
/** A bug walks at most this long to where it hides (ticks), and is there this near to it. */
const GO_TICKS = 240;
const placed = (w: Weapon): boolean => w.kind === 'wall' || w.kind === 'bridge' || w.kind === 'shelter';
const GO_NEAR = 0.9;
const goInput: BugInput = { move: 1, turn: 0, jump: false, run: true, faceX: 0, faceZ: 0 };
/** A bug keeps this much room from what is built. */
const BUILD_ROOM = 0.15;
const COS45 = 0.7071067811865476;
const aimed = new Float64Array(3);
/** How near two bugs' centres come, as a fraction of their radii together (nose to tail their bodies are longer than their spheres). */
const BODY = 1.15;
/** A bug that comes down on another slides off it at this speed. */
const SLIDE_OFF = 3;
const flying: FlockInput = { turn: 0, up: 0, faceX: 0, faceZ: 0, pitch: 0 };
const foes: Bug[] = [];
const bugInput: BugInput = { move: 0, turn: 0, jump: false, run: false, faceX: 0, faceZ: 0 };

/** Fraction of the full rate after holding a key for `held` ticks (see RAMP_START). */
function ramp(held: number): number {
  return held >= RAMP_TICKS ? 1 : RAMP_START + ((1 - RAMP_START) * held) / RAMP_TICKS;
}

/** How much of a blast's damage a bug takes (0..1): it falls off linearly to BLAST_REACH radii. */
export function blastShare(b: Bug, x: number, y: number, z: number, w: Weapon): number {
  const dx = b.x - x;
  const dy = b.y - y;
  const dz = b.z - z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - b.species.radius;
  const reach = w.blastRadius * BLAST_REACH;
  return d >= reach ? 0 : d <= 0 ? 1 : 1 - d / reach;
}

export interface MatchOptions {
  /** Seconds a turn lasts (default AIM_TICKS). */
  turnSeconds?: number;
  /** How strong the wind may blow, against WIND_MAX (default 1; 0: none). */
  wind?: number;
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
  /** Spaces each team has for items it keeps (0: whatever is in a box takes effect at once). */
  bag?: number;
  /** The quarter turns it has made before this match (a map that an earlier match was fought on). */
  turned?: number;
  /** Boxes turn up on the map (default true; not where the tests place the bugs). */
  items?: boolean;
  /** Where a bug may spawn, stand and walk: it turns back at the limit (default: the whole map). Pure. */
  confine?: (x: number, y: number, z: number) => boolean;
}

export class Match {
  readonly units: Unit[] = [];
  readonly projectiles: Projectile[] = [];
  readonly webs: Web[] = [];
  /** The ant column on its way, if any. */
  column: Column | null = null;
  /** The brood on its way, if any, and the spot marked for one. */
  brood: Brood | null = null;
  mark: Mark | null = null;
  /** The swarm a player flies, if any, and the rings laid out for it. */
  flock: Flock | null = null;
  rings: Ring[] = [];
  /** How far each team's special attack is loaded (0..SKILL_FULL). */
  readonly skill: number[];
  /** The boxes on the map. */
  readonly items: Items;
  /** Uses left of what each team found (by weapon index). */
  readonly stock: number[][];
  /** How often each team may still build or hide, whatever kind. */
  readonly works: number[];
  /** The items each team keeps, and whether one was used this turn. */
  readonly bag: Partial<Record<ItemKind, number>>[];
  usedItem = false;
  /** What each team did (for its experience). */
  readonly tally: Tally[];
  /** What stands that bugs built. */
  readonly structures: Structure[] = [];
  /** What of each team's holds enemies that touch it, and how much they slow down. */
  private readonly sticky: { readonly team: number; readonly pieces: number[]; readonly slow: number }[] = [];
  /** Builds in one turn that a team may still do once more; whose shell grew back; whether the active bee stung. */
  private readonly again: number[];
  private readonly regrown = new Set<number>();
  private stung = false;
  private builtOnce = false;
  /** The turn a burst was used in; who lands softly. */
  private burstTurn = -1;
  private readonly soft = new Set<number>();
  /** How much of its bite the swarm on its way still has. */
  private tired = 1;
  /** The active bug is on its way to hide: where, in what, and how long it may still take. */
  going: { x: number; y: number; z: number; w: Weapon; left: number } | null = null;
  /** Curtains of silk that still catch shots of other teams: how many. */
  readonly curtains: { readonly team: number; readonly pieces: number[]; left: number }[] = [];
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
  /** The weapon each team last picked (not a special attack): its next turn starts with it. */
  readonly kept: number[];
  charging = false;
  /** Something was built this turn. */
  built = false;
  /** Ticks left of a special attack's scene. */
  specialTicks = 0;
  /** The active bug stands ready with its special attack: it aims on the spot. */
  stance = false;
  /** Ticks left to look at where a special attack hit. */
  lingerTicks = 0;
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
  /** How much harder the shot on its way hurts (an overclocked one). */
  private hard = 1;
  /** Draws for the boxes: their own, so the winds stay the same. */
  private readonly luck: () => number;
  /** Ticks left to look at what the shot did. */
  private lookTicks = 0;
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
        this.units.push({ id: id++, team: t, name: `${teams[t].species.id} ${i + 1}`, bug, aimH: COS45, aimV: COS45, dead: false, web: -1, shell: teams[t].species.shell === true, shellTurn: -1, fuse: false, boost: false, spring: 0, extra: 0, cover: null, coverLeft: 0 });
        this.bugs.push(bug);
      }
    this.nextInTeam = teams.map(() => 0);
    this.kept = teams.map(() => 0);
    this.quarterTurns = options.turned ?? 0;
    this.luck = createRng(seed * 1597334677 + 411);
    this.items = new Items(field, this.luck, options.spawnLevels === true, options.confine ?? null);
    this.stock = teams.map((t) => WEAPONS.map((w) => (w.species === undefined || w.species === t.species.id ? (w.start ?? 0) : 0)));
    this.works = teams.map(() => WORKS);
    this.bag = teams.map((t) => ({ ...t.growth?.items }));
    this.tally = teams.map(() => ({ damage: 0, kills: 0, blocked: 0, boxes: 0 }));
    this.again = teams.map((t) => (t.growth?.passives.includes('many-hands') ? 1 : 0));
    this.skill = teams.map(() => 0);
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

    if (this.lookTicks > 0) this.lookTicks--;

    let move: Readonly<BugInput> = IDLE;
    if (this.phase === 'aim') {
      move = this.aimTick(unit, input, fireDown);
    } else if (this.phase === 'flight') {
      if (this.retreatTicks > 0) {
        this.retreatTicks--;
        if (!unit.cover) move = this.movement(input);
        // (getting away: its slot throws it at once)
        if (input.weapon >= 0 && WEAPONS[input.weapon]?.kind === 'burst' && this.has(unit, input.weapon) && !unit.cover) this.burst(unit);
      }
      if (this.column) this.columnTick(this.column, unit, input);
      else if (this.brood) this.broodTick(this.brood, unit);
      else if (this.flock) this.flockTick(this.flock, unit, input);
      else if (this.lingerTicks > 0) {
        // (a special attack's hit is looked at first; then the shooter may walk away)
        if (--this.lingerTicks === 0) this.retreatTicks = RETREAT_TICKS;
      } else if (this.projectiles.length === 0 && this.retreatTicks === 0) this.startSettle();
    } else if (this.phase === 'special') {
      if (!unit.bug.alive) this.endAim();
      else if (!unit.bug.grounded || (input.weapon >= 0 && input.weapon !== this.weapon && input.weapon < WEAPONS.length && this.canUse(unit, input.weapon))) {
        // (called off: another weapon, or it lost its footing)
        this.phase = 'aim';
        this.leaveStance();
        if (input.weapon >= 0 && this.canUse(unit, input.weapon)) this.weapon = input.weapon;
        if (this.currentWeapon.sceneTicks === 0) this.kept[unit.team] = this.weapon;
      } else if (--this.specialTicks <= 0) {
        this.phase = 'aim';
        this.stance = true;
      }
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
      if (b.justLanded && this.soft.delete(u.id)) {
        // (it meant to)
        b.floating = 0;
      } else if (b.justLanded && b.lastImpact > FALL_SAFE_SPEED && !this.passive(u.team, 'light-feet')) this.damage(u, Math.round((b.lastImpact - FALL_SAFE_SPEED) * FALL_DAMAGE));
      if (!b.alive && !u.dead) this.announceDeath(u);
      // (its hold is gone: so is its shelter)
      else if (u.cover && !b.grounded && b.airTicks > 6) this.bare(u, true);
    }
    this.sting(unit);
    if (this.phase !== 'spin') this.keepApart();
    if (this.phase !== 'spin') this.boxes();
    // (whose turn it is now: it may just have passed on from one that died)
    if (this.phase === 'aim' && !this.units[this.active].bug.alive) this.endAim();

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      const r = p.step(this.field, this.windX, this.windZ, this.bugs, this.options.strictBounds === true);
      if (this.caught(p)) {
        this.projectiles.splice(i--, 1);
        continue;
      }
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
    if (!this.charging && input.weapon >= 0 && input.weapon < WEAPONS.length && this.canUse(unit, input.weapon)) {
      this.weapon = input.weapon;
      if (this.currentWeapon.sceneTicks === 0) {
        this.stance = false;
        if (!this.currentWeapon.start) this.kept[unit.team] = this.weapon;
      }
    }
    // a special attack begins as soon as it is picked
    if (this.currentWeapon.sceneTicks > 0 && !this.stance && unit.bug.grounded) {
      this.phase = 'special';
      this.specialTicks = this.currentWeapon.sceneTicks;
      if (this.currentWeapon.kind === 'flock') this.layOut(unit);
      this.events.push({ type: 'special', unit: unit.id, weapon: this.currentWeapon.id });
      return IDLE;
    }
    if (this.stance && !unit.bug.grounded) this.leaveStance();
    if (this.stance && input.pitch) this.tilt(unit, input.pitch > PITCH_MAX ? PITCH_MAX : input.pitch < -PITCH_MAX ? -PITCH_MAX : input.pitch);
    if (input.aim !== 0) this.tilt(unit, input.aim * AIM_RATE * ramp(this.aimHeld) * DT * (this.stance ? STANCE_RATE : 1));
    this.turnTicks--;
    if (input.item !== undefined && input.item >= 0 && input.item < ITEM_KINDS.length && !this.charging) this.useItem(unit, ITEM_KINDS[input.item]);
    const w = this.currentWeapon;
    if (this.going) {
      if (input.weapon >= 0 || input.jump || (fireDown && this.going.left < GO_TICKS - 1)) this.going = null;
      else return this.goHide(unit);
    }
    if (input.place && !this.charging && unit.bug.grounded && placed(w)) {
      this.putAt(unit, w, input.place);
      return this.going ? this.goHide(unit) : IDLE;
    }
    if (this.stance && w.kind === 'brood' && input.mark) this.setMark(unit, input.mark, w);
    if (this.charging) {
      if (input.fire) this.power += 1 / CHARGE_TICKS;
      if (!input.fire || this.power >= 1) {
        if (this.power > 1) this.power = 1;
        this.fire(unit, w);
      }
      return this.stance ? this.onTheSpot(input) : IDLE;
    }
    if (fireDown && w.kind === 'burst') {
      this.burst(unit);
      return IDLE;
    }
    if (fireDown && unit.bug.grounded) {
      if (w.kind === 'wall' || w.kind === 'bridge') this.build(unit, w);
      else if (w.kind === 'shelter') this.shelter(unit, w);
      else if (w.kind === 'tunnel' || w.kind === 'trap' || w.kind === 'flock' || (w.kind === 'brood' && this.mark)) this.fire(unit, w);
      else if (w.kind !== 'brood') {
        this.charging = true;
        this.power = 0;
      }
      return IDLE;
    }
    if (this.turnTicks <= 0) this.endAim();
    return this.stance ? this.onTheSpot(input) : this.movement(input);
  }

  /** Raise (or lower) the aim by `a` radians. */
  private tilt(unit: Unit, a: number): void {
    rotate2(unit.aimH, unit.aimV, a);
    if (rot[0] <= 0 && rot[1] > 0) {
      // straight up, and no further
      unit.aimH = 0;
      unit.aimV = 1;
    } else if (rot[1] >= AIM_MAX_DOWN) {
      unit.aimH = rot[0];
      unit.aimV = rot[1];
    }
  }

  /** In its stance a bug only turns. */
  private onTheSpot(input: Readonly<MatchInput>): Readonly<BugInput> {
    this.movement(input);
    bugInput.move = 0;
    bugInput.jump = false;
    bugInput.run = false;
    bugInput.turn *= STANCE_RATE;
    return bugInput;
  }

  private leaveStance(): void {
    this.stance = false;
    this.charging = false;
    if (this.currentWeapon.sceneTicks > 0) this.weapon = this.keptBy(this.activeUnit);
  }

  /** What a unit's team last picked, if it still has it. */
  private keptBy(u: Unit): number {
    if (!this.canUse(u, this.kept[u.team])) this.kept[u.team] = 0;
    return this.kept[u.team];
  }

  /** Whether the unit has weapon `index` (a special attack may still have to load). */
  has(u: Unit, index: number): boolean {
    return hasWeapon(u.bug.species.id, WEAPONS[index]) || this.usesLeft(u.team, index) > 0;
  }

  /** How often a team may still use what it has only some of. */
  usesLeft(team: number, index: number): number {
    const n = this.stock[team][index];
    const w = WEAPONS[index];
    return w.start === undefined || w.alone ? n : Math.min(n, this.works[team]);
  }

  /** Whether the unit can use weapon `index` now. */
  canUse(u: Unit, index: number): boolean {
    return this.has(u, index) && (WEAPONS[index].sceneTicks === 0 || this.skill[u.team] >= SKILL_FULL);
  }

  /** A team's passive: its number (1 where it has none), or 0: it is not in use. */
  passive(team: number, id: string): number {
    if (!this.teams[team].growth?.passives.includes(id)) return 0;
    return passive(id)?.value || 1;
  }

  /** Spaces for items. */
  spaces(team: number): number {
    return this.options.bag ?? levelAt(this.teams[team].growth?.level ?? 1).spaces + this.passive(team, 'carrier');
  }

  /** How far a brood of the active team covers. */
  get coverRadius(): number {
    return this.currentWeapon.coverRadius + this.passive(this.units[this.active].team, 'wider-swarm');
  }

  private heal(u: Unit, n: number): void {
    const b = u.bug;
    const gain = Math.min(n, b.species.health - b.health);
    if (!b.alive || b.health <= 0 || gain <= 0) return;
    b.health += gain;
    this.events.push({ type: 'heal', unit: u.id, amount: gain });
  }

  /** A bug stands on (or touches) something of another team's that holds: how much it slows, 1 if it does not. */
  private stuckTo(u: Unit): number {
    const b = u.bug;
    if (!b.grounded || !b.alive) return 1;
    for (const s of this.sticky) {
      if (s.team === u.team) continue;
      for (let i = 0; i < s.pieces.length; i += PIECE) {
        if (toPiece(s.pieces, i, b.x, b.y, b.z, near) > b.species.radius + 0.45) continue;
        if (this.field.sample(near[0], near[1], near[2]) < 0) return s.slow;
      }
    }
    return 1;
  }

  /** Load a team's special attack. */
  private load(team: number, by: number): void {
    by *= this.passive(team, 'patience') || 1;
    const was = this.skill[team];
    if (was >= SKILL_FULL) return;
    this.skill[team] = was + by < SKILL_FULL ? was + by : SKILL_FULL;
    if (this.skill[team] >= SKILL_FULL) this.events.push({ type: 'skill', team });
  }

  /** Which bugs the webs hold now; the active one pulls at its web while it tries to walk or jump. */
  private holdInWebs(active: Unit, move: Readonly<BugInput>): void {
    for (const u of this.units) {
      const w = u.bug.alive ? this.webAt(u) : null;
      if (w && u.web !== w.id) this.events.push({ type: 'stuck', unit: u.id });
      u.web = w ? w.id : -1;
      const free = this.passive(u.team, 'scurry') && u === active ? this.passive(u.team, 'scurry') : 1;
      u.bug.slow = w ? WEB_SLOW : free * this.stuckTo(u);
      if (!w || u !== active || (move.move === 0 && !move.jump)) continue;
      if (--w.strength > 0) continue;
      this.removeWeb(w, true);
      u.web = -1;
      u.bug.slow = 1;
      if (w.team >= 0 && w.team !== u.team && w.paste < 0) this.damage(u, this.passive(w.team, 'barbs'));
    }
  }

  /** The web a bug stands in (the oldest, if several), or null. */
  private webAt(u: Unit): Web | null {
    const b = u.bug;
    if (!b.grounded) return null;
    for (const w of this.webs) {
      if (w.paste >= 0 ? w.paste === u.team : b.species.silk) continue;
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
    this.lingerTicks = LINGER_TICKS;
    const u = b ? this.units[this.bugs.indexOf(b)] : null;
    this.events.push({ type: 'arrow', x: p.x, y: p.y, z: p.z, dx, dy, dz, unit: u ? u.id : -1 });
    if (u) {
      this.damage(u, Math.max(1, Math.round(p.weapon.damage * this.hard * Math.min(1, speed / p.weapon.maxSpeed))));
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
        this.damage(u, Math.round(w.damage * this.hard));
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
  private openWeb(x: number, y: number, z: number, w: Weapon, grand: boolean, paste = -1): void {
    // (nothing near to hold on to: a bug hit in the air)
    const on = this.toSurface(x, y, z);
    if (!on) return;
    const id = this.nextWebId++;
    const team = this.units[this.active].team;
    this.webs.push({ id, ...on, radius: w.webRadius, turns: w.webTurns + (paste < 0 ? this.passive(team, 'strong-silk') : 0), strength: WEB_TEAR_TICKS, grand, paste, team });
    this.events.push({ type: 'web', id });
  }

  /** The place on the surface nearest (x, y, z), if there is one near: a few steps along the way to it. */
  private toSurface(x: number, y: number, z: number): Mark | null {
    for (let k = 0; k < 4; k++) {
      const d = surfaceDistance(this.field, x, y, z, aimed);
      x -= aimed[0] * d;
      y -= aimed[1] * d;
      z -= aimed[2] * d;
    }
    const d = surfaceDistance(this.field, x, y, z, aimed);
    const l = Math.sqrt(aimed[0] * aimed[0] + aimed[1] * aimed[1] + aimed[2] * aimed[2]);
    if (d > 1 || d < -1 || l < 0.5) return null;
    return { x, y, z, nx: aimed[0] / l, ny: aimed[1] / l, nz: aimed[2] / l };
  }

  /** The player points at a spot: the mark, if it is on a surface and near enough. */
  private setMark(unit: Unit, p: readonly [number, number, number], w: Weapon): void {
    const b = unit.bug;
    const dx = p[0] - b.x;
    const dy = p[1] - b.y;
    const dz = p[2] - b.z;
    if (!(dx * dx + dy * dy + dz * dz <= w.markRange * w.markRange)) return;
    const m = this.toSurface(p[0], p[1], p[2]);
    // (a spot in the air is none)
    if (m && (m.x - p[0]) * (m.x - p[0]) + (m.y - p[1]) * (m.y - p[1]) + (m.z - p[2]) * (m.z - p[2]) < 9) this.mark = m;
  }

  /** One tick of a brood: it comes, covers every enemy near the mark and bites, and flees from the light. */
  private broodTick(c: Brood, owner: Unit): void {
    const w = this.currentWeapon;
    c.ticks++;
    if (c.ticks === BROOD_COVER) {
      const radius = w.coverRadius + this.passive(owner.team, 'wider-swarm');
      this.tire(c.at.x, c.at.y, c.at.z, 1);
      for (const u of this.units) {
        const b = u.bug;
        if (!b.alive || u.team === owner.team) continue;
        const dx = b.x - c.at.x;
        const dy = b.y - c.at.y;
        const dz = b.z - c.at.z;
        let d = Math.sqrt(dx * dx + dy * dy + dz * dz) - b.species.radius;
        if (d < 0) d = 0;
        if (d > radius) continue;
        c.units.push(u.id);
        c.harm.push(Math.round(w.damage * this.hard * this.tired * (1 - ((1 - BROOD_EDGE) * d) / radius)));
      }
      this.events.push({ type: 'cover', x: c.at.x, y: c.at.y, z: c.at.z, units: c.units });
    }
    const since = c.ticks - BROOD_COVER;
    if (since > 0 && since % BROOD_BITE_TICKS === 0 && since <= BROOD_BITES * BROOD_BITE_TICKS) {
      const k = since / BROOD_BITE_TICKS;
      for (let i = 0; i < c.units.length; i++)
        this.damage(this.units[c.units[i]], Math.floor((c.harm[i] * k) / BROOD_BITES) - Math.floor((c.harm[i] * (k - 1)) / BROOD_BITES));
    }
    if (c.ticks < BROOD_LIGHT) return;
    for (const id of c.units) {
      const b = this.units[id].bug;
      if (b.alive) b.push(b.nx * BROOD_THROW, b.ny * BROOD_THROW, b.nz * BROOD_THROW);
    }
    this.brood = null;
    this.events.push({ type: 'lights', x: c.at.x, y: c.at.y, z: c.at.z, units: c.units });
    this.lingerTicks = LINGER_TICKS;
  }

  // ---------------------------------------------------------------- building and hiding

  /** The pieces a build weapon would lay right before the unit (a bridge: along its aim); none: no room. */
  piecesFor(u: Unit, w: Weapon, out: number[]): number[] {
    const b = u.bug;
    before(b, site);
    if (w.kind === 'wall') wallPieces(this.field, site, out);
    else {
      site.x = b.x - b.nx * b.species.radius;
      site.y = b.y - b.ny * b.species.radius;
      site.z = b.z - b.nz * b.species.radius;
      const [dx, dy, dz] = this.aimDirection(u, aimed);
      bridgePieces(this.field, site, dx, dy, dz, SPANS, out);
    }
    return this.allowed(out);
  }

  /** What of the pieces may be laid: not into a bug, a box, or where nobody may go. */
  private allowed(out: number[]): number[] {
    let n = 0;
    for (let i = 0; i < out.length; i += PIECE) {
      if (this.options.confine && !this.options.confine(out[i], out[i + 1], out[i + 2])) continue;
      if (!this.roomFor(out, i)) continue;
      for (let k = 0; k < PIECE; k++) out[n + k] = out[i + k];
      n += PIECE;
    }
    out.length = n;
    // (next to nothing left of it)
    if (laid(this.field, out) < 3) out.length = 0;
    return out;
  }

  /** The surface at a place, as a site: level ground stays level. False: there is none. */
  private siteAt(x: number, y: number, z: number): boolean {
    const d = surfaceDistance(this.field, x, y, z, near);
    if (!(d < 1 && d > -1)) return false;
    const level = near[1] > 0.6;
    site.x = x;
    site.y = y;
    site.z = z;
    site.nx = level ? 0 : near[0];
    site.ny = level ? 1 : near[1];
    site.nz = level ? 0 : near[2];
    return true;
  }

  /** What putting a weapon at a place comes to: why not, or '' and (a wall, a bridge) its pieces in `out`. */
  tryPlace(u: Unit, w: Weapon, p: Place, out: number[]): NoPlace {
    out.length = 0;
    const b = u.bug;
    const [x, y, z] = p;
    if (!p.every(Number.isFinite)) return 'no ground';
    if (w.kind !== 'shelter' && this.built) return 'once a turn';
    const dx = x - b.x;
    const dy = y - b.y;
    const dz = z - b.z;
    if (dx * dx + dy * dy + dz * dz > w.reach * w.reach) return 'too far';
    if (!this.siteAt(x, y, z)) return 'no ground';
    if (w.kind === 'shelter') return u.web >= 0 ? 'no room' : this.walksTo(u, x, y, z) ? '' : 'no way there';
    let [fx, fy, fz] = [p[3], p[4], p[5]];
    const far = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const up = fx * site.nx + fy * site.ny + fz * site.nz;
    let tx = fx - site.nx * up;
    let ty = fy - site.ny * up;
    let tz = fz - site.nz * up;
    const l = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (l < 1e-3) return 'too short';
    tx /= l;
    ty /= l;
    tz /= l;
    site.fx = tx;
    site.fy = ty;
    site.fz = tz;
    if (w.kind === 'wall') wallPieces(this.field, site, out);
    else {
      const count = Math.min(SPANS, Math.ceil(far / SPAN));
      if (count < 4) return 'too short';
      fx /= far;
      fy /= far;
      fz /= far;
      bridgePieces(this.field, site, fx, fy, fz, count, out);
    }
    // (a bridge that lies in the ground it goes over is none)
    if (w.kind === 'bridge' && laid(this.field, out) < 3) {
      out.length = 0;
      return 'nothing to bridge';
    }
    return this.allowed(out).length > 0 ? '' : 'no room';
  }

  /** Whether the bug gets to a place by running straight at it. */
  private walksTo(u: Unit, x: number, y: number, z: number): boolean {
    const b = new Bug(u.bug.species);
    b.copy(u.bug);
    for (let n = 0; n < GO_TICKS; n++) {
      const near2 = this.towards(b, x, y, z);
      if (near2) return true;
      b.step(this.field, goInput);
      if (!b.alive || b.airTicks > 22 || (b.justLanded && b.lastImpact > FALL_SAFE_SPEED)) return false;
    }
    return false;
  }

  /** Set the input that runs a bug at a place; true: it is there. */
  private towards(b: Bug, x: number, y: number, z: number): boolean {
    const dx = x - b.x;
    const dz = z - b.z;
    const dy = y - (b.y - b.ny * b.species.radius);
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < GO_NEAR && dy < 2 && dy > -2 && b.grounded) return true;
    goInput.faceX = l > 0.05 ? dx / l : 0;
    goInput.faceZ = l > 0.05 ? dz / l : 0;
    return false;
  }

  private putAt(u: Unit, w: Weapon, p: Place): void {
    const pieces: number[] = [];
    if (this.tryPlace(u, w, p, pieces) !== '') {
      this.events.push({ type: 'noRoom', unit: u.id });
      return;
    }
    if (w.kind === 'shelter') this.going = { x: p[0], y: p[1], z: p[2], w, left: GO_TICKS };
    else this.lay(u, w, pieces);
  }

  /** One tick of a bug on its way to hide. */
  private goHide(u: Unit): Readonly<BugInput> {
    const g = this.going;
    if (!g) return IDLE;
    if (this.towards(u.bug, g.x, g.y, g.z)) {
      this.going = null;
      this.shelter(u, g.w);
      return IDLE;
    }
    if (--g.left <= 0 || this.turnTicks <= 0) {
      this.going = null;
      if (this.turnTicks <= 0) this.endAim();
      return IDLE;
    }
    return goInput;
  }

  private roomFor(p: readonly number[], i: number): boolean {
    for (const q of this.units) {
      const b = q.bug;
      if (!b.alive) continue;
      const d = toPiece(p, i, b.x, b.y, b.z, near);
      if (d >= b.species.radius + BUILD_ROOM) continue;
      // (under its own feet is no harm)
      if ((near[0] - b.x) * b.nx + (near[1] - b.y) * b.ny + (near[2] - b.z) * b.nz > -(b.species.radius * 0.8 + p[i + 9] * 0.5)) return false;
    }
    const reach = Math.sqrt(p[i + 3] * p[i + 3] + p[i + 4] * p[i + 4] + p[i + 5] * p[i + 5]) + p[i + 9];
    for (const it of this.items.near(p[i], p[i + 1], p[i + 2], reach + BOX + 2)) if (toPiece(p, i, it.x, it.y, it.z, near) < BOX) return false;
    return true;
  }

  /** Lay it; the turn goes on, with the weapon the team had before. */
  private build(u: Unit, w: Weapon): void {
    const pieces: number[] = [];
    if (this.built || !this.field.deposit || this.piecesFor(u, w, pieces).length === 0) {
      this.events.push({ type: 'noRoom', unit: u.id });
      return;
    }
    this.lay(u, w, pieces);
  }

  private lay(u: Unit, w: Weapon, pieces: readonly number[]): void {
    this.field.deposit?.(pieces);
    // (many hands: once a match, two in one turn)
    if (this.again[u.team] > 0 && this.builtOnce) this.again[u.team]--;
    this.built = this.again[u.team] <= 0 || this.builtOnce;
    this.builtOnce = true;
    this.stock[u.team][WEAPONS.indexOf(w)]--;
    this.works[u.team]--;
    if (w === SILK_CURTAIN) this.curtains.push({ team: u.team, pieces: [...pieces], left: CATCHES + this.passive(u.team, 'double-weave') });
    const slow = w.species === 'spider' && w.kind === 'bridge' ? this.passive(u.team, 'trapline') : w.species === 'bee' ? this.passive(u.team, 'honey-trap') : 0;
    if (slow > 0) this.sticky.push({ team: u.team, pieces: [...pieces], slow });
    const id = this.structures.length;
    this.structures.push({ id, team: u.team, weapon: w, tags: tagsOf(w.id), pieces: [...pieces], fire: new Map(), gone: new Set() });
    this.events.push({ type: 'built', build: id, unit: u.id, weapon: w.id, pieces });
    this.weapon = this.keptBy(u);
    // (webs under it are gone)
    for (let q = this.webs.length - 1; q >= 0; q--) {
      const s = this.webs[q];
      if (this.field.sample(s.x + s.nx, s.y + s.ny, s.z + s.nz) < 0) this.removeWeb(s, true);
    }
  }

  /** Hide: instead of a shot. */
  private shelter(u: Unit, w: Weapon): void {
    if (u.web >= 0) {
      this.events.push({ type: 'noRoom', unit: u.id });
      return;
    }
    u.cover = w;
    u.coverLeft = (w.coverHealth ?? 0) + (w.species === 'cockroach' ? this.passive(u.team, 'thick-skin') : 0);
    this.events.push({ type: 'hide', unit: u.id, weapon: w.id });
    this.stock[u.team][WEAPONS.indexOf(w)]--;
    this.works[u.team]--;
    this.load(u.team, SKILL_HIDE);
    this.events.push({ type: 'fire', unit: u.id, weapon: w.id });
    this.phase = 'flight';
    this.retreatTicks = HIDE_TICKS;
  }

  /** Out of its shelter. */
  private bare(u: Unit, broken: boolean): void {
    if (!u.cover) return;
    u.cover = null;
    u.coverLeft = 0;
    this.events.push({ type: 'bared', unit: u.id, broken });
  }

  /** What a blow of this much would do to a unit, as it is now. */
  dealt(u: Unit, amount: number): number {
    return u.cover ? amount - Math.min(u.coverLeft, Math.floor(amount * (u.cover.cover ?? 0))) : amount;
  }

  /** The curtain of another team that a shot is at, or null. */
  curtainAt(p: Projectile, team: number): { left: number; readonly team: number } | null {
    for (const c of this.curtains) {
      if (c.team === team) continue;
      for (let i = 0; i < c.pieces.length; i += PIECE) {
        if (toPiece(c.pieces, i, p.x, p.y, p.z, near) > CURTAIN_NEAR) continue;
        // (what of it still stands there)
        if (this.field.sample(near[0], near[1], near[2]) < 0) return c;
      }
    }
    return null;
  }

  /** A curtain catches a shot (a great dart tears it); after the last one it is a wall like any other. */
  private caught(p: Projectile): boolean {
    const c = this.curtainAt(p, this.teamOf(p.owner));
    if (!c) return false;
    const through = p.weapon.kind === 'arrow';
    c.left = through ? 0 : c.left - 1;
    if (c.left <= 0) this.curtains.splice(this.curtains.findIndex((q) => q === c), 1);
    if (!through) this.tally[c.team].blocked += CAUGHT_WORTH;
    if (!through) this.events.push({ type: 'caught', x: p.x, y: p.y, z: p.z });
    return !through;
  }

  private teamOf(b: Bug | null): number {
    return b ? this.units[this.bugs.indexOf(b)].team : -1;
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
    if (w.sceneTicks > 0) this.skill[unit.team] = 0;
    this.hard = unit.boost ? OVERCLOCK : 1;
    unit.boost = false;
    const index = WEAPONS.indexOf(w);
    if (!hasWeapon(unit.bug.species.id, w)) this.stock[unit.team][index]--;
    if (w.kind === 'tunnel') this.dig(unit, w);
    else if (w.kind === 'trap') this.openWeb(unit.bug.x, unit.bug.y, unit.bug.z, w, false, unit.team);
    else if (w.kind === 'column') {
      const power = this.power < MIN_POWER ? MIN_POWER : this.power;
      this.column = { head: this.columnHead(unit), path: [], left: Math.round(MARCH_TICKS * power * (this.passive(unit.team, 'long-march') || 1)), swarm: 0, still: 0, victim: -1 };
    } else if (w.kind === 'flock') this.flock = this.newFlock(unit);
    else if (w.kind === 'brood' && this.mark) this.brood = { at: this.mark, ticks: 0, units: [], harm: [] };
    else this.projectiles.push(this.makeProjectile(unit, w, this.power));
    this.phase = 'flight';
    this.retreatTicks = w.sceneTicks > 0 ? 0 : RETREAT_TICKS;
    this.stance = false;
  }

  /** A flock of this unit's, where it would set out now. */
  newFlock(u: Unit): Flock {
    const b = u.bug;
    const [dx, dy, dz] = this.aimDirection(u, aimed);
    const off = b.species.radius + 1.6;
    const f = new Flock(b.x + dx * off, b.y + dy * off + 0.6, b.z + dz * off, this.rings).aim(dx, dy, dz);
    f.left = Math.round(f.left * (this.passive(u.team, 'long-flight') || 1));
    return f;
  }

  /** The rings are laid out, and the bug turns to the first of them. */
  private layOut(u: Unit): void {
    const b = u.bug;
    this.rings = this.ringsFor(u);
    const r = this.rings[0];
    if (!r || b.ny < 0.64) return;
    const dx = r.x - b.x;
    const dz = r.z - b.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-3) return;
    b.fx = dx / l;
    b.fz = dz / l;
    const d = Math.sqrt(l * l + (r.y - b.y) * (r.y - b.y));
    u.aimH = l / d;
    u.aimV = (r.y - b.y) / d;
  }

  /** The rings on the way to the nearest enemy. */
  private ringsFor(u: Unit): Ring[] {
    const b = u.bug;
    let best: Bug | null = null;
    let bestD = 1e12;
    for (const q of this.units) {
      if (q.team === u.team || !q.bug.alive) continue;
      const d = (q.bug.x - b.x) * (q.bug.x - b.x) + (q.bug.y - b.y) * (q.bug.y - b.y) + (q.bug.z - b.z) * (q.bug.z - b.z);
      if (d >= bestD) continue;
      bestD = d;
      best = q.bug;
    }
    return best ? layRings(this.field, this.luck, b.x, b.y + 2, b.z, best.x, best.y + 1, best.z) : [];
  }

  /** One tick of the flock: the player flies it; it bursts on what it meets. */
  private flockTick(f: Flock, owner: Unit, input: Readonly<MatchInput>): void {
    flying.turn = input.turn;
    flying.up = input.aim !== 0 ? input.aim : input.move;
    flying.faceX = input.faceX;
    flying.faceZ = input.faceZ;
    flying.pitch = input.pitch ?? 0;
    foes.length = 0;
    for (const q of this.units) if (q.team !== owner.team) foes.push(q.bug);
    const end = f.step(this.field, flying, foes);
    this.tire(f.x, f.y, f.z, 1.2);
    if (f.ring >= 0) this.events.push({ type: 'ring', index: f.ring, x: f.rings[f.ring].x, y: f.rings[f.ring].y, z: f.rings[f.ring].z });
    if (!end) return;
    this.flock = null;
    this.rings = [];
    if (end === 'lost') {
      this.events.push({ type: 'sting', x: f.x, y: f.y, z: f.z, unit: -1, rings: f.taken });
      this.retreatTicks = RETREAT_TICKS;
      return;
    }
    const v = f.touched;
    const unit = v ? this.units[this.bugs.indexOf(v)] : null;
    const x = v ? v.x : f.x;
    const y = v ? v.y : f.y;
    const z = v ? v.z : f.z;
    this.events.push({ type: 'sting', x, y, z, unit: unit ? unit.id : -1, rings: f.taken });
    this.explode(x, y, z, { ...this.currentWeapon, damage: Math.round((this.currentWeapon.damage + RING_DAMAGE * f.taken) * this.tired) });
    this.lingerTicks = LINGER_TICKS;
  }

  /** What leads a column of this unit's, where it would set out now. */
  columnHead(u: Unit): Bug {
    const b = u.bug;
    const h = new Bug(MARCHER);
    h.confine = b.confine;
    h.x = h.px = b.x;
    h.y = h.py = b.y;
    h.z = h.pz = b.z;
    h.nx = b.nx;
    h.ny = b.ny;
    h.nz = b.nz;
    h.fx = b.fx;
    h.fz = b.fz;
    h.hx = b.hx;
    h.hy = b.hy;
    h.hz = b.hz;
    h.grounded = true;
    return h;
  }

  /** One tick of the column: it marches (the player turns it), or swarms what it met, or goes under. */
  private columnTick(c: Column, owner: Unit, input: Readonly<MatchInput>): void {
    const h = c.head;
    if (c.victim >= 0) {
      const v = this.units[c.victim];
      c.swarm++;
      if (v.bug.alive && c.swarm % Math.floor(SWARM_TICKS / SWARM_BITES) === 0 && c.swarm < SWARM_TICKS) this.damage(v, Math.round(SWARM_BITE * this.hard * this.tired));
      if (v.bug.alive && c.swarm < SWARM_TICKS) return;
      // (under it: the nearest ground, which on an edge is not straight below)
      const on = v.bug.alive ? this.toSurface(v.bug.x, v.bug.y, v.bug.z) : null;
      if (on) this.collapse(c, on.x, on.y, on.z);
      else if (v.bug.alive) this.collapse(c, v.bug.x - v.bug.nx * v.bug.species.radius, v.bug.y - v.bug.ny * v.bug.species.radius, v.bug.z - v.bug.nz * v.bug.species.radius);
      else this.collapse(c, h.x - h.nx * h.species.radius, h.y - h.ny * h.species.radius, h.z - h.nz * h.species.radius);
      return;
    }
    bugInput.move = 1;
    bugInput.turn = input.turn * ramp(this.turnHeld);
    bugInput.faceX = 0;
    bugInput.faceZ = 0;
    bugInput.jump = false;
    bugInput.run = false;
    h.step(this.field, bugInput);
    this.tire(h.x, h.y, h.z, 0.4);
    c.path.push(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.hx, h.hy, h.hz);
    c.left--;
    const mx = h.x - h.px;
    const my = h.y - h.py;
    const mz = h.z - h.pz;
    c.still = mx * mx + my * my + mz * mz < 0.0016 ? c.still + 1 : 0;
    for (const u of this.units) {
      const b = u.bug;
      if (!b.alive || u.team === owner.team) continue;
      const dx = b.x - h.x;
      const dy = b.y - h.y;
      const dz = b.z - h.z;
      const reach = b.species.radius + SWARM_REACH;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      c.victim = u.id;
      this.events.push({ type: 'swarm', unit: u.id });
      return;
    }
    if (!h.alive || h.airTicks > 60) {
      // (it fell off: lost)
      this.column = null;
      this.retreatTicks = RETREAT_TICKS;
    } else if (c.left <= 0 || c.still > 20) this.collapse(c, h.x - h.nx * h.species.radius, h.y - h.ny * h.species.radius, h.z - h.nz * h.species.radius);
  }

  /** The column digs the ground away, and goes under. */
  private collapse(c: Column, x: number, y: number, z: number): void {
    this.column = null;
    this.events.push({ type: 'collapse', x, y, z, unit: c.victim });
    this.explode(x, y, z, this.currentWeapon);
    this.lingerTicks = LINGER_TICKS;
  }

  /** Time ran out, or the active bug got hurt or died: no more aiming this turn. */
  private endAim(): void {
    this.going = null;
    this.charging = false;
    this.stance = false;
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
    if ((this.stillTicks < SETTLE_HOLD_TICKS || this.lookTicks > 0) && this.settleTicks < SETTLE_MAX_TICKS) return;
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
    for (const q of this.curtains) turnPieces(q.pieces, tt);
    for (const q of this.sticky) turnPieces(q.pieces, tt);
    for (const q of this.structures) turnPieces(q.pieces, tt);
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
    this.smoulder();
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
        this.turnTicks = this.options.turnSeconds === undefined ? AIM_TICKS : Math.round(this.options.turnSeconds * TICK_RATE);
        this.stance = false;
        this.lingerTicks = 0;
        this.column = null;
        this.brood = null;
        this.mark = null;
        this.flock = null;
        this.rings = [];
        this.weapon = this.keptBy(u);
        for (let q = this.webs.length - 1; q >= 0; q--) if (--this.webs[q].turns < 0) this.removeWeb(this.webs[q], false);
        this.retreatTicks = 0;
        this.charging = false;
        this.power = 0;
        const wind = WIND_MAX * (this.options.wind ?? 1);
        this.windX = (this.rng() * 2 - 1) * wind;
        this.windZ = (this.rng() * 2 - 1) * wind;
        for (const q of this.units) q.bug.breath = Math.round((q.bug.species.flight ?? 0) * TICK_RATE * (this.passive(q.team, 'big-lungs') || 1));
        this.tend(t);
        if (!u.shell && u.bug.species.shell && u.bug.health < this.passive(t, 'survivor') && !this.regrown.has(u.id)) {
          this.regrown.add(u.id);
          u.shell = true;
        }
        this.turnTicks += u.extra * TICK_RATE;
        u.extra = 0;
        this.hard = 1;
        this.built = this.builtOnce = false;
        this.tired = 1;
        this.stung = false;
        this.usedItem = false;
        this.going = null;
        this.bare(u, false);
        // (springs wear off as their bug's turns go by)
        for (const q of this.units) {
          if (q === u && q.spring > 0) q.spring--;
          q.bug.leap = q.spring > 0 ? SPRING : 1;
        }
        this.turnNumber++;
        if (this.options.items ?? this.options.placeBugs !== false) {
          const box = this.items.turn(this.turnNumber, this.bugs.filter((b) => b.alive));
          if (box) this.events.push({ type: 'box', id: box.id });
        }
        this.events.push({ type: 'turn', unit: u.id });
        this.load(u.team, SKILL_TURN);
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

  // ---------------------------------------------------------------- tags that meet (see reactions.ts)

  /** Whether a slot of something built still stands. */
  private stands(s: Structure, i: number): boolean {
    return !s.gone.has(s.pieces[i + 10]) && this.field.sample(s.pieces[i], s.pieces[i + 1], s.pieces[i + 2]) < 0;
  }

  /** Something with these tags happens within `r` of a place: what is built there, and the webs, take it as their tags say. */
  private react(x: number, y: number, z: number, r: number, by: readonly Tag[]): void {
    for (const s of this.structures) {
      const burn = reaction('burn', by, s.tags);
      const wear = reaction('melt', by, s.tags) ?? reaction('brittle', by, s.tags);
      if (!burn && !wear) continue;
      // (what still stands at the edge of the hole, the nearest first)
      const at: { i: number; d: number; standing: boolean }[] = [];
      for (let i = 0; i < s.pieces.length; i += PIECE) {
        const d = toPiece(s.pieces, i, x, y, z, near);
        if (d < r * 0.8 && !s.gone.has(s.pieces[i + 10])) at.push({ i, d, standing: this.stands(s, i) });
      }
      if (at.length === 0) continue;
      at.sort((a, b) => a.d - b.d || a.i - b.i);
      if (burn) for (const q of at.filter((v) => v.standing).slice(0, r < 2 ? 1 : 2)) this.light(s, q.i, burn.value);
      if (!wear) continue;
      const wide = r * wear.value;
      this.field.erase?.(s.pieces, [x, y, z, wide]);
      this.events.push({ type: 'worn', build: s.id, x, y, z, radius: wide, word: wear.word });
      if (wear.id === 'melt') this.spill(s, at[0].i, x, z);
    }
    if (by.includes('fire'))
      for (let q = this.webs.length - 1; q >= 0; q--) {
        const w = this.webs[q];
        const reach = r + w.radius;
        if (w.paste < 0 && (w.x - x) * (w.x - x) + (w.y - y) * (w.y - y) + (w.z - z) * (w.z - z) < reach * reach) this.removeWeb(w, true);
      }
  }

  private light(s: Structure, i: number, spread: number): void {
    const slot = s.pieces[i + 10];
    if (s.fire.has(slot) || s.gone.has(slot)) return;
    s.fire.set(slot, spread);
    this.events.push({ type: 'burning', build: s.id, slot, x: s.pieces[i], y: s.pieces[i + 1], z: s.pieces[i + 2], high: s.weapon.kind === 'wall' ? 2 : 0.4 });
  }

  /** Melted comb: a puddle of honey on the ground there, that holds every other team. */
  private spill(s: Structure, i: number, x: number, z: number): void {
    const p = s.pieces;
    const team = s.team;
    // (beside its foot, on the side it was hit from; under a bridge)
    let hx = x - p[i];
    let hz = z - p[i + 2];
    const l = Math.sqrt(hx * hx + hz * hz);
    hx = l > 0.1 ? hx / l : 1;
    hz = l > 0.1 ? hz / l : 0;
    const wall = s.weapon.kind === 'wall';
    const fx = p[i] + (wall ? hx * 2.2 : 0);
    const fz = p[i + 2] + (wall ? hz * 2.2 : 0);
    const fy = p[i + 1] + (wall ? 0 : -2.4);
    const t = this.field.raycast(fx, fy, fz, 0, -1, 0, 14);
    if (t <= 0) return;
    const on = this.toSurface(fx, fy - t, fz);
    if (!on) return;
    for (const w of this.webs) if (w.honey && (w.x - on.x) * (w.x - on.x) + (w.y - on.y) * (w.y - on.y) + (w.z - on.z) * (w.z - on.z) < 4) return;
    const id = this.nextWebId++;
    this.webs.push({ id, ...on, radius: HONEY_WIDE, turns: HONEY_TURNS * this.teams.length, strength: WEB_TEAR_TICKS, grand: false, paste: team, team, honey: true });
    this.events.push({ type: 'web', id });
  }

  /** A turn begins: what burns is gone and its fire goes on to what is beside it; what is alive grows back. */
  private smoulder(): void {
    for (const s of this.structures) {
      if (s.fire.size > 0) {
        const slots = [...s.fire.keys()].sort((a, b) => a - b);
        for (const u of this.units) {
          const b = u.bug;
          if (!b.alive) continue;
          for (let i = 0; i < s.pieces.length; i += PIECE)
            if (s.fire.has(s.pieces[i + 10]) && toPiece(s.pieces, i, b.x, b.y, b.z, near) < b.species.radius + 0.6) {
              this.damage(u, BURN_HURTS);
              break;
            }
        }
        // (earth smothers it: what stands in it burns no lower, nor further)
        const upper = s.tags.includes('earth');
        for (const slot of slots) {
          const spread = s.fire.get(slot) as number;
          s.fire.delete(slot);
          this.events.push({ type: 'fireOut', build: s.id, slot });
          const i = this.slotAt(s, slot);
          if (i < 0) continue;
          this.burnAway(s, i, upper);
          if (spread <= 0) continue;
          for (const n of [slot - 1, slot + 1]) {
            const k = this.slotAt(s, n);
            if (k >= 0 && this.stands(s, k)) this.light(s, k, spread - 1);
          }
        }
      }
      this.regrow(s);
    }
  }

  private slotAt(s: Structure, slot: number): number {
    for (let i = 0; i < s.pieces.length; i += PIECE) if (s.pieces[i + 10] === slot) return i;
    return -1;
  }

  private burnAway(s: Structure, i: number, upper: boolean): void {
    const p = s.pieces.slice(i, i + PIECE);
    if (s.weapon.kind === 'wall') {
      // (not what it stands on)
      const l = Math.sqrt(p[3] * p[3] + p[4] * p[4] + p[5] * p[5]);
      // (from this high over the ground up; it stands WALL_DEEP in it)
      const keep = (upper ? SMOTHERED : 0.4) + WALL_DEEP + p[9];
      const half = Math.max(0.2, l - keep / 2);
      for (let k = 0; k < 3; k++) {
        const u = p[3 + k] / l;
        p[k] += u * (l - half);
        p[3 + k] = u * half;
      }
    }
    // (its own place only: the pieces reach into each other)
    const across = s.weapon.kind === 'wall' ? 6 : 3;
    const w = Math.sqrt(p[across] * p[across] + p[across + 1] * p[across + 1] + p[across + 2] * p[across + 2]);
    for (let k = 0; k < 3; k++) p[across + k] *= 0.1 / w;
    this.field.erase?.(p);
    if (!upper) s.gone.add(p[10]);
    this.events.push({ type: 'pieceGone', build: s.id, slot: p[10], upper, x: p[0], y: p[1], z: p[2], burnt: true });
  }

  /** What is alive closes one gap a turn, while enough of it stands. */
  private regrow(s: Structure): void {
    const r = reaction('regrow', [], s.tags);
    if (!r || s.fire.size > 0) return;
    const total = s.pieces.length / PIECE;
    let standing = 0;
    let first = -1;
    for (let i = 0; i < s.pieces.length; i += PIECE) {
      if (this.stands(s, i)) standing++;
      else if (first < 0 && this.roomFor(s.pieces, i)) first = i;
    }
    if (first < 0 || standing <= total * r.value) return;
    this.field.deposit?.(s.pieces.slice(first, first + PIECE));
    s.gone.delete(s.pieces[first + 10]);
    const gone: number[] = [];
    for (let i = 0; i < s.pieces.length; i += PIECE) if (!this.stands(s, i)) gone.push(s.pieces[i + 10]);
    this.events.push({ type: 'regrown', build: s.id, slot: s.pieces[first + 10], gone, x: s.pieces[first], y: s.pieces[first + 1], z: s.pieces[first + 2] });
  }

  /** Something that stops arcs is in between. */
  private insulated(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (const s of this.structures) {
      if (!reaction('insulate', ['electric'], s.tags)) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      for (let t = 0.6; t < l; t += 0.6) {
        const x = ax + (dx * t) / l;
        const y = ay + (dy * t) / l;
        const z = az + (dz * t) / l;
        for (let i = 0; i < s.pieces.length; i += PIECE) if (toPiece(s.pieces, i, x, y, z, near) < 0 && this.field.sample(x, y, z) < 0) return true;
      }
    }
    return false;
  }

  /** A shock at a place: whatever metal is smeared there takes it to everyone in it. */
  private conductAt(x: number, y: number, z: number, r: number, harm: number, hit: Set<Unit>): void {
    const rule = reaction('conduct', ['electric'], ['metal']);
    if (!rule) return;
    for (const w of this.webs) {
      if (w.paste < 0 || w.honey) continue;
      const reach = w.radius + r;
      if ((w.x - x) * (w.x - x) + (w.y - y) * (w.y - y) + (w.z - z) * (w.z - z) > reach * reach) continue;
      this.events.push({ type: 'conducts', x: w.x, y: w.y, z: w.z });
      for (const u of this.units) {
        const b = u.bug;
        if (!b.alive || hit.has(u)) continue;
        const dx = b.x - w.x;
        const dy = b.y - w.y;
        const dz = b.z - w.z;
        const in_ = w.radius + b.species.radius * 0.5;
        if (dx * dx + dy * dy + dz * dz > in_ * in_) continue;
        hit.add(u);
        this.events.push({ type: 'arc', x1: w.x, y1: w.y, z1: w.z, x2: b.x, y2: b.y, z2: b.z });
        this.damage(u, Math.round((harm || rule.value) * this.hard), true);
      }
    }
  }

  /** How much of its bite a swarm keeps that is at a place: it sticks to webs, to silk and honey. */
  private bite(x: number, y: number, z: number, reach: number): number {
    const r = reaction('tire', ['swarm'], ['sticky']);
    if (!r) return 1;
    for (const w of this.webs) {
      const d = w.radius + reach;
      if ((w.x - x) * (w.x - x) + (w.y - y) * (w.y - y) + (w.z - z) * (w.z - z) < d * d) return r.value;
    }
    for (const s of this.structures) {
      if (!reaction('tire', ['swarm'], s.tags)) continue;
      for (let i = 0; i < s.pieces.length; i += PIECE) if (toPiece(s.pieces, i, x, y, z, near) < reach + 0.6 && this.stands(s, i)) return r.value;
    }
    return 1;
  }

  /** The active special attack gets stuck on its way, once. */
  private tire(x: number, y: number, z: number, reach: number): void {
    if (this.tired < 1) return;
    this.tired = this.bite(x, y, z, reach);
    if (this.tired < 1) this.events.push({ type: 'tired', x, y, z });
  }

  /** What the bug's aim meets first that is built (within `range`), or null. */
  builtAhead(u: Unit, range: number): Structure | null {
    if (this.structures.length === 0) return null;
    const [dx, dy, dz] = this.aimDirection(u, aimed);
    const b = u.bug;
    for (let t = 1.5; t < range; t += 0.7) {
      const x = b.x + dx * t;
      const y = b.y + dy * t;
      const z = b.z + dz * t;
      if (this.field.sample(x, y, z) > 0.4) continue;
      for (const s of this.structures) for (let i = 0; i < s.pieces.length; i += PIECE) if (toPiece(s.pieces, i, x, y, z, near) < 0.4 && this.stands(s, i)) return s;
      return null;
    }
    return null;
  }

  /** It throws itself along its aim: fast, far, and it lands softly. Once a turn; the turn goes on. */
  private burst(u: Unit): void {
    const i = WEAPONS.findIndex((w) => w.kind === 'burst');
    const b = u.bug;
    if (this.burstTurn === this.turnNumber || this.usesLeft(u.team, i) <= 0 || u.web >= 0 || u.cover || !b.alive) {
      this.events.push({ type: 'noRoom', unit: u.id });
      return;
    }
    this.burstTurn = this.turnNumber;
    this.stock[u.team][i]--;
    const [dx, dy, dz] = this.aimDirection(u, aimed);
    const v = WEAPONS[i].maxSpeed;
    b.grounded = false;
    b.vx = dx * v;
    b.vy = dy * v + 3;
    b.vz = dz * v;
    b.floating = BURST_TICKS;
    this.soft.add(u.id);
    this.events.push({ type: 'burst', unit: u.id });
    if (this.phase === 'aim') this.weapon = this.keptBy(u);
  }

  /** A team's turn comes: its shelters tend to who is in them, or beside them. */
  private tend(team: number): void {
    const nursery = this.passive(team, 'nursery');
    const warm = this.passive(team, 'warm-nest');
    if (!nursery && !warm) return;
    for (const u of this.units) {
      if (u.team !== team || !u.bug.alive || !u.cover) continue;
      if (nursery && u.cover.species === 'ant') this.heal(u, nursery);
      if (!warm || u.cover.species !== 'bee') continue;
      for (const q of this.units) {
        if (q === u || q.team !== team) continue;
        const dx = q.bug.x - u.bug.x;
        const dy = q.bug.y - u.bug.y;
        const dz = q.bug.z - u.bug.z;
        if (dx * dx + dy * dy + dz * dz < BESIDE * BESIDE) this.heal(q, warm);
      }
    }
  }

  /** A bee that flies into an enemy stings it. */
  private sting(u: Unit): void {
    const n = this.passive(u.team, 'sting');
    if (!n || this.stung || !u.bug.flying) return;
    for (const q of this.units) {
      if (q.team === u.team || !q.bug.alive) continue;
      const r = u.bug.species.radius + q.bug.species.radius + 0.3;
      const dx = q.bug.x - u.bug.x;
      const dy = q.bug.y - u.bug.y;
      const dz = q.bug.z - u.bug.z;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      this.stung = true;
      this.damage(q, n);
      return;
    }
  }

  private dig(u: Unit, w: Weapon): void {
    const b = u.bug;
    const [dx, dy, dz] = this.aimDirection(u, aimed);
    const stepLen = w.tunnelRadius * 0.7;
    const start = b.species.radius * 0.5;
    for (let s = start; s <= w.tunnelLength; s += stepLen) this.field.carve(b.x + dx * s, b.y + dy * s, b.z + dz * s, w.tunnelRadius);
    for (let s = start; s <= w.tunnelLength; s += 1) this.react(b.x + dx * s, b.y + dy * s, b.z + dz * s, w.tunnelRadius, tagsOf(w.id));
    const hot = this.passive(u.team, 'hot-tip');
    if (hot)
      for (const q of this.units) {
        const c = q.bug;
        if (q === u || !c.alive) continue;
        const along = Math.max(0, Math.min(w.tunnelLength, (c.x - b.x) * dx + (c.y - b.y) * dy + (c.z - b.z) * dz));
        const ex = c.x - b.x - dx * along;
        const ey = c.y - b.y - dy * along;
        const ez = c.z - b.z - dz * along;
        const r = w.tunnelRadius + c.species.radius * 0.6;
        if (ex * ex + ey * ey + ez * ez < r * r) this.damage(q, hot);
      }
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
    const tags = tagsOf(w.id);
    // (arcs find it by themselves)
    if (tags.includes('electric') && w.arcs === 0) this.conductAt(x, y, z, w.blastRadius, w.arcDamage, new Set());
    this.field.carve(x, y, z, w.blastRadius);
    this.lookTicks = Math.max(this.lookTicks, LOOK_BLAST_TICKS);
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
    this.react(x, y, z, w.blastRadius, tags);
    for (const it of this.items.near(x, y, z, w.blastRadius + BOX)) {
      this.items.remove(it);
      this.events.push({ type: 'boxGone', id: it.id, x: it.x, y: it.y, z: it.z });
    }
    for (const u of this.units) {
      const b = u.bug;
      if (!b.alive) continue;
      const ex = b.x - x;
      const ey = b.y - y;
      const ez = b.z - z;
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const f = blastShare(b, x, y, z, w);
      if (f <= 0) continue;
      this.damage(u, Math.round(w.damage * this.hard * f), tags.includes('electric'));
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
      // (a swarm's hit does not throw as hard as it hurts)
      // (it sits tight in its shelter)
      if (u.cover) continue;
      const speed = KNOCKBACK * f * (Math.min(60, w.damage) / 45);
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
        if (d2 < bestD && !this.insulated(fx, fy, fz, b.x, b.y, b.z)) {
          bestD = d2;
          best = u;
        }
      }
      if (!best) return;
      hit.add(best);
      const b = best.bug;
      this.events.push({ type: 'arc', x1: fx, y1: fy, z1: fz, x2: b.x, y2: b.y, z2: b.z });
      // (grounded in its husk: it runs off)
      if (!(best.cover && best.cover.species === 'cockroach' && this.passive(best.team, 'grounded'))) this.damage(best, Math.round(w.arcDamage * this.hard), true);
      this.conductAt(b.x, b.y, b.z, 0, w.arcDamage, hit);
      b.push(0, 5, 0);
      fx = b.x;
      fy = b.y;
      fz = b.z;
    }
  }

  /** The boxes move on; a bug that touches one opens it. */
  private boxes(): void {
    this.items.step(this.tick);
    if (this.items.list.length === 0) return;
    for (const u of this.units) {
      if (!u.bug.alive || u.bug.health <= 0) continue;
      const it = this.items.touchedBy(u.bug);
      if (it) this.open(u, it);
    }
  }

  private open(u: Unit, it: Item): void {
    this.items.remove(it);
    this.tally[u.team].boxes++;
    this.heal(u, this.passive(u.team, 'nectar'));
    const kept = this.keeps(u, it.kind);
    // (the event first: what it does may end the turn, or the bug)
    const e = { type: 'open' as const, unit: u.id, kind: it.kind, x: it.x, y: it.y, z: it.z, id: it.id, gain: 0, kept };
    this.events.push(e);
    if (kept) this.bag[u.team][it.kind] = (this.bag[u.team][it.kind] ?? 0) + 1;
    else e.gain = this.effect(u, it.kind, it.x, it.y, it.z);
  }

  /** Whether the team keeps what it found: one of those that are, of no use right now, and there is a space for it. */
  private keeps(u: Unit, kind: ItemKind): boolean {
    if (!KEPT.includes(kind) || this.wantsNow(u, kind)) return false;
    const team = u.team;
    const bag = this.bag[team];
    const taken = KEPT.filter((k) => (bag[k] ?? 0) > 0).length + (this.stock[team][PASTE] > 0 ? 1 : 0);
    return (bag[kind] ?? 0) > 0 || taken < this.spaces(team);
  }

  /** What a box holds is of use to who opened it right now (then it takes effect at once). */
  private wantsNow(u: Unit, kind: ItemKind): boolean {
    const b = u.bug;
    switch (kind) {
      case 'patch':
        return b.health < b.species.health;
      case 'crystal':
        return u === this.units[this.active] && this.phase === 'aim';
      case 'fuse':
        return !u.fuse;
      case 'overclock':
        return !u.boost;
      case 'spring':
        return u.spring === 0;
      default:
        return false;
    }
  }

  /** Use an item the team keeps: one a turn. */
  private useItem(u: Unit, kind: ItemKind): void {
    const bag = this.bag[u.team];
    const n = bag[kind] ?? 0;
    if (this.usedItem || n <= 0) return;
    this.usedItem = true;
    bag[kind] = n - 1;
    const e = { type: 'use' as const, unit: u.id, kind, gain: 0 };
    this.events.push(e);
    e.gain = this.effect(u, kind, u.bug.x, u.bug.y, u.bug.z);
  }

  /** What is in a box takes effect; returns what it gave. */
  private effect(u: Unit, kind: ItemKind, x: number, y: number, z: number): number {
    const b = u.bug;
    let gain = 0;
    switch (kind) {
      case 'battery':
        this.load(u.team, BATTERY);
        break;
      case 'patch':
        gain = Math.max(0, Math.min(Math.round(b.species.health * PATCH), Math.round(b.species.health * (1 + PATCH_OVER)) - b.health));
        b.health += gain;
        break;
      case 'fuse':
        u.fuse = true;
        break;
      case 'overclock':
        u.boost = true;
        break;
      case 'spring':
        u.spring = 3;
        b.leap = SPRING;
        break;
      case 'paste':
        this.stock[u.team][PASTE]++;
        break;
      case 'crystal':
        if (u === this.units[this.active] && this.phase === 'aim') this.turnTicks += CRYSTAL * TICK_RATE;
        else u.extra += CRYSTAL;
        break;
      case 'magnet':
        this.magnet(u);
        break;
      case 'scrap': {
        // (a weapon of somebody else's, or paste; twice)
        const k = this.luck() < 0.6 && !hasWeapon(b.species.id, WEAPONS[WEB]) ? WEB : PASTE;
        this.stock[u.team][k] += 2;
        gain = k;
        break;
      }
      case 'dud':
        this.explode(x, y, z, DUD);
        break;
    }
    return gain;
  }

  /** The nearest enemy in reach is pulled over. */
  private magnet(u: Unit): void {
    let best: Unit | null = null;
    let bestD = MAGNET * MAGNET;
    const b = u.bug;
    for (const q of this.units) {
      if (q.team === u.team || !q.bug.alive) continue;
      const d2 = (q.bug.x - b.x) * (q.bug.x - b.x) + (q.bug.y - b.y) * (q.bug.y - b.y) + (q.bug.z - b.z) * (q.bug.z - b.z);
      if (d2 >= bestD) continue;
      bestD = d2;
      best = q;
    }
    if (!best) return;
    const o = best.bug;
    const d = Math.sqrt(bestD) || 1;
    const pull = 10 + d * 0.35;
    o.push(((b.x - o.x) / d) * pull, 7 + ((b.y - o.y) / d) * pull * 0.5, ((b.z - o.z) / d) * pull);
    this.events.push({ type: 'arc', x1: b.x, y1: b.y, z1: b.z, x2: o.x, y2: o.y, z2: o.z });
  }

  private damage(u: Unit, amount: number, electric = false): void {
    if (amount <= 0 || !u.bug.alive) return;
    const b = u.bug;
    if (u.cover) {
      const w = u.cover;
      const off = Math.min(u.coverLeft, Math.floor(amount * (w.cover ?? 0)));
      amount -= off;
      this.tally[u.team].blocked += off;
      u.coverLeft -= off;
      if (u.coverLeft <= 0) this.bare(u, true);
      if (amount <= 0) return;
    }
    if (u.fuse && amount > 1) {
      u.fuse = false;
      // (a shock: it takes all of it)
      amount = electric ? 0 : Math.ceil(amount / 2);
      this.events.push({ type: 'fuse', unit: u.id });
      if (amount <= 0) return;
    }
    // (its shell just took a blow that would have killed it: nothing more gets through this turn)
    if (u.shellTurn === this.turnNumber) return;
    if (u.shell && b.health > 0 && b.health <= amount) {
      u.shell = false;
      u.shellTurn = this.turnNumber;
      amount = b.health - 1;
      b.health = 1;
      this.events.push({ type: 'shell', unit: u.id });
    } else b.health = b.health > amount ? b.health - amount : 0;
    if (amount <= 0) return this.hurtOwnTurn(u);
    this.lookTicks = LOOK_DAMAGE_TICKS;
    this.events.push({ type: 'damage', unit: u.id, amount });
    const by = this.units[this.active].team;
    if (by !== u.team) this.tally[by].damage += amount;
    this.load(u.team, amount * SKILL_TAKEN);
    if (by !== u.team && this.currentWeapon.sceneTicks === 0) this.load(by, amount * SKILL_DONE);
    this.hurtOwnTurn(u);
  }

  private hurtOwnTurn(u: Unit): void {
    // getting hurt on your own turn ends it (no more aiming)
    if (this.phase === 'aim' && u === this.units[this.active]) this.endAim();
  }

  private announceDeath(u: Unit): void {
    this.bare(u, true);
    u.dead = true;
    u.bug.health = 0;
    this.events.push({ type: 'death', unit: u.id });
    const by = this.units[this.active];
    if (by.team === u.team) return;
    this.tally[by.team].kills++;
    this.heal(by, this.passive(by.team, 'leftovers'));
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
      b.health = b.species.health;
      b.lastImpact = 0;
    }
  }
}
