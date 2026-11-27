import type { Bug } from './bug';
import { CRACKED, EXTRA_TIME, FUSE, HELD, OVERCLOCK, SHELL, SHELTERED, SPRINGS } from './conditions';
import type { EffectDef, Effects } from './engine';
import { WEAPONS, type Weapon } from './weapons';

/**
 * A bug in a match, with its side and what it is under. Its states (a fuse, springs, a web, its shell, a shelter...) are
 * effects (`conditions.ts`) on `effects`; the fields below read and write them, so the rules read as before.
 */
export class Unit {
  /** Aim pitch as a unit vector in the vertical plane of the facing: (horizontal, vertical). */
  aimH: number;
  aimV: number;
  /** Set once the death has been announced. */
  dead = false;
  /** What a shelter it left still kept off (read after it is gone). */
  private coverWas = 0;

  constructor(
    readonly id: number,
    readonly team: number,
    readonly name: string,
    readonly bug: Bug,
    /** What it is under now (effects, with their stacks and time); their modifiers sit on `bug.stats`. */
    readonly effects: Effects,
    aim: number,
  ) {
    this.aimH = aim;
    this.aimV = aim;
  }

  private flag(def: EffectDef, on: boolean): void {
    if (on) {
      if (!this.effects.has(def.id)) this.effects.apply(def);
    } else this.effects.remove(def.id);
  }

  /** A number an effect carries (`off` when it is not on); `off` puts it off. */
  private amount(def: EffectDef, off: number): number {
    return this.effects.find(def.id)?.value ?? off;
  }

  private setAmount(def: EffectDef, v: number, off: number): void {
    if (v === off) this.effects.remove(def.id);
    else {
      const s = this.effects.find(def.id);
      if (s) s.value = v;
      else this.effects.apply(def, { value: v });
    }
  }

  /** From a box: a fuse that halves the next blow. */
  get fuse(): boolean {
    return this.effects.has(FUSE.id);
  }
  set fuse(v: boolean) {
    this.flag(FUSE, v);
  }

  /** From a box: its next shot hurts more. */
  get boost(): boolean {
    return this.effects.has(OVERCLOCK.id);
  }
  set boost(v: boolean) {
    this.flag(OVERCLOCK, v);
  }

  /** Turns left on springs. */
  get spring(): number {
    return this.amount(SPRINGS, 0);
  }
  set spring(v: number) {
    this.setAmount(SPRINGS, v, 0);
  }

  /** Seconds its next turn has more. */
  get extra(): number {
    return this.amount(EXTRA_TIME, 0);
  }
  set extra(v: number) {
    this.setAmount(EXTRA_TIME, v, 0);
  }

  /** Held by a web (its id; -1: free). */
  get web(): number {
    return this.amount(HELD, -1);
  }
  set web(v: number) {
    this.setAmount(HELD, v, -1);
  }

  /** Its shell is whole: it takes the next blow that would kill it... */
  get shell(): boolean {
    return this.effects.has(SHELL.id);
  }
  set shell(v: boolean) {
    this.flag(SHELL, v);
  }

  /** ...and nothing more hurts it in that turn (its number; -1: never yet). */
  get shellTurn(): number {
    return this.amount(CRACKED, -1);
  }
  set shellTurn(v: number) {
    this.setAmount(CRACKED, v, -1);
  }

  /** It hides (until its next turn): in which shelter... */
  get cover(): Weapon | null {
    const s = this.effects.find(SHELTERED.id);
    return s ? (WEAPONS.find((w) => w.id === s.ref) ?? null) : null;
  }
  set cover(w: Weapon | null) {
    if (!w) {
      this.effects.remove(SHELTERED.id);
      return;
    }
    const s = this.effects.find(SHELTERED.id);
    if (s) s.ref = w.id;
    else this.effects.apply(SHELTERED, { ref: w.id, value: this.coverWas });
  }

  /** ...and how much that still keeps off. */
  get coverLeft(): number {
    return this.amount(SHELTERED, this.coverWas);
  }
  set coverLeft(v: number) {
    this.coverWas = v;
    const s = this.effects.find(SHELTERED.id);
    if (s) s.value = v;
  }
}
