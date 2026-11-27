import { COLLECTIONS, stamp, type CollectionName, type Collections, type Row } from './records';
import type { DataStore } from './store';

/**
 * The records in memory, read at once (the menus and the HUD read them every frame, and IndexedDB only answers later).
 * A write changes memory now and is kept in the store behind it, in order; `flushed()` waits for that.
 */
export class DataCache {
  private readonly rows = new Map<CollectionName, Map<string, Row>>(COLLECTIONS.map((c) => [c, new Map()]));
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(row: Row) => void>();
  /** The last write that failed to reach the store (kept for the console and for tests). */
  failed: unknown = null;

  constructor(
    readonly store: DataStore,
    /** This client's id: it signs what it writes. */
    readonly origin: string,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Fill memory from the store. */
  async load(): Promise<void> {
    for (const r of await this.store.all()) this.rows.get(r.collection)?.set(r.id, r);
  }

  /** A record's value (undefined: none, or deleted). */
  get<C extends CollectionName>(collection: C, id: string): Collections[C] | undefined {
    const r = this.rows.get(collection)?.get(id);
    return r && !r.deleted ? (r.value as Collections[C]) : undefined;
  }

  row(collection: CollectionName, id: string): Row | undefined {
    return this.rows.get(collection)?.get(id);
  }

  /** The ids in a collection that are not deleted. */
  ids(collection: CollectionName): string[] {
    return [...(this.rows.get(collection) ?? new Map<string, Row>()).values()].filter((r) => !r.deleted).map((r) => r.id);
  }

  /** Write a record (it is copied: a later change to `value` does not reach it). */
  put<C extends CollectionName>(collection: C, id: string, value: Collections[C]): void {
    this.write(stamp(collection, id, structuredClone(value), this.row(collection, id), this.origin, this.clock()));
  }

  /** Delete a record (it stays as deleted, so the deletion syncs). */
  remove(collection: CollectionName, id: string): void {
    const prev = this.row(collection, id);
    if (!prev || prev.deleted) return;
    this.write(stamp(collection, id, prev.value, prev, this.origin, this.clock(), true));
  }

  /** A record from elsewhere was kept by the store (sync): memory follows. */
  merged(row: Row): void {
    this.rows.get(row.collection)?.set(row.id, row);
    for (const l of this.listeners) l(row);
  }

  /** Be told of every change (written here or merged from elsewhere). */
  onChange(listener: (row: Row) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every write so far is in the store. */
  flushed(): Promise<void> {
    return this.queue;
  }

  private write(row: Row): void {
    this.rows.get(row.collection)?.set(row.id, row);
    this.queue = this.queue.then(
      () => this.store.write(row),
    ).catch((e: unknown) => {
      this.failed = e;
      console.warn('a record could not be kept', e);
    });
    for (const l of this.listeners) l(row);
  }
}

/** A small typed view of the `settings` collection: one value per name. */
export class Settings {
  constructor(private readonly cache: DataCache) {}

  get<T>(name: string): T | undefined {
    return this.cache.get('settings', name)?.value as T | undefined;
  }

  set(name: string, value: unknown): void {
    this.cache.put('settings', name, { value });
  }
}
