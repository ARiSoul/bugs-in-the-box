import * as THREE from 'three';
import { GameSounds } from './audio/GameSounds';
import { MusicEngine } from './audio/MusicEngine';
import { SoundEngine } from './audio/SoundEngine';
import { runExplosionBenchmark } from './bench/explosions';
import { applyPose, CameraPath, FlyCamera } from './debug/camera';
import { captureCanvas } from './debug/capture';
import { readHooks, usesDebugCamera } from './debug/hooks';
import { PerfLog } from './debug/perf';
import { viewsFor, type ScenarioViews } from './debug/views';
import { Brain, SKILLS } from './game/brain';
import { DT, GRAVITY, KILL_Y, TICK_RATE } from './game/bug';
import { galeDirection, LIFT_HIGH, Match, NO_INPUT, type MatchEvent, type MatchInput, type TeamSpec } from './game/match';
import { ANT, SPECIES, SPIDER, type BugSpecies } from './game/species';
import { SOLDER_BLOB, WEAPONS } from './game/weapons';
import { Controls, keepKeysIn } from './input/controls';
import { openData, type Collections } from './data';
import { pickTerrain } from './input/picking';
import { AimView } from './render/aim';
import { BugView } from './render/BugView';
import { BowScene } from './render/gpu/bowScene';
import { BroodScene } from './render/gpu/broodScene';
import { FlockScene } from './render/gpu/flockScene';
import { ColumnScene } from './render/gpu/columnScene';
import { itemIndex } from './game/actions';
import { computerGrowth, LEVELS, VERSUS, worth, type Growth } from './game/progress';
import { Profile } from './ui/profile';
import { SpeciesPage } from './ui/species';
import { Minimap } from './ui/minimap';
import { Inventory } from './ui/inventory';
import { SeeThrough } from './render/gpu/seeThrough';
import { Placing } from './input/placing';
import { BuildViews } from './render/gpu/buildViews';
import { WebViews } from './render/webs';
import { DrawnGround } from './render/drawnGround';
import { ChunkRenderer } from './render/ChunkRenderer';
import { ExplosionFlashes, LineFlashes } from './render/effects';
import { GaleView } from './render/gale';
import { CHASE_ELEVATION, FollowCamera } from './render/followCamera';
import { MeshWorkers, type MeshBatch } from './render/MeshWorkers';
import { FloatingTexts, UnitLabel } from './render/labels';
import { ProjectileViews } from './render/projectiles';
import { BurrowViews } from './render/burrows';
import { BUILT, COLLIDER, MATERIAL_RGB } from './terrain/materials';
import { dress, type Face } from './render/gpu/heroDress';
import { ITEM_LOOKS } from './render/gpu/itemLooks';
import { ItemViews } from './render/gpu/itemViews';
import { Heroes } from './render/gpu/heroes';
import { createGpuStage } from './render/gpu/gpuStage';
import type { Stage, StageOptions } from './render/stage';
import { createLayout } from './terrain/generators/types';
import { scenarioById, type Scenario } from './terrain/scenarios';
import { Terrain } from './terrain/Terrain';
import { HAND, Hud, type HudState } from './ui/hud';
import { EndScreen, SetupScreen, type SetupChoice } from './ui/setup';
import { setupKeysMenu } from './ui/keys';
import { SoundMenu } from './ui/sound';
import { PauseMenu, PauseReserve } from './ui/pause';
import { EVERY, groundDigest, Recorder, type InputChange, type MatchRecord, type MatchSetup } from './sim';
import { NetClient, serverUrl, tokenKey } from './net/client';
import { Lockstep } from './net/lockstep';
import { isCode, type HoldWhy, type Inputs } from './net/protocol';
import { OnlineBox, OnlineStatus, waitingBox } from './ui/online';
import { keptOf, readKept, TuningPage } from './ui/tuning';
import { RULE, TUNING } from './game/tuning';

/** The two teams, each of one species (chosen in the menu, kept in the address as `?teams=ant,spider`). */
const PLURAL: Record<string, string> = { ant: 'Ants', spider: 'Spiders', cockroach: 'Cockroaches', bee: 'Bees' };
const picked: BugSpecies[] = [ANT, SPIDER];
/** Which special attack each team takes (`?specials=titan-lift,`; empty: its species' first). */
const specials: [string, string] = ['', ''];
/** Who plays each team: a player here ('human'), or the computer (a skill's id); `?players=human,normal`. */
const players = ['human', 'normal'];
let brains: (Brain | null)[] = [null, null];
/** The computer whose turn it is, if any. */
const brain = (): Brain | null => brains[match.activeUnit.team];
/**
 * This side does not play the turn now: the computer does, or, online, the other player (then this side watches: the
 * other's hand, aim, previews and marks are theirs, and are not shown here).
 */
const notMine = (): boolean => brain() !== null || watching();
/** Online, and the turn is the other player's. */
const watching = (): boolean => online !== null && match.activeUnit.team !== online.seat;
/** The rules: bugs per team, seconds per turn, how strong the wind is (`?size=3&turn=30&wind=1`). */
const rules = { size: 3, seconds: 30, wind: 1 };
/** No levels in this match (`?equal=1`). */
let equal = false;
/** The player's data: on this device first (IndexedDB), ready to sync with a server later (see `src/data`). */
const data = await openData();
keepKeysIn(data.settings);
const profile = new Profile(data.cache);
/** A side's level: the player's own with its species; the computer's is as high as its rival's. */
function levelFor(side: number, species: readonly BugSpecies[], who: readonly string[]): number {
  if (who[side] === 'human') return profile.level(species[side].id).level;
  return who[1 - side] === 'human' ? profile.level(species[1 - side].id).level : 1;
}
/** What a side brings to the match (none with no levels: then every special is open, and no passive). */
function growthFor(side: number): Growth | undefined {
  if (equal) return undefined;
  return players[side] === 'human' ? profile.growth(picked[side].id) : computerGrowth(picked[side].id, levelFor(side, picked, players));
}
const teams = (): TeamSpec[] =>
  online
    ? // (online: the teams as the room has them, the same on both sides)
      online.setup.teams.map((t) => ({ name: t.name, species: SPECIES.find((q) => q.id === t.species) ?? ANT, special: t.special, color: t.color, size: t.size, growth: t.growth }))
    : [
  { growth: growthFor(0), name: `Red ${PLURAL[picked[0].id]}`, species: picked[0], special: specials[0] || undefined, color: 0xff6b5e, size: rules.size },
  { growth: growthFor(1), name: `Blue ${PLURAL[picked[1].id]}`, species: picked[1], special: specials[1] || undefined, color: 0x5fb0ff, size: rules.size },
      ];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const hooks = readHooks(params);
(params.get('teams') ?? '').split(',').forEach((id, i) => {
  const s = SPECIES.find((q) => q.id === id);
  if (s && i < 2) picked[i] = s;
});
(params.get('specials') ?? '').split(',').forEach((id, i) => {
  if (i < 2) specials[i] = id;
});
(params.get('players') ?? '').split(',').forEach((id, i) => {
  if (i < 2 && (id === 'human' || SKILLS.some((s) => s.id === id))) players[i] = id;
});
const ruleOf = (name: string, least: number, most: number, otherwise: number): number => {
  const v = params.get(name);
  return v === null || !Number.isFinite(Number(v)) ? otherwise : Math.min(most, Math.max(least, Number(v)));
};
equal = params.get('equal') === '1';
rules.size = Math.round(ruleOf('size', 1, 5, 3));
rules.seconds = ruleOf('turn', 10, 120, 30);
rules.wind = ruleOf('wind', 0, 2, 1);
// ---- online: a room in the address (`?room=CODE`) waits for both players; its setup is the match ----
/** A match played online: the room, this client's seat (its team), the connection, the setup, the lockstep. */
interface Online {
  readonly code: string;
  readonly seat: number;
  readonly client: NetClient;
  readonly setup: MatchSetup;
  lock: Lockstep | null;
  /** Every input so far, when it came (one coming back plays them first). */
  start: { inputs: readonly InputChange[]; known: number };
  here: readonly boolean[];
  names: readonly string[];
  desync: number;
  sentChecks: number;
  /** The other's batches that came before this side's match was made (they wait for it). */
  early: Inputs[];
  /** The other holds the match on its turn: why, and until when (ms, this clock); null: it does not. */
  held: { why: HoldWhy; until: number } | null;
}
/** Back to the menu from a room (the room is left). */
function leaveRoom(): void {
  online?.client.close();
  const p = new URLSearchParams(location.search);
  for (const k of ['room', 'play']) p.delete(k);
  location.href = `?${p.toString()}`;
}
async function enterRoom(code: string): Promise<Online> {
  const sign = document.querySelector<HTMLElement>('#loading span');
  const say = (text: string): void => {
    if (sign) sign.textContent = text;
  };
  const client = new NetClient(serverUrl(params, location));
  try {
    say('Finding the room…');
    await client.open();
    const growths = Object.fromEntries(SPECIES.map((s) => [s.id, profile.growth(s.id)]));
    // (who is there: kept from the first word on, also before the match is made)
    const seen: { names: readonly string[]; here: readonly boolean[] } = { names: [], here: [] };
    client.on((m) => {
      if (m.t === 'presence') [seen.names, seen.here] = [m.names, m.here];
    });
    const started = client.next((m) => (m.t === 'start' ? m : null));
    const { seat, token } = await client.join(code, data.settings.get<string>('name') ?? '', sessionStorage.getItem(tokenKey(code)) ?? undefined, growths);
    sessionStorage.setItem(tokenKey(code), token);
    const link = `${location.origin}${location.pathname}?room=${code}${params.get('server') ? `&server=${encodeURIComponent(params.get('server') as string)}` : ''}`;
    const wait = waitingBox(code, link, leaveRoom);
    say('');
    document.getElementById('loading')?.append(wait.root);
    const s = await started;
    wait.root.remove();
    say('warming up the box');
    const o: Online = { code, seat, client, setup: s.setup, lock: null, start: { inputs: s.inputs, known: s.known }, here: seen.here, names: seen.names, desync: -1, sentChecks: 0, early: [], held: null };
    client.on((m) => {
      if (m.t === 'presence') [o.here, o.names] = [m.here, m.names];
    });
    return o;
  } catch (e) {
    say(`${e instanceof Error ? e.message : String(e)}.`);
    const back = document.createElement('button');
    back.className = 'online-back';
    back.textContent = 'Back to the menu';
    back.addEventListener('click', leaveRoom);
    document.getElementById('loading')?.append(back);
    return new Promise<Online>(() => {});
  }
}
const roomCode = params.get('room');
const online: Online | null = roomCode && isCode(roomCode) ? await enterRoom(roomCode) : null;
if (online) {
  const s = online.setup;
  s.teams.forEach((t, i) => {
    picked[i] = SPECIES.find((q) => q.id === t.species) ?? picked[i];
    specials[i] = t.special ?? '';
    players[i] = 'human';
  });
  rules.size = s.teams[0].size;
  rules.seconds = s.rules.turnSeconds ?? rules.seconds;
  rules.wind = s.rules.wind ?? rules.wind;
  equal = s.teams[0].growth === undefined;
  params.set('seed', String(s.seed));
  params.set('scenario', s.scenario);
}

// Map size in chunks of 32, e.g. `?map=3x2x3` for the small map. Without it, the
// scenario's own size (a scenario at a larger scale needs a larger map), else 5x3x5.
const size = (params.get('map') ?? '').match(/^(\d+)x(\d+)x(\d+)$/);
let seed = Number(params.get('seed') ?? 1234) | 0;
let scenario: Scenario = scenarioById(params.get('scenario'));
const mapSize = (sc: Scenario): [number, number, number] =>
  online && online.setup.scenario === sc.id ? [...online.setup.size] as [number, number, number] : size ? [Number(size[1]), Number(size[2]), Number(size[3])] : (sc.mapSize ?? [5, 3, 5]);
