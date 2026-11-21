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

/** Surface finish of each material: [roughness, metalness], indexed by id. */
export const MATERIAL_PBR: readonly (readonly [number, number])[] = [
  [0.95, 0], // GROUND
  [0.55, 0], // PCB: glossy solder mask
  [0.35, 1], // COPPER
  [0.42, 0.9], // ALUMINIUM
  [0.6, 0], // BLACK_PLASTIC
  [0.45, 0], // CAP_SLEEVE
  [0.5, 0.85], // STEEL: brushed, so small bumps do not show as mirror wobble
  [0.5, 0.2], // SHROUD
  [0.55, 0], // CABLE_RED
  [0.55, 0], // CABLE_YELLOW
  [0.5, 0], // FAN
  [0.25, 1], // GOLD
  [0.4, 0], // SILICON
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
  [0.22, 0.24, 0.3], // FAN
  [0.9, 0.7, 0.22], // GOLD
  [0.12, 0.12, 0.14], // SILICON
];
