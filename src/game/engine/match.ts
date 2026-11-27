import { HEALTH, type BugSpecies } from '../species';
import type { AttributeBase } from './attributes';

/**
 * What the engine knows of a match: the events rules can hang on, and a bug's attributes as its species gives them.
 */

/** A bug's attributes as its species gives them (what effects, items and levels change). */
export function speciesBase(s: BugSpecies): AttributeBase {
  return { health: HEALTH, speed: s.walkSpeed, jump: s.jumpSpeed, jumpForward: s.jumpForward, damage: 1, defence: s.toughness / 100, luck: 0 };
}

/** The events of a match that rules hang on (`Triggers<MatchTriggers>`), with what each carries. Unit numbers are
 * indexes into `Match.units`. */
export interface MatchTriggers {
  /** A turn begins: whose. */
  turnStart: { readonly turn: number; readonly team: number; readonly unit: number };
  /** A bug was hurt: by how much (after everything that lessened it), and by whose team (-1: the ground, a fall). */
  damage: { readonly unit: number; readonly amount: number; readonly team: number };
  /** A bug died. */
  death: { readonly unit: number };
  /** A bug opened a box: what was in it. */
  boxOpen: { readonly unit: number; readonly kind: string };
  /** An effect came on a bug, or went off it. */
  effectStart: { readonly unit: number; readonly effect: string; readonly stacks: number };
  effectEnd: { readonly unit: number; readonly effect: string };
}