const terrain = new Terrain(...mapSize(scenario));
const layout = createLayout();
const stageOptions: StageOptions = { fixedSize: hooks.fixedSize, timestamps: hooks.perf, seed };
const stage: Stage = await createGpuStage(canvas, terrain, stageOptions);
const chunks = new ChunkRenderer(stage.scene, stage.look);
const ground = new DrawnGround(terrain);
const flashes = new ExplosionFlashes(stage.scene);
const lines = new LineFlashes(stage.scene);
const gales = new GaleView(stage.scene);
/** A gale's way while it is aimed (render only). */
const galeDir = new Float64Array(3);
const texts = new FloatingTexts(stage.hud);
const projectiles = new ProjectileViews(stage.scene);
const burrows = new BurrowViews(stage.scene);
const burrowWay: number[] = [];
/** The way up out of a burrow, drawn when the ant breaks through (x, y, z twice, and the radius). */
let burrowUp: number[] = [];
burrows.puff = (x, y, z, n) => buildViews.dust(x, y, z, n);
burrows.inside = () => scenario.inside?.core;
burrows.skin = () => scenario.inside?.skin;
// (the colour of what is under a place: the first solid cell down from it)
burrows.groundColor = (x, y, z) => {
  const i = Math.round(x);
  const k = Math.round(z);
  if (i < 0 || k < 0 || i >= terrain.sx || k >= terrain.sz) return [0.3, 0.27, 0.24];
  for (let j = Math.min(terrain.sy - 1, Math.round(y) + 1); j >= 0; j--) {
    if (terrain.sample(i, j, k) >= 0) continue;
    const m = terrain.material[terrain.idx(i, j, k)];
    return m === COLLIDER || m === BUILT ? [0.2, 0.2, 0.21] : (MATERIAL_RGB[m] ?? [0.3, 0.27, 0.24]);
  }
  return [0.3, 0.27, 0.24];
};
burrows.rest = (ox, oy, oz, dx, dy, dz, maxT) => ground.rest(ox, oy, oz, dx, dy, dz, maxT);
/** A camera shake left (s): an ant breaking out of the ground. */
let shake = 0;
/** After an ant is out of its burrow: how long the view still holds both holes (s), and its way. */
let burrowAfter = 0;
/** The view looked down from above (a burrow, or a bug in a tunnel) last frame. */
let overlooked = false;
let burrowPath: number[] = [];
const liftUp = new THREE.Vector3();
const aim = new AimView(stage.scene);
const webViews = new WebViews(stage.scene);
const itemViews = new ItemViews(stage.scene);
const buildViews = new BuildViews(stage.scene);
const bow = new BowScene(stage.scene, stage.fx);
const antColumn = new ColumnScene(stage.scene, stage.fx, bow.light, bow.targetLight);
const brood = new BroodScene(stage.scene, stage.fx, bow.light);
const flock = new FlockScene(stage.scene, stage.fx, bow.light);
/** The special attack whose scene has the view now, if any. */
const inScene = (): BowScene | ColumnScene | BroodScene | FlockScene | null => (bow.camera.active ? bow : antColumn.camera.active ? antColumn : brood.camera.active ? brood : flock.camera.active ? flock : null);
/** What the player builds follows the pointer, until a click puts it down. */
/** What hides the bug is seen through; or (as it was) the camera moves out of the way. The player's choice. */
const seeThrough = new SeeThrough();
/** The setting the camera's way is kept under. */
const CAMERA = 'camera';
/** The numbers the next match is tuned by (the settings page changes them; kept on this device). */
let tuning = online ? TUNING.make(online.setup.tuning.changed, online.setup.tuning.version) : readKept(TUNING, data.settings.get('tuning'));
/** How far along the aim the view is kept free. */
const AHEAD = 14;
const aimAt = new Float64Array(3);
const lookAhead = new THREE.Vector3();
const placing = new Placing();
/** Time for reading: the clock stands still while the inventory is open on a player's turn; so much a turn, so much a match (the settings). */
const reading = { turn: 20, match: [90, 90], key: '', on: false };
/** Online, what this side may still hold the match for on its own turn with the pause box (the settings). */
const pauseReserve = new PauseReserve(60);
const places = (): boolean => !reading.on && !notMine() && !debugCamera && !menus.setup && !menus.over && match.phase === 'aim' && !match.going && match.activeUnit.bug.alive && Placing.takes(match.currentWeapon);
/** The player marks a spot for a brood. */
const marking = (): boolean => !notMine() && match.stance && match.phase === 'aim' && match.currentWeapon.kind === 'brood' && brood.camera.active;
const follow = new FollowCamera(stage.camera, stage.controls);
// the right button turns the view (and the bug with it), the wheel zooms; the left button stays free
stage.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
const hud = new Hud();
const sound = new SoundEngine(data.settings);
const music = new MusicEngine(sound);
const gameSounds = new GameSounds(sound, music);

const state: HudState = {
  meshing: '',
  generateMs: 0,
  initialMeshMs: 0,
  lastExplosionMs: 0,
  lastExplosionWorkerMs: 0,
  lastExplosionLatencyMs: 0,
  lastExplosionChunks: 0,
  triangles: 0,
  bench: '',
};
const refresh = (): void => {
  state.triangles = chunks.triangles;
  hud.render(terrain, state);
};

// Meshing runs on a worker pool; `?mesh=main` keeps it on the main thread (to compare, or as a fallback).
let initialBatch = -1;
const workers = params.get('mesh') === 'main' ? null : MeshWorkers.create(onMeshBatch);
state.meshing = `${workers ? `${workers.size} worker${workers.size > 1 ? 's' : ''}` : 'main thread'} · ${stage.backend}`;

/** A batch of chunk meshes is ready: show all of them in this frame (neighbours must change together). */
function onMeshBatch(b: MeshBatch): void {
  const t0 = performance.now();
  for (const m of b.meshes) chunks.apply(m.id, m.mesh);
  const now = performance.now();
  if (b.id === initialBatch) {
    state.initialMeshMs = now - b.startedAt;
    menus.meshed = true;
  } else {
    state.lastExplosionMs = b.postMs + (now - t0);
    state.lastExplosionWorkerMs = b.workerMs;
    state.lastExplosionLatencyMs = now - b.startedAt;
    state.lastExplosionChunks = b.meshes.length;
  }
  refresh();
}

let match: Match;
/** A special attack starts: its scene is set up with the frame's bugs in place. */
let bowPending = false;
/** The turntable's turn when the drawn ground was indexed. */
let indexedTurns = 0;
let views: ScenarioViews;
let bugViews: { view: BugView; face: Face; wing: number; blink: number; label: UnitLabel; height: number }[] = [];

/** New map and new match from one number: the seed is all two players need to share. */
function newMatch(s: number): void {
  // (the last match's record first, while its map is as it left it)
  keepRecord('left');
  const t0 = performance.now();
  const chunksNow = mapSize(scenario);
  if (chunksNow.join() !== [terrain.cx, terrain.cy, terrain.cz].join()) {
    terrain.resize(...chunksNow);
    chunks.clear();
  }
  buildViews.raze();
  scenario.generate(terrain, s, layout);
  stage.setScenario(scenario, layout);
  seeThrough.give(stage.look.material);
  seeThrough.apply(stage.scene, bugViews.map((v) => v.view.root));
  chunks.setSharp(scenario.sharpEdges);
  follow.chaseElevation = scenario.chaseElevation ?? CHASE_ELEVATION;
  views = viewsFor(scenario.id, terrain, layout);
  state.generateMs = performance.now() - t0;
  if (workers) {
    workers.reset();
    initialBatch = workers.request(terrain, chunks.sharp);
  } else {
    state.initialMeshMs = chunks.sync(terrain).ms;
  }
  state.lastExplosionMs = 0;
  state.lastExplosionWorkerMs = 0;
  state.lastExplosionLatencyMs = 0;
  state.lastExplosionChunks = 0;
  state.bench = '';

  made = { seed: s, ground: groundDigest(terrain) };
  newTeams(s);
}

/** The map as it was made (its seed, and its ground's digest): a match on it, unchanged, can be made again from the seed. */
let made = { seed: -1, ground: '' };
/** Records the match being played (every input), kept when it ends or is left. */
let recorder: Recorder | null = null;
/** Most matches kept as records on this device. */
const KEEP_RECORDS = 20;
/** Keep the record of the match being played (once), as it stands. */
function keepRecord(end: MatchRecord['end']): void {
  const r = recorder;
  recorder = null;
  // (a few seconds of one is not worth keeping)
  if (!r || r.length < 600) return;
  const rec = r.finish(end);
  const id = `${Date.now().toString(36)}-${rec.setup.seed}`;
  data.cache.put('replays', id, rec as unknown as Collections['replays']);
  const ids = data.cache.ids('replays').sort();
  for (const old of ids.slice(0, Math.max(0, ids.length - KEEP_RECORDS))) data.cache.remove('replays', old);
}

/** New teams on the map as it is; `turns`: how far its turntable has turned. */
function newTeams(s: number, turns = 0): void {
  keepRecord('left');
  const sides = teams();
  match = new Match(terrain, sides, s, { tuning, turned: turns, turnSeconds: rules.seconds, wind: rules.wind, strictBounds: scenario.strictBounds, spawnLevels: scenario.spawnLevels === true, turntable: scenario.turntable?.(terrain.W, terrain.H, terrain.D), confine: scenario.confine?.(terrain.W, terrain.H, terrain.D) });
  const groundNow = (): string => groundDigest(terrain);
  const start = groundNow();
  const setup: MatchSetup = {
    scenario: scenario.id,
    size: [terrain.cx, terrain.cy, terrain.cz],
    seed: s,
    teams: sides.map((q) => ({ name: q.name, species: q.species.id, special: q.special, color: q.color, size: q.size, growth: q.growth })),
    rules: { turnSeconds: rules.seconds, wind: rules.wind, turned: turns },
    tuning: { version: tuning.version, changed: { ...tuning.changed }, hash: tuning.hash },
    fresh: made.seed === s && made.ground === start,
  };
  recorder = new Recorder(setup, match, groundNow, start);
  if (online) {
    // (online the room records the match; this side steps it in lockstep, first with every input it missed)
    recorder = null;
    const l = new Lockstep(match, online.seat);
    if (online.start.known > 0) l.take({ t: 'inputs', from: 0, upTo: online.start.known, changes: online.start.inputs });
    while (l.tick < online.start.known) l.step();
    online.sentChecks = l.digests.length;
    online.start = { inputs: [], known: 0 };
    online.lock = l;
    for (const b of online.early.splice(0)) if (!l.take(b)) location.reload();
  }

  brains = players.map((id, i) => {
    const s = SKILLS.find((q) => q.id === id);
    return s ? new Brain(s, seed * 2 + i) : null;
  });
  prevTurns = turns;
  for (const v of bugViews) {
    v.view.dispose();
    v.label.dispose();
  }
  bugViews = match.units.map((u) => {
    const view = new BugView(u.bug.species);
    const face = dress(view, u.team);
    // (the last level's name is of gold)
    const label = new UnitLabel(u.name, (match.teams[u.team].growth?.level ?? 1) >= LEVELS ? 0xffd45a : match.teams[u.team].color);
    stage.scene.add(view.root);
    stage.hud.add(label.sprite);
    return { view, face, wing: 0, blink: 1 + Math.random() * 4, label, height: u.bug.species.radius * 2.4 };
  });
  bestHit = 0;
  minimap.touch();
  reading.match = [0, 1].map(() => match.tuning.get(RULE.readMatch));
  reading.key = '';
  pauseReserve.left = match.tuning.get(RULE.pauseMatch);
  webViews.clear();
  itemViews.clear();
  buildViews.clear(match.teams.map((t) => t.species.id));
  burrows.clear();
  gales.clear();
  bow.clear();
  antColumn.clear();
  brood.clear();
  flock.clear();
  gameSounds.reset(match, scenario.id);
  indexedTurns = turns;
  ground.reset(stage.scene, [...bugViews.map((v) => v.view.root), buildViews.root]);
  hud.setupMatch(match, WEAPONS, (i) => controls.selectWeapon(i));
  const active = bugViews[match.active];
  active.view.update(match.activeUnit.bug, 1, 0);
  startCamera();
  refresh();
}

/** Damage a special attack did, to show when its flash is over. */
const heldDamage: { unit: number; amount: number }[] = [];
function showDamage(unit: number, amount: number, long: boolean): void {
  const u = match.units[unit];
  const stung = flock.camera.active;
  if (stung) texts.clear();
  // (beside it: over it is the one that stung it)
  at2.set(stung ? -2.6 : 0, 0, 0).applyQuaternion(stage.camera.quaternion);
  texts.spawn(`-${amount}`, stung ? 0xffc83a : match.teams[u.team].color, at.set(u.bug.x, u.bug.y + (stung ? 0.4 : bugViews[unit].height + (long ? 1.9 : 1)), u.bug.z).add(at2), long && !stung ? 2.6 : 1.1, stung ? 1.8 : 1);
}

/** The sight of a special attack: where its dart points, and how far the string is drawn. */
const sight = document.getElementById('sight') as unknown as SVGElement;
const sightPull = sight.querySelector('.pull') as SVGElement;
const sightAim = new Float64Array(3);
function placeSight(): void {
  const on = match.stance && match.phase === 'aim' && bow.camera.active && !debugCamera;
  sight.classList.toggle('on', on);
  if (!on) return;
  const b = match.activeUnit.bug;
  match.aimDirection(match.activeUnit, sightAim);
  // (where a dart at full draw would end: its drop and the wind are in it; a weaker pull falls short of it)
  const w = match.currentWeapon;
  const out = b.species.radius + 0.5;
  at.set(b.x + sightAim[0] * out, b.y + sightAim[1] * out, b.z + sightAim[2] * out);
  at2.set(sightAim[0], sightAim[1], sightAim[2]).multiplyScalar(w.maxSpeed);
  for (let n = 0; n < 150; n++) {
    at2.x += match.windX * w.windFactor * DT;
    at2.y -= GRAVITY * w.gravityFactor * DT;
    at2.z += match.windZ * w.windFactor * DT;
    at.addScaledVector(at2, DT);
    if (terrain.sample(at.x, at.y, at.z) < 0.3 || at.x < 0 || at.z < 0 || at.x > terrain.W || at.z > terrain.D) break;
    if (match.units.some((q) => q !== match.activeUnit && q.bug.alive && (q.bug.x - at.x) ** 2 + (q.bug.y - at.y) ** 2 + (q.bug.z - at.z) ** 2 < (q.bug.species.radius + 0.4) ** 2)) break;
  }
  stage.camera.updateMatrixWorld();
  at.project(stage.camera);
  const box = canvas.getBoundingClientRect();
  sight.style.transform = `translate(${(box.left + ((at.x + 1) / 2) * box.width).toFixed(1)}px, ${(box.top + ((1 - at.y) / 2) * box.height).toFixed(1)}px)`;
  sightPull.setAttribute('stroke-dasharray', `${match.charging ? (match.power * 100).toFixed(0) : 0} 100`);
}

