import { BAG_SPACES, QUICK_SLOTS, type Tag } from './actions';
import type { ItemKind } from './items';

/**
 * How a creature grows, as data: what a match is worth, what each level brings, the passives. A player has one growth per
 * species. A level gives choices rather than strength: slots, spaces, and passives of which only a few are in use at once.
 */

/** What a match is worth, before `VERSUS`; no more than MOST in all. */
export const XP = { played: 30, won: 40, perDamage: 0.25, perKill: 10, perBlocked: 0.25, perBox: 3, most: 150 } as const;
/** Against the computer it counts less; against a player, in full. */
export const VERSUS: Readonly<Record<string, number>> = { easy: 0.5, normal: 0.8, hard: 1, human: 1 };
export const LEVELS = 10;
/** Items kept from one match to the next, at most. */
export const CARRY = 3;

/** From level `l` to the next. */
export const xpFor = (l: number): number => 100 + (l - 1) * 50;

/** Levels that bring a passive in use, a quick slot, a space for items, a point to learn a passive with. */
const ACTIVE_AT = [2, 5, 8];
const SLOT_AT = [3, 6];
const SPACE_AT = [4, 7, 9];
const POINT_AT = [2, 3, 4, 6, 7, 9];
const upTo = (at: readonly number[], l: number): number => at.reduce((n, q) => (q <= l ? n + 1 : n), 0);

export interface Level {
  readonly level: number;
  /** Into this level, and from it to the next (0: the last). */
  readonly into: number;
  readonly next: number;
  readonly slots: number;
  readonly spaces: number;
  readonly actives: number;
  readonly points: number;
}

export function levelAt(level: number, into = 0): Level {
  return { level, into, next: level >= LEVELS ? 0 : xpFor(level), slots: QUICK_SLOTS + upTo(SLOT_AT, level), spaces: BAG_SPACES + upTo(SPACE_AT, level), actives: upTo(ACTIVE_AT, level), points: upTo(POINT_AT, level) };
}

/** Where a creature with this much experience is. */
export function levelOf(xp: number): Level {
  let l = 1;
  let left = xp > 0 ? xp : 0;
  while (l < LEVELS && left >= xpFor(l)) left -= xpFor(l++);
  return levelAt(l, l >= LEVELS ? 0 : left);
}

/** What level `l` brings, in words. */
export function brings(l: number): string[] {
  const out: string[] = [];
  if (l === 1) out.push(`${QUICK_SLOTS} slots, ${BAG_SPACES} spaces`);
  const nth = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  if (ACTIVE_AT.includes(l)) out.push(`${nth[upTo(ACTIVE_AT, l) - 1]} passive in use`);
  if (SLOT_AT.includes(l)) out.push(`${nth[QUICK_SLOTS + upTo(SLOT_AT, l) - 1]} quick slot`);
  if (SPACE_AT.includes(l)) out.push(`${BAG_SPACES + upTo(SPACE_AT, l)} spaces`);
  if (POINT_AT.includes(l)) out.push('+1 point');
  if (l === LEVELS) out.push('golden name');
  return out;
}

/** What a team did in a match (see `Match.tally`). */
export interface Tally {
  damage: number;
  kills: number;
  blocked: number;
  boxes: number;
}
export interface Gain {
  readonly label: string;
  readonly detail: string;
  readonly xp: number;
}

/** What a match was worth to a side: line by line, and in all. */
export function worth(t: Readonly<Tally>, won: boolean, versus: string): { lines: Gain[]; xp: number } {
  const lines: Gain[] = [{ label: 'Played to the end', detail: '', xp: XP.played }];
  if (won) lines.push({ label: 'Won', detail: '', xp: XP.won });
  const add = (label: string, detail: string, xp: number): void => {
    if (xp > 0) lines.push({ label, detail, xp: Math.round(xp) });
  };
  add('Damage done', String(t.damage), t.damage * XP.perDamage);
  add('Finished off', t.kills === 1 ? '1 bug' : `${t.kills} bugs`, t.kills * XP.perKill);
  add('Kept off by defence', String(t.blocked), t.blocked * XP.perBlocked);
  add('Boxes opened', String(t.boxes), t.boxes * XP.perBox);
  const k = VERSUS[versus] ?? 1;
  const sum = lines.reduce((s, l) => s + l.xp, 0);
  return { lines, xp: Math.min(XP.most, Math.round(sum * k)) };
}

export const BRANCHES = ['Attack', 'Defence', 'Body'] as const;
export interface Passive {
  readonly id: string;
  readonly species: string;
  readonly branch: (typeof BRANCHES)[number];
  readonly name: string;
  readonly text: string;
  readonly tags: readonly Tag[];
  /** Its one number, where it has one. */
  readonly value: number;
}

