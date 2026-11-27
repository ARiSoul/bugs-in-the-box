import { newer, rowKey, type CollectionName, type Row } from './records';
import type { DataStore } from './store';

/** A store in memory: for tests, and for a browser that refuses storage (a private window): it lasts the visit. */
export class MemoryStore implements DataStore {
  private readonly rows = new Map<string, Row>();
  private readonly box = new Map<number, string>();
  private readonly meta = new Map<string, unknown>();
  private seq = 0;

  async all(): Promise<Row[]> {
    return [...this.rows.values()];
  }

  async get(collection: CollectionName, id: string): Promise<Row | undefined> {
    return this.rows.get(rowKey(collection, id));
  }

  async write(row: Row): Promise<void> {
    const key = rowKey(row.collection, row.id);
    this.rows.set(key, row);
    // (one entry per record: the latest state is what is sent)
    for (const [s, k] of this.box) if (k === key) this.box.delete(s);
    this.box.set(++this.seq, key);
  }

  async merge(row: Row): Promise<boolean> {
    const key = rowKey(row.collection, row.id);
    const here = this.rows.get(key);
    if (here && !newer(row, here)) return false;
    this.rows.set(key, row);
    return true;
  }

  async outbox(limit: number): Promise<{ seq: number; row: Row }[]> {
    const out: { seq: number; row: Row }[] = [];
    for (const [seq, key] of [...this.box].sort((a, b) => a[0] - b[0])) {
      const row = this.rows.get(key);
      if (row) out.push({ seq, row });
      if (out.length >= limit) break;
    }
    return out;
  }

  async acknowledge(seqs: readonly number[]): Promise<void> {
    for (const s of seqs) this.box.delete(s);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.meta.get(key) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, value);
  }

  close(): void {}
}
