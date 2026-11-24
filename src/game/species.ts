/**
 * One configurable bug model. Physics only reads `radius` and the movement numbers;
 * the renderer reads the body proportions. New species are new data, not new code.
 *
 * Units: world units (1 = one terrain cell), seconds.
 */
export interface BugSpecies {
  readonly id: string;
  /** Collision sphere radius. The body is drawn around this sphere. */
  readonly radius: number;
  /** Ground speed when walking forward (backwards is slower, see WALK_BACK_FACTOR). */
  readonly walkSpeed: number;
  /** Turn rate in radians per second. */
  readonly turnRate: number;
  /** Vertical take-off speed of a jump. */
  readonly jumpSpeed: number;
  /** Forward take-off speed of a jump. */
  readonly jumpForward: number;

  /** Health it starts with. */
  readonly health: number;
  /** Spins silk: in the air it can hang on a thread (see Bug.thread), and no web holds it. */
  readonly silk?: boolean;
  /** Its shell takes the first blow that would kill it, once a match (see Match.damage). */
  readonly shell?: boolean;

  // ---- looks (render only) ----
  readonly legs: number;
  /** Leg reach relative to `radius`. */
  readonly legLength: number;
  /** Total body length relative to `radius`. */
  readonly bodyLength: number;
  /** Abdomen size relative to `radius`. */
  readonly abdomen: number;
  /** Head size relative to `radius`. */
  readonly head: number;
  /** Antenna length relative to `radius` (0 = none). */
  readonly antennae: number;
  readonly color: number;
  readonly accent: number;
}

export const ANT: BugSpecies = {
  id: 'ant',
  radius: 1,
  walkSpeed: 5,
  turnRate: 3,
  jumpSpeed: 9,
  jumpForward: 4,
  health: 115,
  legs: 6,
  legLength: 1.25,
  bodyLength: 2.6,
  abdomen: 0.62,
  head: 0.42,
  antennae: 0.9,
  color: 0x8a2f1c,
  accent: 0x2a0f08,
};

export const SPIDER: BugSpecies = {
  id: 'spider',
  radius: 1.1,
  walkSpeed: 5.5,
  turnRate: 3.4,
  jumpSpeed: 10,
  jumpForward: 5,
  health: 110,
  silk: true,
  legs: 8,
  legLength: 1.7,
  bodyLength: 2,
  abdomen: 0.8,
  head: 0.3,
  antennae: 0,
  color: 0x2b2b33,
  accent: 0xc9a227,
};

export const COCKROACH: BugSpecies = {
  id: 'cockroach',
  radius: 1,
  walkSpeed: 6.5,
  turnRate: 2.6,
  jumpSpeed: 7.5,
  jumpForward: 4.5,
  health: 62,
  shell: true,
  legs: 6,
  legLength: 1.12,
  bodyLength: 2.9,
  abdomen: 0.72,
  head: 0.32,
  antennae: 1.6,
  color: 0x5c2c10,
  accent: 0x43230e,
};

/** The head of an ant column: what leads it crawls like any bug, small and fast. Not a species one plays. */
export const MARCHER: BugSpecies = { ...ANT, id: 'marcher', radius: 0.7, walkSpeed: 12, turnRate: 1.7 };

export const SPECIES: readonly BugSpecies[] = [ANT, SPIDER, COCKROACH];
