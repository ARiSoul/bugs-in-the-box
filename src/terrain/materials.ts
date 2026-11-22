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
export const MDF = 16; // raw fibreboard: the cabinet's cut edges
export const FOAM = 17; // white polyester wadding lining a speaker cabinet
export const VINYL = 18; // the cabinet's black textured wrap, and the amp plate's black paint
export const CONE = 19; // the back of a loudspeaker cone: dark pressed paper
export const DAMPER = 20; // the speaker's spider (the corrugated suspension): golden impregnated cloth
export const FERRITE = 21; // the speaker's ring magnet: dark grey ceramic
export const WOOD = 22; // the desk top
export const SLEEVE = 23; // the grey foam sleeve around a speaker cable bundle

/**
 * Glow of each material (`MATERIAL_PBR[id][2]`): what the renderer may light up. Signed so that the
 * mesher can blend it across material borders: towards +1 an RGB light, towards -1 a fan blade.
 */
export const GLOW_NONE = 0;
export const GLOW_RGB = 1; // hue-cycling RGB light
export const GLOW_FAN = -1; // fan blades: a renderer may draw a spinning stripe on them
export const GLOW_FUZZ = -0.4; // fibrous wadding: a renderer may give it a soft velvet sheen
export const GLOW_GRAIN = -0.7; // wood: a renderer may draw a grain along x

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
  [0.92, 0, 0], // MDF
  [1, 0, GLOW_FUZZ], // FOAM
  [0.85, 0, 0], // VINYL: matte wrap
  [0.85, 0, 0], // CONE
  [0.7, 0, 0], // DAMPER
  [0.8, 0.1, 0], // FERRITE
  [0.55, 0, GLOW_GRAIN], // WOOD: lacquered
  [0.95, 0, 0], // SLEEVE
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
  [0.46, 0.38, 0.27], // MDF: pale tan fibreboard
  [0.86, 0.85, 0.82], // FOAM
  [0.016, 0.017, 0.02], // VINYL: black (the key light is strong: anything lighter reads tan)
  [0.07, 0.065, 0.06], // CONE
  [0.72, 0.5, 0.12], // DAMPER
  [0.13, 0.13, 0.14], // FERRITE
  [0.5, 0.31, 0.16], // WOOD
  [0.11, 0.11, 0.12], // SLEEVE
];
