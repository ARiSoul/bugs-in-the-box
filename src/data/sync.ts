import { newer, type Row } from './records';
import type { DataStore } from './store';

/**
 * Sync with a server: what this client wrote goes up (the outbox), what others wrote comes down (since a cursor), and
 * where two copies of a record meet, the same rule decides on both sides (`newer`). The server may keep the rows in any
 * database: it only has to speak this protocol.
 */

/** What the server says to a push: what it took, and its own copy of those it kept instead (it had a newer one). */
export interface PushResult {
  readonly accepted: readonly string[];
  readonly rejected: readonly Row[];
}

/** The way to a server (HTTP, a WebSocket... or a fake one in tests). */
export interface SyncTransport {
  push(rows: readonly Row[]): Promise<PushResult>;
  /** Records written since `cursor` (null: from the start), and the cursor to ask from next time. */
  pull(cursor: string | null): Promise<{ rows: readonly Row[]; cursor: string }>;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  /** Records here that lost to a newer copy from elsewhere. */
  replaced: number;
}

const CURSOR = 'sync.cursor';
const BATCH = 200;

export const keyOf = (r: Row): string => `${r.collection}/${r.id}`;

export class SyncEngine {
  constructor(
    private readonly store: DataStore,
    private readonly transport: SyncTransport,
    /** Told of every record that came from elsewhere and was kept (the cache takes it). */
    private readonly onMerged: (row: Row) => void = () => {},
  ) {}

  /** One round: send what waits, then take what came. */
  async sync(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, replaced: 0 };
    for (;;) {
      const box = await this.store.outbox(BATCH);
      if (box.length === 0) break;
      const res = await this.transport.push(box.map((b) => b.row));
      const took = new Set(res.accepted);
      for (const r of res.rejected) {
        if (await this.store.merge(r)) {
          report.replaced++;
          this.onMerged(r);
        }
      }
      const done = new Set([...took, ...res.rejected.map(keyOf)]);
      await this.store.acknowledge(box.filter((b) => done.has(keyOf(b.row))).map((b) => b.seq));
      report.pushed += took.size;
      // (the server took none of them: try again on the next round, not now)
      if (done.size === 0) break;
    }
    const cursor = (await this.store.getMeta<string>(CURSOR)) ?? null;
    const got = await this.transport.pull(cursor);
    for (const r of got.rows) {
      if (await this.store.merge(r)) {
        report.pulled++;
        this.onMerged(r);
      }
    }
    await this.store.setMeta(CURSOR, got.cursor);
    return report;
  }
}

/**
 * A server in memory, speaking the protocol: for tests, and as the reference for a real server (which keeps the same
 * rows and applies the same rule).
 */
export class MemoryServer implements SyncTransport {
  private readonly rows = new Map<string, Row>();
  /** Every record kept, in order (what a pull walks). */
  private readonly log: string[] = [];

  async push(rows: readonly Row[]): Promise<PushResult> {
    const accepted: string[] = [];
    const rejected: Row[] = [];
    for (const r of rows) {
      const key = keyOf(r);
      const here = this.rows.get(key);
      if (here && !newer(r, here)) {
        rejected.push(here);
        continue;
      }
      this.rows.set(key, r);
      this.log.push(key);
      accepted.push(key);
    }
    return { accepted, rejected };
  }

  async pull(cursor: string | null): Promise<{ rows: readonly Row[]; cursor: string }> {
    const from = cursor === null ? 0 : Number(cursor);
    const keys = [...new Set(this.log.slice(from))];
    return { rows: keys.map((k) => this.rows.get(k) as Row), cursor: String(this.log.length) };
  }

  /** The server's copy of a record. */
  peek(key: string): Row | undefined {
    return this.rows.get(key);
  }
}
