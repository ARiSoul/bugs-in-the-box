import type { Terrain } from '../Terrain';

/**
 * A generator starts with `terrain.beginGeneration()`, fills `terrain.dens` (and optionally
 * `terrain.material`) for a given seed, and ends with `terrain.commitGeneration()`.
 * Each scenario (PC interior, speaker, fridge, ...) will be its own generator.
 * Must be deterministic: same seed => identical density grid on every device.
 *
 * A generator may also describe where its render-only features are (`layout`): lights, fans, heat.
 * Gameplay never reads the layout; the renderer uses it to place glows, effects and camera poses.
 */
export type TerrainGenerator = (terrain: Terrain, seed: number, layout?: SceneLayout) => void;

/** World-space box: min and max corners. */
export type Box3 = [number, number, number, number, number, number];

/**
 * Render-only features of a generated map (plain data, no three.js).
 *
 * - `fan`: a fan with an RGB ring. Centre of the rotor, `axis` it faces along (`facing` +1 or -1 along
 *   it), `radius` of the opening; the ring sits 2 units out on the facing side.
 * - `pump`: the cooler pump block. Centre of its top, `radius` of its RGB ring.
 * - `lightBar`: an RGB light bar (`box`).
 * - `led`: a small activity LED at the centre, `color` 0xRRGGBB.
 * - `heat`: air that shimmers above something hot (`box`).
 * - `connector`: a power connector block on the board (`box`).
 * - `part`: a small detail with a clean render shape over a coarser terrain block: `box`, `shape`
 *   ('box' | 'cylX' | 'cylY' | 'cylZ'), `color`, `metal`, `rough`, `glow` (self-lit, 0 = none).
 * - `trace`: a straight copper trace (`box`). `ramBody`: the heat spreader of a RAM stick (`box`).
 * - `dust`: a dust bunny lying at (x, y, z), `radius`.
 * - `pad`: a round solder pad on the board, centre on the board top, `radius`.
 * - `grommet`: a rubber grommet ring lying flat, centre on the surface, `radius` of the ring.
 * - `capacitor`: an electrolytic capacitor standing on the board at (x, y, z), `radius`, top at `box[4]`.
 * - `tube`: a thick tube or cable along the arc of `parts.cable`: `path` = [ax, ay, az, bx, by, bz, lift, radius],
 *   `color` its sleeve (0xffffff: plain black rubber).
 * - `wire`: a thin render-only cable (no terrain) from (ax, ay, az) to (bx, by, bz) that rises off the first
 *   point and comes level into the second (along `axis`, from its `facing` side), sagging by `lift`:
 *   `path` = [ax, ay, az, bx, by, bz, lift, radius, ...via], where optional `via` points (x, y, z triples) replace
 *   the sag and steer the run in between.
 * - `screw`: a board mounting hole at (x, y, z): copper ring of `radius` and a screw head.
 */
export interface Feature {
  kind: 'fan' | 'pump' | 'lightBar' | 'led' | 'heat' | 'tube' | 'capacitor' | 'grommet' | 'pad' | 'connector' | 'dust' | 'trace' | 'ramBody' | 'part' | 'screw' | 'wire';
  x: number;
  y: number;
  z: number;
  axis: 0 | 1 | 2;
  /** +1 or -1: which way along `axis` the feature faces. */
  facing: number;
  radius: number;
  color: number;
  box: Box3;
  path: number[];
  shape?: 'box' | 'cylX' | 'cylY' | 'cylZ';
  metal?: number;
  rough?: number;
  glow?: number;
  /** Where the render checks that the terrain under a `part` is still there (default: the box centre). */
  probe?: [number, number, number];
}

export interface SceneLayout {
  features: Feature[];
  /** Height of a render-only glass panel over the map, or -1 for none. */
  glassY: number;
  /** Inside of the enclosure (walls excluded), or the whole map. */
  inner: Box3;
  /** Height of the floor the parts stand on (render-only air effects stay above it). */
  floorY: number;
}

export function createLayout(): SceneLayout {
  return { features: [], glassY: -1, inner: [0, 0, 0, 0, 0, 0], floorY: 0 };
}

/** Empty `layout` before a generator fills it; the default is the whole map with no glass. */
export function resetLayout(layout: SceneLayout, t: Terrain): void {
  layout.features.length = 0;
  layout.glassY = -1;
  layout.inner = [0, 0, 0, t.W, t.H, t.D];
  layout.floorY = 0;
}

export function feature(kind: Feature['kind'], x: number, y: number, z: number, more: Partial<Feature> = {}): Feature {
  return { kind, x, y, z, axis: 1, facing: 1, radius: 0, color: 0xffffff, box: [x, y, z, x, y, z], path: [], ...more };
}
