/**
 * The client's data: what the player has (growth, loadouts, settings, matches played), kept on this device first, and
 * ready to sync with a server later.
 *
 * Layers, each only seeing the one under it:
 * - `DataCache`: the records in memory, read at once by the UI; writes go on to the store behind it, in order;
 * - `DataStore`: where they are kept: IndexedDB (`DexieStore`), or memory (`MemoryStore`: tests, a refusing browser);
 * - `SyncEngine` + a `SyncTransport`: the outbox up, others' changes down, one merge rule (`newer`) on both sides.
 *
 * The game itself (`src/game`, `src/terrain`) never sees any of this: a match takes what it needs (a growth, a seed) as
 * plain values, so the same match runs on a server.
 */
import { DataCache, Settings } from './cache';
import { DexieStore } from './dexie';
import { importLegacy } from './legacy';
import { MemoryStore } from './memory';
import type { DataStore } from './store';

export { DataCache, Settings } from './cache';
export { DexieStore } from './dexie';
export { MemoryStore } from './memory';
export { importLegacy, LEGACY } from './legacy';
export { newer, stamp, COLLECTIONS, type Collections, type CollectionName, type Row } from './records';
export type { DataStore } from './store';
export { MemoryServer, SyncEngine, type SyncReport, type SyncTransport } from './sync';

/** What the UI holds: the cache, and the settings as a view of it. */
export interface ClientData {
  readonly cache: DataCache;
  readonly settings: Settings;
  /** Kept on this device for good (false: in memory only, for this visit). */
  readonly persistent: boolean;
}

const CLIENT = 'client.id';

/** Open the client's data: IndexedDB if this browser allows it (memory if not), its old values brought in once. */
export async function openData(name = 'bugs-in-the-box'): Promise<ClientData> {
  const db = typeof indexedDB === 'undefined' ? null : new DexieStore(name);
  const opened = db !== null && (await db.open());
  const store: DataStore = opened && db ? db : new MemoryStore();
  let origin = await store.getMeta<string>(CLIENT);
  if (!origin) {
    origin = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    await store.setMeta(CLIENT, origin);
  }
  const cache = new DataCache(store, origin);
  await cache.load();
  await importLegacy(cache, typeof localStorage === 'undefined' ? null : localStorage);
  // (ask the browser not to clear it when space runs low, or after days unused, as Safari does)
  if (opened && typeof navigator !== 'undefined') void navigator.storage?.persist?.().catch(() => false);
  return { cache, settings: new Settings(cache), persistent: opened };
}
