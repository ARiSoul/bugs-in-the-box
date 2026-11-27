import { Registry } from './registry';

/**
 * Settings: the numbers that tune the game (a weapon's damage, a species' toughness, a rule's limit), as data. Each is
 * defined once (id, group, what it is, its unit and range, its value as shipped). A match takes a frozen, numbered set
 * of them (`SettingsSet`), as it takes its seed: every client must simulate with the same, and the set's hash says so.
 * Changed sets come from the settings page (local now; an admin's, behind a server, later).
 */
export interface SettingDef {
  readonly id: string;
  /** Where it is listed (a weapon's name, a species', "Rules"). */
  readonly group: string;
  readonly label: string;
  readonly unit?: string;
  readonly min: number;
  readonly max: number;
  /** The step the page moves it by. */
  readonly step: number;
  /** As shipped. */
  readonly value: number;
  readonly help?: string;
}

/** The defined settings, in the order they were defined. */
export class Settings {
  private readonly defs = new Registry<SettingDef>('setting');
  private shipped: SettingsSet | null = null;

  define(d: SettingDef): string {
    if (!(d.min <= d.value && d.value <= d.max) || !(d.step > 0)) throw new Error(`setting '${d.id}': its value is out of its range, or its step is not above 0`);
    this.defs.register(d);
    this.shipped = null;
    return d.id;
  }

  get(id: string): Readonly<SettingDef> {
    return this.defs.get(id);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  all(): readonly Readonly<SettingDef>[] {
    return this.defs.all();
  }

  /** The set as shipped (version 0, nothing changed). */
  defaults(): SettingsSet {
    return (this.shipped ??= new SettingsSet(this, 0, {}));
  }

  /** A set from changed values (what is unknown is dropped, what is out of range is brought into it). */
  make(changed: Readonly<Record<string, number>>, version = 0): SettingsSet {
    return new SettingsSet(this, version, changed);
  }
}

/** A frozen set of values: what a match plays with. */
export class SettingsSet {
  /** Only the values that differ from the shipped ones, by id (sorted by the definitions' order). */
  readonly changed: Readonly<Record<string, number>>;
  /** Whose numbers are these: the same on every client that has the same values. */
  readonly hash: string;
  private readonly values = new Map<string, number>();

  constructor(
    readonly of: Settings,
    readonly version: number,
    changed: Readonly<Record<string, number>>,
  ) {
    const kept: Record<string, number> = {};
    for (const d of of.all()) {
      const v = changed[d.id];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const c = v < d.min ? d.min : v > d.max ? d.max : v;
      if (c === d.value) continue;
      kept[d.id] = c;
      this.values.set(d.id, c);
    }
    this.changed = Object.freeze(kept);
    this.hash = hashOf(of, this.values);
    Object.freeze(this);
  }

  /** Its value of setting `id`. */
  get(id: string): number {
    return this.values.get(id) ?? this.of.get(id).value;
  }

  /** Whether it changes anything at all. */
  get shipped(): boolean {
    return this.values.size === 0;
  }

  /** This set with `changes` on it (the next version). */
  with(changes: Readonly<Record<string, number>>): SettingsSet {
    return new SettingsSet(this.of, this.version + 1, { ...this.changed, ...changes });
  }

  /** This set with setting `id` back as shipped (the next version). */
  without(id: string): SettingsSet {
    const rest = { ...this.changed };
    delete rest[id];
    return new SettingsSet(this.of, this.version + 1, rest);
  }
}

/** FNV-1a over every setting's id and value (its exact bits), in the definitions' order. */
function hashOf(of: Settings, values: ReadonlyMap<string, number>): string {
  let h = 0x811c9dc5;
  const f = new Float64Array(1);
  const w = new Uint32Array(f.buffer);
  const int = (v: number): void => {
    h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0;
  };
  for (const d of of.all()) {
    for (let i = 0; i < d.id.length; i++) int(d.id.charCodeAt(i));
    f[0] = values.get(d.id) ?? d.value;
    int(w[0]);
    int(w[1]);
  }
  return h.toString(16).padStart(8, '0');
}
