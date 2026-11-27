import { car } from './generators/car';
import { carScale, insideCar } from './generators/carPlan';
import { desk } from './generators/desk';
import { fridge } from './generators/fridge';
import { microwave, microwavePlan } from './generators/microwave';
import { pcCase } from './generators/pcCase';
import { speaker } from './generators/speaker';
import type { TerrainGenerator } from './generators/types';

/** A scenario: a generator plus the look around it. Data only (the render reads `sky`). */
export interface Scenario {
  id: string;
  name: string;
  generate: TerrainGenerator;
  /** Mesh with sharp edges (Dual Contouring, for built things) or smooth (Surface Nets, for natural terrain). */
  sharpEdges: boolean;
  /**
   * Background: CSS gradient behind the canvas, and the fog colour (0xRRGGBB). The distance
   * fog is clear up to `fogClear` and nearly full `fogSpan` further (defaults 40 and 110: a closed case),
   * and the map's edges and corners fall dark by `cornerDark` (default 0.75). `backdrop`: the colour of the
   * room behind the map at the middle of the view (default a very dark blue-grey).
   */
  sky: { css: string; fog: number; fogClear?: number; fogSpan?: number; cornerDark?: number; backdrop?: number };
  /** Projectiles that leave the map box by its sides are discarded; at its top they stop and fall back. */
  strictBounds: boolean;
  /** Where the key light stands, from the map centre (default: high on the low-x side). */
  sun?: [number, number, number];
  /** Colour and intensity of the key light (defaults 0xffb878 and 3.9: late sun into a dark case). */
  sunColor?: number;
  sunIntensity?: number;
  /** How bright the light from all round is (default 0.4). */
  environment?: number;
  /** How strong the shafts of light in the air are (default 0.5). */
  rays?: number;
  /** Lowest angle of the chase view above the active bug (radians; default 0.42): higher over tall walls. */
  chaseElevation?: number;
  /** Bugs may start on any level (shelves under shelves), not only on the topmost surface. */
  spawnLevels?: boolean;
  /** A turntable that turns a quarter between turns (gameplay), for a map of this size. */
  /**
   * The map's size in chunks of 32 when the address gives none (default 5x3x5): a scenario at a larger scale
   * needs a larger map, so the bugs keep their size against the things around them.
   */
  mapSize?: [number, number, number];
  /**
   * What its ground is made of inside, where a blast breaks it open (linear RGB): the broken stuff, and the thin layers
   * through it (visual only; default a grey-brown with paler lines).
   */
  inside?: { core: readonly [number, number, number]; line: readonly [number, number, number] };
  /** Where a bug may stand or walk, for a map of this size (default: all of it). */
  confine?: (W: number, H: number, D: number) => (x: number, y: number, z: number) => boolean;
  turntable?: (W: number, H: number, D: number) => { x: number; z: number; radius: number; j0: number; j1: number; surface: number };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'pc-case',
    name: 'Tower Case',
    generate: pcCase,
    sharpEdges: true,
    // (a circuit board: pale fibreglass, thin copper layers)
    inside: { core: [0.17, 0.17, 0.095], line: [0.75, 0.32, 0.1] },
    sky: { css: 'radial-gradient(ellipse at 50% 45%, #1a1d24 0%, #050608 70%)', fog: 0x0b1016 },
    strictBounds: true,
  },
  {
    id: 'speaker',
    name: 'Studio Monitor',
    generate: speaker,
    sharpEdges: true,
    // (a cabinet of fibreboard)
    inside: { core: [0.17, 0.11, 0.065], line: [0.09, 0.055, 0.03] },
    // an open desk: the fog only darkens the far end of the room, and a dim warm room shows behind (the
    // black cabinet must not melt into the background)
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #221d19 0%, #070605 72%)', fog: 0x0d0b09, fogClear: 80, fogSpan: 220, cornerDark: 0.2, backdrop: 0x3a2e25 },
    strictBounds: true,
    // high, a little from the amp side: into the open cabinet, short shadows on the desk around it
    sun: [0, 180, 48],
    // a softer, whiter light: black parts must stay black (a strong warm light gives every black surface a
    // tan sheen where it is seen at a grazing angle, and turns the cabinet's vinyl brown)
    sunColor: 0xffe2c6,
    sunIntensity: 3,
    // the cabinet walls stand tall around the play: the chase view looks down over them
    chaseElevation: 0.66,
  },
  {
    id: 'fridge',
    name: 'Mini Fridge',
    generate: fridge,
    sharpEdges: true,
    // (tiles: a pale fired body, a grey bed of mortar in it)
    inside: { core: [0.3, 0.27, 0.22], line: [0.11, 0.105, 0.1] },
    // a kitchen at night: the fridge's light and a soft key light from the front, a dim warm room behind
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #24211e 0%, #080706 72%)', fog: 0x0e0c0b, fogClear: 90, fogSpan: 230, cornerDark: 0.2, backdrop: 0x2e2a26 },
    strictBounds: true,
    // high in front, a little from the right: into the open fridge, onto the door's bins
    sun: [25, 160, 140],
    sunColor: 0xfff0e0,
    sunIntensity: 2.6,
    chaseElevation: 0.5,
    // shelves under shelves: bugs start on any level
    spawnLevels: true,
  },
  {
    id: 'microwave',
    name: 'Microwave',
    generate: microwave,
    sharpEdges: true,
    // (sheet steel and plastic: grey)
    inside: { core: [0.13, 0.13, 0.125], line: [0.3, 0.3, 0.3] },
    // a bright kitchen: a pale marble worktop, a warm dim room behind
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #2a2622 0%, #0a0908 72%)', fog: 0x100e0c, fogClear: 90, fogSpan: 230, cornerDark: 0.2, backdrop: 0x34302b },
    strictBounds: true,
    // high in front, from the right: into the cavity, onto the bay
    sun: [40, 160, 140],
    sunColor: 0xfff2e4,
    sunIntensity: 2.8,
    chaseElevation: 0.5,
    spawnLevels: true,
    turntable: (W, H, D) => {
      const t = microwavePlan(W, H, D).turntable;
      return { x: t.x, z: t.z, radius: t.radius, j0: t.j0, j1: t.j1, surface: t.surface };
    },
  },
  {
    id: 'desk',
    name: 'Desk',
    generate: desk,
    sharpEdges: true,
    // (a laminated chipboard top: tan chips, darker glue lines)
    inside: { core: [0.2, 0.14, 0.08], line: [0.07, 0.05, 0.03] },
    // an evening room: warm walls far off, the screens' glow on the black desk
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #2a2724 0%, #0b0a09 72%)', fog: 0x110f0e, fogClear: 220, fogSpan: 480, cornerDark: 0.2, backdrop: 0x3a352f },
    strictBounds: true,
    // (twice the scale of the other maps' desks and shelves: about 0.8 cm a unit, like the fridge, so a bug
    // stays bug-sized next to a keyboard; the map is twice as wide)
    mapSize: [10, 3, 5],
    // high in front, a little from the right: across the desk, short shadows behind the monitors
    sun: [60, 340, 300],
    sunColor: 0xfff0e2,
    sunIntensity: 2.6,
    chaseElevation: 0.55,
    spawnLevels: true,
  },
  {
    id: 'car',
    name: 'Car Dashboard',
    generate: car,
    sharpEdges: true,
    // (a dashboard: grey-yellow foam under the skin)
    inside: { core: [0.17, 0.155, 0.11], line: [0.06, 0.06, 0.06] },
    // a car parked in a bright garage, its ignition on
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #3a3835 0%, #0c0b0a 72%)', fog: 0x14120f, fogClear: 300, fogSpan: 600, cornerDark: 0.1, backdrop: 0x3a3733 },
    strictBounds: true,
    // (the desk's scale: 2 units a centimetre; a row of chunks taller, for the dashboard stands high)
    mapSize: [10, 4, 5],
    // the low sun of the photos, from the left through the open garage door: long shadows over the top
    sun: [-230, 250, 120],
    sunColor: 0xfff3e6,
    sunIntensity: 5.5,
    environment: 0.5,
    rays: 0.16,
    chaseElevation: 0.5,
    spawnLevels: true,
    confine: (W, H, D) => {
      const { s, ox, oz } = carScale(W, H, D);
      return (x, y, z) => insideCar((x - ox) / s, y / s, (z - oz) / s);
    },
  },
];

export function scenarioById(id: string | null): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
