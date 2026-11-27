import type { CollectionName, Row } from './records';

/**
 * Where records are kept on this device. Two implementations: IndexedDB (`DexieStore`, the real one) and memory
 * (`MemoryStore`: tests, and a browser that refuses storage). Everything above (the cache, sync) only sees this.
 */
export interface DataStore {
  /** Every record (deleted ones too), to load the cache. */
  all(): Promise<Row[]>;
  get(collection: CollectionName, id: string): Promise<Row | undefined>;
  /** Keep a record written here; it goes in the outbox, to be sent. */
  write(row: Row): Promise<void>;
  /** Keep a record that came from elsewhere, if it wins over the one here (`newer`); not sent back. True: it was kept. */
  merge(row: Row): Promise<boolean>;
  /** What is waiting to be sent, oldest first: the outbox entry's number and the record as it is now. */
  outbox(limit: number): Promise<{ seq: number; row: Row }[]>;
  /** Those entries were taken by the other side. */
  acknowledge(seqs: readonly number[]): Promise<void>;
  /** Small values of the store itself (this client's id, the sync cursor...). */
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  close(): void;
}
