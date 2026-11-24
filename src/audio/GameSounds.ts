import { KILL_Y, TICK_RATE } from '../game/bug';
import type { Match, MatchEvent } from '../game/match';
import type { LoopSound, SoundEngine } from './SoundEngine';
import { SOUNDS, type SoundId } from './sounds';

/** How far a bug walks between two steps that are heard, and at which fall speed a landing is. */
const STRIDE = 1.05;
const LAND_SPEED = 4;
/** A bounce: the grenade's speed changes by more than this in a tick (gravity alone: 0.4). */
const BOUNCE_SPEED = 1.6;
/** The last seconds of a turn tick. */
const LAST_SECONDS = 5;

/** When a scene's sounds start (seconds into it, by its own clock), and their level and speed. */
type Cue = readonly [number, SoundId, number?, number?];
const BOW_SCENE: readonly Cue[] = [
  [0.12, 'cloth'],
  [0.24, 'bowRise'],
  [0.3, 'cloth', 0.9, 1.2],
  [0.45, 'cloth', 0.8, 0.9],
  [0.56, 'eyes'],
  [0.7, 'bowBurst'],
  [1.02, 'bowGrow'],
  [1.5, 'bowGather'],
  [2.05, 'bowReady'],
];
const COLUMN_SCENE: readonly Cue[] = [
  [0, 'columnRear'],
  [1.32, 'slam'],
  [1.36, 'cracks'],
  [1.8, 'holes'],
  [2.2, 'pour'],
  [2.7, 'pour', 0.8, 1.1],
  [3.45, 'ranks'],
];
const BROOD_SCENE: readonly Cue[] = [
  [0.2, 'wings'],
  [1.05, 'wings', 0.9, 1.12],
  [1.3, 'powerFail'],
  [2.5, 'eyes', 0.8, 0.6],
  [3.25, 'eyesOpen'],
  [3.6, 'eyesOpen', 0.7, 1.2],
];
/** ...and from when its hit is seen. */
const COLUMN_END: readonly Cue[] = [[3.52, 'finale']];
const BROOD_END: readonly Cue[] = [[0.45, 'pour', 0.9, 1.3], [3.42, 'finale']];
/** Into the swarm (ticks), the ground starts to split. */
const SPLIT = 130;

/** How each map echoes: seconds, brightness, level. */
const ECHO: Record<string, [number, number, number]> = {
  'pc-case': [0.9, 4200, 0.2],
  speaker: [1.1, 2800, 0.16],
  fridge: [0.8, 4600, 0.22],
  microwave: [0.7, 5200, 0.2],
  desk: [1.2, 2400, 0.13],
  car: [0.6, 2000, 0.13],
};

export interface SceneState {
  /** Seconds into the scene before the aim (-1: it does not play), and since its hit (-1: none yet). */
  time: number;
  hitFor: number;
  active: boolean;
}

interface BugState {
  walked: number;
  grounded: boolean;
  thread: boolean;
}

/** What the match sounds like: reads the match and its events, never changes them. */
export class GameSounds {
  private bugs: BugState[] = [];
  private readonly flying = new Map<number, [number, number, number, boolean]>();
  private readonly charge: LoopSound;
  private readonly flight: LoopSound;
  private readonly dart: LoopSound;
  private readonly draw: LoopSound;
  private readonly hum: LoopSound;
  private readonly swarm: LoopSound;
  private readonly blackout: LoopSound;
  private readonly turntable: LoopSound;
  private readonly rooms = new Map<string, LoopSound>();
  private scenario = '';
  private sceneTime = -1;
  private hitTime = -1;
  private wasStance = false;
  private lastSecond = -1;
  private lastWeapon = -1;
  private lastTurn = -1;
  /** Where the small ants are, and how many of them are heard. */
  private readonly ants = { x: 0, y: 0, z: 0, level: 0 };

  constructor(private readonly engine: SoundEngine) {
    this.charge = engine.loop('charge', false);
    this.flight = engine.loop('flight', true);
    this.dart = engine.loop('dart', true, 'scene');
    this.draw = engine.loop('bowDraw', false, 'scene');
    this.hum = engine.loop('bowHum', false, 'scene', 0.25);
    this.swarm = engine.loop('swarm', true, 'scene', 0.15);
    this.blackout = engine.loop('blackout', false, 'scene', 0.4);
    this.turntable = engine.loop('turntable', true, 'world', 0.2);
  }