const at = new THREE.Vector3();
const at2 = new THREE.Vector3();
function handleEvents(events: readonly MatchEvent[]): void {
  for (const e of events) {
    itemViews.on(e);
    buildViews.on(e, match);
    burrows.on(e, match);
    if (e.type === 'emerge') {
      shake = 0.32;
      burrowAfter = 1.4;
    }
    if (e.type === 'burrow') burrowPath = e.path.slice();
    if (e.type === 'explosion' || e.type === 'dig' || e.type === 'burrow' || e.type === 'built' || e.type === 'worn' || e.type === 'pieceGone' || e.type === 'regrown') minimap.touch();
    switch (e.type) {
      case 'open': {
        const look = ITEM_LOOKS[e.kind];
        const what = e.kept ? `${look.name} kept` : e.kind === 'patch' ? `+${e.gain}` : look.name;
        texts.spawn(what, parseInt(look.color.slice(1), 16), at.set(e.x, e.y + 2.2, e.z), 1.5);
        hud.found(match, e.unit, e.kind, look, e.kept);
        if (e.kind === 'dud') break;
        flashes.spawn(at.set(e.x, e.y, e.z), 0.9);
        break;
      }
      case 'burning':
        texts.spawn('burning', 0xff8a2a, at.set(e.x, e.y + 2.5, e.z));
        break;
      case 'worn':
        texts.spawn(e.word, e.word === 'melting' ? 0xffc040 : 0xffb080, at.set(e.x, e.y + 2, e.z));
        break;
      case 'conducts':
        texts.spawn('conducts', 0x8fe3ff, at.set(e.x, e.y + 2, e.z));
        break;
      case 'tired':
        texts.spawn('slowed', 0xf2f2ee, at.set(e.x, e.y + 2, e.z));
        break;
      case 'burst':
        texts.spawn('burst!', 0x9fe8ff, at.set(match.units[e.unit].bug.x, match.units[e.unit].bug.y + 2.6, match.units[e.unit].bug.z));
        break;
      case 'heal':
        texts.spawn(`+${e.amount}`, 0xff7fa5, at.set(match.units[e.unit].bug.x, match.units[e.unit].bug.y + 3, match.units[e.unit].bug.z));
        break;
      case 'use': {
        const look = ITEM_LOOKS[e.kind];
        const b = match.units[e.unit].bug;
        texts.spawn(e.kind === 'patch' ? `+${e.gain}` : look.name, parseInt(look.color.slice(1), 16), at.set(b.x, b.y + 3, b.z), 1.5);
        break;
      }
      case 'fuse':
        texts.spawn('fuse blown', 0x8ccaff, at.set(match.units[e.unit].bug.x, match.units[e.unit].bug.y + 3.2, match.units[e.unit].bug.z));
        break;
      case 'reacted':
        // (tags met on a bug: what came of it, in a word)
        texts.spawn(e.word, 0xffc98a, at.set(match.units[e.unit].bug.x, match.units[e.unit].bug.y + 3.4, match.units[e.unit].bug.z));
        break;
      case 'noRoom':
        // (a burrow where the ground is too thin, or hard: it says so)
        texts.spawn(match.currentWeapon.kind === 'burrow' && match.burrowPath(match.units[e.unit], 0, burrowWay).length < 12 ? 'cannot dig here' : match.built ? 'once a turn' : 'no room', 0xff8a6a, at.set(match.units[e.unit].bug.x, match.units[e.unit].bug.y + 3, match.units[e.unit].bug.z));
        break;
      case 'bared':
        if (e.broken && match.units[e.unit].bug.alive) texts.spawn('shelter broken', 0xffd9a0, at.set(match.units[e.unit].bug.x, match.units[e.unit].bug.y + 3.2, match.units[e.unit].bug.z));
        break;
      case 'caught':
        texts.spawn('caught', 0xf2f2ee, at.set(e.x, e.y + 1.4, e.z));
        break;
      case 'box':
        hud.box(match.items.list.find((q) => q.id === e.id)?.by ?? 'bee');
        break;
      case 'explosion':
        // (an ant column digs: no fireball)
        if (!antColumn.camera.active && !flock.camera.active) flashes.spawn(at.set(e.x, e.y, e.z), e.radius);
        // (lumps of the ground thrown out, of its colour)
        {
          // (its outside's colour a little, mostly the broken inside, as the crater's walls)
          const c = scenario.inside?.skin ?? burrows.groundColor?.(e.x, e.y + e.radius, e.z) ?? [0.3, 0.27, 0.24];
          const k = scenario.inside?.core ?? [0.17, 0.15, 0.125];
          const l = scenario.inside?.line ?? k;
          buildViews.rubble(e.x, e.y, e.z, e.radius, [c[0] * 0.2 + k[0] * 0.8, c[1] * 0.2 + k[1] * 0.8, c[2] * 0.2 + k[2] * 0.8], c, [k[0] * 0.3 + l[0] * 0.7, k[1] * 0.3 + l[1] * 0.7, k[2] * 0.3 + l[2] * 0.7]);
        }
        // (a blast's crater is uneven: the same shape the terrain was carved to)
        stage.craters.add(e.x, e.y, e.z, e.radius, true);
        ground.addCrater(e.x, e.y, e.z, e.radius, true);
        lookAtSpot(e.x, e.y, e.z);
        ground.dropLoose(e.x, e.y, e.z, e.radius);
        break;
      case 'arc':
        lines.arc(at.set(e.x1, e.y1, e.z1), at2.set(e.x2, e.y2, e.z2));
        break;
      case 'burrow':
        // (a tunnel under the ground: no beam, the walls of it shaded as a tunnel's)
        // (its way up is not there yet: it breaks through at the end)
        for (let k = 0; k + 6 < e.path.length; k += 3) {
          const p = e.path;
          stage.craters.addTunnel(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5], e.radius);
          ground.addTunnel(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5], e.radius);
          ground.dropLoose(p[k], p[k + 1], p[k + 2], e.radius + 2);
        }
        burrowUp = [...e.path.slice(6, 12), e.radius];
        break;
      case 'emerge':
        if (burrowUp.length === 7) {
          const p = burrowUp;
          stage.craters.addTunnel(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
          ground.addTunnel(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
          ground.dropLoose(p[3], p[4], p[5], p[6] + 2);
          minimap.touch();
        }
        break;
      case 'opened':
        // (a tunnel's mouth opened to the sky: what is drawn over it opens, and what lay on it falls)
        stage.craters.addTunnel(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, e.radius);
        ground.addTunnel(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, e.radius);
        ground.dropLoose(e.x1, e.y1, e.z1, e.radius + 2);
        minimap.touch();
        break;
      case 'dig':
        lines.beam(at.set(e.x1, e.y1, e.z1), at2.set(e.x2, e.y2, e.z2));
        stage.craters.addTunnel(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, e.radius);
        ground.addTunnel(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, e.radius);
        for (let k = 0; k <= 4; k++) ground.dropLoose(e.x1 + ((e.x2 - e.x1) * k) / 4, e.y1 + ((e.y2 - e.y1) * k) / 4, e.z1 + ((e.z2 - e.z1) * k) / 4, e.radius + 2);
        break;
      case 'turn':
        chasePending = true;
        deathFocus = -1;
        hit.on = false;
        break;
      case 'death': {
        // a bug that fell out of the world is just gone; any other dies on screen, and the camera looks
        const u = match.units[e.unit];
        if (u.bug.y > KILL_Y && deathFocus < 0) deathFocus = e.unit;
        break;
      }
      case 'special':
        bowPending = match.currentWeapon.kind === 'arrow';
        break;
      case 'fire':
        hit.on = false;
        if (match.currentWeapon.kind === 'arrow') bow.onFire();
        else if (match.currentWeapon.kind === 'column') antColumn.onFire();
        else if (match.currentWeapon.kind === 'brood') brood.onFire(match, ground);
        else if (match.currentWeapon.kind === 'flock') flock.onFire();
        break;
      case 'ring':
        flock.onRing(e.index, e.x, e.y, e.z);
        break;
      case 'sting':
        flock.onSting(e.x, e.y, e.z, e.unit >= 0 ? bugViews[e.unit].view : null);
        break;
      case 'cover':
        brood.onCover(e.units, bugViews.map((v) => v.view));
        break;
      case 'lights':
        brood.onLights();
        break;
      case 'shell': {
        const u = match.units[e.unit];
        texts.spawn('shell cracked!', 0xffd9a0, at.set(u.bug.x, u.bug.y + bugViews[e.unit].height + 2.2, u.bug.z));
        break;
      }
      case 'swarm':
        antColumn.onSwarm();
        break;
      case 'collapse':
        antColumn.onCollapse(e.x, e.y, e.z);
        break;
      case 'gale': {
        // (from a little before the bug, along the aim; the view shakes with it)
        gales.spawn(at.set(e.x + e.dx * 0.8, e.y + e.dy * 0.8 + 0.4, e.z + e.dz * 0.8), at2.set(e.dx, e.dy, e.dz), e.reach, e.cone);
        shake = Math.max(shake, 0.22);
        break;
      }
      case 'arrow':
        // (a bug it hits: in the middle of it)
        if (e.unit >= 0) bow.onHit(match.units[e.unit].bug.x, match.units[e.unit].bug.y, match.units[e.unit].bug.z);
        else bow.onHit(e.x, e.y, e.z);
        break;
      case 'stuck': {
        const u = match.units[e.unit];
        lookAtUnit(e.unit, 1);
        texts.spawn('stuck!', 0xf2f2ee, at.set(u.bug.x, u.bug.y + bugViews[e.unit].height + 1, u.bug.z));
        break;
      }
      case 'damage':
        bestHit = Math.max(bestHit, e.amount);
        lookAtUnit(e.unit, e.amount);
        if (inScene()) {
          // (bite upon bite: one number in the end)
          const held = heldDamage.find((h) => h.unit === e.unit);
          if (held) held.amount += e.amount;
          else heldDamage.push({ unit: e.unit, amount: e.amount });
        }
        else showDamage(e.unit, e.amount, false);
        break;
      default:
        break;
    }
  }
}

/** Re-mesh whatever the last ticks carved (on the workers if there are any), and time it. */
function syncTerrain(): void {
  if (terrain.dirty.size === 0) return;
  if (workers) {
    workers.request(terrain, chunks.sharp);
    return;
  }
  const res = chunks.sync(terrain);
  state.lastExplosionMs = res.ms;
  state.lastExplosionChunks = res.chunks;
  refresh();
}

// ---- controls ----
const soundMenu = new SoundMenu(sound);
const controls = new Controls(window, (code) => {
  if (code === 'KeyN') newMatch(seed);
  // (M is the map in a match; the sound is K, as it is M in the menus)
  else if (code === 'KeyM') minimap.toggle();
  else if (code === 'KeyK') soundMenu.toggle();
  else if (code === 'KeyI' || code === 'KeyP') inventory.toggle();
  else if (code === 'KeyV') setCamera(!follow.stays);
});
controls.pickSlot = (n) => hud.pick(n);
const cameraButton = document.getElementById('camMode') as HTMLButtonElement;
function setCamera(stays: boolean): void {
  follow.stays = stays;
  cameraButton.textContent = `camera: ${stays ? 'sees through walls' : 'moves out of the way'}`;
  data.settings.set(CAMERA, stays ? 'stays' : 'moves');
}
cameraButton.addEventListener('click', () => {
  setCamera(!follow.stays);
  cameraButton.blur();
});
setCamera(data.settings.get<string>(CAMERA) !== 'moves');
const inventory = new Inventory(
  {
    weapon: (i) => controls.selectWeapon(i),
    item: (a) => a.item && controls.useItem(itemIndex(a.item)),
    drop: () => controls.selectWeapon(match.kept[match.activeUnit.team]),
  },
  HAND,
  data.cache,
);
hud.addInventory(inventory);
const minimap = new Minimap();
document.getElementById('hud')?.append(minimap.root);
inventory.experience = (team) => (equal || players[team] !== 'human' ? null : profile.of(picked[team].id).xp);
controls.bindButtons(hud.pad);
setupKeysMenu(controls);
if (hooks.fly) {
  // the free camera's keys, in the menu (opened below, so they show)
  (document.getElementById('hint') as HTMLElement).textContent =
    'Free camera: click the view to look round with the mouse (Esc frees the mouse) · W/S/A/D move · Q/E down / up · ' +
    'Shift faster, Ctrl slower · scroll: speed · R: back to the start · "back to the game" leaves';
}

