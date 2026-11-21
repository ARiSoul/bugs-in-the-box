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
import { FloatingTexts, UnitLabel } from './render/labels';
import { ProjectileViews } from './render/projectiles';
import { createStage } from './render/stage';
import { floatingIslands } from './terrain/generators/floatingIslands';
import { SurfaceNetsMesher } from './terrain/mesher';
import { Terrain } from './terrain/Terrain';
import { Hud, type HudState } from './ui/hud';

const TEAMS: TeamSpec[] = [
  { name: 'Red Ants', species: ANT, color: 0xff6b5e, size: 3 },
  { name: 'Blue Spiders', species: SPIDER, color: 0x5fb0ff, size: 3 },
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const terrain = new Terrain(3, 2, 3);
const stage = createStage(canvas, terrain);
const chunks = new ChunkRenderer(stage.scene, new SurfaceNetsMesher());
const flashes = new ExplosionFlashes(stage.scene);
const lines = new LineFlashes(stage.scene);
const texts = new FloatingTexts(stage.scene);
const projectiles = new ProjectileViews(stage.scene);
const aim = new AimView(stage.scene);
const follow = new FollowCamera(stage.camera, stage.controls);
const hud = new Hud();

const state: HudState = { generateMs: 0, initialMeshMs: 0, lastExplosionMs: 0, lastExplosionChunks: 0, triangles: 0, bench: '' };
const refresh = (): void => {
  state.triangles = chunks.triangles;
  hud.render(terrain, state);
};

let seed = 1234;
let match: Match;
let views: { view: BugView; label: UnitLabel; height: number }[] = [];

/** New map and new match from one number: the seed is all two players need to share. */
function newMatch(s: number): void {
  const t0 = performance.now();
  floatingIslands(terrain, s);
  state.generateMs = performance.now() - t0;
  state.initialMeshMs = chunks.sync(terrain).ms;
  state.lastExplosionMs = 0;
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

/** Re-mesh whatever the last ticks carved, and time it. */
function syncTerrain(): void {
  if (terrain.dirty.size === 0) return;
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
  floatingIslands(terrain, seed);
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
let frames = 0;
let lastFps = performance.now();
let lastFrame = performance.now();
let accumulator = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.25, (now - lastFrame) / 1000); // after a stall, drop time instead of spiralling
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
  frames++;
  if (now - lastFps > 500) {
    hud.setFps((frames * 1000) / (now - lastFps));
    frames = 0;
    lastFps = now;
  }
}

newMatch(seed);
requestAnimationFrame(loop);

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = { terrain, stage, controls, match: () => match, newMatch };
}
