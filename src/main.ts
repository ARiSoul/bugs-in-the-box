import * as THREE from 'three';
import { runExplosionBenchmark } from './bench/explosions';
import { DT } from './game/bug';
import { Match, type MatchEvent, type TeamSpec } from './game/match';
import { ANT, SPIDER } from './game/species';
import { SOLDER_BLOB, WEAPONS } from './game/weapons';
import { Controls } from './input/controls';
import { pickTerrain } from './input/picking';
import { AimView } from './render/aim';
import { BugView } from './render/BugView';
import { ChunkRenderer } from './render/ChunkRenderer';
import { ExplosionFlashes, LineFlashes } from './render/effects';
import { FollowCamera } from './render/followCamera';
import { MeshWorkers, type MeshBatch } from './render/MeshWorkers';
import { FloatingTexts, UnitLabel } from './render/labels';
import { ProjectileViews } from './render/projectiles';
import { createStage } from './render/stage';
import { SCENARIOS, scenarioById, type Scenario } from './terrain/scenarios';
import { Terrain } from './terrain/Terrain';
import { Hud, type HudState } from './ui/hud';

const TEAMS: TeamSpec[] = [
  { name: 'Red Ants', species: ANT, color: 0xff6b5e, size: 3 },
  { name: 'Blue Spiders', species: SPIDER, color: 0x5fb0ff, size: 3 },
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
// Map size in chunks of 32, e.g. `?map=3x2x3` for the small map (default 5x3x5), until there is a setup screen.
const size = (params.get('map') ?? '').match(/^(\d)x(\d)x(\d)$/);
const terrain = size ? new Terrain(Number(size[1]), Number(size[2]), Number(size[3])) : new Terrain(5, 3, 5);
const stage = createStage(canvas, terrain);
const chunks = new ChunkRenderer(stage.scene);
const flashes = new ExplosionFlashes(stage.scene);
const lines = new LineFlashes(stage.scene);
const texts = new FloatingTexts(stage.scene);
const projectiles = new ProjectileViews(stage.scene);
const aim = new AimView(stage.scene);
const follow = new FollowCamera(stage.camera, stage.controls);
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
state.meshing = workers ? `${workers.size} worker${workers.size > 1 ? 's' : ''}` : 'main thread';

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

let seed = 1234;
let scenario: Scenario = scenarioById(params.get('scenario'));
let match: Match;
let views: { view: BugView; label: UnitLabel; height: number }[] = [];

/** New map and new match from one number: the seed is all two players need to share. */
function newMatch(s: number): void {
  const t0 = performance.now();
  scenario.generate(terrain, s);
  applySky(scenario);
  chunks.setSharp(scenario.sharpEdges);
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

  match = new Match(terrain, TEAMS, s);
  for (const v of views) {
    v.view.dispose();
    v.label.dispose();
  }
  views = match.units.map((u) => {
    const view = new BugView(u.bug.species);
    const label = new UnitLabel(u.name, match.teams[u.team].color);
    stage.scene.add(view.root, label.sprite);
    return { view, label, height: u.bug.species.radius * 2.4 };
  });
  hud.setupMatch(match, WEAPONS, (i) => controls.selectWeapon(i));
  const active = views[match.active];
  active.view.update(match.activeUnit.bug, 1, 0);
  follow.focus(active.view.root.position, 34);
  refresh();
}

const at = new THREE.Vector3();
const at2 = new THREE.Vector3();
function handleEvents(events: readonly MatchEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case 'explosion':
        flashes.spawn(at.set(e.x, e.y, e.z), e.radius);
        break;
      case 'arc':
        lines.arc(at.set(e.x1, e.y1, e.z1), at2.set(e.x2, e.y2, e.z2));
        break;
      case 'dig':
        lines.beam(at.set(e.x1, e.y1, e.z1), at2.set(e.x2, e.y2, e.z2));
        break;
      case 'damage': {
        const u = match.units[e.unit];
        texts.spawn(`-${e.amount}`, match.teams[u.team].color, at.set(u.bug.x, u.bug.y + views[e.unit].height + 1, u.bug.z));
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

// The menu (seed, benchmark, key help) starts open where there is room for it.
(document.getElementById('panel') as HTMLDetailsElement).open = window.innerWidth > 1000;
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
  scenario = scenarioById(hud.scenario.value);
  newMatch(seed);
  hud.scenario.blur();
});

/** The look around the map: page background behind the canvas and the fog colour. */
function applySky(sc: Scenario): void {
  document.body.style.background = sc.sky.css;
  (stage.scene.fog as THREE.Fog).color.setHex(sc.sky.fog);
}
hud.regen.addEventListener('click', () => {
  seed = Number(hud.seed.value) | 0;
  newMatch(seed);
  hud.regen.blur();
});
hud.random.addEventListener('click', () => {
  seed = Math.floor(Math.random() * 99999); // UI only: never in generation/gameplay code
  hud.seed.value = String(seed);
  newMatch(seed);
  hud.random.blur();
});
hud.bench.addEventListener('click', () => {
  scenario.generate(terrain, seed);
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

// ---- loop: fixed-step simulation, interpolated rendering ----
window.addEventListener('resize', stage.resize);
const target = new THREE.Vector3();
const camDir = new THREE.Vector3();
const frameMs = new Float32Array(120);
let frameCount = 0;
let lastFps = performance.now();
let lastFrame = performance.now();
let accumulator = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.25, (now - lastFrame) / 1000); // after a stall, drop time instead of spiralling
  frameMs[frameCount++ % frameMs.length] = now - lastFrame;
  lastFrame = now;

  accumulator += dt;
  while (accumulator >= DT) {
    match.step(controls.next());
    handleEvents(match.events);
    accumulator -= DT;
  }
  syncTerrain();
  const alpha = accumulator / DT;

  match.units.forEach((u, i) => {
    const v = views[i];
    v.view.update(u.bug, alpha, dt);
    v.label.update(v.view.root.position, v.height, u.bug.health, u.bug.alive);
  });
  projectiles.sync(match.projectiles, alpha);
  const active = views[match.active];
  aim.update(match, active.view.root.position, active.height, now);

  // follow the shot while it flies, otherwise the bug whose turn it is
  if (projectiles.first(target) || match.activeUnit.bug.alive) {
    if (match.projectiles.length === 0) target.copy(active.view.root.position);
    follow.update(target, dt);
  }

  // wind arrow in screen space: project the wind onto the camera's ground-plane axes
  stage.camera.getWorldDirection(camDir);
  const fl = Math.hypot(camDir.x, camDir.z) || 1;
  const fx = camDir.x / fl;
  const fz = camDir.z / fl;
  const right = match.windX * -fz + match.windZ * fx;
  const away = match.windX * fx + match.windZ * fz;
  hud.renderMatch(match, Math.atan2(-away, right));

  stage.controls.update();
  follow.avoid(terrain, dt);
  flashes.update(now);
  lines.update(now);
  texts.update(now);
  stage.renderer.render(stage.scene, stage.camera);
  if (now - lastFps > 500) {
    hud.setFrames(frameMs, Math.min(frameCount, frameMs.length));
    lastFps = now;
  }
}

newMatch(seed);
requestAnimationFrame(loop);

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = { terrain, stage, chunks, controls, match: () => match, newMatch };
}