// The menu (seed, benchmark, key help) starts closed after the setup screen, open without it.
(document.getElementById('panel') as HTMLDetailsElement).open = hooks.fly || params.get('play') === '1';
hud.seed.value = String(seed);
/** Keep the seed in the address, so a reload (the free camera's switch) shows the same map. */
const keepSeed = (): void => {
  params.set('seed', String(seed));
  history.replaceState(null, '', `?${params.toString()}`);
};
hud.regen.addEventListener('click', () => {
  seed = Number(hud.seed.value) | 0;
  keepSeed();
  newMatch(seed);
  hud.regen.blur();
});
hud.random.addEventListener('click', () => {
  seed = Math.floor(Math.random() * 99999); // UI only: never in generation/gameplay code
  hud.seed.value = String(seed);
  keepSeed();
  newMatch(seed);
  hud.random.blur();
});
// the free camera, to look round a map: the same map and seed, reloaded with (or without) `?fly=1`
const flyButton = document.getElementById('fly') as HTMLButtonElement;
flyButton.textContent = hooks.fly ? 'back to the game' : 'free camera';
flyButton.addEventListener('click', () => {
  params.set('seed', String(seed));
  if (hooks.fly) {
    params.delete('fly');
    params.set('play', '1');
  }
  else params.set('fly', '1');
  params.delete('flythrough');
  location.search = params.toString();
});
// the cinematic camera: the map's scripted flight, the same way (`?flythrough=1`)
const cineButton = document.getElementById('cine') as HTMLButtonElement;
/** Switch between the game and the cinematic camera: the same map and seed, reloaded. */
const setCinematic = (on: boolean): void => {
  params.set('seed', String(seed));
  params.delete('fly');
  if (on) params.set('flythrough', '1');
  else {
    params.delete('flythrough');
    params.set('play', '1');
  }
  location.search = params.toString();
};
cineButton.addEventListener('click', () => setCinematic(true));
hud.bench.addEventListener('click', () => {
  scenario.generate(terrain, seed, layout);
  chunks.sync(terrain);
  const r = runExplosionBenchmark(terrain, () => chunks.sync(terrain).chunks, 6, 60);
  newMatch(seed);
  state.bench =
    `benchmark ${r.count} explosions (radius ${r.radius}): mean ${r.meanMs.toFixed(1)} ms · ` +
    `median ${r.medianMs.toFixed(1)} · p95 ${r.p95Ms.toFixed(1)} · worst ${r.worstMs.toFixed(1)} ms (CPU, ${r.meanChunks.toFixed(1)} chunks/explosion)`;
  refresh();
  hud.bench.blur();
});

// ---- the setup screen, and the end of a match ----
/** The menu comes first, unless the address asks for something else (`?play=1`: straight into the match). */
const menuAtStart = !usesDebugCamera(hooks) && !hooks.perf && params.get('play') !== '1' && !online;
if (menuAtStart && params.get('seed') === null) seed = randomSeed();
const menus = {
  setup: false,
  over: false,
  time: 0,
  overFor: 0,
  starting: -1,
  /** Closing over the old map (seconds left), and waiting for the new one's chunks. */
  mapIn: -1,
  meshed: true,
  warm: true,
  /** The colours rip open over the match that starts. */
  ripping: false,
  ended: -1,
  /** A match was played on this map. */
  played: !menuAtStart,
  flare: 2.5,
};
/** The hardest blow of the match, for its end. */
let bestHit = 0;
const menuAt = new THREE.Vector3();
const heroes = new Heroes(stage.menu);
const flashEl = document.getElementById('flash') as HTMLElement;
const choice: SetupChoice = { scenario: scenario.id, species: [picked[0], picked[1]], specials: [specials[0], specials[1]], players: [players[0], players[1]], size: rules.size, seconds: rules.seconds, wind: rules.wind, seed, equal };
const setup = new SetupScreen(choice, {
  level: (i) => levelFor(i, choice.species, choice.players),
  onSpeciesPage: (i) => speciesPage.open(choice.species[i].id),
  onMap: () => {
    menus.mapIn = 0.42;
    setup.call();
    stage.menu.open.value = Math.min(stage.menu.open.value, 0.9);
  },
  onSpecies: (i) => {
    heroes.set(i, choice.species[i]);
  },
  onPlay: () => {
    menus.starting = 0;
    heroes.charge();
    sound.play('turn');
  },
  onHover: (i) => heroes.show(i),
  onReady: (on) => {
    heroes.ready = on;
  },
  onPick: (strong) => sound.play(strong ? 'select' : 'tick'),
  random: randomSeed,
  onMute: () => soundMenu.toggle(),
  onOnline: () => onlineBox.toggle(true),
});
/** Make a room with the setup as it is, or join one by its code: either way, the page goes to the room's address. */
const onlineBox = new OnlineBox(data.settings.get<string>('name') ?? '', {
  name: (n) => data.settings.set('name', n),
  create: async (name) => {
    data.settings.set('name', name);
    const sc = scenarioById(choice.scenario);
    const grown = (i: number): MatchSetup['teams'][number]['growth'] => (choice.equal ? undefined : i === 0 ? profile.growth(choice.species[0].id) : { level: 1, passives: [], items: {} });
    const setup: MatchSetup = {
      scenario: sc.id,
      size: mapSize(sc),
      seed: choice.seed,
      teams: [0, 1].map((i) => ({ name: `${i ? 'Blue' : 'Red'} ${PLURAL[choice.species[i].id]}`, species: choice.species[i].id, special: choice.specials[i] || undefined, color: i ? 0x5fb0ff : 0xff6b5e, size: choice.size, growth: grown(i) })),
      rules: { turnSeconds: choice.seconds, wind: choice.wind },
      tuning: { version: tuning.version, changed: { ...tuning.changed }, hash: tuning.hash },
      fresh: true,
    };
    const client = new NetClient(serverUrl(params, location));
    await client.open();
    const { code, token } = await client.create(name, setup);
    sessionStorage.setItem(tokenKey(code), token);
    goToRoom(code);
  },
  join: (code, name) => {
    data.settings.set('name', name);
    goToRoom(code);
  },
});
/** The page of room `code` (the room server kept in the address, if it is not the default). */
function goToRoom(code: string): void {
  const p = new URLSearchParams();
  p.set('room', code);
  const server = params.get('server');
  if (server) p.set('server', server);
  location.href = `?${p.toString()}`;
}
const speciesPage = new SpeciesPage(profile, (strong) => sound.play(strong ? 'select' : 'tick'), () => setup.refresh());
setup.root.append(soundMenu.panel(), speciesPage.root);
const ending = new EndScreen(
  () => {
    // (online, a match is one room's: another is made from the menu)
    if (online) return leaveRoom();
    closeEnding();
    if (ending.keeps) newTeams(randomSeed(), match.turntableTurns);
    else {
      seed = randomSeed();
      keepSeed();
      newMatch(seed);
    }
    flash();
  },
  () => {
    if (online) return leaveRoom();
    closeEnding();
    openSetup();
  },
);
function randomSeed(): number {
  return Math.floor(Math.random() * 99999); // UI only: never in generation/gameplay code
}
function flash(): void {
  flashEl.classList.remove('on');
  void flashEl.offsetWidth;
  flashEl.classList.add('on');
}
/** The menu's view of the map: the whole device, swayed round slowly, higher in the picture than the board in front. */
function menuView(t: number): void {
  const { p, t: to } = views.start;
  menuAt.set(p[0] - to[0], p[1] - to[1], p[2] - to[2]);
  const a = Math.sin(t * 0.13) * 0.3 + heroes.pointer.x * 0.015;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const far = 0.84 + 0.07 * Math.cos(t * 0.11);
  stage.camera.position.set(to[0] + (menuAt.x * c + menuAt.z * s) * far, to[1] + menuAt.y * far * (0.94 + 0.05 * Math.sin(t * 0.17)), to[2] + (menuAt.z * c - menuAt.x * s) * far);
  const drop = menuAt.length() * far * 0.17;
  stage.camera.lookAt(to[0], to[1] - drop, to[2]);
}
function openSetup(): void {
  params.delete('play');
  // (the last match's craters are gone: a new setup starts on a whole map)
  if (menus.played) {
    menus.played = false;
    menus.meshed = workers === null;
    newMatch(seed);
  }
  Object.assign(choice, { scenario: scenario.id, species: [picked[0], picked[1]], specials: [specials[0], specials[1]], players: [players[0], players[1]], size: rules.size, seconds: rules.seconds, wind: rules.wind, seed, equal });
  menus.setup = true;
  menus.starting = -1;
  menus.mapIn = -1;
  introT = -1;
  controls.enabled = false;
  document.body.classList.add('menu');
  stage.hud.visible = false;
  stage.menu.seam.value = 0;
  stage.menu.open.value = 0;
  stage.menu.amount.value = 1;
  stage.menu.show(true);
  menus.ripping = false;
  music.choose('menu');
  menus.time = 0;
  heroes.stage.setMap(scenario.id);
  heroes.clear();
  for (const i of [0, 1]) heroes.set(i, picked[i], 0.25 + i * 0.22);
  setup.show();
}
/** The choice becomes the match. */
function startMatch(): void {
  picked[0] = choice.species[0];
  picked[1] = choice.species[1];
  specials[0] = choice.specials[0];
  specials[1] = choice.specials[1];
  players[0] = choice.players[0];
  players[1] = choice.players[1];
  rules.size = choice.size;
  rules.seconds = choice.seconds;
  rules.wind = choice.wind;
  equal = choice.equal;
  params.set('teams', picked.map((q) => q.id).join());
  if (specials.some((s) => s)) params.set('specials', specials.join());
  else params.delete('specials');
  params.set('players', players.join());
  params.set('size', String(rules.size));
  params.set('turn', String(rules.seconds));
  params.set('wind', String(rules.wind));
  if (equal) params.set('equal', '1');
  else params.delete('equal');
  params.set('scenario', scenario.id);
  hud.seed.value = String(seed);
  keepSeed();
  setup.hide();
  heroes.clear();
  // (the colours shut for an instant, then rip open over the match)
  heroes.stage.root.visible = false;
  stage.menu.amount.value = 0;
  stage.menu.open.value = 0;
  stage.menu.glow.value = 2;
  menus.ripping = true;
  controls.enabled = true;
  menus.setup = false;
  menus.played = true;
  menus.starting = -1;
  accumulator = 0;
  music.choose(scenario.id);
  newTeams(seed);
  // (the flash gave way to the map: no long hold)
  introT = INTRO_HOLD * 0.35;
  flash();
}
/** The colours are open: the match has the picture. */
function endRip(): void {
  menus.ripping = false;
  stage.menu.glow.value = 0;
  stage.menu.open.value = 1.4;
  stage.menu.show(false);
  heroes.stage.root.visible = true;
  document.body.classList.remove('menu');
  stage.hud.visible = true;
}
function closeEnding(): void {
  if (!menus.over) return;
  menus.over = false;
  ending.hide();
  heroes.clear();
  stage.menu.amount.value = stage.menu.glow.value = 0;
  stage.menu.show(false);
  document.body.classList.remove('menu');
  stage.hud.visible = true;
  controls.enabled = true;
}
function openEnding(): void {
  menus.over = true;
  menus.ended = 0;
  controls.enabled = false;
  document.body.classList.add('menu');
  stage.hud.visible = false;
  stage.menu.open.value = 1.4;
  stage.menu.seam.value = match.winner < 0 ? 0 : match.winner ? -0.75 : 0.75;
  stage.menu.show(true);
  heroes.stage.setMap(scenario.id);
  heroes.clear();
  for (const i of [0, 1]) heroes.set(i, picked[i]);
  if (match.winner >= 0) heroes.celebrate(match.winner);
}
function showEnding(): void {
  const w = match.winner;
  const left = w >= 0 ? match.teamAlive(w) : 0;
  const numbers: [number, string][] = [[left, left === 1 ? 'survivor' : 'survivors'], [match.turnNumber, match.turnNumber === 1 ? 'turn' : 'turns'], [bestHit, 'best hit']];
  // ---- what it was worth
  const gains = [0, 1]
    .filter((i) => players[i] === 'human')
    .map((side) => {
      const versus = players[1 - side];
      const got = worth(match.tally[side], w === side, versus);
      const { before, after } = profile.gain(picked[side].id, got.xp, equal ? null : match.bag[side]);
      const k = VERSUS[versus] ?? 1;
      return { side, species: picked[side].id, xp: got.xp, lines: got.lines, note: k < 1 ? `against the computer: ×${k}` : '', before, after };
    });
  if (w >= 0) ending.show(`${match.teams[w].name.replace('Cockroaches', 'Roaches')} win`, w ? '#8ccaff' : '#ff7a68', numbers, gains);
  else ending.show('Nobody left', '#ffb547', numbers, gains);
}
heroes.onLand = () => sound.play('land');
heroes.onShow = () => sound.play('tick');
heroes.onMeet = () => {
  sound.play('impact');
  startMatch();
};
function updateMenus(dt: number): void {
  const layer = stage.menu;
  if (menus.ripping) {
    layer.time.value += dt;
    layer.open.value += dt * (0.5 + layer.open.value * 4.5);
    layer.glow.value = Math.max(0, 2 * (1 - layer.open.value * 1.1));
    if (layer.open.value > 1.2) endRip();
    return;
  }
  if (!menus.setup && !menus.over) {
    if (match.phase !== 'over' || debugCamera) menus.overFor = 0;
    else if ((menus.overFor += dt) > 2.6 && !inScene()) openEnding();
    return;
  }
  const ease = 1 - Math.exp(-dt * 4);
  menus.time += dt;
  layer.time.value += dt;
  menus.flare -= dt;
  if (menus.flare < 0) menus.flare = 2 + Math.random() * 2.2;
  layer.flare.value = menus.flare < 0.35 || menus.starting >= 0 ? 1 : layer.flare.value * Math.exp(-dt * 5);
  if (menus.setup) {
    layer.amount.value += (1 - layer.amount.value) * ease;
    layer.glow.value += ((menus.starting >= 0 ? 2.6 : 1) - layer.glow.value) * ease;
    // another map: the colours shut over the old one, the map is made, they open on the new one
    if (menus.mapIn >= 0) {
      layer.open.value = Math.max(0, layer.open.value - dt * 4.2);
      if ((menus.mapIn -= dt) <= 0) {
        menus.mapIn = -1;
        menus.meshed = workers === null;
        scenario = scenarioById(choice.scenario);
        seed = choice.seed;
        hud.seed.value = String(seed);
        newMatch(seed);
        music.choose('menu');
        menus.warm = false;
        void stage.warm().then(() => {
          menus.warm = true;
        });
        heroes.stage.setMap(scenario.id);
        introT = -1;
        menus.time = 0;
      }
    } else if (menus.meshed && menus.warm && layer.open.value < 1.4) {
      if (layer.open.value === 0) setup.uncall();
      layer.open.value += dt * (0.35 + layer.open.value * 3.4);
    }
  } else {
    layer.amount.value += (1 - layer.amount.value) * ease;
    if (menus.ended >= 0 && (menus.ended += dt) > 1) {
      menus.ended = -1;
      showEnding();
    }
  }
  heroes.update(dt);
}
window.addEventListener('pointermove', (e) => {
  heroes.pointer.set((e.clientX / window.innerWidth) * 2 - 1, 1 - (e.clientY / window.innerHeight) * 2);
});
(document.getElementById('toSetup') as HTMLButtonElement).addEventListener('click', () => {
  pauseMenu.close();
  openSetup();
});

