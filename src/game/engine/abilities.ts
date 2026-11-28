import type { Resources } from './resources';

/**
 * Abilities: everything a bug can do (attacks, special attacks, building, hiding, moves), in one format, as data. What
 * using one costs is in resource pools; how often it may be used, how it is aimed and what it does are fields of it. The
 * match reads these instead of rules about each weapon.
 */

/** Something an ability takes from a side's pools. `all`: it takes the whole pool (and needs at least `amount`). */
export interface Cost {
  readonly pool: string;
  readonly amount: number;
  readonly all?: boolean;
}

/** How it is pointed: along the aim; at a place on a surface; at a marked spot; steered while it goes; the bug itself. */
export type Target = 'aim' | 'place' | 'mark' | 'steer' | 'self';

/** What it does, in short (the match's rules do it; these say what, for the HUD, the computer and balance). */
export type Effect =
  | { readonly kind: 'blast'; readonly radius: number; readonly damage: number }
  | { readonly kind: 'arcs'; readonly count: number; readonly range: number; readonly damage: number }
  | { readonly kind: 'dig'; readonly length: number; readonly radius: number }
  | { readonly kind: 'web'; readonly radius: number; readonly turns: number }
  | { readonly kind: 'swarm'; readonly radius: number; readonly damage: number }
  | { readonly kind: 'shelter'; readonly cover: number; readonly health: number }
  | { readonly kind: 'build' }
  | { readonly kind: 'throw' }
  /** A gale in a cone: how far, how hard it throws, what it hurts. */
  | { readonly kind: 'gale'; readonly reach: number; readonly push: number; readonly damage: number };

export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  /** Whose it is (none: every bug's). */
  readonly species?: string;
  /** What it is of, or works by: rules look at these, not at names. */
  readonly tags: readonly string[];
  /** Its owner always has it (a cost may still be needed to use it). */
  readonly innate: boolean;
  /** What a use takes. */
  readonly cost: readonly Cost[];
  /** At most this many uses a turn (none: no such limit). */
  readonly perTurn?: number;
  readonly target: Target;
  /** Held to charge its power before it goes. */
  readonly charged: boolean;
  readonly effects: readonly Effect[];
}

/** How many uses of something costing `cost` `pools` pay for (Infinity: it costs nothing). */
export function usesIn(cost: readonly Cost[], pools: Resources): number {
  let n = Infinity;
  for (const c of cost) {
    if (c.amount <= 0) continue;
    const have = pools.amount(c.pool);
    const k = c.all ? (have >= c.amount ? 1 : 0) : Math.floor(have / c.amount);
    if (k < n) n = k;
  }
  return n;
}

/** Pay `cost` once (false, and nothing paid, if `pools` cannot). */
export function pay(cost: readonly Cost[], pools: Resources): boolean {
  if (usesIn(cost, pools) < 1) return false;
  for (const c of cost) {
    if (c.all) pools.set(c.pool, 0);
    else pools.give(c.pool, -c.amount);
  }
  return true;
}
