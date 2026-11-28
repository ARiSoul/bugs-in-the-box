import { NO_INPUT, type Match, type MatchInput } from '../game/match';
import { matchDigest } from '../sim/digest';
import { EVERY, inputChange, withChange, type InputChange } from '../sim/record';
import type { Inputs } from './protocol';

/** Ticks of a player's own that go in one batch, at most (a tenth of a second). */
export const BATCH_TICKS = 6;

/**
 * A match played by two over the network, in lockstep: one stream of inputs, tick by tick, each tick's input given by
 * the player whose turn it is (`source`: the team of the active bug before the tick; every client knows it, as every
 * client simulates the same). A client steps its own ticks with its own input and sends them in batches; it steps the
 * other's ticks only once they came. The server steps every tick as it comes, checking that it came from its source.
 */
export class Lockstep {
  /** Ticks stepped. */
  tick = 0;
  /** The stream's input now. */
  private input: MatchInput = { ...NO_INPUT };
  /** The other's inputs are known up to this tick (not included). */
  private known = 0;
  /** The other's changes that came, by tick, not yet stepped. */
  private readonly came = new Map<number, Readonly<Record<string, unknown>>>();
  /** My changes not yet sent, and the first of my ticks not yet sent (-1: none). */
  private mine: InputChange[] = [];
  private mineFrom = -1;
  /** Every change of the stream, in order (for one that comes back, and for the record). */
  readonly history: InputChange[] = [];
  /** Checkpoints of the match as stepped here (one every `EVERY` ticks). */
  readonly digests: string[] = [];
  private events = '';

  constructor(
    readonly match: Match,
    /** The team this client plays (-1: none, the server). */
    readonly seat: number,
  ) {}

  /** Whose input the next tick takes (a team). */
  get source(): number {
    return this.match.activeUnit.team;
  }

  /** The next tick is this client's own. */
  get own(): boolean {
    return this.source === this.seat;
  }

  /** The next tick can be stepped now (its input came, or it is mine). */
  get ready(): boolean {
    return this.tick < this.known || this.own;
  }

  /** Ticks the other's inputs are known up to. */
  get knownUpTo(): number {
    return this.known;
  }

  /** Step one tick (with `local` if it is mine); false: its input has not come yet. */
  step(local: Readonly<MatchInput> = NO_INPUT): boolean {
    let c: Readonly<Record<string, unknown>> | null;
    if (this.tick < this.known) {
      // (what came: the other's, or, for a client that came back, its own of before)
      c = this.came.get(this.tick) ?? null;
      this.came.delete(this.tick);
    } else if (this.own) {
      c = inputChange(this.input, local);
      if (this.mineFrom < 0) this.mineFrom = this.tick;
      if (c) this.mine.push([this.tick, c]);
    } else return false;
    if (c) {
      this.input = withChange(this.input, c);
      this.history.push([this.tick, c]);
    }
    this.match.step(this.input);
    if (this.match.events.length) this.events += JSON.stringify(this.match.events);
    if (++this.tick % EVERY === 0) {
      this.digests.push(matchDigest(this.match, this.events));
      this.events = '';
    }
    return true;
  }

  /**
   * The other's batch (or, for a client that comes back, every input so far): what it gives is kept until stepped.
   * False: it does not follow on from what came before.
   */
  take(b: Inputs): boolean {
    // (it follows on from the other's last batch, or from my own last tick: my turn came between)
    if (!(b.from === this.known || (b.from === this.tick && this.tick >= this.known)) || b.upTo < b.from) return false;
    for (const [t, c] of b.changes) this.came.set(t, c);
    this.known = b.upTo;
    return true;
  }

  /**
   * My ticks not yet sent, as a batch, when it is time: `BATCH_TICKS` of them, or my turn is over (the other's next tick
   * waits for it), or `now`. Null: nothing to send yet.
   */
  batch(now = false): Inputs | null {
    if (this.mineFrom < 0) return null;
    if (!now && this.own && this.tick - this.mineFrom < BATCH_TICKS) return null;
    const b: Inputs = { t: 'inputs', from: this.mineFrom, upTo: this.tick, changes: this.mine };
    this.mine = [];
    this.mineFrom = -1;
    return b.upTo > b.from ? b : null;
  }

  /**
   * The server's way: step every tick of a batch from `seat`, each only if it is that seat's (the batch's ticks must
   * follow on from the last). What of it was taken, as a batch to pass on, and why the rest was not.
   */
  feed(seat: number, b: Inputs): { taken: Inputs | null; why: string | null } {
    if (b.from !== this.tick) return { taken: null, why: `ticks from ${b.from}, but the match is at ${this.tick}` };
    if (!this.take(b)) return { taken: null, why: 'out of order' };
    let why: string | null = null;
    while (this.tick < this.known) {
      if (this.source !== seat) {
        why = `tick ${this.tick} is not this seat's`;
        // (what was not its own is dropped)
        for (const t of [...this.came.keys()]) if (t >= this.tick) this.came.delete(t);
        this.known = this.tick;
        break;
      }
      this.step();
    }
    const upTo = this.tick;
    return { taken: upTo > b.from ? { t: 'inputs', from: b.from, upTo, changes: b.changes.filter(([t]) => t < upTo) } : null, why };
  }
}
