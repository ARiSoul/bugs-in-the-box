/**
 * Weapons as data. Every weapon is original (see docs/IDEAS.md); do not copy Worms weapons.
 *
 * Units: world units, seconds (fuse in ticks). Damage is in health points (a bug has 100).
 */
export type WeaponKind =
  /** Projectile that explodes on the first contact with terrain or a bug. */
  | 'shell'
  /** Projectile that bounces and explodes when its fuse runs out. */
  | 'grenade'
  /** No projectile: digs a straight tunnel along the aim, right away. */
  | 'tunnel'
  /** Projectile that spreads a sticky web where it lands (no blast, the terrain stays). */
  | 'web'
  /** Projectile that hurts and throws only the bug it hits, the more the faster it flies; it sticks in terrain. */
  | 'arrow';

export interface Weapon {
  readonly id: string;
  readonly name: string;
  readonly kind: WeaponKind;
  /** Launch speed at full power (projectiles only). */
  readonly maxSpeed: number;
  /** How much of the wind acceleration the projectile feels (0 = none). */
  readonly windFactor: number;
  /** How much of gravity the projectile feels (1 = all). */
  readonly gravityFactor: number;
  /** Ticks until a grenade goes off. */
  readonly fuseTicks: number;
  /** Fraction of the speed kept along the normal after a bounce (grenade). */
  readonly bounce: number;
  /** Terrain removed by the explosion (also the reach of the damage, see BLAST_REACH). */
  readonly blastRadius: number;
  /** Damage at the centre of the blast. */
  readonly damage: number;
  /** Short Circuit: how many extra bugs an arc can jump to, how far, and how much each takes. */
  readonly arcs: number;
  readonly arcRange: number;
  readonly arcDamage: number;
  /** Tunnel: length and radius. */
  readonly tunnelLength: number;
  readonly tunnelRadius: number;
  /** Web: its radius, and how many turns it lasts. */
  readonly webRadius: number;
  readonly webTurns: number;
  /** The only species that has it (none: every bug). */
  readonly species?: string;
  /** Render only. */
  readonly color: number;
}

const BASE = {
  maxSpeed: 0,
  windFactor: 0,
  gravityFactor: 1,
  fuseTicks: 0,
  bounce: 0,
  blastRadius: 0,
  damage: 0,
  arcs: 0,
  arcRange: 0,
  arcDamage: 0,
  tunnelLength: 0,
  tunnelRadius: 0,
  webRadius: 0,
  webTurns: 0,
} as const;

/** A drop of molten solder, flung hard. Explodes on impact; the wind pushes it. */
export const SOLDER_BLOB: Weapon = {
  ...BASE,
  id: 'solder-blob',
  name: 'Solder Blob',
  kind: 'shell',
  maxSpeed: 34,
  windFactor: 1,
  blastRadius: 5,
  damage: 45,
  color: 0xc8ccd4,
};

/** A capacitor about to burst: bounces around and goes off after 3 seconds. Heavy: ignores the wind. */
export const CAPACITOR: Weapon = {
  ...BASE,
  id: 'capacitor',
  name: 'Capacitor',
  kind: 'grenade',
  maxSpeed: 26,
  fuseTicks: 180,
  bounce: 0.45,
  blastRadius: 5.5,
  damage: 50,
  color: 0x2f6fd6,
};

/** Small blast on impact, then an electric arc jumps to the nearest bugs. */
export const SHORT_CIRCUIT: Weapon = {
  ...BASE,
  id: 'short-circuit',
  name: 'Short Circuit',
  kind: 'shell',
  maxSpeed: 30,
  windFactor: 0.6,
  blastRadius: 3,
  damage: 20,
  arcs: 2,
  arcRange: 14,
  arcDamage: 20,
  color: 0x8fe3ff,
};

/** Digs a thin straight tunnel along the aim. No damage: a way through, or a way down. */
export const SOLDERING_IRON: Weapon = {
  ...BASE,
  id: 'soldering-iron',
  name: 'Soldering Iron',
  kind: 'tunnel',
  tunnelLength: 14,
  tunnelRadius: 1.7,
  color: 0xff7a2f,
};

/** Spiders only: a ball of silk that opens into a web where it lands. It holds every bug but a spider. */
export const WEB_SHOT: Weapon = {
  ...BASE,
  id: 'web-shot',
  name: 'Web Shot',
  kind: 'web',
  species: 'spider',
  maxSpeed: 30,
  windFactor: 0.4,
  damage: 5,
  webRadius: 4.5,
  webTurns: 6,
  color: 0xf2f2ee,
};

/**
 * Spiders only: a web strung between two threads, drawn back like a bow. Its dart of hardened silk flies fast and
 * flat and hardly feels the wind, but it has to hit: no blast, no crater.
 */
export const WEB_BOW: Weapon = {
  ...BASE,
  id: 'web-bow',
  name: 'Web Bow',
  kind: 'arrow',
  species: 'spider',
  maxSpeed: 62,
  windFactor: 0.15,
  gravityFactor: 0.5,
  damage: 45,
  color: 0xf4f4ee,
};

export const WEAPONS: readonly Weapon[] = [SOLDER_BLOB, CAPACITOR, SHORT_CIRCUIT, SOLDERING_IRON, WEB_SHOT, WEB_BOW];

/** Whether a bug of this species has the weapon. */
export function hasWeapon(species: string, w: Weapon): boolean {
  return w.species === undefined || w.species === species;
}
