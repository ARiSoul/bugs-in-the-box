import { describe, expect, it } from 'vitest';
import { DataCache, MemoryStore } from '../src/data';
import { NO_INPUT, type MatchInput } from '../src/game/match';
import { computerGrowth } from '../src/game/progress';
import { TUNING, weaponSetting } from '../src/game/tuning';
import { SOLDER_BLOB } from '../src/game/weapons';
import { GONE, inputChange, playRecorded, Recorder, replay, setUp, withChange, groundDigest, type MatchRecord, type MatchSetup } from '../src/sim';

const shipped = TUNING.defaults();
const SETUP: MatchSetup = {
  scenario: 'pc-case',
  size: [3, 2, 3],
  seed: 21,
  teams: [
    { name: 'a', species: 'ant', color: 0, size: 2, growth: computerGrowth('ant', 4) },
    { name: 'b', species: 'spider', color: 0, size: 2, growth: computerGrowth('spider', 2) },
  ],
  rules: { turnSeconds: 20, wind: 1 },
  tuning: { version: 0, changed: {}, hash: shipped.hash },
  fresh: true,
};
const TICKS = 1500;
/** Once, for every test that needs a whole match. */
const played = playRecorded(SETUP, TICKS);

describe('inputs as changes', () => {
  it('only what changed is kept; a key gone is said so; applied, it gives the input back', () => {
    const a: MatchInput = { ...NO_INPUT, move: 1, mark: [1, 2, 3] };
    const b: MatchInput = { ...NO_INPUT, move: 1, fire: true };
    const c = inputChange(a, b);
    expect(c).toEqual({ fire: true, mark: GONE });
    expect(withChange(a, c ?? {})).toEqual(b);
    expect(inputChange(b, { ...b })).toBe(null);
    // (arrays by what is in them, not by which array they are)
    expect(inputChange({ ...NO_INPUT, place: [1, 2, 3, 0, 0, 1] }, { ...NO_INPUT, place: [1, 2, 3, 0, 0, 1] })).toBe(null);
  });

  it('an input object that its giver changes in place, tick after tick, is recorded as it was at each tick', () => {
    const { terrain, match } = setUp(SETUP);
    const rec = new Recorder(SETUP, match, () => groundDigest(terrain));
    const same: MatchInput = { ...NO_INPUT };
    for (let n = 0; n < 120; n++) {
      same.move = n < 60 ? 1 : 0;
      rec.step(same);
    }
    const r = rec.finish('left');
    expect(r.inputs.map(([t, c]) => [t, c.move])).toEqual([[0, 1], [60, 0]]);
    expect(replay(r).same).toBe(true);
  });
});

describe('a match recorded, and played again', () => {
  it('plays the same, checkpoint for checkpoint, ground and all, also after JSON', () => {
    expect(played.ticks).toBe(TICKS);
    expect(played.checkpoints.length).toBe(TICKS / 60);
    expect(played.inputs.length).toBeGreaterThan(20);
    expect(played.setup.fresh).toBe(true);
    const again = replay(played);
    expect([again.same, again.firstDiff, again.sameGround]).toEqual([true, -1, true]);
    const sent = JSON.parse(JSON.stringify(played)) as MatchRecord;
    expect(replay(sent).same).toBe(true);
    // (and the computer's own match is the same match, played again)
    expect(JSON.stringify(playRecorded(SETUP, TICKS))).toBe(JSON.stringify(played));
  });

  it('a client that went another way is caught at the first checkpoint after it', () => {
    // (one input changed at tick 700: the match differs from the checkpoint that follows)
    const i = played.inputs.findIndex(([t]) => t >= 700);
    const at = played.inputs[i][0];
    const inputs = played.inputs.map((x, k) => (k === i ? ([x[0], { ...x[1], move: x[1].move === 1 ? -1 : 1, faceX: 0.3, faceZ: 0.95 }] as const) : x));
    const off = replay({ ...played, inputs }, true);
    expect(off.same).toBe(false);
    expect(off.firstDiff).toBeGreaterThan(at);
    expect(off.firstDiff).toBeLessThanOrEqual(at + 600);
    expect(off.firstDiff % 60).toBe(0);
  });

  it('is not played with other numbers, nor on a map an earlier match left in pieces', () => {
    const tuned = TUNING.make({ [weaponSetting(SOLDER_BLOB, 'damage')]: 60 });
    expect(() => replay({ ...played, setup: { ...played.setup, tuning: { version: 1, changed: tuned.changed, hash: shipped.hash } } })).toThrow(/settings/);
    expect(() => replay({ ...played, setup: { ...played.setup, fresh: false } })).toThrow(/pieces/);
    // (a match tuned so plays with them, and again the same)
    const t = playRecorded({ ...SETUP, tuning: { version: 1, changed: { ...tuned.changed }, hash: tuned.hash } }, 600);
    expect(replay(t).same).toBe(true);
  });

  it('is kept on this device and comes back as it was', async () => {
    const store = new MemoryStore();
    const cache = new DataCache(store, 'me');
    cache.put('replays', 'r1', played as unknown as { version: number; ticks: number });
    await cache.flushed();
    const again = new DataCache(store, 'me');
    await again.load();
    const back = again.get('replays', 'r1') as unknown as MatchRecord;
    expect(back.checkpoints).toEqual(played.checkpoints);
    expect(replay(back).same).toBe(true);
  });
});
