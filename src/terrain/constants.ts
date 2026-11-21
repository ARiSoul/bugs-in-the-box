/** Cells per chunk edge. Meshing, dirty-tracking and (later) worker jobs all work in chunks of this size. */
export const CHUNK = 32;

/** Density values are clamped to ±DENSITY_CLAMP so gradients stay well-behaved after many carves. */
export const DENSITY_CLAMP = 6;
