/**
 * The linked engine (RPG style): what affects what in a match goes through these pieces, as data.
 *
 * - `Attributes`: a bug's numbers, a base and modifiers, read in a fixed order;
 * - `Effects`: states with stacks and a time, whose modifiers sit on the attributes;
 * - `Triggers`: "when X, do Y", in a fixed order;
 * - `Registry`: definitions by id;
 * - `AbilityDef` + `Resources`: what a bug can do, in one format, and what it costs in a side's pools;
 * - `Reactions`: what comes of two tags that meet (an attack's, and a build's or a bug's effects').
 *
 * Like the rest of `src/game/`, it is pure: no DOM, no three.js, no `Math.random`, no `Math.pow/sin/cos`; every client
 * computes the same from the same inputs.
 */
export * from './abilities';
export * from './attributes';
export * from './effects';
export * from './reactions';
export * from './registry';
export * from './resources';
export * from './triggers';
export * from './match';
