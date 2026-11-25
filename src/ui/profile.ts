import { KEPT } from '../game/actions';
import type { ItemKind } from '../game/items';
import { CARRY, levelOf, passivesOf, type Growth, type Level } from '../game/progress';

/** A player's growth with one species. */
export interface Grown {
  xp: number;
  /** Passives learnt, and those in use. */
  known: string[];
  active: string[];
  /** What is kept from the last match. */
  items: Partial<Record<ItemKind, number>>;
}

const STORE = 'bugs-in-the-box.profile';

/** What the player has grown so far, kept in this browser (later: on a server, where it cannot be made up). */
export class Profile {
  private data: Record<string, Grown> = {};

  constructor() {
    try {
      const d: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      if (d && typeof d === 'object') this.data = d as Record<string, Grown>;
    } catch {
      // (no storage, or a broken entry: a new player)
    }
  }

  /** Whatever was stored, put right: nothing that its level does not allow. */
  of(species: string): Grown {
    const d = (this.data[species] ?? {}) as Partial<Grown>;
    const xp = typeof d.xp === 'number' && Number.isFinite(d.xp) ? Math.max(0, Math.round(d.xp)) : 0;
    const l = levelOf(xp);
    const ids = passivesOf(species).map((p) => p.id);
    const list = (v: unknown): string[] => (Array.isArray(v) ? ids.filter((id) => v.includes(id)) : []);
    const known = list(d.known).slice(0, l.points);
    const active = list(d.active).filter((id) => known.includes(id)).slice(0, l.actives);
    const items: Grown['items'] = {};
    let left = CARRY;
    for (const k of KEPT) {
      const n = Math.min(left, Math.max(0, Math.floor(Number(d.items?.[k] ?? 0)) || 0));
      if (n > 0) items[k] = n;
      left -= n;
    }
    const g = { xp, known, active, items };
    this.data[species] = g;
    return g;
  }

  level(species: string): Level {
    return levelOf(this.of(species).xp);
  }

  growth(species: string): Growth {
    const g = this.of(species);
    return { level: this.level(species).level, passives: [...g.active], items: { ...g.items } };
  }

  /** Learn a passive with a point, or put one that is known in use, or take it out. False: it cannot be. */
  touch(species: string, id: string): boolean {
    // (its level first: that puts what is stored right, and anew)
    const l = this.level(species);
    const g = this.of(species);
    if (!passivesOf(species).some((p) => p.id === id)) return false;
    if (!g.known.includes(id)) {
      if (g.known.length >= l.points) return false;
      g.known.push(id);
      if (g.active.length < l.actives) g.active.push(id);
    } else if (g.active.includes(id)) g.active = g.active.filter((q) => q !== id);
    else if (g.active.length < l.actives) g.active.push(id);
    else return false;
    this.save();
    return true;
  }

  /** A match is over: what it was worth, and the items left (the first CARRY of them are kept). */
  gain(species: string, xp: number, items: Partial<Record<ItemKind, number>> | null): { before: Level; after: Level } {
    const before = this.level(species);
    const g = this.of(species);
    g.xp += xp;
    if (items) g.items = { ...items };
    this.of(species);
    this.save();
    return { before, after: this.level(species) };
  }

  private save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.data));
    } catch {
      // (storage unavailable: it lasts for this visit)
    }
  }
}
