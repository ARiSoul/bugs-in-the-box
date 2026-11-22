import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneLayout } from '../terrain/generators/types';
import type { Scenario } from '../terrain/scenarios';
import type { Terrain } from '../terrain/Terrain';

/** The terrain material of a render path, and its sharp-edge switch. */
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
 * Renderer, camera, lights and orbit controls of one render path. Contains no game logic.
 * `webgl` is the classic look; `webgpu` adds the atmosphere (see `gpu/gpuStage.ts`).
 */
export interface Stage {
  kind: 'webgl' | 'webgpu';
  /** What actually draws: 'WebGL', 'WebGPU', or 'WebGL2 (no WebGPU)' for the fallback. */
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
  /** Where gameplay carved the terrain, on paths whose render-only parts must be cut the same way. */
  craters?: {
    add(x: number, y: number, z: number, radius: number): void;
    addTunnel(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number): void;
  };
  /** Draw one frame. `seconds` is render time (render-only animation), `dt` the frame step. */
  render(seconds: number, dt: number): void;
  /** The renderer's frame counter (matches the GPU timer's frame numbers). */
  frameNumber(): number;
  /** The turntable's turn so far (quarter turns), on paths that draw one. */
  setTurntable?(turns: number): void;
  /** Look-tuning knobs (uniforms) for the console, on paths that have them. */
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

/** The classic WebGL path. */
export function createStage(canvas: HTMLCanvasElement, terrain: Terrain, options: StageOptions): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0x1b2233, 160, 360);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 800);
  const center = new THREE.Vector3();
  startPose(terrain, camera.position, center);

  // Image-based light from a neutral studio room: soft fill everywhere, and reflections for metal.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xaec8ff, 0x3a2f28, 0.35));
  scene.add(...keyLight(terrain));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxDistance = 300;
  controls.update();

  const resize = (): void => {
    const [w, h, ratio] = sizeOf(options);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const sharp = { value: 1 };
  const hud = new THREE.Scene();
  return {
    kind: 'webgl',
    backend: 'WebGL',
    scene,
    hud,
    camera,
    controls,
    look: { material: terrainMaterial(sharp), setSharp: (on) => (sharp.value = on ? 1 : 0) },
    gpuTimer: null,
    resize,
    setScenario(sc) {
      document.body.style.background = sc.sky.css;
      fog.color.setHex(sc.sky.fog);
    },
    render() {
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.render(hud, camera);
      renderer.autoClear = true;
    },
    frameNumber: () => renderer.info.render.frame,
  };
}

/** The warm key light with soft shadows over the whole map (both render paths). */
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

/**
 * One standard (PBR) material for all terrain, where roughness and metalness come per vertex from the
 * `pbr` attribute (set from the material id by the mesher), so metal parts reflect and plastic does not.
 * With `sharp` at 1, hard edges are shaded hard (see below).
 */
function terrainMaterial(sharp: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSharp = sharp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 pbr;\nvarying vec3 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;\nuniform float uSharp;')
      // Hard edges: vertex normals are averaged across an edge, which shades it round. Where the
      // triangle's own normal disagrees strongly with the interpolated one, use the triangle's.
      .replace(
        '#include <normal_fragment_begin>',
        [
          '#include <normal_fragment_begin>',
          'vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));',
          'normal = normalize(mix(normal, faceNormal, uSharp * smoothstep(0.84, 0.7, dot(faceNormal, normal))));',
        ].join('\n'),
      )
      // (a collision body of a drawn-only part, marked by an impossible roughness: never drawn)
      .replace('#include <clipping_planes_fragment>', ['#include <clipping_planes_fragment>', 'if (vPbr.x > 2.0) discard;'].join('\n'))
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = min(vPbr.x, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  return m;
}
