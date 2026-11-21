import type { Terrain } from '../terrain/Terrain';
import { CHUNK } from '../terrain/constants';

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
};

export interface HudState {
  generateMs: number;
  initialMeshMs: number;
  lastExplosionMs: number;
  lastExplosionChunks: number;
  triangles: number;
  bench: string;
}

export class Hud {
  readonly seed = el<HTMLInputElement>('seed');
  readonly radius = el<HTMLInputElement>('radius');
  readonly regen = el<HTMLButtonElement>('regen');
  readonly random = el<HTMLButtonElement>('rand');
  readonly bench = el<HTMLButtonElement>('bench');
  private readonly stats = el('stats');
  private readonly radiusLabel = el('rv');
  private readonly fps = el('fps');

  setRadiusLabel(r: number): void {
    this.radiusLabel.textContent = String(r);
  }

  setFps(fps: number): void {
    this.fps.textContent = `${Math.round(fps)} fps`;
  }

  render(terrain: Terrain, s: HudState): void {
    this.stats.textContent =
      `map ${terrain.W}×${terrain.H}×${terrain.D} · ${terrain.chunkCount} chunks of ${CHUNK}³ · ${(s.triangles / 1000).toFixed(1)}k triangles\n` +
      `generate: ${s.generateMs.toFixed(0)} ms · initial mesh: ${s.initialMeshMs.toFixed(0)} ms\n` +
      `last explosion: ${s.lastExplosionMs.toFixed(1)} ms (${s.lastExplosionChunks} chunks)` +
      (s.bench ? `\n${s.bench}` : '');
  }
}
