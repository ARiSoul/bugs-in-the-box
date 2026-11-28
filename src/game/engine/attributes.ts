/**
 * A bug's attributes: each a base and the modifiers on it (from effects, items, levels), read as one number.
 *
 * The value is computed in a fixed order, so every client gets the same bits: first every `add` (sorted by `order`, then
 * by `id`), then every `mul` (in the same order): `(base + adds) * muls`. With no modifiers the value is the base itself,
 * bit for bit (x + 0 and x * 1 are exact).
 */

/** What a bug has: its health (its most), its speed on foot, its jump (up, and forward), what it hits for, how hard it is
 * to hurt (a blow is divided by it: 1 as it is), its luck, and the seconds of breath it has to fly in a turn. */
export const ATTRIBUTES = ['health', 'speed', 'jump', 'jumpForward', 'damage', 'defence', 'luck', 'breath'] as const;
export type AttributeId = (typeof ATTRIBUTES)[number];

/** One change to one attribute; `id` names where it comes from (an effect, an item), and is unique on a bug. */
export interface Modifier {
  readonly id: string;
  readonly attr: AttributeId;
  /** Added to the base. */
  readonly add?: number;
  /** Multiplies the sum. */
  readonly mul?: number;
  /** Earlier first (default 0); then by `id`. */
  readonly order?: number;
}

export type AttributeBase = Readonly<Record<AttributeId, number>>;

const byOrder = (a: Modifier, b: Modifier): number => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class Attributes {
  private readonly base: Record<AttributeId, number>;
  private readonly mods = new Map<string, Modifier>();
  /** The values, worked out again only when something changed. */
  private readonly values: Record<AttributeId, number>;
  private dirty = false;

  constructor(base: AttributeBase) {
    this.base = { ...base };
    this.values = { ...base };
  }

  /** The value of `attr` now. */
  get(attr: AttributeId): number {
    if (this.dirty) this.compute();
    return this.values[attr];
  }

  /** The base of `attr`, without modifiers. */
  baseOf(attr: AttributeId): number {
    return this.base[attr];
  }

  setBase(attr: AttributeId, v: number): void {
    this.base[attr] = v;
    this.dirty = true;
  }

  /** Put a modifier on (one by its id: a second with the same id replaces it). */
  add(m: Modifier): void {
    this.mods.set(m.id, m);
    this.dirty = true;
  }

  remove(id: string): boolean {
    const had = this.mods.delete(id);
    if (had) this.dirty = true;
    return had;
  }

  has(id: string): boolean {
    return this.mods.has(id);
  }

  /** The modifiers on, in the order they apply. */
  list(): Modifier[] {
    return [...this.mods.values()].sort(byOrder);
  }

  /** Be as `o` is: its bases and its modifiers. */
  copy(o: Attributes): void {
    Object.assign(this.base, o.base);
    this.mods.clear();
    for (const [k, m] of o.mods) this.mods.set(k, m);
    this.dirty = true;
  }

  private compute(): void {
    const mods = this.list();
    for (const a of Object.keys(this.base) as AttributeId[]) {
      let v = this.base[a];
      for (const m of mods) if (m.attr === a && m.add !== undefined) v += m.add;
      for (const m of mods) if (m.attr === a && m.mul !== undefined) v *= m.mul;
      this.values[a] = v;
    }
    this.dirty = false;
  }
}
