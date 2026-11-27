/**
 * Resources: what a side has to spend, in named pools (a weapon's uses, the builds left in a match, a special attack's
 * charge...). Abilities say what they cost in them; items and levels add to them. Whole numbers or not, they are only
 * added to and taken from, so every client keeps the same.
 */
export class Resources {
  private readonly pools = new Map<string, number>();

  /** How much `pool` holds (0: none). */
  amount(pool: string): number {
    return this.pools.get(pool) ?? 0;
  }

  set(pool: string, v: number): void {
    this.pools.set(pool, v);
  }

  /** Add `n` (negative: take). */
  give(pool: string, n: number): void {
    this.pools.set(pool, this.amount(pool) + n);
  }

  /** Take `n` if there is as much; false (and nothing taken) if not. */
  spend(pool: string, n: number): boolean {
    const have = this.amount(pool);
    if (have < n) return false;
    this.pools.set(pool, have - n);
    return true;
  }

  /** Every pool, in the order they were first set (the same on every client). */
  entries(): [string, number][] {
    return [...this.pools.entries()];
  }
}
