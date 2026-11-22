/**
 * Surface materials: one id per density sample (`Terrain.material`), visual only (gameplay never reads
 * it). Ids are shared by every scenario; each scenario uses the ones it needs.
 */
export const GROUND = 0; // natural terrain: grass on top, rock on the sides (the floating islands)
export const PCB = 1; // green solder mask
export const COPPER = 2;
export const ALUMINIUM = 3;
export const BLACK_PLASTIC = 4;
export const CAP_SLEEVE = 5; // electrolytic capacitor sleeve
export const STEEL = 6; // capacitor tops, PSU case
export const SHROUD = 7; // graphics card cooler
export const CABLE_RED = 8;
export const CABLE_YELLOW = 9;
export const FAN = 10;
export const GOLD = 11;
export const SILICON = 12; // chip packages
export const DUST = 13; // fluffy grey dust bunnies
export const RGB_LIGHT = 14; // diffuser of an RGB light (fan rings, RAM light bars, pump ring): glows
export const CABLE_BLUE = 15;

/**
 * Glow of each material (`MATERIAL_PBR[id][2]`): what the renderer may light up. Signed so that the
 * mesher can blend it across material borders: towards +1 an RGB light, towards -1 a fan blade.
 */
export const GLOW_NONE = 0;
export const GLOW_RGB = 1; // hue-cycling RGB light
export const GLOW_FAN = -1; // fan blades: a renderer may draw a spinning stripe on them

/** Surface finish of each material: [roughness, metalness, glow], indexed by id. */
export const MATERIAL_PBR: readonly (readonly [number, number, number])[] = [
  [0.95, 0, 0], // GROUND
  [0.55, 0, 0], // PCB: glossy solder mask
  [0.42, 1, 0], // COPPER
  [0.42, 0.9, 0], // ALUMINIUM
  [0.6, 0, 0], // BLACK_PLASTIC
  [0.45, 0, 0], // CAP_SLEEVE
  [0.5, 0.85, 0], // STEEL: brushed, so small bumps do not show as mirror wobble
  [0.5, 0.2, 0], // SHROUD
  [0.55, 0, 0], // CABLE_RED
  [0.55, 0, 0], // CABLE_YELLOW
  [0.5, 0, GLOW_FAN], // FAN
  [0.36, 1, 0], // GOLD
  [0.4, 0, 0], // SILICON
  [1, 0, 0], // DUST
  [0.3, 0, GLOW_RGB], // RGB_LIGHT
  [0.55, 0, 0], // CABLE_BLUE
];

/** Base colour of each material (linear RGB, 0..1), indexed by id. */
export const MATERIAL_RGB: readonly (readonly [number, number, number])[] = [
  [0.3, 0.3, 0.3], // GROUND (unused: shaded by slope)
  [0.025, 0.15, 0.07], // PCB
  [0.75, 0.42, 0.18], // COPPER
  [0.62, 0.64, 0.68], // ALUMINIUM
  [0.07, 0.07, 0.08], // BLACK_PLASTIC
  [0.1, 0.2, 0.55], // CAP_SLEEVE
  [0.55, 0.57, 0.6], // STEEL
  [0.16, 0.17, 0.2], // SHROUD
  [0.62, 0.08, 0.06], // CABLE_RED
  [0.85, 0.66, 0.08], // CABLE_YELLOW
  [0.1, 0.11, 0.13], // FAN
  [0.9, 0.7, 0.22], // GOLD
  [0.12, 0.12, 0.14], // SILICON
  [0.27, 0.26, 0.24], // DUST
  [0.12, 0.12, 0.13], // RGB_LIGHT (dark diffuser; the colour comes from the glow)
  [0.05, 0.2, 0.62], // CABLE_BLUE
];
