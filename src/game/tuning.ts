import { Settings, type SettingsSet } from './engine';
import { SPECIES, type BugSpecies } from './species';
import { WEAPONS, type Weapon } from './weapons';

/**
 * The game's settings (see `engine/settings.ts`): the numbers a match is tuned by, defined from the data as shipped.
 * First the weapons that hurt (damage, blast, arcs), then the species (toughness, speed, jump), then the rules. More are
 * brought in one at a time; until then they stay constants in their own files.
 */
export const TUNING = new Settings();

const title = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/** Setting ids, by what they tune. */
export const weaponSetting = (w: Weapon, what: 'damage' | 'blast' | 'arc'): string => `weapon.${w.id}.${what}`;
export const speciesSetting = (s: BugSpecies, what: 'toughness' | 'walk' | 'jump'): string => `species.${s.id}.${what}`;

for (const w of WEAPONS) {
  if (w.damage > 0) TUNING.define({ id: weaponSetting(w, 'damage'), group: w.name, label: 'Damage', unit: 'health', min: 0, max: 200, step: 1, value: w.damage, help: 'What a full hit takes, from a bug of toughness 100.' });
  if (w.blastRadius > 0) TUNING.define({ id: weaponSetting(w, 'blast'), group: w.name, label: 'Blast radius', unit: 'units', min: 0.5, max: 12, step: 0.1, value: w.blastRadius, help: 'How far its blast reaches, and the crater it leaves.' });
  if (w.arcs > 0) TUNING.define({ id: weaponSetting(w, 'arc'), group: w.name, label: 'Arc damage', unit: 'health', min: 0, max: 200, step: 1, value: w.arcDamage, help: 'What each arc takes.' });
}
for (const s of SPECIES) {
  const g = title(s.id);
  TUNING.define({ id: speciesSetting(s, 'toughness'), group: g, label: 'Toughness', unit: '%', min: 20, max: 300, step: 1, value: s.toughness, help: 'How hard it is to hurt: a blow takes 100 / toughness of what it takes of a bug of 100. Every bug has 100 health.' });
  TUNING.define({ id: speciesSetting(s, 'walk'), group: g, label: 'Walk speed', unit: 'units/s', min: 1, max: 15, step: 0.1, value: s.walkSpeed });
  TUNING.define({ id: speciesSetting(s, 'jump'), group: g, label: 'Jump', unit: 'units/s', min: 2, max: 20, step: 0.1, value: s.jumpSpeed, help: 'How fast it leaves the ground, up.' });
}

/** The rules' ids, and their values as shipped (the match reads them through its set). */
export const RULE = {
  fallSafe: TUNING.define({ id: 'rules.fall.safe', group: 'Rules', label: 'Safe landing speed', unit: 'units/s', min: 5, max: 40, step: 0.5, value: 15, help: 'Landing faster than this hurts.' }),
  fallDamage: TUNING.define({ id: 'rules.fall.damage', group: 'Rules', label: 'Fall damage', unit: 'health per unit/s', min: 0, max: 10, step: 0.1, value: 2.5, help: 'What each unit/s over the safe speed takes.' }),
  knockback: TUNING.define({ id: 'rules.knockback', group: 'Rules', label: 'Knockback', unit: 'units/s', min: 0, max: 40, step: 0.5, value: 14, help: 'How hard a full blast throws a bug.' }),
  patch: TUNING.define({ id: 'rules.patch', group: 'Rules', label: 'Patch heals', unit: '× full health', min: 0, max: 1, step: 0.05, value: 0.35, help: 'What a patch from a box heals.' }),
} as const;

/** The weapons as `set` has them: the same objects where it changes nothing of theirs, copies where it does. */
export function tunedWeapons(set: SettingsSet): readonly Weapon[] {
  if (set.shipped) return WEAPONS;
  return WEAPONS.map((w) => {
    const damage = w.damage > 0 ? set.get(weaponSetting(w, 'damage')) : w.damage;
    const blastRadius = w.blastRadius > 0 ? set.get(weaponSetting(w, 'blast')) : w.blastRadius;
    const arcDamage = w.arcs > 0 ? set.get(weaponSetting(w, 'arc')) : w.arcDamage;
    return damage === w.damage && blastRadius === w.blastRadius && arcDamage === w.arcDamage ? w : { ...w, damage, blastRadius, arcDamage };
  });
}
