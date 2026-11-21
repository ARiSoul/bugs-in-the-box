import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** Point on the terrain surface under the pointer, or null if the ray misses. */
export function pickTerrain(
  ev: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  terrain: Terrain,
): THREE.Vector3 | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin: o, direction: d } = raycaster.ray;
  const t = terrain.raycast(o.x, o.y, o.z, d.x, d.y, d.z);
  if (t < 0) return null;
  return new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
}
