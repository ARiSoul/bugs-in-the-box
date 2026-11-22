import { floatingIslands } from './generators/floatingIslands';
import { insidePC } from './generators/insidePC';
import { pcCase } from './generators/pcCase';
import type { TerrainGenerator } from './generators/types';

/** A scenario: a generator plus the look around it. Data only (the render reads `sky`). */
export interface Scenario {
  id: string;
  name: string;
  generate: TerrainGenerator;
  /** Mesh with sharp edges (Dual Contouring, for built things) or smooth (Surface Nets, for natural terrain). */
  sharpEdges: boolean;
  /** Background: CSS gradient behind the canvas, and the fog colour (0xRRGGBB). */
  sky: { css: string; fog: number };
  /**
   * Render path: 'webgl' (the classic look) or 'webgpu' (the atmosphere path: height fog, god rays,
   * bloom, glass, dust). A 'webgpu' scenario still runs where WebGPU is missing, on WebGL2, with less.
   */
  render: 'webgl' | 'webgpu';
  /** Projectiles that leave the map box (sides and top) are discarded. */
  strictBounds: boolean;
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
