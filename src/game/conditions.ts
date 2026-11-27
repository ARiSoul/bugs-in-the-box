import { Registry, type EffectDef } from './engine';

/**
 * The states a bug can be in during a match, as effect definitions (data). What they do is still in the match's rules;
 * here is what they are, with tags rules can look at. None runs out by itself (ticks 0): the rules take them off.
 *
 * What each carries (`EffectState.value` / `ref`) is noted with it.
 */
export const CONDITIONS = new Registry<EffectDef>('condition');

/** From a box: a fuse that halves the next blow (a shock it takes whole). */
export const FUSE = CONDITIONS.register({ id: 'fuse', tags: ['item', 'electric'], maxStacks: 1, ticks: 0 });
/** From a box: its next shot hurts more. */
export const OVERCLOCK = CONDITIONS.register({ id: 'overclock', tags: ['item', 'electric'], maxStacks: 1, ticks: 0 });
/** From a box: it jumps higher; `value`: its turns left on the springs. */
export const SPRINGS = CONDITIONS.register({ id: 'springs', tags: ['item'], maxStacks: 1, ticks: 0 });
/** From a box: its next turn has more time; `value`: the seconds more. */
export const EXTRA_TIME = CONDITIONS.register({ id: 'extra-time', tags: ['item'], maxStacks: 1, ticks: 0 });
/** Held in a web; `value`: the web's id. */
export const HELD = CONDITIONS.register({ id: 'held', tags: ['silk'], maxStacks: 1, ticks: 0 });
/** Its shell is whole: it takes the next blow that would kill it. */
export const SHELL = CONDITIONS.register({ id: 'shell', tags: ['chitin'], maxStacks: 1, ticks: 0 });
/** Its shell broke in a turn: nothing more hurts it in that turn; `value`: the turn's number. */
export const CRACKED = CONDITIONS.register({ id: 'cracked', tags: ['broken'], maxStacks: 1, ticks: 0 });
/** It hides in a shelter (until its next turn); `ref`: the shelter's weapon id; `value`: how much it still keeps off. */
export const SHELTERED = CONDITIONS.register({ id: 'sheltered', tags: ['cover'], maxStacks: 1, ticks: 0 });
