import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Terrain } from '../terrain/Terrain';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resize(): void;
}

/** Renderer, camera, lights and orbit controls. Contains no game logic. */
export function createStage(canvas: HTMLCanvasElement, terrain: Terrain): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1b2233, 160, 360);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 800);
  const center = new THREE.Vector3(terrain.W / 2, terrain.H * 0.3, terrain.D / 2);
  camera.position.set(center.x + 95, center.y + 80, center.z + 105);

  // Image-based light from a neutral studio room: soft fill everywhere, and reflections for metal.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xaec8ff, 0x3a2f28, 0.35));

  // Key light with soft shadows over the whole map.
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  const mapCenter = new THREE.Vector3(terrain.W / 2, 0, terrain.D / 2);
  sun.position.copy(mapCenter).add(new THREE.Vector3(70, 160, 45));
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
  scene.add(sun, sun.target);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxDistance = 300;
  controls.update();

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();

  return { renderer, scene, camera, controls, resize };
}
