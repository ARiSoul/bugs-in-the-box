import { ITEM_KINDS, type ItemKind } from './items';
import { WEAPONS, type Weapon } from './weapons';

/**
 * Everything a bug can do, as one list of data: what its weapons, special attacks, builds, shelters and kept items have in
 * common. The hand, the quick slots and the inventory are made of it, so an action added here (or a weapon added there)
 * shows up by itself.
 */

/** Every bug's; only its creature's; its scenes, which load; what it builds and where it hides; what it keeps from boxes. */
export const CATEGORIES = ['common', 'special', 'skill', 'defence', 'item'] as const;
export type Category = (typeof CATEGORIES)[number];

/** What it is of, or works by: rules will look at these, not at names. */
export type Tag = 'fire' | 'electric' | 'metal' | 'silk' | 'wax' | 'honey' | 'wood' | 'earth' | 'chitin' | 'alive' | 'sticky' | 'heal' | 'swarm' | 'blast' | 'dig';

export interface Action {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  /** What picks it: a weapon (its index), or an item used at once. */
  readonly weapon: number;
  readonly item: ItemKind | null;
  readonly species?: string;
  readonly text: string;
  readonly tags: readonly Tag[];
}

/** Quick slots, and spaces for items: what a level will change. */
export const QUICK_SLOTS = 4;
export const BAG_SPACES = 5;

/** The boxes whose content is kept (the rest takes effect at once). */
export const KEPT: readonly ItemKind[] = ['patch', 'fuse', 'overclock', 'spring', 'crystal', 'magnet'];

const ABOUT: Readonly<Record<string, readonly [string, ...Tag[]]>> = {
  'solder-blob': ['A drop of molten solder. The wind pushes it.', 'fire', 'metal', 'blast'],
  capacitor: ['Bounces, and goes off after three seconds.', 'electric', 'blast'],
  'short-circuit': ['A small blast; arcs jump to who is near.', 'electric'],
  'soldering-iron': ['Digs a straight tunnel. No damage.', 'fire', 'dig'],
  'web-shot': ['Opens into a web that holds whoever is in it.', 'silk', 'sticky'],
  'web-bow': ['Fast and flat; hurts only the bug it hits.', 'silk'],
  'ant-column': ['A column you steer swarms the first enemy it meets.', 'alive', 'swarm'],
  'blackout-swarm': ['In the dark they come to the spot you mark.', 'alive', 'swarm'],
  'queens-flight': ['You fly the swarm; every ring makes it hurt more.', 'alive', 'swarm'],
  rampart: ['A wall of splinters and soil. Fire burns the splinters; the soil puts it out.', 'wood', 'earth'],
  'living-bridge': ['A bridge of workers: it closes a gap a turn while over half of it stands.', 'alive'],
  anthill: ['Keeps off 65% until it breaks.', 'earth'],
  'silk-curtain': ['Catches the first two enemy shots. Fire burns it; swarms stick to it.', 'silk'],
  'silk-span': ['A bridge of threads. Fire burns it; swarms stick to it.', 'silk'],
  'silk-funnel': ['Keeps off 55% until it breaks.', 'silk'],
  'shield-wall': ['A wall of moulted shields. No fire, no arcs; blasts tear more out of it.', 'chitin'],
  'scale-walk': ['A bridge of plates. No fire; blasts tear more out of it.', 'chitin'],
  husk: ['Keeps off 50% until it breaks; holds most.', 'chitin'],
  'comb-wall': ['A wall of comb. Fire melts it into a puddle that holds the others.', 'wax', 'honey'],
  'comb-span': ['A bridge of comb. Fire melts it into a puddle that holds the others.', 'wax', 'honey'],
  'wax-nest': ['Keeps off 60% until it breaks.', 'wax'],
  'thermal-paste': ['Smeared where you stand: others stick in it. It conducts shocks to all in it.', 'metal', 'sticky'],
  patch: ['Heals 40% of its health.', 'heal'],
  fuse: ['The next blow hurts half; a shock not at all.', 'electric'],
  overclock: ['The next shot hits half as hard again.', 'electric', 'fire'],
  spring: ['Jumps high for its next turns.', 'metal'],
  crystal: ['Fifteen seconds more.', 'electric'],
  magnet: ['Pulls the nearest enemy over.', 'metal'],
};
const ITEM_NAMES: Partial<Record<ItemKind, string>> = { patch: 'Flux Patch', fuse: 'Fuse', overclock: 'Overclock', spring: 'Springs', crystal: 'Spare Crystal', magnet: 'Magnet' };

function categoryOf(w: Weapon): Category {
  if (w.kind === 'trap') return 'item';
  if (w.start !== undefined) return 'defence';
  if (w.sceneTicks > 0) return 'skill';
  return w.species ? 'special' : 'common';
}

export const ACTIONS: readonly Action[] = [
  ...WEAPONS.map((w, weapon): Action => {
    const [text, ...tags] = ABOUT[w.id] ?? [''];
    return { id: w.id, name: w.name, category: categoryOf(w), weapon, item: null, species: w.species, text, tags };
  }),
  ...KEPT.map((item): Action => {
    const [text, ...tags] = ABOUT[item];
    return { id: item, name: ITEM_NAMES[item] ?? item, category: 'item', weapon: -1, item, text, tags };
  }),
];

/** The action a weapon is. */
export const actionOf = (weapon: number): Action => ACTIONS[weapon];
export const itemIndex = (k: ItemKind): number => ITEM_KINDS.indexOf(k);

/** What a creature has in its quick slots to begin with: its skill, its wall, its bridge, its shelter. */
export function firstSlots(species: string): string[] {
  const own = (f: (a: Action) => boolean): string => ACTIONS.find((a) => a.species === species && f(a))?.id ?? '';
  const kind = (k: string) => (a: Action): boolean => a.weapon >= 0 && WEAPONS[a.weapon].kind === k;
  return [own((a) => a.category === 'skill'), own(kind('wall')), own(kind('bridge')), own(kind('shelter'))];
}