  /** A new match on a map. */
  reset(match: Match, scenario: string): void {
    this.engine.stopScene();
    this.bugs = match.units.map((u) => ({ walked: 0, grounded: u.bug.grounded, thread: false }));
    this.flying.clear();
    this.sceneTime = this.hitTime = -1;
    this.wasStance = false;
    this.lastSecond = this.lastWeapon = -1;
    this.lastTurn = match.turnNumber;
    this.ants.level = 0;
    this.scenario = scenario;
    this.engine.setEcho(...(ECHO[scenario] ?? [1, 3000, 0.15]));
  }

  /** After every tick of the match. `scene`: a special attack has the view. */
  tick(match: Match, scene: boolean): void {
    for (const e of match.events) this.event(match, e, scene);
    // (a bug thrown by a blast does not jump)
    this.walk(match, (match.phase === 'aim' || match.retreatTicks > 0) && !match.events.some((e) => e.type === 'explosion'));
    this.shots(match);
    if (match.column?.swarm === SPLIT) this.engine.play('cracks', { at: match.column.head, scene: true });
    if (match.phase === 'aim') {
      const s = Math.ceil(match.turnTicks / TICK_RATE);
      if (s !== this.lastSecond && s <= LAST_SECONDS && s > 0 && this.lastSecond > s) this.engine.play('tick', { rate: s === 1 ? 1.5 : 1 });
      this.lastSecond = s;
      if (match.weapon !== this.lastWeapon && this.lastWeapon >= 0 && this.lastTurn === match.turnNumber) this.engine.play('select');
      this.lastWeapon = match.weapon;
      this.lastTurn = match.turnNumber;
    } else this.lastWeapon = match.weapon;
  }

  private event(match: Match, e: MatchEvent, scene: boolean): void {
    const { engine } = this;
    switch (e.type) {
      case 'turn':
        engine.play('turn', { rate: match.units[e.unit].team === 0 ? 1 : 1.122 });
        break;
      case 'fire': {
        const at = match.units[e.unit].bug;
        const kind = match.currentWeapon.kind;
        if (kind === 'arrow') engine.play('bowShot', { at, scene: true });
        else if (kind === 'column') {
          engine.play('command', { at, scene: true });
          engine.play('pour', { at, scene: true, rate: 1.2 });
        } else if (kind === 'brood') {
          engine.play('wings', { at, scene: true, rate: 1.25 });
          engine.play('pour', { at, scene: true, rate: 0.8 });
        } else if (kind === 'web') engine.play('spit', { at });
        else if (e.weapon === 'short-circuit') engine.play('spark', { at });
        else if (kind !== 'tunnel') engine.play('lob', { at, rate: kind === 'grenade' ? 0.85 : 1 });
        break;
      }
      case 'explosion':
        // (an ant column's has its own)
        // (into the ground, or into a bug: what it hurt comes after it in the same tick)
        if (!scene) {
          const hit = match.events.some((q) => q.type === 'damage' || q.type === 'shell');
          const small = e.radius < 4;
          engine.play(hit ? (small ? 'blastSmall' : 'blast') : small ? 'blastMissSmall' : 'blastMiss', { at: e, level: hit ? 0.8 : 1 });
          if (hit) this.impact(match);
        }
        break;
      case 'arc':
        engine.play('zap', { at: { x: e.x2, y: e.y2, z: e.z2 } });
        break;
      case 'dig':
        engine.play('drill', { at: { x: e.x1, y: e.y1, z: e.z1 } });
        break;
      case 'arrow':
        if (e.unit < 0) engine.play('bowMiss', { at: e, scene: true });
        else {
          engine.play('bowHit', { at: e, scene: true });
          this.impact(match, true);
        }
        this.hitTime = -1;
        break;
      case 'web':
        {
          const w = match.webs.find((q) => q.id === e.id);
          // (a ball of silk that hits a bug)
          if (w && !scene && match.events.some((q) => q.type === 'damage')) this.impact(match);
          if (w) engine.play('webOpen', { at: w, rate: scene ? 0.8 : 1, scene });
        }
        break;
      case 'stuck':
        engine.play('thread', { at: match.units[e.unit].bug, rate: 0.6 });
        break;
      case 'webGone':
        // (its place is gone with it; the active bug is near what it tore)
        if (e.torn) engine.play('webTear', { at: match.activeUnit.bug });
        break;
      case 'swarm':
        engine.play('pour', { at: match.units[e.unit].bug, scene: true, rate: 1.25 });
        break;
      case 'collapse':
        engine.play('collapse', { at: e, scene: true });
        engine.play('cracks', { at: e, scene: true });
        break;
      case 'skill':
        engine.play('skillReady', { rate: e.team === 0 ? 1 : 1.122 });
        break;
      case 'cover':
        engine.play('pour', { at: e, scene: true, rate: 1.3 });
        break;
      case 'lights':
        engine.play('powerOn', { at: e, scene: true });
        break;
      case 'shell':
        engine.play('shellCrack', { at: match.units[e.unit].bug, scene });
        break;
      case 'damage': {
        const at = match.units[e.unit].bug;
        if (match.column || match.brood) engine.play('bite', { at, scene: true });
        else if (!scene) engine.play('hurt', { at, level: 0.7 + Math.min(0.5, e.amount / 60) });
        break;
      }
      case 'death': {
        const b = match.units[e.unit].bug;
        if (b.y > KILL_Y) engine.play('death', { at: b });
        else engine.play('death', { at: b, rate: 0.75 });
        break;
      }
      case 'over':
        engine.play(e.winner >= 0 ? 'win' : 'draw');
        break;
      default:
        break;
    }
  }