// ---- the settings page (development): the numbers the next match is tuned by ----
const tuningPage = new TuningPage(
  TUNING,
  tuning,
  (s) => {
    tuning = s;
    data.settings.set('tuning', keptOf(s));
  },
  () => match.tuning,
  // (for testing: each species' level with this player, or the species as never played)
  (into) => {
    into.innerHTML = '<h3>Your growth (testing)</h3>';
    for (const s of SPECIES) {
      const row = document.createElement('div');
      row.className = 'tuning-row';
      const name = document.createElement('span');
      name.textContent = PLURAL[s.id];
      const pick = document.createElement('select');
      const now = profile.level(s.id).level;
      for (let l = 1; l <= LEVELS; l++) pick.add(new Option(`Level ${l}`, String(l), false, l === now));
      pick.addEventListener('change', () => {
        profile.setLevel(s.id, Number(pick.value));
        grown();
      });
      const xp = document.createElement('small');
      xp.textContent = `${profile.of(s.id).xp} xp`;
      const back = document.createElement('button');
      back.className = 'tuning-back';
      back.textContent = '↺';
      back.title = 'as never played';
      back.addEventListener('click', () => {
        profile.reset(s.id);
        grown();
      });
      row.append(name, pick, xp, document.createElement('span'), back);
      into.append(row);
    }
  },
);
/** The player's growth changed (from the settings page): what shows it, anew. */
function grown(): void {
  tuningPage.refresh();
  if (menus.setup) setup.refresh();
}
(document.getElementById('tuningOpen') as HTMLButtonElement).addEventListener('click', (e) => {
  tuningPage.toggle();
  (e.currentTarget as HTMLButtonElement).blur();
});

// ---- the pause box: Esc or its button; Continue, Restart (the same match anew), Leave match (to the setup) ----
/** When the mouse was last given back by a flight (the same Esc must not pause too). */
let mouseFreedAt = -1e9;
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) mouseFreedAt = performance.now();
});
/** Controls were on when it opened (they come back on with it closing). */
let controlsWere = false;
const pauseMenu = new PauseMenu(
  // (only in a match being played: not while the box warms up, in the menus, its intro's rip, the end, nor a camera of its own)
  () => !document.getElementById('loading') && !menus.setup && !menus.over && !menus.ripping && !debugCamera && !document.body.classList.contains('cinematic'),
  {
    open: () => {
      controlsWere = controls.enabled;
      controls.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      sound.hold(true);
    },
    close: () => {
      if (controlsWere) controls.enabled = true;
      controlsWere = false;
      sound.hold(false);
    },
    // (the same map, teams, rules and seed, from the start; nobody gains from the match left)
    restart: () => {
      accumulator = 0;
      newMatch(seed);
      flash();
    },
    // (back to the setup: nobody gains from the match left; online, the room is left)
    leave: () => (online ? leaveRoom() : openSetup()),
  },
  () => ({
    place: scenario.name,
    turn: match.turnNumber + 1,
    teams: match.teams.map((q, i) => ({ name: q.name.replace('Cockroaches', 'Roaches'), color: i ? '#5fb4ff' : '#ff5a45', health: match.teamHealth(i), alive: match.teamAlive(i) })),
  }),
);
document.getElementById('hud')?.append(pauseMenu.button);
// (online, a match is not played again from its start: it is the room's)
if (online) pauseMenu.withRestart(false);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat || e.defaultPrevented) return;
  // (the Esc that gives the mouse back from a flight is that, not a pause)
  if (document.pointerLockElement || performance.now() - mouseFreedAt < 400) return;
  if (!pauseMenu.open) {
    // (what is open over the match closes first)
    if (inventory.isOpen) return inventory.toggle(false);
    if (minimap.big) return minimap.toggle(false);
  }
  if (pauseMenu.toggle()) e.preventDefault();
});

// Dev only, and only asked for (`?boom=1`): shift+click blows up the terrain under the pointer (handy to test falls and
// damage). (Shift is also the run key: never on in a match by itself.)
if (import.meta.env.DEV && new URLSearchParams(location.search).get('boom') === '1') {
  canvas.addEventListener('pointerup', (e) => {
    if (!e.shiftKey || e.button !== 0) return;
    const p = pickTerrain(e, canvas, stage.camera, terrain);
    if (!p) return;
    match.explode(p.x, p.y, p.z, SOLDER_BLOB);
    if (recorder) recorder.touched = true;
    handleEvents(match.events);
    gameSounds.tick(match, false);
    syncTerrain();
  });
}

// ---- cameras: the game's orbit/follow camera, or a debug camera (pose, fly-through, free) ----
/** The game camera starts on the scenario's start pose, holds it, then glides to the first bug. */
const INTRO_HOLD = 2.2;
const INTRO_GLIDE = 1.6;
let introT = -1;
/** A turn started: glide to the chase view of the new active bug. */
let chasePending = false;
/** A bug dying at the end of a turn: the camera looks at it until the next turn (-1: none). */
let deathFocus = -1;
/** What the shot hit: the camera stays on it (the bug it hurt most, or the spot) after the shot is gone. */
const hit = { on: false, unit: -1, amount: 0, until: 0, at: new THREE.Vector3() };
/** The computer's hits stay in view until the next turn; a player gets back to the shooter sooner, or at once by walking. */
const HIT_TICKS = Math.round(1.6 * TICK_RATE);
function lookAtSpot(x: number, y: number, z: number): void {
  if (match.phase !== 'flight' || inScene() || (hit.on && hit.unit >= 0)) return;
  hit.on = true;
  hit.unit = -1;
  hit.amount = 0;
  hit.until = match.tick + TICK_RATE;
  hit.at.set(x, y, z);
}
function lookAtUnit(unit: number, amount: number): void {
  if ((match.phase !== 'flight' && match.phase !== 'settle') || inScene()) return;
  if (!hit.on) hit.unit = -1;
  if (hit.unit < 0) hit.amount = 0;
  hit.on = true;
  hit.until = match.tick + HIT_TICKS;
  // (the shooter hurts itself as well: the one it shot at is what to look at)
  const own = unit === match.active && hit.unit >= 0 && hit.unit !== unit;
  const other = unit !== match.active && hit.unit === match.active;
  if (own || (!other && hit.unit !== unit && amount <= hit.amount)) return;
  hit.amount = hit.unit === unit ? hit.amount + amount : amount;
  hit.unit = unit;
  const b = match.units[unit].bug;
  hit.at.set(b.x, b.y, b.z);
}
function looksAtHit(): boolean {
  if (!hit.on || (match.phase !== 'flight' && match.phase !== 'settle' && match.phase !== 'spin')) return false;
  if (deathFocus >= 0) return false;
  if (!notMine() && match.phase === 'flight' && (match.tick > hit.until || (match.retreatTicks > 0 && controls.moveHeld !== 0))) {
    hit.on = false;
    return false;
  }
  if (hit.unit >= 0) {
    // (one knocked off the map: the camera stays where it went)
    const b = match.units[hit.unit].bug;
    if (b.alive && b.y > 0) hit.at.copy(bugViews[hit.unit].view.root.position);
  }
  return true;
}
/** The player is turning the view with the right button: the active bug faces where the view looks. */
let orbiting = false;
/** Seconds the bug keeps facing the view after the button is released (the orbit damping still turns it). */
const ORBIT_TAIL = 0.6;
let orbitTail = 0;
/** How long the turn keys have been held while the view is held (seconds), and which way. */
let turnHold = 0;
let turnDir = 0;
// (the right button turns the view or the aim: no browser menu over the game. The orbit controls only
// block it while they are enabled, and a special attack turns them off. Text fields keep theirs, to paste a seed)
window.addEventListener('contextmenu', (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
});
canvas.addEventListener('pointerdown', (e) => {
  // (marking a spot: the left button calls the swarm, the right one turns the view over it)
  if (marking()) {
    if (e.button === 0) controls.click();
    return;
  }
  // (a click sends the swarm off)
  if (flockAims()) {
    if (e.button === 0 && !match.flock) controls.click();
    return;
  }
  if (places() && e.button === 0) {
    const p = placing.click();
    if (p) {
      controls.placeAt(p);
      placing.clear();
    } else if (placing.shown && placing.shown.why !== '') texts.spawn(placing.shown.why, 0xff8a6a, at.set(placing.shown.place[0], placing.shown.place[1] + 2, placing.shown.place[2]));
  }
  if (e.button === 2) {
    orbiting = true;
    rightFrom.x = e.clientX;
    rightFrom.y = e.clientY;
  }
});
/** Where the right button went down: let go there, it drops what is being placed. */
const rightFrom = { x: 0, y: 0 };
window.addEventListener('pointerup', (e) => {
  if (e.button !== 2 || !orbiting) return;
  if (places() && Math.hypot(e.clientX - rightFrom.x, e.clientY - rightFrom.y) < 6 && !placing.back()) {
    placing.clear();
    controls.selectWeapon(match.kept[match.activeUnit.team]);
  }
  orbiting = false;
  orbitTail = ORBIT_TAIL;
});
/** In a stance the mouse aims (the right button held): turns the bug and raises its aim. */
const SIGHT_SPEED = 0.0022;
/** Where the pointer is, for the spot it marks. */
const pointer = { clientX: -1, clientY: -1 };
/** The pointer is on the cards, not on the map. */
let overHud = false;
window.addEventListener('pointermove', (e) => {
  overHud = e.target !== canvas;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (marking()) brood.camera.zoomBy(Math.exp(e.deltaY * 0.001));
    else if (places()) placing.turn(Math.sign(e.deltaY));
  },
  { passive: true },
);
canvas.addEventListener('pointermove', (e) => {
  pointer.clientX = e.clientX;
  pointer.clientY = e.clientY;
  if (marking()) {
    if ((e.buttons & 2) !== 0) brood.camera.turn(-e.movementX * 0.005, e.movementY * 0.004);
    return;
  }
  // (a swarm: the mouse alone turns its bee, then flies it)
  if (flockAims()) {
    const f = match.flock;
    const u = match.activeUnit;
    if (swarmAim.hold <= 0) {
      swarmAim.yaw = f ? Math.atan2(f.fx, f.fz) : Math.atan2(u.bug.fx, u.bug.fz);
      swarmAim.pitch = f ? Math.asin(f.v) : Math.atan2(u.aimV, u.aimH);
    }
    // (some browsers report a leap now and then)
    const most = (v: number): number => Math.max(-160, Math.min(160, v));
    // (seen from the front as it sets out: to the sides only once the view is behind it)
    if (!f || f.age > 36) swarmAim.yaw -= most(e.movementX) * SWARM_SPEED;
    swarmAim.pitch = Math.max(-1, Math.min(1.1, swarmAim.pitch - most(e.movementY) * SWARM_SPEED));
    swarmAim.hold = SWARM_HOLD;
    return;
  }
  if (notMine() || !match.stance || match.phase !== 'aim' || (e.buttons & 3) === 0) return;
  const slow = SIGHT_SPEED * (match.charging ? 0.6 : 1);
  const b = match.activeUnit.bug;
  const a = -e.movementX * slow;
  // (from where the last movement of this frame left it)
  if (stanceFace.tick !== match.tick) {
    stanceFace.x = b.fx;
    stanceFace.z = b.fz;
    stanceFace.tick = match.tick;
  }
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = stanceFace.x * c + stanceFace.z * s;
  stanceFace.z = stanceFace.z * c - stanceFace.x * s;
  stanceFace.x = x;
  controls.face(stanceFace.x, stanceFace.z);
  controls.tilt(-e.movementY * slow);
});
/** Where the mouse points the swarm (radians), and the ticks left in which it still turns there. */
const swarmAim = { yaw: 0, pitch: 0, hold: 0 };
const SWARM_SPEED = 0.0026;
const SWARM_HOLD = 40;
/** It points no further off its way than this. */
const SWARM_LEAD = 0.7;
/** The player aims, or flies, a swarm. */
function flockAims(): boolean {
  return !notMine() && !debugCamera && (match.flock !== null || (match.stance && match.phase === 'aim' && match.currentWeapon.kind === 'flock'));
}
/** The next tick's input turns the swarm (or its bee) towards where the mouse points. */
function steerSwarm(): void {
  if (swarmAim.hold <= 0) return;
  if (!flockAims() || controls.turnHeld !== 0 || (match.flock && controls.moveHeld !== 0)) {
    swarmAim.hold = 0;
    return;
  }
  swarmAim.hold--;
  const f = match.flock;
  const u = match.activeUnit;
  const yaw = f ? Math.atan2(f.fx, f.fz) : Math.atan2(u.bug.fx, u.bug.fz);
  const pitch = f ? Math.asin(f.v) : Math.atan2(u.aimV, u.aimH);
  const most = (v: number): number => Math.max(-SWARM_LEAD, Math.min(SWARM_LEAD, v));
  const off = most(Math.atan2(Math.sin(swarmAim.yaw - yaw), Math.cos(swarmAim.yaw - yaw)));
  swarmAim.yaw = yaw + off;
  swarmAim.pitch = pitch + most(swarmAim.pitch - pitch);
  // (softly into it)
  controls.face(Math.sin(yaw + off * 0.4), Math.cos(yaw + off * 0.4));
  controls.tilt(Math.max(-0.05, Math.min(0.05, (swarmAim.pitch - pitch) * 0.4)));
}
/** As long as a player flies, the mouse is the game's (Escape gives it back). */
function holdMouse(): void {
  const locked = document.pointerLockElement === canvas;
  const want = match.flock !== null && flockAims();
  if (want && !mouseAsked && !locked) void Promise.resolve(canvas.requestPointerLock?.()).catch(() => undefined);
  else if (!want && mouseAsked && locked) document.exitPointerLock();
  mouseAsked = want;
}
let mouseAsked = false;
const stanceFace = { x: 0, z: 1, tick: -1 };
window.addEventListener('blur', () => {
  orbiting = false;
  orbitTail = 0;
});
/** Whose facing the camera turns with, and that facing last frame (radians, render only). */
let chaseUnit = -1;
let chaseYaw = 0;
let introReady = false;
const introFrom = new THREE.Vector3();
const introFromTarget = new THREE.Vector3();
const introTo = new THREE.Vector3();
const introToTarget = new THREE.Vector3();
const debugCamera = usesDebugCamera(hooks);
let fly: FlyCamera | null = null;
let path: CameraPath | null = null;
/** Fly-through time; null: follows the clock, a number: frozen there (`__debug.seek`). */
let pathFrozenAt: number | null = null;
let pathStart = performance.now();

