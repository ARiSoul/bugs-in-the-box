/**
 * What the client keeps, as records: every one in a collection, by its id, with what sync needs to merge it with other
 * copies (its revision, when and by whom it was last written, whether it is gone).
 *
 * The record format is the contract with any server: a server keeps the same rows in whatever database it likes, and
 * the merge rule (`newer`) is the same on both sides.
 */

/** The collections, and what a record of each holds. */
export interface Collections {
  /** A player's growth with one species (id: the species). */
  growth: { xp: number; known: string[]; active: string[]; items: Partial<Record<string, number>> };
  /** The quick slots a player set for one species (id: the species). */
  loadout: { slots: string[] };
  /** A setting (id: its name: 'sound', 'keys', 'camera'...). */
  settings: { value: unknown };
  /** A match played (id: unique), for history and later for the server to check. */
  matches: { at: number; scenario: string; seed: number; species: string[]; won: boolean; xp: number };
  /** A match as a record (its setup and every input; see `sim/record.ts`), to look at again and to check (id: unique). */
  replays: { version: number; ticks: number; [k: string]: unknown };
}

export type CollectionName = keyof Collections;
export const COLLECTIONS: readonly CollectionName[] = ['growth', 'loadout', 'settings', 'matches', 'replays'];

/** A record as it is kept and synced. */
export interface Row<C extends CollectionName = CollectionName> {
  readonly collection: C;
  readonly id: string;
  readonly value: Collections[C];
  /** How many times it was written (1: new). */
  readonly rev: number;
  /** When it was last written (ms since 1970, by the writer's clock). */
  readonly updatedAt: number;
  /** Who wrote it last (a client's id, or the server's). */
  readonly origin: string;
  /** Gone (kept, so the deletion syncs too). */
  readonly deleted: boolean;
}

/**
 * Whether `a` wins over `b` when two copies of a record meet: the later write, then the higher revision, then the writer's
 * id (only to break a tie, the same way everywhere).
 */
export function newer(a: Row, b: Row): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  if (a.rev !== b.rev) return a.rev > b.rev;
  return a.origin > b.origin;
}

/** A record written anew over `prev` (or new), by `origin` at `now`. */
export function stamp<C extends CollectionName>(collection: C, id: string, value: Collections[C], prev: Row | undefined, origin: string, now: number, deleted = false): Row<C> {
  // (a clock that went back still moves the record forward)
  const at = prev && now <= prev.updatedAt ? prev.updatedAt + 1 : now;
  return { collection, id, value, rev: (prev?.rev ?? 0) + 1, updatedAt: at, origin, deleted };
}

export const rowKey = (collection: CollectionName, id: string): string => `${collection}/${id}`;
