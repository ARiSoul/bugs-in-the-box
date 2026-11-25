import type { Match, NoPlace, Place } from '../game/match';
import type { Unit } from '../game/match';
import type { Weapon } from '../game/weapons';
import { SPAN, SPANS } from '../game/build';

interface P {
  x: number;
  y: number;
  z: number;
}

/** A notch of the wheel turns a wall by this (radians). */
const NOTCH = Math.PI / 16;
const LONG = SPANS * SPAN;

/** What the player builds or hides in, as it follows the pointer until a click puts it down. */
export class Placing {
  /** What it would come to there: the request, its pieces, why not (''), where the pointer is. Null: the pointer is on nothing. */
  shown: { w: Weapon; place: Place; pieces: readonly number[]; why: NoPlace } | null = null;
  /** The near end of a bridge, once it is set. */
  first: P | null = null;
  private turned = 0;
  private key = '';
  private readonly pieces: number[] = [];

  /** Whether weapon `w` is put down with the pointer. */
  static takes(w: Weapon): boolean {
    return w.kind === 'wall' || w.kind === 'bridge' || w.kind === 'shelter';
  }

  clear(): void {
    this.shown = null;
    this.first = null;
    this.turned = 0;
    this.key = '';
  }

  turn(notches: number): void {
    this.turned += notches * NOTCH;
  }

  /** The pointer is at `p` (null: on nothing). */
  update(match: Match, u: Unit, w: Weapon, p: P | null): void {
    if (!p) {
      this.shown = null;
      this.key = '';
      return;
    }
    const b = u.bug;
    const away = Math.atan2(p.x - b.x, p.z - b.z) + this.turned;
    const at = w.kind === 'bridge' && this.first ? this.first : p;
    const far = w.kind === 'bridge' && this.first;
    let to: [number, number, number] = [Math.sin(away), 0, Math.cos(away)];
    if (far) {
      to = [p.x - at.x, p.y - at.y, p.z - at.z];
      const l = Math.hypot(...to);
      if (l > LONG) to = to.map((v) => (v / l) * LONG) as typeof to;
    } else if (w.kind === 'bridge') to = [to[0] * LONG, 0, to[2] * LONG];
    const place = [at.x, at.y, at.z, ...to].map((v) => Math.round(v * 64) / 64) as unknown as Place;
    const key = `${w.id}|${place.join()}|${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}|${match.built}|${match.turnNumber}|${match.works[u.team]}`;
    if (key === this.key) return;
    this.key = key;
    const why = match.tryPlace(u, w, place, this.pieces);
    this.shown = { w, place, pieces: this.pieces, why };
  }

  /** A click: the place to put it, or null (a bridge's near end is set, or it cannot be put there). */
  click(): Place | null {
    const s = this.shown;
    if (!s) return null;
    if (s.w.kind === 'bridge' && !this.first) {
      // (its far end may still make it fit)
      if (s.why === 'too far' || s.why === 'no ground' || s.why === 'once a turn') return null;
      this.first = { x: s.place[0], y: s.place[1], z: s.place[2] };
      this.key = '';
      return null;
    }
    return s.why === '' ? s.place : null;
  }

  /** The right button: a bridge's near end is taken back; false: there was none. */
  back(): boolean {
    const had = this.first !== null;
    this.first = null;
    this.key = '';
    return had;
  }
}