function startCamera(): void {
  const k = views.start;
  stage.camera.position.set(...k.p);
  stage.controls.target.set(...k.t);
  stage.camera.lookAt(stage.controls.target);
  if (debugCamera) {
    stage.controls.enabled = false;
    if (hooks.pose > 0) applyPose(stage.camera, views.poses[Math.min(hooks.pose, views.poses.length) - 1]);
    // the path keeps clear of the terrain inside the map; above the top layers (over the walls, the glass)
    // it may pass freely
    const top = layout.glassY > 0 ? layout.glassY - 2 : terrain.H;
    if (hooks.flythrough) path = new CameraPath(views.path, views.duration, { sample: (x, y, z) => (y > top ? 99 : terrain.sample(x, y, z)) });
    if (hooks.fly && !fly) fly = new FlyCamera(stage.camera, canvas, views.start);
    pathStart = performance.now();
    return;
  }
  stage.controls.update();
  introT = 0;
  introReady = false;
}

/** Hold the start pose, then glide from it to where the follow camera will be. True while it runs. */
function updateIntro(dt: number): boolean {
  if (introT < 0) return false;
  introT += dt;
  if (introT < INTRO_HOLD) return true;
  if (!introReady) {
    introReady = true;
    introFrom.copy(stage.camera.position);
    introFromTarget.copy(stage.controls.target);
    const first = match.activeUnit.bug;
    introToTarget.copy(bugViews[match.active].view.root.position);
    follow.chasePose(terrain, introToTarget, first.fx, first.fz, introTo);
  }
  const u = Math.min(1, (introT - INTRO_HOLD) / INTRO_GLIDE);
  const e = u * u * (3 - 2 * u);
  stage.camera.position.lerpVectors(introFrom, introTo, e);
  stage.controls.target.lerpVectors(introFromTarget, introToTarget, e);
  stage.camera.lookAt(stage.controls.target);
  if (u < 1) return true;
  introT = -1;
  follow.focus(stage.controls.target, stage.camera.position.distanceTo(stage.controls.target));
  chasePending = false;
  hit.on = false;
  chaseUnit = match.active;
  chaseYaw = Math.atan2(match.activeUnit.bug.fx, match.activeUnit.bug.fz);
  return false;
}

const perf = hooks.perf
  ? new PerfLog(stage.gpuTimer, () => ({
      scenario: scenario.id,
      map: `${terrain.cx}x${terrain.cy}x${terrain.cz}`,
      backend: stage.backend,
      resolution: `${canvas.width}x${canvas.height}`,
    }))
  : null;
const pathTarget = new THREE.Vector3();

/**
 * Render-only time (RGB hue, LEDs, dust, shimmer). On a fixed pose it runs at a fixed 60 Hz step for
 * POSE_SETTLE seconds and then stops, so a pose renders the same image on every run.
 */
const POSE_SETTLE = 6;
let renderFrames = 0;
function renderSeconds(now: number): number {
  if (hooks.pose > 0) return Math.min(renderFrames, POSE_SETTLE * 60) / 60;
  return now / 1000;
}
function renderStep(dt: number): number {
  if (hooks.pose > 0) return renderFrames++ < POSE_SETTLE * 60 ? 1 / 60 : 0;
  return dt;
}

/** True if terrain lies between the camera and `p` (the density field, as gameplay sees it). */
/** Half the game's own view, as a tangent. */
const LENS = Math.tan((55 * Math.PI) / 360);
const toBug = new THREE.Vector3();
function occluded(p: THREE.Vector3, dist: number): boolean {
  const c = stage.camera.position;
  toBug.copy(p).sub(c).divideScalar(dist || 1);
  const hit = terrain.raycast(c.x, c.y, c.z, toBug.x, toBug.y, toBug.z, dist - 1.5);
  return hit >= 0;
}

// ---- loop: fixed-step simulation, interpolated rendering ----
window.addEventListener('resize', stage.resize);
const target = new THREE.Vector3();
const camDir = new THREE.Vector3();
const frameMs = new Float32Array(120);
let frameCount = 0;
let lastFps = performance.now();
let lastFrame = performance.now();
let accumulator = 0;
/** One tick of the match, recorded. */
/** One tick of the match, recorded (online: in lockstep). False: online, and the other's input for it has not come. */
function step(input: Readonly<MatchInput>): boolean {
  const l = online?.lock;
  if (l) return l.step(l.own ? input : NO_INPUT);
  if (recorder) recorder.step(input);
  else match.step(input);
  if (match.phase === 'over') keepRecord('over');
  return true;
}
/** The turntable's turns before the last tick (render interpolates the plate between ticks). */
let prevTurns = 0;

// ---- online, while a match is played: what comes in, what goes out, and the line that says how it stands ----
const onlineStatus = new OnlineStatus();
if (online) {
  document.getElementById('hud')?.append(onlineStatus.root);
  online.client.on((m) => {
    const o = online;
    if (!o) return;
    if (m.t === 'inputs') {
      // (a batch that does not follow on: this side lost its place; it starts again from the room's inputs)
      if (!o.lock) o.early.push(m);
      else if (!o.lock.take(m)) location.reload();
    } else if (m.t === 'held') o.held = m.why ? { why: m.why, until: performance.now() + m.left * 1000 } : null;
    else if (m.t === 'desync') o.desync = m.tick;
    else if (m.t === 'refused') console.warn(`the room refused: ${m.why}`);
  });
  online.client.onLost = () => {
    onlineStatus.show('Connection lost: coming back…', true);
    setTimeout(() => location.reload(), 2000);
  };
}
/** After the frame's ticks: catch up with what came, send this side's inputs and checkpoints, say how it stands. */
function playOnline(): void {
  const o = online;
  const l = o?.lock;
  if (!o || !l) return;
  // (well behind the other: catch up, a little faster than the clock)
  for (let n = 0; n < 30 && !l.own && l.knownUpTo - l.tick > 10; n++) {
    if (!step(NO_INPUT)) break;
    handleEvents(match.events);
    gameSounds.tick(match, inScene() !== null);
  }
  const b = l.batch();
  if (b) o.client.send(b);
  for (; o.sentChecks < l.digests.length; o.sentChecks++) o.client.send({ t: 'check', tick: (o.sentChecks + 1) * EVERY, digest: l.digests[o.sentChecks] });
  const other = 1 - o.seat;
  const them = o.names[other] || 'the other player';
  const hold = o.held && !l.own ? `${them} ${o.held.why === 'reading' ? 'is reading' : 'paused'} · ${Math.max(0, Math.ceil((o.held.until - performance.now()) / 1000))} s left` : '';
  const mine = l.own && pauseMenu.open ? (pauseReserve.left > 0 ? ` · paused: ${Math.ceil(pauseReserve.left)} s left` : ' · no pause left: your turn goes on') : '';
  const turn = l.own ? `your turn${mine}` : !o.here[other] ? `${them} is away` : hold || (!l.ready ? `waiting for ${them}…` : `${them}'s turn`);
  const off = o.desync >= 0 ? ` · out of step since tick ${o.desync}` : tuning.hash !== o.setup.tuning.hash ? ' · another version of the game' : '';
  onlineStatus.show(`Room ${o.code} · ${o.names[0] || 'Red'} vs ${o.names[1] || 'Blue'} · ${turn}${off}`, off !== '' || !o.here[other]);
}
/** Time per frame for indexing the drawn ground of a new map (ms). */
const INDEX_MS = 3;
let paused = false;
/** Paused, and played on by hand (`__debug.advance`): the clock is its own. */
let advancing = false;
/** The last frame's view belonged to a special attack's scene. */
let wasSpecial = false;
function loop(now: number): void {
  requestAnimationFrame(loop);
  // (online, the pause box holds the match only on this side's own turn, and only from its reserve)
  if (paused || (pauseMenu.open && (!online || pauseHolds(now)))) {
    if (!advancing) lastFrame = now;
    return;
  }
  frame(now);
}
/** Online, with the pause box open: whether it holds the match now (this side's turn, reserve left); it spends it. */
function pauseHolds(now: number): boolean {
  const l = online?.lock;
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  const holds = !!l && pauseReserve.hold(l.own, dt);
  if (holds) tellHold('paused', pauseReserve.left);
  pauseMenu.note(
    !l ? '' : !l.own ? 'The match goes on: it is not your turn.' : holds ? `The match waits for you: ${Math.ceil(pauseReserve.left)} s of pause left.` : 'No pause left: your turn goes on.',
  );
  return holds;
}
/** What this side last told the other of its hold (online). */
const told = { why: null as HoldWhy | null, left: -1, at: 0 };
/** Tell the other why the match stands still on this side's turn (when that changes, and every second of it). */
function tellHold(why: HoldWhy | null, left: number): void {
  const o = online;
  if (!o) return;
  const now = performance.now();
  if (why === told.why && (why === null || now - told.at < 1000)) return;
  told.why = why;
  told.left = left;
  told.at = now;
  o.client.send({ t: 'hold', why, left: Math.round(left * 10) / 10 });
}

/** The player hears from where the view is. */
const hearUp = new THREE.Vector3();
function hear(): void {
  const c = stage.camera;
  c.getWorldDirection(camDir);
  hearUp.set(0, 1, 0).applyQuaternion(c.quaternion);
  sound.listen(c.position.x, c.position.y, c.position.z, camDir.x, camDir.y, camDir.z, hearUp.x, hearUp.y, hearUp.z);
}
const bowState = { active: false, hitFor: -1, time: -1 };
const flockState = { active: false, hitFor: -1, time: -1 };
const columnState = { active: false, hitFor: -1, time: -1 };
const broodState = { active: false, hitFor: -1, time: -1 };

