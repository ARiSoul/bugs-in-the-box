import * as THREE from 'three';
import { runExplosionBenchmark } from './bench/explosions';
import { applyPose, CameraPath, FlyCamera } from './debug/camera';
import { captureCanvas } from './debug/capture';
import { readHooks, usesDebugCamera } from './debug/hooks';
import { PerfLog } from './debug/perf';
import { viewsFor, type ScenarioViews } from './debug/views';
import { DT, KILL_Y } from './game/bug';
import { Match, NO_INPUT, type MatchEvent, type TeamSpec } from './game/match';
import { ANT, SPIDER } from './game/species';
import { SOLDER_BLOB, WEAPONS } from './game/weapons';
import { Controls } from './input/controls';
import { pickTerrain } from './input/picking';
import { AimView } from './render/aim';
import { BugView } from './render/BugView';
import { DrawnGround } from './render/drawnGround';
import { ChunkRenderer } from './render/ChunkRenderer';
import { ExplosionFlashes, LineFlashes } from './render/effects';
import { CHASE_ELEVATION, FollowCamera } from './render/followCamera';
import { MeshWorkers, type MeshBatch } from './render/MeshWorkers';
import { FloatingTexts, UnitLabel } from './render/labels';
import { ProjectileViews } from './render/projectiles';
import { createStage, type Stage, type StageOptions } from './render/stage';
import { createLayout } from './terrain/generators/types';
import { SCENARIOS, scenarioById, type Scenario } from './terrain/scenarios';
import { Terrain } from './terrain/Terrain';
import { Hud, type HudState } from './ui/hud';
import { setupKeysMenu } from './ui/keys';

const TEAMS: TeamSpec[] = [
  { name: 'Red Ants', species: ANT, color: 0xff6b5e, size: 3 },
  { name: 'Blue Spiders', species: SPIDER, color: 0x5fb0ff, size: 3 },
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const hooks = readHooks(params);
// Map size in chunks of 32, e.g. `?map=3x2x3` for the small map, until there is a setup screen. Without it, the
// scenario's own size (a scenario at a larger scale needs a larger map), else 5x3x5.
const size = (params.get('map') ?? '').match(/^(\d+)x(\d+)x(\d+)$/);
let seed = Number(params.get('seed') ?? 1234) | 0;
let scenario: Scenario = scenarioById(params.get('scenario'));
const mapSize = (sc: Scenario): [number, number, number] => (size ? [Number(size[1]), Number(size[2]), Number(size[3])] : (sc.mapSize ?? [5, 3, 5]));
const terrain = new Terrain(...mapSize(scenario));
const layout = createLayout();
const stageOptions: StageOptions = { fixedSize: hooks.fixedSize, timestamps: hooks.perf, seed };
// The scenario picks the render path; the WebGPU one is loaded only when needed (it is large).
const stage: Stage =
  scenario.render === 'webgpu'
    ? await import('./render/gpu/gpuStage').then((m) => m.createGpuStage(canvas, terrain, stageOptions))
    : createStage(canvas, terrain, stageOptions);
const chunks = new ChunkRenderer(stage.scene, stage.look);
const ground = new DrawnGround(terrain);
const flashes = new ExplosionFlashes(stage.scene);
const lines = new LineFlashes(stage.scene);
const texts = new FloatingTexts(stage.hud);
const projectiles = new ProjectileViews(stage.scene);
const aim = new AimView(stage.scene);
const follow = new FollowCamera(stage.camera, stage.controls);
// the right button turns the view (and the bug with it), the wheel zooms; the left button stays free
stage.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
const hud = new Hud();

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
  } else {
    state.lastExplosionMs = b.postMs + (now - t0);
    state.lastExplosionWorkerMs = b.workerMs;
    state.lastExplosionLatencyMs = now - b.startedAt;
    state.lastExplosionChunks = b.meshes.length;
  }
  refresh();
}

let match: Match;
/** The turntable's turn when the drawn ground was indexed. */
let indexedTurns = 0;
let views: ScenarioViews;
let bugViews: { view: BugView; label: UnitLabel; height: number }[] = [];

