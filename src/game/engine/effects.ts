import type { Attributes, Modifier } from './attributes';

/**
 * Effects: states a bug is in for a while (held, burnt, wet, sheltered, overclocked), as data. An effect has stacks (up
 * to its most) and ticks left (0: until it is taken off); while it is on, its modifiers are on the bug's attributes,
 * scaled by its stacks.
 */

/** An effect, as data. */
export interface EffectDef {
  readonly id: string;
  /** What it is (fire, wet, silk...): rules look at the tags, not at the id. */
  readonly tags: readonly string[];
  /** Most stacks at once (applying more adds stacks up to this). */
  readonly maxStacks: number;
  /** Ticks it lasts from when it is put on (0: until taken off). */
  readonly ticks: number;
  /** Its changes to the attributes, for one stack (an `add` is times the stacks; a `mul` to the power of them). */
  readonly modifiers?: readonly Omit<Modifier, 'id'>[];
}

/** An effect on a bug now. */
export interface EffectState {
  readonly def: EffectDef;
  stacks: number;
  /** Ticks left (0: until taken off). */
  left: number;
}

/** What `Effects` tells as things change (for triggers). */
export interface EffectListener {
  started?(def: EffectDef, stacks: number): void;
  ended?(def: EffectDef): void;
}

export class Effects {
  /** On now, in the order they were put on (the same on every client). */
  private readonly on = new Map<string, EffectState>();

  constructor(
    private readonly attrs: Attributes,
    private readonly listener: EffectListener = {},
  ) {}

  /** Put `def` on (more stacks of it if it is on already, its time from now). */
  apply(def: EffectDef, stacks = 1, ticks = def.ticks): EffectState {
    let s = this.on.get(def.id);
    if (s) {
      s.stacks = Math.min(def.maxStacks, s.stacks + stacks);
      s.left = ticks;
    } else {
      s = { def, stacks: Math.min(def.maxStacks, stacks), left: ticks };
      this.on.set(def.id, s);
      this.listener.started?.(def, s.stacks);
    }
    this.place(s);
    return s;
  }

  /** Take `id` off; false if it was not on. */
  remove(id: string): boolean {
    const s = this.on.get(id);
    if (!s) return false;
    this.on.delete(id);
    this.unplace(s);
    this.listener.ended?.(s.def);
    return true;
  }

  has(id: string): boolean {
    return this.on.has(id);
  }

  stacks(id: string): number {
    return this.on.get(id)?.stacks ?? 0;
  }

  /** Every effect on with this tag. */
  tagged(tag: string): EffectState[] {
    return [...this.on.values()].filter((s) => s.def.tags.includes(tag));
  }

  list(): readonly EffectState[] {
    return [...this.on.values()];
  }

  /** One tick: what has a time counts down, and what runs out comes off. */
  tick(): void {
    if (this.on.size === 0) return;
    for (const s of [...this.on.values()]) {
      if (s.left <= 0) continue;
      if (--s.left === 0) this.remove(s.def.id);
    }
  }

  /** Everything off. */
  clear(): void {
    for (const id of [...this.on.keys()]) this.remove(id);
  }

  private modId(s: EffectState, i: number): string {
    return `effect:${s.def.id}:${i}`;
  }

  private place(s: EffectState): void {
    const mods = s.def.modifiers ?? [];
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      this.attrs.add({
        ...m,
        id: this.modId(s, i),
        add: m.add === undefined ? undefined : m.add * s.stacks,
        mul: m.mul === undefined ? undefined : pow(m.mul, s.stacks),
      });
    }
  }

  private unplace(s: EffectState): void {
    const mods = s.def.modifiers ?? [];
    for (let i = 0; i < mods.length; i++) this.attrs.remove(this.modId(s, i));
  }
}

/** `x` to a whole power, by products only (Math.pow is not the same on every device). */
function pow(x: number, n: number): number {
  let v = 1;
  for (let i = 0; i < n; i++) v *= x;
  return v;
}
