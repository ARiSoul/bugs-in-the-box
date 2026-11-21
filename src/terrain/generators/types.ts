import type { Terrain } from '../Terrain';

/**
 * A generator starts with `terrain.beginGeneration()`, fills `terrain.dens` (and optionally
 * `terrain.material`) for a given seed, and ends with `terrain.commitGeneration()`.
 * Each scenario (PC interior, speaker, fridge, ...) will be its own generator.
 * Must be deterministic: same seed => identical density grid on every device.
 */
export type TerrainGenerator = (terrain: Terrain, seed: number) => void;
