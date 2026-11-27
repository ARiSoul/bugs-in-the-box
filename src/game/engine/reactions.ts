import { Registry } from './registry';

/**
 * Reactions: what comes of two tags that meet, as data. What does it (`by`: a tag of the attack, or none: on its own),
 * what it does it to (`on`: any of these tags on the target: a build, or a bug's effects), how much. They are asked in the
 * order they were registered, so every client finds the same.
 */
export interface ReactionDef<Id extends string = string> {
  readonly id: Id;
  readonly by: string | null;
  readonly on: readonly string[];
  /** Its main number (what it means is the reaction's own). */
  readonly value: number;
  /** In a word, for the HUD. */
  readonly word: string;
}

export class Reactions<Id extends string = string> {
  private readonly defs: Registry<ReactionDef<Id>>;

  constructor(list: readonly ReactionDef<Id>[]) {
    this.defs = new Registry<ReactionDef<Id>>('reaction');
    for (const r of list) this.defs.register(r);
  }

  /** Reaction `id`, if something with tags `by` meets something with tags `on` (null: they do not react so). */
  find(id: Id, by: readonly string[], on: readonly string[]): Readonly<ReactionDef<Id>> | null {
    const r = this.defs.find(id);
    return r && meets(r, by, on) ? r : null;
  }

  /** Every reaction of `by` meeting `on`, in order. */
  between(by: readonly string[], on: readonly string[]): Readonly<ReactionDef<Id>>[] {
    return this.defs.all().filter((r) => meets(r, by, on));
  }

  all(): readonly Readonly<ReactionDef<Id>>[] {
    return this.defs.all();
  }
}

function meets(r: ReactionDef, by: readonly string[], on: readonly string[]): boolean {
  return (r.by === null || by.includes(r.by)) && r.on.some((t) => on.includes(t));
}