  /** What was hurt this tick: a blow for each, harder the more it lost; the last blow rings out. */
  private impact(match: Match, scene = false): void {
    for (const e of match.events) {
      if (e.type !== 'damage') continue;
      const u = match.units[e.unit];
      const dead = u.bug.health <= 0;
      // (its own side: lower, it is no success)
      const own = u.team === match.activeUnit.team;
      this.engine.play(dead && !own ? 'impactKill' : 'impact', { at: u.bug, scene, level: 0.55 + Math.min(0.6, e.amount / 60), rate: own ? 0.62 : 1, vary: 0.03 });
    }
  }

  private walk(match: Match, jumps: boolean): void {
    match.units.forEach((u, i) => {
      const b = u.bug;
      const s = this.bugs[i];
      if (!s || !b.alive) return;
      if (b.justLanded && b.lastImpact > LAND_SPEED) this.engine.play('land', { at: b, level: Math.min(1.5, 0.3 + b.lastImpact / 18) });
      else if (s.grounded && !b.grounded && u === match.activeUnit && b.vy > 2 && jumps) this.engine.play('jump', { at: b });
      if (b.thread && !s.thread) this.engine.play('thread', { at: b });
      s.thread = b.thread;
      s.grounded = b.grounded;
      if (!b.grounded || match.phase === 'spin') return;
      const dx = b.x - b.px;
      const dy = b.y - b.py;
      const dz = b.z - b.pz;
      s.walked += Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (s.walked < STRIDE) return;
      s.walked %= STRIDE;
      this.engine.play('step', { at: b, vary: 0.2, rate: 0.9 / Math.sqrt(b.species.radius) + 0.1, level: 0.8 + 0.4 * Math.random() });
    });
  }

  private shots(match: Match): void {
    for (const p of match.projectiles) {
      const was = this.flying.get(p.id);
      if (was && p.weapon.kind === 'grenade') {
        const dv = Math.abs(p.vx - was[0]) + Math.abs(p.vy - was[1]) + Math.abs(p.vz - was[2]);
        if (dv > BOUNCE_SPEED && !was[3]) this.engine.play('bounce', { at: p, level: Math.min(1.2, dv / 14) });
        // (its fuse: faster near the end)
        const left = p.weapon.fuseTicks - p.age;
        if (left > 0 && left % (left > 60 ? 30 : left > 24 ? 12 : 6) === 0) this.engine.play('fuse', { at: p, vary: 0, rate: left > 60 ? 1 : 1.26 });
      }
      this.flying.set(p.id, [p.vx, p.vy, p.vz, p.resting]);
    }
    if (this.flying.size > match.projectiles.length) for (const id of this.flying.keys()) if (!match.projectiles.some((p) => p.id === id)) this.flying.delete(id);
  }

