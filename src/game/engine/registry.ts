/**
 * A registry of definitions by id (effects now; abilities, items and settings later). Definitions are data: frozen once
 * registered, listed in the order they were registered, so every client walks them the same way.
 */
export class Registry<T extends { readonly id: string }> {
  private readonly byId = new Map<string, Readonly<T>>();

  constructor(readonly kind: string) {}

  register(def: T): Readonly<T> {
    if (this.byId.has(def.id)) throw new Error(`${this.kind} '${def.id}' is registered twice`);
    const frozen = Object.freeze({ ...def });
    this.byId.set(def.id, frozen);
    return frozen;
  }

  get(id: string): Readonly<T> {
    const d = this.byId.get(id);
    if (!d) throw new Error(`no ${this.kind} '${id}'`);
    return d;
  }

  find(id: string): Readonly<T> | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): readonly Readonly<T>[] {
    return [...this.byId.values()];
  }
}
