import { ACTIONS, type Tag } from './actions';
import { Reactions, type ReactionDef } from './engine';

/**
 * What comes of two tags that meet, as data: what does it, what it does it to, how much. The match asks these in the order
 * they stand here, so every client does the same. A wall, a bridge, a web, a swarm is what its tags say, not its name.
 */
export type ReactionId = 'burn' | 'melt' | 'brittle' | 'insulate' | 'conduct' | 'blow' | 'tire' | 'regrow';
export interface Reaction extends ReactionDef<ReactionId> {
  readonly by: Tag | null;
  readonly on: readonly Tag[];
}

const LIST: readonly Reaction[] = [
  // a piece burns until the next turn; from there its neighbours, so many times over
  { id: 'burn', by: 'fire', on: ['silk', 'wood'], value: 1, word: 'burning' },
  // the hole is so much wider
  { id: 'melt', by: 'fire', on: ['wax'], value: 1.5, word: 'melting' },
  { id: 'brittle', by: 'blast', on: ['chitin'], value: 1.2, word: 'shattered' },
  // no arc crosses it
  { id: 'insulate', by: 'electric', on: ['chitin'], value: 0, word: 'insulated' },
  // everyone in it is hit (by this, where what did it has no arcs of its own)
  { id: 'conduct', by: 'electric', on: ['metal'], value: 12, word: 'conducts' },
  // a fuse takes all of it
  { id: 'blow', by: 'electric', on: ['electric'], value: 0, word: 'fuse blown' },
  // a swarm that comes through it keeps this much of its bite
  { id: 'tire', by: 'swarm', on: ['sticky', 'silk', 'honey'], value: 2 / 3, word: 'slowed' },
  // a piece a turn grows back while more than this much of it stands
  { id: 'regrow', by: null, on: ['alive'], value: 0.5, word: 'regrows' },
];

/** What burns hurts who touches it, a turn. */
export const BURN_HURTS = 4;
/** The honey a melted comb leaves: how wide, and how many turns of a team it lasts. */
export const HONEY_WIDE = 3.4;
export const HONEY_TURNS = 3;
/** Earth smothers a fire: only what stands higher than this burns. */
export const SMOTHERED = 2.3;

const TAGS = new Map(ACTIONS.map((a) => [a.id, a.tags]));
export const tagsOf = (id: string): readonly Tag[] => TAGS.get(id) ?? [];

const RULES = new Reactions<ReactionId>(LIST);
/** The reactions, in the order they are asked (an engine `Reactions`: the same rule for builds and for bugs' effects). */
export const REACTIONS = RULES.all() as readonly Reaction[];

/** The reaction of something with tags `on` (a build's, or a bug's effects') to what `id` does, if there is one. */
export function reaction(id: ReactionId, by: readonly string[], on: readonly string[]): Reaction | null {
  return RULES.find(id, by, on) as Reaction | null;
}

/** What a weapon would do to something built, in a word ('': nothing special). */
export function wordFor(weapon: string, built: string): string {
  const by = tagsOf(weapon);
  const on = tagsOf(built);
  for (const id of ['burn', 'melt', 'brittle'] as const) {
    const r = reaction(id, by, on);
    if (r) return { burn: 'burns it', melt: 'melts it', brittle: 'shatters it' }[id];
  }
  return '';
}
