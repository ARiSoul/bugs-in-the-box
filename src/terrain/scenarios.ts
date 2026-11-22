import { floatingIslands } from './generators/floatingIslands';
import { insidePC } from './generators/insidePC';
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
  /** Projectiles that leave the map box (sides and top) are discarded. */
  strictBounds: boolean;
  /** WebGPU path: where the key light stands, from the map centre (default: high on the low-x side). */
  sun?: [number, number, number];
  /** WebGPU path: colour and intensity of the key light (defaults 0xffb878 and 3.9: late sun into a dark case). */
  sunColor?: number;
  sunIntensity?: number;
  /** Lowest angle of the chase view above the active bug (radians; default 0.42): higher over tall walls. */
  chaseElevation?: number;
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
    sun: [18, 180, 48],
    // a softer, whiter light: black parts must stay black (a strong warm light gives every black surface a
    // tan sheen where it is seen at a grazing angle, and turns the cabinet's vinyl brown)
    sunColor: 0xffe2c6,
    sunIntensity: 3,
    // the cabinet walls stand tall around the play: the chase view looks down over them
    chaseElevation: 0.66,
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
