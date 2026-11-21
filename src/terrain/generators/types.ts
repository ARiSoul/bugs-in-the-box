import type { Terrain } from '../Terrain';

/**
 * A generator fills `terrain.dens` for a given seed and then calls `terrain.commitGeneration()`.
 * Each scenario (PC interior, speaker, fridge, ...) will be its own generator.
 * Must be deterministic: same seed => identical density grid on every device.
 */
export type TerrainGenerator = (terrain: Terrain, seed: number) => void;
