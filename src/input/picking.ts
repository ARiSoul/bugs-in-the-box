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
  /** What is nearer than this does not count (it is seen through). */
  from = 0,
): THREE.Vector3 | null {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin: o, direction: d } = raycaster.ray;
  // (inside of something there: on to where it ends)
  let start = from;
  for (let k = 0; from > 0 && k < 24 && terrain.sample(o.x + d.x * start, o.y + d.y * start, o.z + d.z * start) < 0.05; k++) start += 0.5;
  o.addScaledVector(d, start);
  const t = terrain.raycast(o.x, o.y, o.z, d.x, d.y, d.z);
  if (t < 0) return null;
  return new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
}