function frame(now: number): void {
  // after a stall, drop time instead of spiralling; never negative (the first frame's timestamp can be
  // older than `lastFrame`, which would end the intro before it starts)
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  const interval = now - lastFrame;
  frameMs[frameCount++ % frameMs.length] = interval;
  lastFrame = now;

  const inMenu = menus.setup;
  const intro = !debugCamera && !inMenu && updateIntro(dt);
  // while the player turns the view, the bug faces where it looks (aiming, or walking away after a shot)
  const steering = match.phase === 'aim' || (match.phase === 'flight' && match.retreatTicks > 0);
  const viewTurns = orbiting || orbitTail > 0;
  orbitTail = Math.max(0, orbitTail - dt);
  stage.controls.enabled = !inScene() && !debugCamera && !inMenu && !menus.over;
  if (viewTurns && !inScene() && !debugCamera && !intro && !follow.gliding && steering && !notMine() && match.activeUnit.bug.alive) {
    // the turn keys still turn the bug while the view is held: they turn the view (at the bug's turn
    // rate, with the same slow start for fine steps), and the bug faces where it looks
    const turn = controls.turnHeld;
    turnHold = turn !== 0 && turn === turnDir ? turnHold + dt : 0;
    turnDir = turn;
    if (turn !== 0) follow.turnWith(-turn * match.activeUnit.bug.species.turnRate * Math.min(1, 0.15 + (0.85 * turnHold) / 0.6) * dt);
    const c = stage.camera.position;
    const t = stage.controls.target;
    controls.face(t.x - c.x, t.z - c.z);
  }
  if (marking()) {
    // (no pointer yet: the middle of the view)
    if (pointer.clientX < 0) {
      const box = canvas.getBoundingClientRect();
      pointer.clientX = box.left + box.width / 2;
      pointer.clientY = box.top + box.height / 2;
    }
    const p = pickTerrain(pointer, canvas, stage.camera, terrain);
    // (a bug under the pointer: where it stands, not what lies behind it)
    if (p) {
      const eye = stage.camera.position;
      at.copy(p).sub(eye);
      let far = at.length();
      at.divideScalar(far);
      for (const u of match.units) {
        if (!u.bug.alive || u === match.activeUnit) continue;
        const b = u.bug;
        const t = at2.set(b.x, b.y, b.z).sub(eye).dot(at);
        if (t < 0 || t > far || at2.addScaledVector(at, -t).length() > b.species.radius + 0.3) continue;
        far = t;
        p.set(b.x, b.y, b.z);
        if (b.grounded) p.addScaledVector(at2.set(b.nx, b.ny, b.nz), -b.species.radius);
      }
    }
    if (p) controls.markAt(p.x, p.y, p.z);
  }
  brood.pan = marking() ? controls.moveHeld : 0;
  // (the wheel turns what is placed, not the view)
  stage.controls.enableZoom = !places();
  if (!places() || inMenu) placing.clear();
  else placing.update(match, match.activeUnit, match.currentWeapon, pointer.clientX < 0 || overHud ? null : pickTerrain(pointer, canvas, stage.camera, terrain, seeThrough.on ? Math.max(0, stage.camera.position.distanceTo(stage.controls.target) - 4) : 0));
  let faced = false;
  // (a special attack slows the match for a moment: the same ticks, later)
  const scaled = dt * Math.min(bow.timeScale, antColumn.timeScale, brood.timeScale, flock.timeScale);
  // (reading: time stands still)
  const readKey = `${match.turnNumber}|${match.active}`;
  if (reading.key !== readKey) {
    reading.key = readKey;
    reading.turn = match.tuning.get(RULE.readTurn);
  }
  const team = match.activeUnit.team;
  if (minimap.big && (brain() || match.phase === 'over' || inMenu || menus.over)) minimap.toggle(false);
  reading.on = (inventory.isOpen || minimap.big) && !notMine() && !inMenu && !menus.over && match.phase === 'aim' && !inScene() && reading.turn > 0 && reading.match[team] > 0;
  if (reading.on) {
    reading.turn -= dt;
    reading.match[team] -= dt;
  }
  controls.frozen = inventory.locked = reading.on;
  // (online: the other is told this side reads, or no longer holds the match)
  if (online?.lock?.own) tellHold(reading.on ? 'reading' : null, Math.min(reading.turn, reading.match[team]));
  hud.reading(reading.on ? Math.min(reading.turn, reading.match[team]) : -1, (inventory.isOpen || minimap.big) && match.phase === 'aim' && !notMine() && !reading.on);
  if (!inMenu && !reading.on) accumulator += scaled;
  while (accumulator >= DT) {
    prevTurns = match.turntableTurns;
    // a debug camera (or the intro) owns the view: the match keeps running without input
    let stepped: boolean;
    if (debugCamera || intro || menus.over) stepped = step(NO_INPUT);
    else {
      // (while the computer plays, the player's keys go nowhere)
      steerSwarm();
      const typed = controls.next();
      const b = brain();
      stepped = step(b ? b.next(match) : typed);
      faced ||= !b && controls.faced;
    }
    if (!stepped) {
      // (online, the other's input has not come: wait for it, without saving the time up)
      accumulator = Math.min(accumulator, DT);
      break;
    }
    handleEvents(match.events);
    gameSounds.tick(match, inScene() !== null);
    accumulator -= DT;
  }
  if (online) playOnline();
  syncTerrain();
  const alpha = accumulator / DT;
  holdMouse();
  stage.setTurntable(prevTurns + (match.turntableTurns - prevTurns) * alpha);

  // the turntable rests at a new place: so do the things on it
  if (match.turntableTurns !== indexedTurns && match.turntableTurns === prevTurns && match.phase !== 'spin') {
    indexedTurns = match.turntableTurns;
    ground.reindex(stage.scene, [...bugViews.map((v) => v.view.root), buildViews.root]);
  }
  ground.step(INDEX_MS);
  // (the special attack's scene first: it sets the pose the bug is then drawn in)
  if (bowPending) {
    bowPending = false;
    const u = match.activeUnit;
    bow.prepare(bugViews[match.active].view, at.set(u.bug.nx, u.bug.ny, u.bug.nz).clone(), ground);
  }
  bow.update({ match, view: bugViews[match.active].view, views: bugViews.map((v) => v.view), ground, camera: stage.camera, alpha, dt: scaled });
  antColumn.update({ match, view: bugViews[match.active].view, views: bugViews.map((v) => v.view), ground, camera: stage.camera, alpha, dt: scaled });
  brood.update({ match, view: bugViews[match.active].view, views: bugViews.map((v) => v.view), ground, camera: stage.camera, alpha, dt: scaled });
  flock.update({ match, view: bugViews[match.active].view, views: bugViews.map((v) => v.view), ground, camera: stage.camera, alpha, dt: scaled });
  const sceneNow = inScene();
  buildViews.pose(match, bugViews.map((v) => v.view));
  match.units.forEach((u, i) => {
    const v = bugViews[i];
    v.view.held = u.web >= 0 ? 1 : 0;
    v.view.cracked = u.bug.species.shell === true && !u.shell;
    v.view.update(u.bug, alpha, scaled, ground);
    // (an ant under the ground: head down on its way in, up on its way out)
    const under = match.underground;
    if (under && under.unit === i) {
      const p = under.path;
      const k = under.s < Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]) ? 0 : under.s > under.end - Math.hypot(p[9] - p[6], p[10] - p[7], p[11] - p[8]) ? 6 : 3;
      const dy = (p[k + 4] - p[k + 1]) / (Math.hypot(p[k + 3] - p[k], p[k + 4] - p[k + 1], p[k + 5] - p[k + 2]) || 1);
      v.view.root.rotateX(-Math.asin(Math.max(-1, Math.min(1, dy))) * 0.85);
    }
    // (a bug walking through a tunnel: head down or up as the way goes)
    const tun = match.inTunnel;
    if (tun && tun.unit === i) {
      const p = tun.path;
      const a = Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]);
      const k = tun.s < a ? 0 : tun.s > tun.end - Math.hypot(p[9] - p[6], p[10] - p[7], p[11] - p[8]) ? 6 : 3;
      const dy = ((p[k + 4] - p[k + 1]) / (Math.hypot(p[k + 3] - p[k], p[k + 4] - p[k + 1], p[k + 5] - p[k + 2]) || 1)) * tun.dir;
      v.view.root.rotateX(-Math.asin(Math.max(-1, Math.min(1, dy))) * 0.85);
    }
    // (it blinks; dead, its lids are shut; about to shoot, its jaws open)
    v.blink -= scaled;
    if (v.blink < -0.16) v.blink = 1.5 + Math.random() * 4;
    const queen = sceneNow === flock && i === match.active;
    if (queen && !flock.glad) v.blink = Math.max(v.blink, 0.4);
    v.face.blink(!u.bug.alive || (queen && flock.glad) || (sceneNow === flock && flock.hurts(v.view)) || v.blink < 0 ? 1 : 0);
    // (a Wing Storm: its wings open wide as it winds up, and beat while it holds its stance)
    const storm = i === match.active && u.bug.alive && match.currentWeapon.kind === 'gale' && (match.phase === 'special' || match.stance);
    v.wing += (Math.max(queen ? flock.wing : 0, storm ? 1 : 0, u.bug.alive && !u.bug.grounded ? (u.bug.flying ? 1 : 0.5) : 0) - v.wing) * (1 - Math.exp(-scaled * 14));
    v.face.wingsTo?.(v.wing, u.bug.flying || storm || (queen && flock.wing > 0) ? 1 : 0, now / 1000);
    v.face.jaws(!u.bug.alive ? 0.3 : i === match.active && match.charging ? match.power : 0.12 + 0.1 * Math.sin(now * 0.002 + i * 2));
  });
  // (stung: it cries out)
  for (const v of bugViews) v.face.cry?.(sceneNow === flock && flock.cries(v.view));
  // (the small ants go on bugs posed for this frame)
  antColumn.late();
  brood.late();
  flock.late();
  projectiles.sync(match.projectiles, alpha, ground);
  {
    // (a Titan Lift: the block rises over the ant's back while it stands, and stays there while it aims)
    const w = match.currentWeapon;
    const holding = w.kind === 'lift' && (match.phase === 'special' || (match.phase === 'aim' && match.stance));
    const u = match.activeUnit;
    const rise = match.phase === 'special' ? 1 - match.specialTicks / w.sceneTicks : 1;
    projectiles.hold(holding ? bugViews[match.active].view.root.position : null, liftUp.set(u.bug.nx, u.bug.ny, u.bug.nz), rise, u.bug.species.radius + LIFT_HIGH);
  }
  // (the bars of a film, and no names: while it stands and aims, and once the hit is seen, the names are back)
  document.body.classList.toggle('special', sceneNow !== null && (!match.stance || sceneNow === flock) && !debugCamera);
  if (sceneNow) stage.hud.visible = (match.stance && sceneNow !== brood) || (sceneNow.hitFor > 0.5 && sceneNow.names) || (sceneNow === antColumn && antColumn.swarming && antColumn.names) || (sceneNow === flock && flock.flies);
  else if (wasSpecial) stage.hud.visible = true;
  if (!sceneNow || sceneNow.hitFor > (sceneNow === flock ? 1.35 : 0.8)) {
    // (the damage of a special attack shows when its flash is over)
    for (const e of heldDamage) showDamage(e.unit, e.amount, true);
    heldDamage.length = 0;
  }
  placeSight();
  // (a burst leaves a trail)
  for (const u of match.units) if (u.bug.floating > 0 && u.bug.alive) buildViews.trail(bugViews[u.id].view.root.position);
  itemViews.reveal = !notMine() && match.phase === 'aim' && match.passive(match.activeUnit.team, 'scent') > 0;
  itemViews.update(match, scaled, now / 1000);
  buildViews.update(match, bugViews.map((v) => v.view), !notMine() && !debugCamera && !inMenu && !menus.over ? placing : null, scaled, now / 1000);
  webViews.update(match, ground, (i, out) => out.copy(bugViews[i].view.root.position), now);
  const active = bugViews[match.active];
  aim.update(match, active.view.root.position, active.height, now, stage.camera.position.distanceTo(active.view.root.position));
  // (the other player's aim, online, is theirs: this side sees the bug turn, and the shot)
  if (watching()) aim.hide();
  // (a gale being aimed: the cone it would sweep, from the bug as it is drawn)
  const aimsGale = !notMine() && match.phase === 'aim' && match.stance && match.currentWeapon.kind === 'gale' && match.activeUnit.bug.alive;
  if (aimsGale) {
    const g = galeDirection(match.activeUnit.bug, match.activeUnit.aimH, match.activeUnit.aimV, galeDir);
    gales.preview(at.copy(active.view.root.position), at2.set(g[0], g[1], g[2]), match.currentWeapon.reach, match.currentWeapon.cone ?? 1);
  } else gales.preview(null);
  brood.hideMark = watching();
  if (inMenu || menus.over) {
    aim.hide();
    for (const v of bugViews) v.view.root.visible = false;
  }

  // each turn starts behind the active bug, looking where it walks; while it aims, the view turns with it
  if (!debugCamera && !intro && !inMenu && match.activeUnit.bug.alive) {
    const b = match.activeUnit.bug;
    const yaw = Math.atan2(b.fx, b.fz);
    if (chasePending && match.phase === 'aim' && !inScene()) {
      chasePending = false;
      follow.chase(terrain, active.view.root.position, b.fx, b.fz, 0.9);
    } else if (chaseUnit === match.active && match.phase === 'aim' && !follow.gliding && !faced && !viewTurns && !inScene()) {
      // (when the view turned the bug, the view is already where it should be)
      let d = yaw - chaseYaw;
      if (d > Math.PI) d -= Math.PI * 2;
      else if (d < -Math.PI) d += Math.PI * 2;
      if (d !== 0) follow.turnWith(d);
    }
    chaseUnit = match.active;
    chaseYaw = yaw;
  }

  // follow the shot while it flies, then a bug that dies, otherwise the bug whose turn it is
  if (!debugCamera && !intro && !inMenu && !inScene()) {
    let tracking = true;
    if (match.projectiles.length > 0 && projectiles.first(target)) {
      // the shot
    } else if (looksAtHit()) target.copy(hit.at);
    else if (deathFocus >= 0 && match.phase === 'settle') target.copy(bugViews[deathFocus].view.root.position);
    else if (match.activeUnit.bug.alive) target.copy(active.view.root.position);
    else tracking = false;
    // (a burrow being aimed: the view between the ant and where it comes up, from above)
    const under = match.underground;
    if (burrowAfter > 0) burrowAfter = Math.max(0, burrowAfter - dt);
    const holding = under !== null || (burrowAfter > 0 && burrowPath.length === 12);
    const burrowing = tracking && ((match.phase === 'aim' && match.currentWeapon.kind === 'burrow') || holding) && match.activeUnit.bug.alive;
    if (burrowing) {
      const p = under ? under.path : holding ? burrowPath : match.burrowPath(match.activeUnit, match.charging ? match.power : 0, burrowWay);
      // (between where it went in and where it comes out)
      // (a little towards the way out and up the screen: the cards cover its foot)
      // (no way where the ground is too thin, or hard: the view stays on the ant)
      if (p.length >= 12) {
        if (holding) target.set(p[0] * 0.42 + p[9] * 0.58, p[1] * 0.42 + p[10] * 0.58 - 1.2, p[2] * 0.42 + p[11] * 0.58);
        else target.lerp(at.set(p[9], p[10], p[11]), 0.45);
      }
    }
    if (tracking) follow.update(target, dt);
    // (under the ground: from high above, so little stands between the view and the bug)
    // (aiming it: the view does not turn after the ant, which turns with the view; digging: it turns to the way it digs)
    if (burrowing) follow.overlook(holding ? 1.25 : 0.85, holding ? 29 : 21, dt, holding ? match.activeUnit.bug.hx : 0, holding ? match.activeUnit.bug.hz : 0);
    // (a bug walking through a tunnel: seen from above, not followed from behind)
    // (turned to the tunnel's way, not the bug's: the bug faces where the view looks, and the two would chase each other)
    else if (tracking && match.inTunnel) follow.overlook(1.25, 21, dt, match.inTunnel.ax * match.inTunnel.dir, match.inTunnel.az * match.inTunnel.dir);
    // (out of the ground again, or out of the tunnel: back behind the bug, looking where it walks)
    const above = burrowing || (tracking && match.inTunnel !== null);
    if (overlooked && !above && tracking && match.activeUnit.bug.alive && !follow.gliding) {
      const b = match.activeUnit.bug;
      follow.chase(terrain, bugViews[match.active].view.root.position, b.fx, b.fz, 1.1);
    }
    overlooked = above;
  }

  // wind arrow in screen space: project the wind onto the camera's ground-plane axes
  stage.camera.getWorldDirection(camDir);
  const fl = Math.hypot(camDir.x, camDir.z) || 1;
  const fx = camDir.x / fl;
  const fz = camDir.z / fl;
  const right = match.windX * -fz + match.windZ * fx;
  const away = match.windX * fx + match.windZ * fz;
  hud.renderMatch(match, Math.atan2(-away, right), notMine(), watching() ? online?.names[match.activeUnit.team] || match.teams[match.activeUnit.team].name : '');
  minimap.update(terrain, match, Math.atan2(fx, fz), stage.camera.position, dt, !inMenu && !menus.over && !inScene() && !debugCamera);

  if (debugCamera) {
    if (path) path.at(pathFrozenAt ?? (now - pathStart) / 1000, stage.camera, pathTarget);
    if (fly) fly.update(dt);
  } else if (inMenu) menuView(menus.time);
  else if (!intro && !inScene()) {
    if (menus.over) follow.turnWith(dt * 0.12);
    if (wasSpecial) {
      // out of a special attack's scene: the game's lens, and a glide back to the active bug
      stage.camera.fov = bow.camera.fov;
      stage.camera.up.set(0, 1, 0);
      stage.camera.updateProjectionMatrix();
      const b = match.activeUnit.bug;
      stage.controls.target.copy(active.view.root.position);
      follow.chase(terrain, active.view.root.position, b.fx, b.fz, 1.1);
    }
    stage.controls.update();
    follow.avoid(terrain, dt);
  }
  {
    // (the way to where the aim goes is kept free too, and all of it is wider looking up)
    const u = match.activeUnit;
    match.aimDirection(u, aimAt);
    const t = stage.controls.target;
    lookAhead.set(t.x + aimAt[0] * AHEAD, t.y + aimAt[1] * AHEAD, t.z + aimAt[2] * AHEAD);
    // (a Burrow is not aimed up: no way is kept free ahead of it)
    if (u.bug.alive && match.currentWeapon.kind === 'burrow') lookAhead.copy(t);
    const c = stage.camera.position;
    const d = c.distanceTo(t) || 1;
    const up = Math.max(0, (t.y - c.y) / d + Math.max(0, aimAt[1]) * 0.5);
    const playing = follow.stays && !debugCamera && !inMenu && !intro && !inScene() && !menus.over;
    const aheadHidden = playing && match.phase === 'aim' && terrain.raycast(c.x, c.y, c.z, lookAhead.x - c.x, lookAhead.y - c.y, lookAhead.z - c.z, c.distanceTo(lookAhead) - 1) >= 0 && terrain.sample(c.x, c.y, c.z) < 3;
    // (a bug under the ground is always seen through it: what is drawn over a broken roof hides it too)
    const underGround = match.underground !== null || match.inTunnel !== null;
    // (and round the bug itself there, not round where the view looks)
    seeThrough.update(underGround ? active.view.root.position : t, lookAhead, up, playing && (follow.hides(terrain) || aheadHidden || underGround), dt, underGround);
  }
  wasSpecial = inScene() !== null;
  bowState.active = bow.camera.active;
  bowState.hitFor = bow.hitFor;
  columnState.active = antColumn.camera.active;
  columnState.hitFor = antColumn.hitFor;
  bowState.time = bow.sceneTime;
  columnState.time = antColumn.sceneTime;
  broodState.active = brood.camera.active;
  broodState.hitFor = brood.hitFor;
  broodState.time = brood.sceneTime;
  flockState.active = flock.camera.active;
  flockState.hitFor = flock.hitFor;
  flockState.time = flock.sceneTime;
  gameSounds.frame(match, dt, Math.min(bow.timeScale, antColumn.timeScale, brood.timeScale, flock.timeScale), bowState, columnState, broodState, flockState);
  hear();
  updateMenus(dt);
  flashes.update(now);
  lines.update(now);
  gales.update(now);
  texts.update(now);
  placeLabels();
  burrows.update(match, scaled);
  if (shake > 0) {
    const k = shake * shake * 1.6;
    stage.camera.position.x += (Math.random() - 0.5) * k;
    stage.camera.position.y += (Math.random() - 0.5) * k;
    stage.camera.position.z += (Math.random() - 0.5) * k;
    shake = Math.max(0, shake - dt);
  }
  stage.render(renderSeconds(now), renderStep(dt));
  perf?.record(interval);
  if (now - lastFps > 500) {
    hud.setFrames(frameMs, Math.min(frameCount, frameMs.length));
    lastFps = now;
  }
}

