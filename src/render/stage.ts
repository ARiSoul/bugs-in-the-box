import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneLayout } from '../terrain/generators/types';
import type { Scenario } from '../terrain/scenarios';
import type { Terrain } from '../terrain/Terrain';

/** The terrain material, and its sharp-edge switch. */
export interface TerrainLook {
  material: THREE.Material;
  setSharp(sharp: boolean): void;
}

/** Reads GPU time per frame where the renderer can (WebGPU timestamp queries). */
export interface GpuTimer {
  /** Ask for the timings of the frames rendered so far; `onFrame(frame, ms)` is called for each one, later. */
  poll(onFrame: (frame: number, ms: number) => void): void;
}

export interface StageOptions {
  /** Fixed drawing-buffer size in pixels (e.g. 2560×1440 for measurements); null: follow the window. */
  fixedSize: [number, number] | null;
  /** Ask the renderer for GPU timestamps (WebGPU only). */
  timestamps: boolean;
  /** Seed for render-only randomness (dust motes). */
  seed: number;
}

/**
 * Renderer, camera, lights and orbit controls (made by `gpu/gpuStage.ts`). Contains no game logic.
 */
export interface Stage {
  /** What actually draws: 'WebGPU', or 'WebGL2 (no WebGPU)' for the fallback. */
  backend: string;
  scene: THREE.Scene;
  /** Screen-space overlays (labels): drawn after every post effect, so they stay crisp and still. */
  hud: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  look: TerrainLook;
  gpuTimer: GpuTimer | null;
  resize(): void;
  /** A new map: the scenario's look and the generator's render-only layout. */
  setScenario(sc: Scenario, layout: SceneLayout): void;
  /** Where gameplay carved the terrain: the render-only parts are cut the same way. */
  craters: {
    /** `rough`: a blast's uneven crater (see `terrain/crater.ts`). */
    add(x: number, y: number, z: number, radius: number, rough?: boolean): void;
    addTunnel(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number): void;
  };
  /** The menu's own layer over the picture (see `MenuLayer`). */
  menu: import('./gpu/gpuStage').MenuLayer;
  /** What a special attack's scene does to the whole picture. */
  fx: import('./gpu/gpuStage').StageFx;
  /** Draw one frame. `seconds` is render time (render-only animation), `dt` the frame step. */
  render(seconds: number, dt: number): void;
  /** Make the shaders of everything in the scene; until they are there, `render` draws nothing (the last picture stays). */
  warm(): Promise<void>;
  /** The renderer's frame counter (matches the GPU timer's frame numbers). */
  frameNumber(): number;
  /** The turntable's turn so far (quarter turns). */
  setTurntable(turns: number): void;
  /** Look-tuning knobs (uniforms) for the console. */
  tune?: Record<string, { value: unknown }>;
}

/** The game camera's first pose: above and outside the map, looking at its middle. */
export function startPose(terrain: Terrain, position: THREE.Vector3, target: THREE.Vector3): void {
  target.set(terrain.W / 2, terrain.H * 0.3, terrain.D / 2);
  position.set(target.x + 95, target.y + 80, target.z + 105);
}

/** Keep the canvas drawing buffer at the window size, or at a fixed size (scaled to fit by CSS). */
export function sizeOf(options: StageOptions): [number, number, number] {
  if (options.fixedSize) return [options.fixedSize[0], options.fixedSize[1], 1];
  return [window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 2)];
}

/** The warm key light with soft shadows over the whole map. */
export function keyLight(terrain: Terrain, offset = new THREE.Vector3(70, 160, 45)): [THREE.DirectionalLight, THREE.Object3D] {
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  const mapCenter = new THREE.Vector3(terrain.W / 2, 0, terrain.D / 2);
  sun.position.copy(mapCenter).add(offset);
  sun.target.position.copy(mapCenter);
  const reach = Math.max(terrain.W, terrain.D) * 0.8;
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  return [sun, sun.target];
}
