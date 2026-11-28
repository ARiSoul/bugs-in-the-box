import type { Growth } from '../game/progress';
import { NO_INPUT, type Match, type MatchInput } from '../game/match';
import { matchDigest } from './digest';

/**
 * A match as a record: what it was set up with, and every input of every tick (only where it changed). That is all a
 * client needs to play the very same match: the map is its seed, the rest is the simulation's, which is deterministic.
 * It is what goes over the network (turn-based multiplayer sends inputs, not state), and what is kept to be looked at
 * again. Its checkpoints (a digest of the match every `EVERY` ticks, and the ground's at both ends) tell at once, and at
 * which tick, if another client's simulation went another way.
 */
export const RECORD_VERSION = 1;
/** Ticks between two checkpoints. */
export const EVERY = 60;
/** In a change of input: this key was there, and is no more (no input field is a string). */
export const GONE = '~';

/** What a match is set up with (all of it plain data). */
export interface MatchSetup {
  readonly scenario: string;
  /** Its map, in chunks. */
  readonly size: readonly [number, number, number];
  readonly seed: number;
  readonly teams: readonly {
    readonly name: string;
    readonly species: string;
    readonly special?: string;
    readonly color: number;
    readonly size: number;
    readonly growth?: Growth;
  }[];
  readonly rules: { readonly turnSeconds?: number; readonly wind?: number; readonly turned?: number; readonly bag?: number; readonly items?: boolean; readonly placeBugs?: boolean };
  /** The settings it is tuned by (their hash: the same numbers). */
  readonly tuning: { readonly version: number; readonly changed: Readonly<Record<string, number>>; readonly hash: string };
  /** The map was made anew for it (not one an earlier match left in pieces: that one cannot be made again from the seed alone). */
  readonly fresh: boolean;
}

/** A change of input at a tick: the fields that changed, `GONE` for one that is no more. */
export type InputChange = readonly [tick: number, change: Readonly<Record<string, unknown>>];

export interface MatchRecord {
  readonly version: number;
  readonly setup: MatchSetup;
  readonly inputs: readonly InputChange[];
  readonly ticks: number;
  readonly checkpoints: readonly string[];
  readonly ground: { readonly start: string; readonly end: string };
  /** How it ended: played out, or left (and when it was kept). */
  readonly end: 'over' | 'left';
  readonly winner: number;
  /** Something outside the inputs changed it (a test tool): it cannot be played again the same. */
  readonly touched?: boolean;
}

/** The fields of `b` that differ from `a`'s (a key gone: `GONE`); null: none. */
export function inputChange(a: Readonly<MatchInput>, b: Readonly<MatchInput>): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  const A = a as unknown as Record<string, unknown>;
  const B = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[k];
    const y = B[k];
    if (x === y || (typeof x === 'object' && typeof y === 'object' && JSON.stringify(x) === JSON.stringify(y))) continue;
    (out ??= {})[k] = y === undefined ? GONE : Array.isArray(y) ? [...y] : y;
  }
  return out;
}

/** A copy of `input` that a later change to it does not reach. */
export function copyInput(input: Readonly<MatchInput>): MatchInput {
  const out = { ...input } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v)) out[k] = [...v];
  return out as unknown as MatchInput;
}

/** `input` with `change` on it. */
export function withChange(input: Readonly<MatchInput>, change: Readonly<Record<string, unknown>>): MatchInput {
  const next = { ...input } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(change)) {
    if (v === GONE) delete next[k];
    else next[k] = v;
  }
  return next as unknown as MatchInput;
}

/** Records a match while it is played: give it every input the match steps with. */
export class Recorder {
  private readonly inputs: InputChange[] = [];
  private readonly checkpoints: string[] = [];
  private last: Readonly<MatchInput> = NO_INPUT;
  private events = '';
  private ticks = 0;
  /** Something outside the inputs changed the match. */
  touched = false;

  constructor(
    readonly setup: MatchSetup,
    readonly match: Match,
    /** The ground's digest now (the terrain is not the match's to hash). */
    private readonly ground: () => string,
    private readonly groundStart = ground(),
  ) {}

  /** Step the match with `input`, and keep it. */
  step(input: Readonly<MatchInput>): void {
    const c = inputChange(this.last, input);
    if (c) this.inputs.push([this.ticks, c]);
    // (a copy: whoever gives the input may change the same object next tick)
    this.last = copyInput(input);
    this.match.step(input);
    if (this.match.events.length) this.events += JSON.stringify(this.match.events);
    if (++this.ticks % EVERY === 0) {
      this.checkpoints.push(matchDigest(this.match, this.events));
      this.events = '';
    }
  }

  get length(): number {
    return this.ticks;
  }

  /** The record, as it stands now. */
  finish(end: MatchRecord['end']): MatchRecord {
    return {
      version: RECORD_VERSION,
      setup: this.setup,
      inputs: [...this.inputs],
      ticks: this.ticks,
      checkpoints: [...this.checkpoints],
      ground: { start: this.groundStart, end: this.ground() },
      end,
      winner: this.match.winner,
      ...(this.touched ? { touched: true } : {}),
    };
  }
}
