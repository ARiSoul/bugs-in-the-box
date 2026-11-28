/**
 * The simulation as a whole match: its record (setup and inputs), playing it again without a screen, and the digests
 * that tell two clients' matches apart. Pure like `game/` and `terrain/` (no DOM, no three.js), so it runs the same in
 * a browser, in Node, and on a server.
 */
export * from './digest';
export * from './record';
export * from './replay';
