import { car } from './generators/car';
import { desk } from './generators/desk';
import { floatingIslands } from './generators/floatingIslands';
import { fridge } from './generators/fridge';
import { insidePC } from './generators/insidePC';
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
   * Background: CSS gradient behind the canvas, and the fog colour (0xRRGGBB). WebGPU path: the distance
   * fog is clear up to `fogClear` and nearly full `fogSpan` further (defaults 40 and 110: a closed case),
   * and the map's edges and corners fall dark by `cornerDark` (default 0.75). `backdrop`: the colour of the
   * room behind the map at the middle of the view (default a very dark blue-grey).
   */
  sky: { css: string; fog: number; fogClear?: number; fogSpan?: number; cornerDark?: number; backdrop?: number };
  /**
   * Render path: 'webgl' (the classic look) or 'webgpu' (the atmosphere path: height fog, god rays,
   * bloom, glass, dust). A 'webgpu' scenario still runs where WebGPU is missing, on WebGL2, with less.
   */
  render: 'webgl' | 'webgpu';
  /** Projectiles that leave the map box by its sides are discarded; at its top they stop and fall back. */
  strictBounds: boolean;
  /** WebGPU path: where the key light stands, from the map centre (default: high on the low-x side). */
  sun?: [number, number, number];
  /** WebGPU path: colour and intensity of the key light (defaults 0xffb878 and 3.9: late sun into a dark case). */
  sunColor?: number;
  sunIntensity?: number;
  /** WebGPU path: how bright the light from all round is (default 0.4). */
  environment?: number;
  /** WebGPU path: how strong the shafts of light in the air are (default 0.5). */
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
  turntable?: (W: number, H: number, D: number) => { x: number; z: number; radius: number; j0: number; j1: number; surface: number };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'pc',
    name: 'Inside a PC',
    generate: insidePC,
    sharpEdges: true,
    sky: { css: 'radial-gradient(ellipse at 50% 30%, #1d2a38 0%, #07090d 75%)', fog: 0x0b1016 },
    render: 'webgl',
    strictBounds: false,
  },
  {
    id: 'pc-case',
    name: 'Tower Case',
    generate: pcCase,
    sharpEdges: true,
    sky: { css: 'radial-gradient(ellipse at 50% 45%, #1a1d24 0%, #050608 70%)', fog: 0x0b1016 },
    render: 'webgpu',
    strictBounds: true,
  },
  {
    id: 'speaker',
    name: 'Studio Monitor',
    generate: speaker,
    sharpEdges: true,
    // an open desk: the fog only darkens the far end of the room, and a dim warm room shows behind (the
    // black cabinet must not melt into the background)
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #221d19 0%, #070605 72%)', fog: 0x0d0b09, fogClear: 80, fogSpan: 220, cornerDark: 0.2, backdrop: 0x3a2e25 },
    render: 'webgpu',
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
    // a kitchen at night: the fridge's light and a soft key light from the front, a dim warm room behind
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #24211e 0%, #080706 72%)', fog: 0x0e0c0b, fogClear: 90, fogSpan: 230, cornerDark: 0.2, backdrop: 0x2e2a26 },
    render: 'webgpu',
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
    // a bright kitchen: a pale marble worktop, a warm dim room behind
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #2a2622 0%, #0a0908 72%)', fog: 0x100e0c, fogClear: 90, fogSpan: 230, cornerDark: 0.2, backdrop: 0x34302b },
    render: 'webgpu',
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
    // an evening room: warm walls far off, the screens' glow on the black desk
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #2a2724 0%, #0b0a09 72%)', fog: 0x110f0e, fogClear: 220, fogSpan: 480, cornerDark: 0.2, backdrop: 0x3a352f },
    render: 'webgpu',
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
    // a car parked in a bright garage, its ignition on
    sky: { css: 'radial-gradient(ellipse at 50% 40%, #3a3835 0%, #0c0b0a 72%)', fog: 0x14120f, fogClear: 300, fogSpan: 600, cornerDark: 0.1, backdrop: 0x3a3733 },
    render: 'webgpu',
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
  },
  {
    id: 'islands',
    name: 'Floating islands',
    generate: floatingIslands,
    sharpEdges: false,
    sky: { css: 'radial-gradient(ellipse at 50% 30%, #2a3a5c 0%, #141a2b 70%)', fog: 0x1b2233 },
    render: 'webgl',
    strictBounds: false,
  },
];

export function scenarioById(id: string | null): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
