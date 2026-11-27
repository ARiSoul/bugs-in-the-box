/**
 * Triggers: "when X happens, do Y". A rule subscribes to an event by its name; the event's payload is typed per name.
 *
 * Handlers run in a fixed order, the same on every client: by `priority` (lower first), then in the order they were
 * added. A handler added or removed while an event runs takes effect from the next event.
 */

export type Handler<P> = (payload: P) => void;

interface Entry<P> {
  readonly handler: Handler<P>;
  readonly priority: number;
  readonly seq: number;
}

export class Triggers<M extends { [K in keyof M]: unknown }> {
  private readonly lists = new Map<keyof M, Entry<never>[]>();
  private seq = 0;

  /** Run `handler` whenever `event` happens; returns what removes it. */
  on<K extends keyof M>(event: K, handler: Handler<M[K]>, priority = 0): () => void {
    const list = (this.lists.get(event) ?? []) as Entry<M[K]>[];
    const entry: Entry<M[K]> = { handler, priority, seq: this.seq++ };
    // (a new list each time: an event already running keeps the one it started with)
    const next = [...list, entry].sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    this.lists.set(event, next as Entry<never>[]);
    return () => {
      const now = (this.lists.get(event) ?? []) as Entry<M[K]>[];
      this.lists.set(event, now.filter((e) => e !== entry) as Entry<never>[]);
    };
  }

  /** `event` happened: every handler of it, in order. */
  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const list = this.lists.get(event) as Entry<M[K]>[] | undefined;
    if (!list) return;
    for (const e of list) e.handler(payload);
  }

  /** How many handlers `event` has. */
  count<K extends keyof M>(event: K): number {
    return this.lists.get(event)?.length ?? 0;
  }

  clear(): void {
    this.lists.clear();
  }
}
