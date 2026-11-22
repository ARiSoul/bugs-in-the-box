import type { Bug } from './bug';
import type { TerrainField } from './field';

/** Candidate offsets around the requested point, nearest first. Fixed order: spawning is deterministic. */
const OFFSETS: readonly (readonly [number, number])[] = (() => {
  const list: [number, number][] = [];
  for (let i = -6; i <= 6; i++) for (let k = -6; k <= 6; k++) list.push([i * 4, k * 4]);
  return list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[0] - b[0] || a[1] - b[1]);
})();

/**
 * Drop the bug onto ground as close as possible to (x, z), trying nearby columns if that one has
 * no ground (e.g. a hole blown through the floor). From `fromY` (default the top of the world) it lands
 * on the first surface below that height: a shelf under another one. Returns false if nothing was found.
 */
export function dropNear(bug: Bug, field: TerrainField, x: number, z: number, fromY = field.H - 1): boolean {
  const margin = bug.species.radius + 3;
  for (const [dx, dz] of OFFSETS) {
    const cx = x + dx;
    const cz = z + dz;
    if (cx < margin || cz < margin || cx > field.W - margin || cz > field.D - margin) continue;
    if (bug.drop(field, cx, cz, fromY)) return true;
  }
  return false;
}
