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
 * - `wire`: a soft cable along a polyline: `path` = [radius, x0, y0, z0, x1, y1, z1, ...] (the terrain may hold
 *   the same cable, thinner, so bugs can walk on it).
 * - `screw`: a board mounting hole at (x, y, z): copper ring of `radius` and a screw head.
 * - `driver`: a loudspeaker seen from behind, standing on the floor at (x, y, z) with its basket `radius`
 *   (`box`: its bounds). A woofer has `path` = [cone top, spider top, magnet bottom, magnet top] (heights);
 *   a tweeter has none.
 * - `port`: a bass port duct (`box`), the top of the duct at y; `path` = [slot x0, z0, x1, z1, bottom y]
 *   (the slot is open from the top of the duct down to `bottom y` and beyond).
 * - `rod`: a straight round rod from `path` [x0, y0, z0] to [x1, y1, z1], `radius`, `color`, `metal`, `rough`;
 *   `facing` -1: a flat blade at its start (a screwdriver tip); `axis` 0: a fluted grip.
 * - `room`: the floor of the room far below the map, at height y, `color` (a drop off the map reads as one).
 * - `lamp`: a small light at (x, y, z) (a fridge's bulb): `color`, `glow` its intensity, `radius` its reach.
 * - `turntable`: a microwave's glass plate on its roller ring, axis at (x, z), the plate's top at y, `radius`
 *   the plate's; `path` = [ring radius, cavity floor y]. It turns with the match (render reads the turns).
 * - `perforated`: a perforated sheet (`box`, a sharp plate), its face across `axis`, holes `radius` apart,
 *   `color`; `path` = [cos, sin] tilts it about x like a `part`.
 * - `marble`: a polished marble sheet with fine veins (`box`), its face across `axis`.
 * - `blower`: a fan's impeller facing along `axis` at (x, y, z): hub, swept blades, a wire guard; `radius`, `color`.
 * - `screen`: a display panel (`box`), its picture on the face towards local +z: `look` 'game', 'editor', 'desert'
 *   or 'off'. `keyboard`: keycaps on a keyboard's deck (`box`, its top at box[4]): `path` = [columns, rows],
 *   `color` of the caps. `dusty`: a black laminate desk sheet with dust and crumbs (`box`).
 * Any `part`, `screen` or `keyboard` may carry `yaw` = [cos, sin]: turned about the vertical through its box's
 * centre, local +x towards world (cos, 0, sin) (as `rotatedBox` about y).
 *
 * A `part` with `opacity` below 1 is see-through (glass shelves, clear plastic drawers and bins). A `part`
 * with `path` = [cos, sin] is turned about x by that angle round its box's centre (a board leaning on a shelf).
 */
/** Render shape of a `part`: a rounded box, a sharp-edged box ('plate'), a box with very round edges ('soft', a melting ice cube), a dome on its base, a ball filling the box, or a cylinder along an axis. */
export type PartShape = 'box' | 'plate' | 'soft' | 'dome' | 'ball' | 'cylX' | 'cylY' | 'cylZ';

export interface Feature {
  kind:
    | 'fan' | 'pump' | 'lightBar' | 'led' | 'heat' | 'tube' | 'capacitor' | 'grommet' | 'pad' | 'connector'
    | 'dust' | 'trace' | 'ramBody' | 'part' | 'screw' | 'wire' | 'driver' | 'port' | 'rod' | 'room' | 'lamp'
    | 'turntable' | 'perforated' | 'marble' | 'blower' | 'screen' | 'keyboard' | 'dusty' | 'mouse' | 'speakerFront' | 'bottle' | 'foil' | 'butt' | 'flake';
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
  shape?: PartShape;
  metal?: number;
  rough?: number;
  glow?: number;
  /** See-through parts: 0..1 (default 1, opaque). */
  opacity?: number;
  /** Turned about the vertical: [cos, sin] (see above). */
  yaw?: [number, number];
  /** What a `screen` shows. */
  look?: 'game' | 'editor' | 'desert' | 'movie' | 'desktop' | 'off' | 'felt' | 'wood' | 'pale' | 'full' | 'laptop';
  /** A curved `screen`'s extra bezel under the picture (a monitor's chin). */
  chin?: number;
  /** A curved `screen`'s coloured trim along the front of its lower bezel (0 = none). */
  trim?: number;
  /** A cigarette `butt`: its ash stub's length (0: burnt to the paper), its paper's bend (radians), a flattened filter. */
  butt?: { ash: number; bend: number; flat: boolean };
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
