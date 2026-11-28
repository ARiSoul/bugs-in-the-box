import type { Match } from '../game/match';
import type { Terrain } from '../terrain/Terrain';

/** FNV-1a over 32-bit words. */
export class Hash {
  private h = 0x811c9dc5;
  private readonly f = new Float64Array(1);
  private readonly w = new Uint32Array(this.f.buffer);
  int(v: number): void {
    this.h = Math.imul(this.h ^ (v | 0), 0x01000193) >>> 0;
  }
  /** A number by its exact bits (the simulation is deterministic: the bits must match, not just the value). */
  num(v: number): void {
    this.f[0] = v;
    this.int(this.w[0]);
    this.int(this.w[1]);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
  }
  get hex(): string {
    return this.h.toString(16).padStart(8, '0');
  }
}

/** Everything the simulation decided by now, as one hash: the turn, the wind, every bug, and `events` (what happened since the last one, as JSON). */
export function matchDigest(m: Match, events: string): string {
  const h = new Hash();
  h.str(m.phase);
  h.int(m.active);
  h.int(m.turnNumber);
  h.num(m.windX);
  h.num(m.windZ);
  for (const u of m.units) {
    const b = u.bug;
    for (const v of [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.hx, b.hz, b.health]) h.num(v);
    h.int(b.alive ? 1 : 0);
    h.int(b.grounded ? 1 : 0);
  }
  h.str(events);
  return h.hex;
}

/** The ground's own hash: every density and material. */
export function groundDigest(t: Terrain): string {
  const h = new Hash();
  const d = new Uint32Array(t.dens.buffer, t.dens.byteOffset, t.dens.byteLength >> 2);
  for (let i = 0; i < d.length; i++) h.int(d[i]);
  for (let i = 0; i < t.material.length; i++) h.int(t.material[i]);
  return h.hex;
}
