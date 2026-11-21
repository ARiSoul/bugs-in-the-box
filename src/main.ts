import * as THREE from 'three';
import { runExplosionBenchmark } from './bench/explosions';
import { pickTerrain } from './input/picking';
import { ChunkRenderer } from './render/ChunkRenderer';
import { ExplosionFlashes } from './render/effects';
import { createStage } from './render/stage';
import { floatingIslands } from './terrain/generators/floatingIslands';
import { SurfaceNetsMesher } from './terrain/mesher';
import { Terrain } from './terrain/Terrain';
import { Hud, type HudState } from './ui/hud';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const terrain = new Terrain(3, 2, 3);
const stage = createStage(canvas, terrain);
const chunks = new ChunkRenderer(stage.scene, new SurfaceNetsMesher());
const flashes = new ExplosionFlashes(stage.scene);
const hud = new Hud();

const state: HudState = {
  generateMs: 0,
  initialMeshMs: 0,
  lastExplosionMs: 0,
  lastExplosionChunks: 0,
  triangles: 0,
  bench: '',
};
const refresh = (): void => {
  state.triangles = chunks.triangles;
  hud.render(terrain, state);
};

let seed = 1234;
let radius = 6;

function newMap(s: number): void {
  const t0 = performance.now();
  floatingIslands(terrain, s);
  state.generateMs = performance.now() - t0;
  state.initialMeshMs = chunks.sync(terrain).ms;
  state.lastExplosionMs = 0;
  state.lastExplosionChunks = 0;
  state.bench = '';
  refresh();
}

function explode(p: THREE.Vector3, r: number): void {
  const t0 = performance.now();
  terrain.carve(p.x, p.y, p.z, r);
  const res = chunks.sync(terrain);
  state.lastExplosionMs = performance.now() - t0;
  state.lastExplosionChunks = res.chunks;
  flashes.spawn(p, r);
  refresh();
}

// ---- pointer: click (no drag) explodes, hover previews the blast radius ----
const marker = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
);
marker.visible = false;
stage.scene.add(marker);

let down: { x: number; y: number; t: number; button: number } | null = null;
let hover: PointerEvent | null = null;
let hoverQueued = false;

canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
});
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (down.button === 0 && moved < 5 && performance.now() - down.t < 500) {
    const p = pickTerrain(e, canvas, stage.camera, terrain);
    if (p) explode(p, radius);
  }
  down = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) {
    marker.visible = false;
    return;
  }
  hover = e;
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    const p = hover ? pickTerrain(hover, canvas, stage.camera, terrain) : null;
    if (p) {
      marker.position.copy(p);
      marker.scale.setScalar(radius);
      marker.visible = true;
    } else marker.visible = false;
  });
});
canvas.addEventListener('pointerleave', () => {
  marker.visible = false;
});

// ---- controls ----
hud.seed.value = String(seed);
hud.radius.addEventListener('input', () => {
  radius = Number(hud.radius.value);
  hud.setRadiusLabel(radius);
});
hud.regen.addEventListener('click', () => {
  seed = Number(hud.seed.value) | 0;
  newMap(seed);
});
hud.random.addEventListener('click', () => {
  seed = Math.floor(Math.random() * 99999); // UI only: never in generation/gameplay code
  hud.seed.value = String(seed);
  newMap(seed);
});
hud.bench.addEventListener('click', () => {
  newMap(seed);
  const r = runExplosionBenchmark(terrain, () => chunks.sync(terrain).chunks, radius, 60);
  state.bench =
    `benchmark ${r.count} explosions (radius ${r.radius}): mean ${r.meanMs.toFixed(1)} ms · ` +
    `median ${r.medianMs.toFixed(1)} · p95 ${r.p95Ms.toFixed(1)} · worst ${r.worstMs.toFixed(1)} ms (CPU, ${r.meanChunks.toFixed(1)} chunks/explosion)`;
  refresh();
});

// ---- loop ----
window.addEventListener('resize', stage.resize);
let frames = 0;
let lastFps = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  stage.controls.update();
  flashes.update(now);
  stage.renderer.render(stage.scene, stage.camera);
  frames++;
  if (now - lastFps > 500) {
    hud.setFps((frames * 1000) / (now - lastFps));
    frames = 0;
    lastFps = now;
  }
}

newMap(seed);
requestAnimationFrame(loop);

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = { terrain, explode, newMap, stage };
}
