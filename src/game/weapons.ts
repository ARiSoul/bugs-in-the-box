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
  /** Projectile that hurts only the bug it hits, the more the faster it flies, and opens a web where it ends. */
  | 'arrow'
  /** A column of small ants that charges over the surfaces, steered, and swarms the first enemy it meets. */
  | 'column'
  /** A swarm called in the dark, from everywhere, onto a marked spot: it covers every enemy near it. */
  | 'brood'
  /** A swarm the player flies through the air, through rings that make it stronger, into whatever it meets. */
  | 'flock'
  /** Laid where the bug stands: it holds whoever of the other teams steps on it. */
  | 'trap'
  /** Built of solder, at once, and the turn goes on: a wall before the bug, or a bridge along its aim. */
  | 'wall'
  | 'bridge'
  /** The bug hides until its next turn, in the way of its species (instead of a shot). */
  | 'shelter'
  /** A screen of silk before the bug: it catches the shots of the other teams. */
  | 'screen';

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
  /** Brood: how far from the caller it can be marked, and how far round the mark it covers (it hurts less at the edge). */
  readonly markRange: number;
  readonly coverRadius: number;
  /** Web: its radius, and how many turns it lasts. */
  readonly webRadius: number;
  readonly webTurns: number;
  /** A special attack: its scene (ticks) plays when it is picked; then the bug stands, aims and fires. 0: none. */
  readonly sceneTicks: number;
  /** The only species that has it (none: every bug). */
  readonly species?: string;
  /**
   * A use at a time (see Match.stock): from a box on the map, or, for what is built and where bugs hide, the uses a team
   * has in a match (`start`). Those share a total too (WORKS).
   */
  readonly found?: boolean;
  readonly start?: number;
  /** Shelter: how much of a blow it keeps off (0..1), and how much in all before it breaks. */
  readonly cover?: number;
  readonly coverHealth?: number;
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
  markRange: 0,
  coverRadius: 0,
  webRadius: 0,
  webTurns: 0,
  sceneTicks: 0,
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
  damage: 42,
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
  blastRadius: 6,
  damage: 55,
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
  damage: 15,
  webRadius: 4.5,
  webTurns: 6,
  color: 0xf2f2ee,
};

/**
 * Spiders only, their special attack: it stands up, spins a bow of silk and draws it. The dart flies fast and flat and
 * hardly feels the wind; it hurts only the bug it hits, and bursts into a great web where it ends. No crater.
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
  damage: 88,
  webRadius: 5.5,
  webTurns: 6,
  sceneTicks: 264,
  color: 0xf4f4ee,
};

/**
 * Ants only, their special attack: it calls its nest. A column of small ants charges over the terrain, up walls too,
 * and the player steers it (turn keys); it swarms the first enemy it meets and digs the ground away under it.
 */
export const ANT_COLUMN: Weapon = {
  ...BASE,
  id: 'ant-column',
  name: 'Ant Column',
  kind: 'column',
  species: 'ant',
  blastRadius: 3.6,
  damage: 12,
  sceneTicks: 270,
  color: 0xffb03a,
};

/**
 * Cockroaches only, their special attack: it rubs its wings and the lights fail. In the dark the player marks a spot
 * (only eyes show), cockroaches come to it from everywhere, and the light comes back on whoever they cover. No crater.
 */
export const BLACKOUT_SWARM: Weapon = {
  ...BASE,
  id: 'blackout-swarm',
  name: 'Blackout Swarm',
  kind: 'brood',
  species: 'cockroach',
  damage: 64,
  markRange: 48,
  coverRadius: 6,
  sceneTicks: 264,
  color: 0xffc46b,
};

/**
 * Bees only, their special attack: a ring of light runs round it and becomes a crown. The player flies the swarm for a
 * few seconds; every ring of pollen on the way makes it hurt more (RING_DAMAGE).
 */
export const QUEENS_FLIGHT: Weapon = {
  ...BASE,
  id: 'queens-flight',
  name: "Queen's Flight",
  kind: 'flock',
  species: 'bee',
  blastRadius: 2.4,
  damage: 46,
  sceneTicks: 204,
  color: 0xffc83a,
};
/** What each ring adds. */
export const RING_DAMAGE = 10;

/** From a box: thermal paste, smeared where the bug stands. Whoever of another team steps on it sticks. */
export const THERMAL_PASTE: Weapon = {
  ...BASE,
  id: 'thermal-paste',
  name: 'Thermal Paste',
  kind: 'trap',
  found: true,
  webRadius: 3.2,
  webTurns: 10,
  color: 0xb9c2cf,
};

/** What a box's dud does. */
export const DUD: Weapon = { ...BASE, id: 'dud', name: 'Dud', kind: 'shell', blastRadius: 3, damage: 24, color: 0xff7a2f };

/** How much a team builds and hides in a match, all kinds together (each has its own limit too). */
export const WORKS = 4;

/** Every bug: a wall of solder beads before it. It stops shots until it is blown away. The turn goes on. */
export const SOLDER_WALL: Weapon = { ...BASE, id: 'solder-wall', name: 'Solder Wall', kind: 'wall', found: true, start: 2, color: 0xd5dae2 };

/** Every bug: a bridge (or a ramp) of solder along its aim. The turn goes on. */
export const SOLDER_BRIDGE: Weapon = { ...BASE, id: 'solder-bridge', name: 'Solder Bridge', kind: 'bridge', found: true, start: 2, color: 0xb9c6d6 };

/** Ants: dug into the ground, under a lid of crumbs. */
export const BURROW: Weapon = { ...BASE, id: 'burrow', name: 'Burrow', kind: 'shelter', species: 'ant', found: true, start: 2, cover: 0.65, coverHealth: 45, color: 0xc98a4a };

/** Cockroaches: pressed flat against what they stand on, walls and ceilings too; nothing throws them. */
export const FLATTEN: Weapon = { ...BASE, id: 'flatten', name: 'Flatten', kind: 'shelter', species: 'cockroach', found: true, start: 2, cover: 0.5, coverHealth: 60, color: 0x9a6a3c };

/** Bees: a cell of wax round them. */
export const WAX_CELL: Weapon = { ...BASE, id: 'wax-cell', name: 'Wax Cell', kind: 'shelter', species: 'bee', found: true, start: 2, cover: 0.6, coverHealth: 50, color: 0xffc04a };

/** Spiders: a screen of strong silk before them; their own side shoots through it. */
export const SILK_SCREEN: Weapon = { ...BASE, id: 'silk-screen', name: 'Silk Screen', kind: 'screen', species: 'spider', found: true, start: 2, webRadius: 4, webTurns: 8, color: 0xf2f2ee };

export const WEAPONS: readonly Weapon[] = [SOLDER_BLOB, CAPACITOR, SHORT_CIRCUIT, SOLDERING_IRON, WEB_SHOT, WEB_BOW, ANT_COLUMN, BLACKOUT_SWARM, THERMAL_PASTE, QUEENS_FLIGHT, BURROW, FLATTEN, WAX_CELL, SILK_SCREEN, SOLDER_WALL, SOLDER_BRIDGE];

/** Whether a bug of this species has the weapon. */
export function hasWeapon(species: string, w: Weapon): boolean {
  return !w.found && (w.species === undefined || w.species === species);
}