  /** Every frame. `scale`: how fast time runs. */
  frame(match: Match, dt: number, scale: number, bow: SceneState, column: SceneState, brood: SceneState): void {
    const { engine } = this;
    engine.setTimeScale(scale);
    const scene = bow.active || column.active || brood.active;
    // (in a blackout the place goes silent)
    const out = brood.active && brood.hitFor < 0 && (brood.time < 0 || brood.time > 2.1);
    engine.setRoomLevel(out ? 0 : scene ? 0.3 : 1);
    this.blackout.set(out ? (match.stance ? 1 : 0.7) : 0, 1);
    this.ambience();

    // ---- what goes on
    const unit = match.activeUnit;
    const b = unit.bug;
    const charging = match.phase === 'aim' && match.charging;
    const special = match.currentWeapon.kind;
    this.charge.set(charging && special !== 'arrow' ? 0.5 + 0.5 * match.power : 0, 0.8 + 1.2 * match.power);
    this.draw.set(charging && special === 'arrow' ? 0.5 + 0.7 * match.power : 0, 0.8 + 0.9 * match.power);
    const held = bow.active && bow.hitFor > 0.5 && bow.hitFor < 3.6;
    this.hum.set(held ? 0.45 : (match.stance && special === 'arrow') || (match.phase === 'special' && special === 'arrow' && this.sceneTime > 1) ? 0.6 + 0.8 * (charging ? match.power : 0) : 0, 1 + 0.12 * (charging ? match.power : 0));
    const p = match.projectiles.find((q) => !q.resting);
    const arrow = p?.weapon.kind === 'arrow';
    const speed = p ? Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) : 0;
    this.flight.set(p && !arrow ? Math.min(1, speed / 30) : 0, 0.6 + speed / 45, p?.x, p?.y, p?.z);
    this.dart.set(p && arrow ? 1 : 0, (0.7 + speed / 130) * (0.5 + 0.5 * scale), p?.x, p?.y, p?.z);
    this.turntable.set(match.phase === 'spin' ? 1 : 0, 1, match.field.W / 2, match.field.H / 3, match.field.D / 2);

    // ---- a special attack's scene, by its own clock (slowed with it)
    const t = Math.max(bow.time, column.time, brood.time);
    if (t >= 0) {
      this.cues(bow.time >= 0 ? BOW_SCENE : column.time >= 0 ? COLUMN_SCENE : BROOD_SCENE, this.sceneTime, t, b);
      this.sceneTime = t;
    } else if (this.sceneTime >= 0) {
      this.sceneTime = -1;
      if (!match.stance) engine.stopScene();
    }
    if (column.active && column.hitFor >= 0) {
      this.cues(COLUMN_END, this.hitTime, column.hitFor, b);
      this.hitTime = column.hitFor;
    } else if (brood.active && brood.hitFor >= 0) {
      this.cues(BROOD_END, this.hitTime, brood.hitFor, b);
      this.hitTime = brood.hitFor;
    } else this.hitTime = -1;
    if (this.wasStance && !match.stance && match.phase === 'aim') engine.stopScene();
    this.wasStance = match.stance;

    // ---- the small ants: in their ranks, on the march, over a bug, and into the ground
    const a = this.ants;
    let want = 0;
    let rate = 1;
    if (match.column) {
      const h = match.column.head;
      a.x = h.x;
      a.y = h.y;
      a.z = h.z;
      want = match.column.victim >= 0 ? 1.25 : 1;
      rate = match.column.victim >= 0 ? 1.15 : 1.06;
    } else if (special === 'column' && ((match.phase === 'special' && this.sceneTime > 2.2) || match.stance)) {
      a.x = b.x;
      a.y = b.y;
      a.z = b.z;
      want = match.stance ? 0.3 : 0.6;
      rate = 0.85;
    } else if (match.brood) {
      a.x = match.brood.at.x;
      a.y = match.brood.at.y;
      a.z = match.brood.at.z;
      want = Math.min(1.3, 0.35 + match.brood.ticks / 110);
      rate = match.brood.units.length > 0 ? 0.95 : 0.85;
    } else if (brood.active && brood.hitFor >= 0) {
      want = brood.hitFor < 0.42 ? 0 : Math.max(0, 1.1 - (brood.hitFor - 0.42) * 0.8);
      rate = 1.2;
    } else if (column.active && column.hitFor >= 0) want = Math.max(0, 0.9 - column.hitFor * 0.32);
    a.level += (want - a.level) * Math.min(1, dt * 6);
    if (want === 0 && a.level < 0.01) a.level = 0;
    this.swarm.set(a.level, rate, a.x, a.y, a.z);
  }

  private cues(list: readonly Cue[], from: number, to: number, at: { x: number; y: number; z: number }): void {
    for (const [when, id, level, rate] of list) if (when > from && when <= to) this.engine.play(id, { at, scene: true, vary: 0, level, rate });
  }

  private ambience(): void {
    const id = `room:${this.scenario}`;
    if (id in SOUNDS && !this.rooms.has(this.scenario)) this.rooms.set(this.scenario, this.engine.loop(id as SoundId, false, 'room', 0.8));
    for (const [name, l] of this.rooms) l.set(name === this.scenario ? 1 : 0);
  }
}
