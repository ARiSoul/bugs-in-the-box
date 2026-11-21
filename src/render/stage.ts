import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1b2233, 160, 360);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 800);
  const center = new THREE.Vector3(terrain.W / 2, terrain.H * 0.3, terrain.D / 2);
  camera.position.set(center.x + 95, center.y + 80, center.z + 105);

  scene.add(new THREE.HemisphereLight(0xaec8ff, 0x3a2f28, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
  sun.position.set(80, 140, 40);
  scene.add(sun);

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
