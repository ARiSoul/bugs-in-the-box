/**
 * Surface materials: one id per density sample (`Terrain.material`), visual only (gameplay never reads
 * it). Ids are shared by every scenario; each scenario uses the ones it needs.
 */
export const GROUND = 0; // natural terrain: grass on top, rock on the sides (no map uses it now; tests do)
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
 * Solid but never drawn: the collision body of a part that only the renderer draws (a thin wire, a
 * collar, a small component). Gameplay collides with it like any terrain; the renderer drops its
 * surface (roughness HIDDEN_ROUGHNESS, impossible for a real material, marks it), and its smooth
 * stand-in shows instead. Explosions carve it like everything else.
 */
export const COLLIDER = 24;
/** Roughness that marks a hidden surface (real materials stay within 0..1). */
export const HIDDEN_ROUGHNESS = 3;
export const ENAMEL = 25; // a fridge's white painted steel body and door
export const LINER = 26; // a fridge's white moulded plastic inside
export const TILE = 27; // glazed floor tiles (the grout lines are drawn on top)
export const FROST = 28; // frost on a freezer's walls
export const PAINT = 29; // a painted kitchen wall
export const CHASSIS_RED = 30; // a retro appliance's glossy red painted steel
export const MARBLE = 31; // a pale marble worktop and splashback
export const DESK_BLACK = 32; // a black laminate desk top (dust and crumbs are drawn on it)
export const DESK_WHITE = 33; // a white laminate table top (ash and dust are drawn on it)
export const DASH = 34; // a dashboard's dark moulded skin (the drawn skin lies over it)
export const DASH_FOAM = 35; // the yellowed foam under a dashboard's skin
export const DASH_TRIM = 36; // a car's dark grey hard plastic: the doors, the tunnel
/**
 * The hidden body of what bugs build: like COLLIDER, but a crater in it is never drawn either (the build's own view draws
 * the walls of its holes). Its metalness, below 0 (impossible), marks it.
 */
export const BUILT = 37;
/** A metalness below this marks a hidden body whose craters are not drawn. */
export const BUILT_METAL = -0.1;

/**
 * Glow of each material (`MATERIAL_PBR[id][2]`): what the renderer may light up. Signed so that the
 * mesher can blend it across material borders: towards +1 an RGB light, towards -1 a fan blade.
 */
export const GLOW_NONE = 0;
export const GLOW_RGB = 1; // hue-cycling RGB light
export const GLOW_FAN = -1; // fan blades: a renderer may draw a spinning stripe on them
export const GLOW_FUZZ = -0.4; // fibrous wadding: a renderer may give it a soft velvet sheen
export const GLOW_GRAIN = -0.7; // wood: a renderer may draw a grain along x
export const GLOW_BROKEN = -0.05; // the broken inside a blast opened: a renderer may draw it in layers (near 0: a blend to 0 crosses no other code)
export const GLOW_PEEL = -0.12; // textured vinyl wrap: a renderer may give it an orange-peel mottle and an edge sheen

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
  [0.85, 0, GLOW_PEEL], // VINYL: matte textured wrap
  [0.85, 0, 0], // CONE
  [0.7, 0, 0], // DAMPER
  [0.8, 0.1, 0], // FERRITE
  [0.55, 0, GLOW_GRAIN], // WOOD: lacquered
  [0.95, 0, 0], // SLEEVE
  [HIDDEN_ROUGHNESS, 0, 0], // COLLIDER: never drawn
  [0.3, 0, 0], // ENAMEL: glossy paint
  [0.4, 0, 0], // LINER: smooth plastic
  [0.28, 0, 0], // TILE: glazed
  [0.9, 0, GLOW_FUZZ], // FROST: soft, lets light in like the wadding
  [0.85, 0, 0], // PAINT: matte
  [0.36, 0.04, 0], // CHASSIS_RED: glossy enamel
  [0.22, 0, 0], // MARBLE: polished
  [0.6, 0, 0], // DESK_BLACK: satin laminate
  [0.55, 0, 0], // DESK_WHITE: satin laminate
  [0.8, 0, 0], // DASH: matte soft plastic
  [0.95, 0, 0], // DASH_FOAM
  [0.7, 0, 0], // DASH_TRIM
  [HIDDEN_ROUGHNESS, -1, 0], // BUILT: never drawn, nor its craters
];

/**
 * How much the base colour varies over a surface (a slow value noise, the full swing), indexed by id.
 * Clean painted and moulded surfaces barely vary; a white one shows any variation as dirt.
 */
export const MATERIAL_NOISE: readonly number[] = (() => {
  const n = new Array<number>(38).fill(0.24);
  n[ENAMEL] = 0.025;
  n[LINER] = 0.025;
  n[TILE] = 0.1;
  n[FROST] = 0.12;
  n[PAINT] = 0.05;
  n[CHASSIS_RED] = 0.03;
  n[MARBLE] = 0; // (drawn sheets with veins lie over it)
  n[DESK_BLACK] = 0; // (a drawn dusty sheet lies over it)
  n[DESK_WHITE] = 0; // (a drawn dusty sheet lies over it)
  n[DASH] = 0.04;
  n[DASH_TRIM] = 0.04;
  n[STEEL] = 0.08; // (galvanised and brushed sheet: a cloudy swing reads as dirt)
  return n;
})();

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
  [0.026, 0.028, 0.032], // VINYL: black, a shade off the void (the backdrop is darker still)
  [0.07, 0.065, 0.06], // CONE
  [0.72, 0.5, 0.12], // DAMPER
  [0.13, 0.13, 0.14], // FERRITE
  [0.5, 0.31, 0.16], // WOOD
  [0.11, 0.11, 0.12], // SLEEVE
  [0.02, 0.02, 0.02], // COLLIDER (never drawn; dark where a border blends into it)
  [0.8, 0.8, 0.78], // ENAMEL
  [0.76, 0.78, 0.78], // LINER: a cool white
  [0.5, 0.47, 0.43], // TILE: warm grey stone
  [0.82, 0.88, 0.94], // FROST: blue-white
  [0.36, 0.4, 0.37], // PAINT: pale sage
  [0.5, 0.025, 0.02], // CHASSIS_RED
  [0.74, 0.74, 0.72], // MARBLE: warm white
  [0.03, 0.03, 0.032], // DESK_BLACK
  [0.8, 0.8, 0.78], // DESK_WHITE
  [0.027, 0.027, 0.028], // DASH
  [0.34, 0.27, 0.15], // DASH_FOAM: pale yellow-brown
  [0.05, 0.05, 0.053], // DASH_TRIM
  [0.02, 0.02, 0.02], // BUILT (never drawn)
];

/**
 * What an ant cannot dig through (metal, stone, hard ceramic): its Burrow stops short of it. Blasts still break them.
 */
export const HARD: readonly number[] = [ALUMINIUM, STEEL, FERRITE, ENAMEL, CHASSIS_RED, MARBLE];