newMatch(seed);
// (the map's shaders, side by side on the GPU's own threads, before anything is drawn)
const takeAway = itemViews.samples();
await stage.warm();
takeAway();
if (!menuAtStart) document.getElementById('loading')?.remove();
else {
  // (the fighters' shaders first: nothing stalls when they are picked)
  heroes.warm(SPECIES, scenario.id);
  await stage.menu.warm();
  heroes.rest(scenario.id);
  openSetup();
  // (the first frames make the map's shaders: a sign stands before the menu until it runs smoothly, then it makes its entrance)
  let last = performance.now();
  let smooth = 0;
  const until = last + 15000;
  const settle = (now: number): void => {
    smooth = now - last < 50 ? smooth + 1 : 0;
    last = now;
    if (smooth < 12 && now < until) requestAnimationFrame(settle);
    else {
      document.getElementById('loading')?.remove();
      openSetup();
    }
  };
  requestAnimationFrame(settle);
}
// the cinematic camera's own little bar: it hides while the mouse rests (and for good with `?hud=0`, as in the
// scripted reviews and measurements)
if (hooks.flythrough && params.get('hud') !== '0') {
  const body = document.body;
  body.classList.add('cinematic');
  // (just the map and its bugs: no names over them)
  stage.hud.visible = false;
  const pauseButton = document.getElementById('cinePause') as HTMLButtonElement;
  let quiet = 0;
  const wake = (): void => {
    body.classList.remove('quiet');
    clearTimeout(quiet);
    quiet = window.setTimeout(() => body.classList.add('quiet'), 3000);
  };
  const flown = (): number => pathFrozenAt ?? (performance.now() - pathStart) / 1000;
  /** Carry on from `t` seconds into the flight (or stay frozen there). */
  const jump = (t: number): void => {
    const at = ((t % views.duration) + views.duration) % views.duration;
    if (pathFrozenAt !== null) pathFrozenAt = at;
    else pathStart = performance.now() - at * 1000;
  };
  const togglePause = (): void => {
    const at = flown();
    if (pathFrozenAt === null) pathFrozenAt = at;
    else {
      pathFrozenAt = null;
      pathStart = performance.now() - at * 1000;
    }
    pauseButton.textContent = pathFrozenAt === null ? 'pause' : 'resume';
  };
  pauseButton.addEventListener('click', () => {
    togglePause();
    pauseButton.blur();
  });
  (document.getElementById('cineLeave') as HTMLButtonElement).addEventListener('click', () => setCinematic(false));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') setCinematic(false);
    else if (e.code === 'Space') togglePause();
    else if (e.code === 'ArrowLeft') jump(flown() - 3);
    else if (e.code === 'ArrowRight') jump(flown() + 3);
    else if (e.code === 'KeyR') jump(0);
    else return;
    e.preventDefault();
    wake();
  });
  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  wake();
}
if (!hooks.hud) document.body.classList.add('no-hud');
requestAnimationFrame(loop);

// Debug API (console, and the scripted review): poses, fly-through time, captures, perf runs.
/**
 * Size the bugs and place their labels for the camera as it is now (call right before drawing): the
 * labels snap to whole pixels of this very frame, so they do not crawl.
 */
function placeLabels(): void {
  stage.camera.updateMatrixWorld();
  const bars = document.body.classList.contains('special');
  texts.clamp(stage.camera, bars ? 0.72 : undefined, bars ? -0.72 : -2);
  match.units.forEach((u, i) => {
    const v = bugViews[i];
    const dist = stage.camera.position.distanceTo(v.view.root.position);
    // (a scene that moves the bug places it)
    if (flock.camera.active && i === match.active) v.view.root.scale.setScalar(1);
    else v.view.setCameraDistance(dist);
    // (a narrow lens, as a special attack's scene has, brings it nearer)
    const seen = dist * (Math.tan((stage.camera.fov * Math.PI) / 360) / LENS);
    v.face.near(seen < 60, seen);
    v.label.update(v.view.root.position, v.height * v.view.root.scale.y, u.bug.health, u.bug.alive, dist, u.bug.alive && occluded(v.view.root.position, dist), i === match.active);
    // (its own name is in the way of what it points at)
    if (i === match.active && (antColumn.camera.active || flock.camera.active)) v.label.sprite.visible = false;
    if (match.underground?.unit === i) v.label.sprite.visible = false;
    // (the swarm flies to its rings: what hangs over the one they lead to hides them)
    if (i !== match.active && flock.camera.active && (flock.hidesNames(match) || (match.flock && u.team === match.activeUnit.team))) v.label.sprite.visible = false;
    // (over its crown, where what it flies to is)
    if (flock.flies && u.team !== match.activeUnit.team) v.label.sprite.position.y += 0.02 * dist;
    v.label.snap(stage.camera, canvas.width, canvas.height);
  });
}

const debugApi = {
  terrain,
  ground,
  stage,
  chunks,
  controls,
  layout,
  menus,
  heroes,
  setup: openSetup,
  match: () => match,
  /** Online: the room, the seat, the lockstep (its checkpoints). */
  online: () => online,
  newMatch,
  views: () => views,
  /** Freeze the fly-through at `t` seconds (null: back to the clock). */
  seek(t: number | null): void {
    pathFrozenAt = t;
    if (t === null) pathStart = performance.now();
  },
  /** Stop (or resume) the live loop, so captures alone advance the frames. */
  pause(on: boolean): void {
    paused = on;
    advancing = false;
  },
  bow,
  antColumn,
  brood,
  flock,
  follow,
  sound,
  music,
  webViews,
  items: itemViews,
  /** With the loop paused: play on for `seconds` at 60 frames a second (scripted reviews of moving scenes). */
  advance(seconds: number): void {
    advancing = true;
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) frame(lastFrame + 1000 / 60);
  },
  /**
   * Draw a frame now and save it as captures/<name>.png (dev server only). With `t`, the fly-through
   * and the render-only animation are at time `t`, and `dt` advances the dust: with the loop paused, a
   * sequence of captures is the same on every run.
   */
  capture(name: string, opts: { t?: number; dt?: number; jpeg?: boolean } = {}): Promise<string> {
    const t = opts.t ?? pathFrozenAt ?? (performance.now() - pathStart) / 1000;
    if (path) path.at(t, stage.camera, pathTarget);
    placeLabels();
    stage.render(opts.t !== undefined ? opts.t : renderSeconds(performance.now()), opts.dt ?? 0);
    return captureCanvas(canvas, name, opts.jpeg === true);
  },
  /** Restart the fly-through and the perf log together; resolves with the report after `seconds`. */
  perfRun(seconds = 60): Promise<unknown> {
    const log = perf;
    if (!log) return Promise.reject(new Error('open with ?perf=1'));
    pathFrozenAt = null;
    pathStart = performance.now();
    log.start(performance.now(), stage.frameNumber() + 1);
    return new Promise((resolve) =>
      setTimeout(() => {
        log.stop();
        // let the last GPU timings arrive
        setTimeout(() => resolve(log.report(performance.now())), 600);
      }, seconds * 1000),
    );
  },
  perfDownload: (): void => perf?.download(performance.now()),
};
(window as unknown as { __debug: unknown }).__debug = debugApi;
if (perf && 'gpu' in navigator) {
  void navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then((a) => {
    const info = (a as unknown as { info?: { vendor?: string; architecture?: string; description?: string } } | null)?.info;
    perf.gpuAdapter = info ? `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.trim() : 'unknown';
  });
}