const p = (species: string, branch: Passive['branch'], id: string, name: string, value: number, text: string, ...tags: Tag[]): Passive => ({ id, species, branch, name, value, text, tags });

export const PASSIVES: readonly Passive[] = [
  p('ant', 'Attack', 'hot-tip', 'Hot Tip', 15, 'The Soldering Iron hurts who stands in its tunnel (15).', 'fire', 'dig'),
  p('ant', 'Attack', 'long-march', 'Long March', 1.25, 'The Ant Column marches a quarter longer.', 'swarm'),
  p('ant', 'Defence', 'nursery', 'Nursery', 8, 'In its Anthill it heals 8 at every turn of its team.', 'earth', 'heal'),
  p('ant', 'Defence', 'many-hands', 'Many Hands', 1, 'Once a match, two builds in one turn.', 'alive'),
  p('ant', 'Body', 'carrier', 'Carrier', 1, 'One more space for items.'),
  p('ant', 'Body', 'scent', 'Scent', 0, 'It sees what is in a box before it opens it.'),
  p('spider', 'Attack', 'strong-silk', 'Strong Silk', 3, 'Its webs last three turns more.', 'silk', 'sticky'),
  p('spider', 'Attack', 'barbs', 'Barbs', 10, 'Who tears itself out of its web loses 10.', 'silk'),
  p('spider', 'Defence', 'double-weave', 'Double Weave', 1, 'The Silk Curtain catches a third shot.', 'silk'),
  p('spider', 'Defence', 'trapline', 'Trapline', 0.4, 'Enemies on its Silk Span stick.', 'silk', 'sticky'),
  p('spider', 'Body', 'light-feet', 'Light Feet', 0, 'Falls never hurt it.'),
  p('spider', 'Body', 'patience', 'Patience', 1.2, 'Its skill loads a fifth faster.'),
  p('cockroach', 'Attack', 'leftovers', 'Leftovers', 15, 'Who it finishes off heals it (15).', 'heal'),
  p('cockroach', 'Attack', 'wider-swarm', 'Wider Swarm', 1.5, 'The Blackout Swarm covers a little more.', 'swarm'),
  p('cockroach', 'Defence', 'grounded', 'Grounded', 0, 'In its Husk arcs do nothing to it.', 'chitin', 'electric'),
  p('cockroach', 'Defence', 'thick-skin', 'Thick Skin', 20, 'Its Husk keeps off 20 more before it breaks.', 'chitin'),
  p('cockroach', 'Body', 'scurry', 'Scurry', 1.16, 'It runs a sixth faster.'),
  p('cockroach', 'Body', 'survivor', 'Survivor', 20, 'Its Hard Shell grows back once, below 20.', 'chitin'),
  p('bee', 'Attack', 'long-flight', 'Long Flight', 1.15, "The Queen's Flight lasts longer.", 'swarm'),
  p('bee', 'Attack', 'sting', 'Sting', 10, 'Flying into an enemy hurts it (10), once a turn.', 'alive'),
  p('bee', 'Defence', 'honey-trap', 'Honey Trap', 0.5, 'Enemies that touch its comb are slowed.', 'honey', 'sticky'),
  p('bee', 'Defence', 'warm-nest', 'Warm Nest', 5, 'Its Nest heals friends beside it (5) at every turn of the team.', 'wax', 'heal'),
  p('bee', 'Body', 'big-lungs', 'Big Lungs', 1.33, 'A third more breath to fly.'),
  p('bee', 'Body', 'nectar', 'Nectar', 8, 'Every box it opens heals it (8).', 'honey', 'heal'),
];
export const passive = (id: string): Passive | undefined => PASSIVES.find((q) => q.id === id);
export const passivesOf = (species: string): Passive[] => PASSIVES.filter((q) => q.species === species);

/** What a team brings to a match from outside it: part of its setup, as the seed is, so every client has the same. */
export interface Growth {
  readonly level: number;
  readonly passives: readonly string[];
  readonly items: Readonly<Partial<Record<ItemKind, number>>>;
}
export const NO_GROWTH: Growth = { level: 1, passives: [], items: {} };

/** What the computer makes of a level. */
export function computerGrowth(species: string, level: number): Growth {
  const l = levelAt(level);
  return { level, passives: passivesOf(species).map((q) => q.id).filter((_, i) => i % 2 === 0).slice(0, Math.min(l.actives, l.points)), items: {} };
}
