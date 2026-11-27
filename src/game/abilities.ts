import { actionOf } from './actions';
import { Registry, type AbilityDef, type Cost, type Effect, type Target } from './engine';
import { WEAPONS, type Weapon, type WeaponKind } from './weapons';

/**
 * Every weapon, special attack, build, shelter and move as an ability (`engine/abilities.ts`): what it costs in a side's
 * pools, how often, how it is aimed, what it does. Made from the weapons' own numbers, so a weapon changed there changes
 * here. The pools a side has:
 *
 * - `uses:<id>`: the uses of one ability (from a box, or the builds and moves a side starts a match with);
 * - `works`: builds and shelters in all, in a match (an ability `alone` does not count in it);
 * - `charge`: a special attack's loading (full at SKILL_FULL; using one takes all of it);
 * - `again`: a second build in a turn (a passive gives it).
 */

/** A special attack's charge when full. */
export const SKILL_FULL = 1000;

export const usesPool = (id: string): string => `uses:${id}`;
export const WORKS_POOL = 'works';
export const CHARGE_POOL = 'charge';
export const AGAIN_POOL = 'again';

const TARGETS: Readonly<Record<WeaponKind, Target>> = {
  burst: 'aim',
  shell: 'aim',
  grenade: 'aim',
  tunnel: 'aim',
  burrow: 'aim',
  web: 'aim',
  arrow: 'aim',
  column: 'steer',
  lift: 'aim',
  brood: 'mark',
  flock: 'steer',
  trap: 'self',
  wall: 'place',
  bridge: 'place',
  shelter: 'place',
};

function costOf(w: Weapon): Cost[] {
  if (w.start !== undefined) return w.alone ? [{ pool: usesPool(w.id), amount: 1 }] : [{ pool: usesPool(w.id), amount: 1 }, { pool: WORKS_POOL, amount: 1 }];
  if (w.found) return [{ pool: usesPool(w.id), amount: 1 }];
  if (w.sceneTicks > 0) return [{ pool: CHARGE_POOL, amount: SKILL_FULL, all: true }];
  return [];
}

function effectsOf(w: Weapon): Effect[] {
  const out: Effect[] = [];
  if (w.kind === 'wall' || w.kind === 'bridge') out.push({ kind: 'build' });
  if (w.kind === 'shelter') out.push({ kind: 'shelter', cover: w.cover ?? 0, health: w.coverHealth ?? 0 });
  if (w.kind === 'lift') out.push({ kind: 'throw' });
  if (w.blastRadius > 0) out.push({ kind: 'blast', radius: w.blastRadius, damage: w.damage });
  if (w.arcs > 0) out.push({ kind: 'arcs', count: w.arcs, range: w.arcRange, damage: w.arcDamage });
  if (w.tunnelRadius > 0 && (w.kind === 'tunnel' || w.kind === 'burrow')) out.push({ kind: 'dig', length: w.tunnelLength, radius: w.tunnelRadius });
  if (w.webRadius > 0) out.push({ kind: 'web', radius: w.webRadius, turns: w.webTurns });
  if (w.kind === 'column' || w.kind === 'brood' || w.kind === 'flock') out.push({ kind: 'swarm', radius: w.coverRadius, damage: w.damage });
  return out;
}

function abilityOf(w: Weapon, index: number): AbilityDef {
  return {
    id: w.id,
    name: w.name,
    species: w.species,
    tags: actionOf(index).tags,
    innate: !w.found,
    cost: costOf(w),
    perTurn: w.kind === 'burst' || w.kind === 'burrow' ? 1 : undefined,
    target: TARGETS[w.kind],
    charged: w.maxSpeed > 0 || w.kind === 'burrow' || w.kind === 'column',
    effects: effectsOf(w),
  };
}

/**
 * What a use of `a` costs a bug of `species`: its own cost; and one of its uses too where it is not its own (another
 * creature's weapon, found in a box).
 */
export function costFor(a: AbilityDef, species: string): readonly Cost[] {
  const own = a.innate && (a.species === undefined || a.species === species);
  if (own || a.cost.some((c) => c.pool === usesPool(a.id))) return a.cost;
  return [{ pool: usesPool(a.id), amount: 1 }, ...a.cost];
}

export const ABILITIES = new Registry<AbilityDef>('ability');
for (let i = 0; i < WEAPONS.length; i++) ABILITIES.register(abilityOf(WEAPONS[i], i));

/** The ability a weapon is (by its index in WEAPONS: the two lists are in the same order). */
export const abilityAt = (weapon: number): AbilityDef => ABILITIES.all()[weapon];
