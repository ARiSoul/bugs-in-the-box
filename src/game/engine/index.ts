/**
 * The linked engine (RPG style): what affects what in a match goes through these pieces, as data.
 *
 * - `Attributes`: a bug's numbers, a base and modifiers, read in a fixed order;
 * - `Effects`: states with stacks and a time, whose modifiers sit on the attributes;
 * - `Triggers`: "when X, do Y", in a fixed order;
 * - `Registry`: definitions by id.
 *
 * Like the rest of `src/game/`, it is pure: no DOM, no three.js, no `Math.random`, no `Math.pow/sin/cos`; every client
 * computes the same from the same inputs.
 */
export * from './attributes';
export * from './effects';
export * from './registry';
export * from './triggers';
export * from './match';
