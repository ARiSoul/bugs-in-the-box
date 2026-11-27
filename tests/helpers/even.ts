import type { Match } from '../../src/game/match';

/**
 * Every bug of `m` as hard to hurt as a bug of toughness 100 (defence 1): a rule's numbers (a fuse halves, a patch heals
 * 40%) then read in plain points, whatever the species. How toughness itself divides a blow is tested on its own.
 */
export function even<T extends Match>(m: T): T {
  for (const u of m.units) u.bug.stats.setBase('defence', 1);
  return m;
}