/** New map and new match from one number: the seed is all two players need to share. */
function newMatch(s: number): void {
  const t0 = performance.now();
  scenario.generate(terrain, s, layout);
  stage.setScenario(scenario, layout);
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

  match = new Match(terrain, TEAMS, s, { strictBounds: scenario.strictBounds, spawnLevels: scenario.spawnLevels === true, turntable: scenario.turntable?.(terrain.W, terrain.H, terrain.D) });

  prevTurns = 0;
  for (const v of bugViews) {
    v.view.dispose();
    v.label.dispose();
  }
  bugViews = match.units.map((u) => {
    const view = new BugView(u.bug.species, match.teams[u.team].color);
    const label = new UnitLabel(u.name, match.teams[u.team].color);
    stage.scene.add(view.root);
    stage.hud.add(label.sprite);
    return { view, label, height: u.bug.species.radius * 2.4 };
  });
  indexedTurns = 0;
  ground.reset(stage.scene, bugViews.map((v) => v.view.root));
  hud.setupMatch(match, WEAPONS, (i) => controls.selectWeapon(i));
  const active = bugViews[match.active];
  active.view.update(match.activeUnit.bug, 1, 0);
  startCamera();
  refresh();
}

const at = new THREE.Vector3();
const at2 = new THREE.Vector3();
function handleEvents(events: readonly MatchEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'explosion':
        flashes.spawn(at.set(e.x, e.y, e.z), e.radius);
        stage.craters?.add(e.x, e.y, e.z, e.radius);
        ground.addCrater(e.x, e.y, e.z, e.radius);
        break;
      case 'arc':
        lines.arc(at.set(e.x1, e.y1, e.z1), at2.set(e.x2, e.y2, e.z2));
        break;
      case 'dig':
        lines.beam(at.set(e.x1, e.y1, e.z1), at2.set(e.x2, e.y2, e.z2));
        stage.craters?.addTunnel(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, e.radius);
        ground.addTunnel(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, e.radius);
        break;
      case 'turn':
        chasePending = true;
        deathFocus = -1;
        break;
      case 'death': {
        // a bug that fell out of the world is just gone; any other dies on screen, and the camera looks
        const u = match.units[e.unit];
        if (u.bug.y > KILL_Y && deathFocus < 0) deathFocus = e.unit;
        break;
      }
      case 'damage': {
        const u = match.units[e.unit];
        texts.spawn(`-${e.amount}`, match.teams[u.team].color, at.set(u.bug.x, u.bug.y + bugViews[e.unit].height + 1, u.bug.z));
        break;
      }
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
const controls = new Controls(window, (code) => {
  if (code === 'KeyN') newMatch(seed);
});
controls.bindButtons(hud.pad);
setupKeysMenu(controls);
if (hooks.fly) {
  // the free camera's keys, in the menu (opened below, so they show)
  (document.getElementById('hint') as HTMLElement).textContent =
    'Free camera: click the view to look round with the mouse (Esc frees the mouse) · W/S/A/D move · Q/E down / up · ' +
    'Shift faster, Ctrl slower · scroll: speed · R: back to the start · "back to the game" leaves';
}

// The menu (seed, benchmark, key help) starts open where there is room for it.
(document.getElementById('panel') as HTMLDetailsElement).open = hooks.fly || window.innerWidth > 1000;
hud.seed.value = String(seed);
hud.scenario.replaceChildren(
  ...SCENARIOS.map((sc) => {
    const o = document.createElement('option');
    o.value = sc.id;
    o.textContent = sc.name;
    return o;
  }),
);
hud.scenario.value = scenario.id;
hud.scenario.addEventListener('change', () => {
  const next = scenarioById(hud.scenario.value);
  params.set('scenario', next.id);
  if (next.render !== scenario.render || mapSize(next).join() !== mapSize(scenario).join()) {
    // another render path needs another canvas context, another map size another grid: reload with it
    location.search = params.toString();
    return;
  }
  scenario = next;
  history.replaceState(null, '', `?${params.toString()}`);
  newMatch(seed);
  hud.scenario.blur();
});
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
  if (hooks.fly) params.delete('fly');
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
  else params.delete('flythrough');
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

// Dev only: shift+click blows up the terrain under the pointer (handy to test falls and damage).
if (import.meta.env.DEV) {
  canvas.addEventListener('pointerup', (e) => {
    if (!e.shiftKey || e.button !== 0) return;
    const p = pickTerrain(e, canvas, stage.camera, terrain);
    if (!p) return;
    match.explode(p.x, p.y, p.z, SOLDER_BLOB);
    handleEvents(match.events);
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
/** The player is turning the view with the right button: the active bug faces where the view looks. */
let orbiting = false;
/** Seconds the bug keeps facing the view after the button is released (the orbit damping still turns it). */
const ORBIT_TAIL = 0.6;
let orbitTail = 0;
/** How long the turn keys have been held while the view is held (seconds), and which way. */
let turnHold = 0;
let turnDir = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) orbiting = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.button !== 2 || !orbiting) return;
  orbiting = false;
  orbitTail = ORBIT_TAIL;
});
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
/** The turntable's turns before the last tick (render interpolates the plate between ticks). */
let prevTurns = 0;
/** Time per frame for indexing the drawn ground of a new map (ms). */
const INDEX_MS = 3;
let paused = false;
function loop(now: number): void {
  requestAnimationFrame(loop);
  if (paused) {
    lastFrame = now;
    return;
  }
  // after a stall, drop time instead of spiralling; never negative (the first frame's timestamp can be
  // older than `lastFrame`, which would end the intro before it starts)
  const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  const interval = now - lastFrame;
  frameMs[frameCount++ % frameMs.length] = interval;
  lastFrame = now;

  const intro = !debugCamera && updateIntro(dt);
  // while the player turns the view, the bug faces where it looks (aiming, or walking away after a shot)
  const steering = match.phase === 'aim' || (match.phase === 'flight' && match.retreatTicks > 0);
  const viewTurns = orbiting || orbitTail > 0;
  orbitTail = Math.max(0, orbitTail - dt);
  if (viewTurns && !debugCamera && !intro && !follow.gliding && steering && match.activeUnit.bug.alive) {
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
  let faced = false;
  accumulator += dt;
  while (accumulator >= DT) {
    prevTurns = match.turntableTurns;
    // a debug camera (or the intro) owns the view: the match keeps running without input
    if (debugCamera || intro) match.step(NO_INPUT);
    else {
      match.step(controls.next());
      faced ||= controls.faced;
    }
    handleEvents(match.events);
    accumulator -= DT;
  }
  syncTerrain();
  const alpha = accumulator / DT;
  stage.setTurntable?.(prevTurns + (match.turntableTurns - prevTurns) * alpha);

  // the turntable rests at a new place: so do the things on it
  if (match.turntableTurns !== indexedTurns && match.turntableTurns === prevTurns && match.phase !== 'spin') {
    indexedTurns = match.turntableTurns;
    ground.reindex(stage.scene, bugViews.map((v) => v.view.root));
  }
  ground.step(INDEX_MS);
  match.units.forEach((u, i) => {
    const v = bugViews[i];
    v.view.update(u.bug, alpha, dt, ground);
  });
  projectiles.sync(match.projectiles, alpha, ground);
  const active = bugViews[match.active];
  aim.update(match, active.view.root.position, active.height, now);

  // each turn starts behind the active bug, looking where it walks; while it aims, the view turns with it
  if (!debugCamera && !intro && match.activeUnit.bug.alive) {
    const b = match.activeUnit.bug;
    const yaw = Math.atan2(b.fx, b.fz);
    if (chasePending && match.phase === 'aim') {
      chasePending = false;
      follow.chase(terrain, active.view.root.position, b.fx, b.fz, 0.9);
    } else if (chaseUnit === match.active && match.phase === 'aim' && !follow.gliding && !faced && !viewTurns) {
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
  if (!debugCamera && !intro) {
    let tracking = true;
    if (match.projectiles.length > 0 && projectiles.first(target)) {
      // the shot
    } else if (deathFocus >= 0 && match.phase === 'settle') target.copy(bugViews[deathFocus].view.root.position);
    else if (match.activeUnit.bug.alive) target.copy(active.view.root.position);
    else tracking = false;
    if (tracking) follow.update(target, dt);
  }

  // wind arrow in screen space: project the wind onto the camera's ground-plane axes
  stage.camera.getWorldDirection(camDir);
  const fl = Math.hypot(camDir.x, camDir.z) || 1;
  const fx = camDir.x / fl;
  const fz = camDir.z / fl;
  const right = match.windX * -fz + match.windZ * fx;
  const away = match.windX * fx + match.windZ * fz;
  hud.renderMatch(match, Math.atan2(-away, right));

  if (debugCamera) {
    if (path) path.at(pathFrozenAt ?? (now - pathStart) / 1000, stage.camera, pathTarget);
    if (fly) fly.update(dt);
  } else if (!intro) {
    stage.controls.update();
    follow.avoid(terrain, dt);
  }
  flashes.update(now);
  lines.update(now);
  texts.update(now);
  placeLabels();
  stage.render(renderSeconds(now), renderStep(dt));
  perf?.record(interval);
  if (now - lastFps > 500) {
    hud.setFrames(frameMs, Math.min(frameCount, frameMs.length));
    lastFps = now;
  }
}

newMatch(seed);
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
  match.units.forEach((u, i) => {
    const v = bugViews[i];
    const dist = stage.camera.position.distanceTo(v.view.root.position);
    v.view.setCameraDistance(dist);
    v.label.update(v.view.root.position, v.height * v.view.root.scale.y, u.bug.health, u.bug.alive, dist, u.bug.alive && occluded(v.view.root.position, dist), i === match.active);
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
  match: () => match,
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
