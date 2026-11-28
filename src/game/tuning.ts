import { Settings, type SettingsSet } from './engine';
import { PASSIVES } from './progress';
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

export const passiveSetting = (id: string): string => `passive.${id}`;
for (const q of PASSIVES) {
  // (one that is only on or off has no number to tune)
  if (q.value <= 0) continue;
  const whole = Number.isInteger(q.value);
  TUNING.define({ id: passiveSetting(q.id), group: `Passives: ${title(q.species)}`, label: q.name, unit: q.attr ? `× ${q.attr}` : whole ? '' : '×', min: 0, max: whole ? Math.max(4, q.value * 4) : Math.round(q.value * 300) / 100, step: whole ? 1 : 0.01, value: q.value, help: q.text });
}

/** The rules' ids, and their values as shipped (the match reads them through its set). */
export const RULE = {
  fallSafe: TUNING.define({ id: 'rules.fall.safe', group: 'Rules', label: 'Safe landing speed', unit: 'units/s', min: 5, max: 40, step: 0.5, value: 15, help: 'Landing faster than this hurts.' }),
  fallDamage: TUNING.define({ id: 'rules.fall.damage', group: 'Rules', label: 'Fall damage', unit: 'health per unit/s', min: 0, max: 10, step: 0.1, value: 2.5, help: 'What each unit/s over the safe speed takes.' }),
  knockback: TUNING.define({ id: 'rules.knockback', group: 'Rules', label: 'Knockback', unit: 'units/s', min: 0, max: 40, step: 0.5, value: 14, help: 'How hard a full blast throws a bug.' }),
  patch: TUNING.define({ id: 'rules.patch', group: 'Rules', label: 'Patch heals', unit: '× full health', min: 0, max: 1, step: 0.05, value: 0.35, help: 'What a patch from a box heals.' }),
  retreat: TUNING.define({ id: 'rules.retreat', group: 'Rules', label: 'Time to get away', unit: 's', min: 0, max: 10, step: 0.5, value: 3, help: 'After the shot, the shooter may still walk this long.' }),
  wind: TUNING.define({ id: 'rules.wind', group: 'Rules', label: 'Strongest wind', unit: 'units/s²', min: 0, max: 15, step: 0.5, value: 5, help: 'How hard the wind may push a shot (times the wind of the setup).' }),

  skillTurn: TUNING.define({ id: 'specials.turn', group: 'Specials', label: 'Load a turn', unit: 'of 1000', min: 0, max: 1000, step: 10, value: 200, help: 'What the special of a team loads when its turn comes.' }),
  skillDone: TUNING.define({ id: 'specials.done', group: 'Specials', label: 'Load by damage done', unit: '× damage', min: 0, max: 10, step: 0.1, value: 2.5, help: 'What hurting an enemy loads (by the blow, before its toughness).' }),
  skillTaken: TUNING.define({ id: 'specials.taken', group: 'Specials', label: 'Load by damage taken', unit: '× damage', min: 0, max: 10, step: 0.1, value: 1.8, help: 'What being hurt loads.' }),

  webSlow: TUNING.define({ id: 'webs.slow', group: 'Webs', label: 'Held: speed', unit: '× speed', min: 0, max: 1, step: 0.01, value: 0.12, help: 'How fast a bug held in a web still walks.' }),
  webTear: TUNING.define({ id: 'webs.tear', group: 'Webs', label: 'Time to tear free', unit: 's', min: 0.5, max: 15, step: 0.5, value: 4, help: 'How long a held bug pulls (walking or jumping) before its web gives.' }),

  march: TUNING.define({ id: 'column.march', group: 'Ant Column', label: 'March', unit: 's', min: 1, max: 15, step: 0.5, value: 6, help: 'How long the column marches at full charge.' }),
  bites: TUNING.define({ id: 'column.bites', group: 'Ant Column', label: 'Bites', unit: '', min: 1, max: 20, step: 1, value: 8, help: 'How many times the swarm bites the bug it met.' }),
  bite: TUNING.define({ id: 'column.bite', group: 'Ant Column', label: 'Bite', unit: 'health', min: 0, max: 40, step: 1, value: 7, help: 'What each bite takes.' }),

  broodThrow: TUNING.define({ id: 'brood.throw', group: 'Blackout Swarm', label: 'Throw', unit: 'units/s', min: 0, max: 20, step: 0.5, value: 5, help: 'How hard the brood throws a bug off as it flees the light.' }),

  burrowShort: TUNING.define({ id: 'burrow.short', group: 'Burrow', label: 'Shortest', unit: 'units', min: 6, max: 40, step: 1, value: 12, help: 'Its length with no charge.' }),
  burrowLong: TUNING.define({ id: 'burrow.long', group: 'Burrow', label: 'Longest', unit: 'units', min: 6, max: 60, step: 1, value: 24, help: 'Its length at full charge.' }),
  burrowSpeed: TUNING.define({ id: 'burrow.speed', group: 'Burrow', label: 'Speed', unit: 'units/s', min: 2, max: 30, step: 0.5, value: 8, help: 'How fast the ant goes through it.' }),

  battery: TUNING.define({ id: 'boxes.battery', group: 'Boxes', label: 'Battery loads', unit: 'of 1000', min: 0, max: 1000, step: 10, value: 400, help: 'What a battery loads of the special of its team.' }),
  patchOver: TUNING.define({ id: 'boxes.patchOver', group: 'Boxes', label: 'Patch: over full', unit: '× full health', min: 0, max: 1, step: 0.05, value: 0.15, help: 'How far over its full health a patch may take a bug.' }),
  crystal: TUNING.define({ id: 'boxes.crystal', group: 'Boxes', label: 'Crystal adds', unit: 's', min: 0, max: 60, step: 1, value: 15, help: 'More time for its turn.' }),
  overclock: TUNING.define({ id: 'boxes.overclock', group: 'Boxes', label: 'Overclocked shot', unit: '× damage', min: 1, max: 4, step: 0.05, value: 1.5, help: 'What the next shot of an overclocked bug hurts.' }),
  spring: TUNING.define({ id: 'boxes.spring', group: 'Boxes', label: 'Springs: jump', unit: '× jump', min: 1, max: 3, step: 0.01, value: 1.42, help: 'How much higher a bug on springs jumps.' }),
  magnet: TUNING.define({ id: 'boxes.magnet', group: 'Boxes', label: 'Magnet reach', unit: 'units', min: 0, max: 120, step: 1, value: 45, help: 'How far a magnet pulls the nearest enemy from.' }),
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
