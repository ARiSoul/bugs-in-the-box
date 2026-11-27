import Dexie, { type Table } from 'dexie';
import { newer, type CollectionName, type Row } from './records';
import type { DataStore } from './store';

/** An outbox entry: which record waits to be sent (its state is read when it is sent: the latest wins). */
interface Pending {
  seq?: number;
  collection: CollectionName;
  id: string;
}

interface Meta {
  key: string;
  value: unknown;
}

/**
 * The store in IndexedDB (through Dexie): the client's own database, offline first. One table of records for every
 * collection (the same rows a server keeps), an outbox, and the store's own small values.
 *
 * Schema versions: add a `this.version(n)` below for every change, with its upgrade; never edit an old one.
 */
class BugsDb extends Dexie {
  rows!: Table<Row, [CollectionName, string]>;
  outbox!: Table<Pending, number>;
  meta!: Table<Meta, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      rows: '[collection+id], collection, updatedAt',
      outbox: '++seq, &[collection+id]',
      meta: 'key',
    });
  }
}

export class DexieStore implements DataStore {
  private readonly db: BugsDb;

  constructor(name = 'bugs-in-the-box') {
    this.db = new BugsDb(name);
  }

  /** Open it (false: this browser refuses IndexedDB, e.g. some private windows). */
  async open(): Promise<boolean> {
    try {
      await this.db.open();
      return true;
    } catch {
      return false;
    }
  }

  all(): Promise<Row[]> {
    return this.db.rows.toArray();
  }

  get(collection: CollectionName, id: string): Promise<Row | undefined> {
    return this.db.rows.get([collection, id]);
  }

  async write(row: Row): Promise<void> {
    await this.db.transaction('rw', this.db.rows, this.db.outbox, async () => {
      await this.db.rows.put(row);
      // (one entry per record, moved to the end: the latest state is what is sent)
      await this.db.outbox.where('[collection+id]').equals([row.collection, row.id]).delete();
      await this.db.outbox.add({ collection: row.collection, id: row.id });
    });
  }

  async merge(row: Row): Promise<boolean> {
    return this.db.transaction('rw', this.db.rows, async () => {
      const here = await this.db.rows.get([row.collection, row.id]);
      if (here && !newer(row, here)) return false;
      await this.db.rows.put(row);
      return true;
    });
  }

  async outbox(limit: number): Promise<{ seq: number; row: Row }[]> {
    const pending = await this.db.outbox.orderBy('seq').limit(limit).toArray();
    const out: { seq: number; row: Row }[] = [];
    for (const p of pending) {
      const row = await this.db.rows.get([p.collection, p.id]);
      if (row && p.seq !== undefined) out.push({ seq: p.seq, row });
    }
    return out;
  }

  async acknowledge(seqs: readonly number[]): Promise<void> {
    await this.db.outbox.bulkDelete([...seqs]);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  close(): void {
    this.db.close();
  }
}
