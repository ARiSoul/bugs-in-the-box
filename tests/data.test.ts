import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DataCache, DexieStore, LEGACY, MemoryServer, MemoryStore, SyncEngine, importLegacy, newer, openData, stamp, type DataStore, type Row } from '../src/data';

let dbs = 0;
/** A new IndexedDB store, its own database. */
async function dexie(): Promise<DexieStore> {
  const s = new DexieStore(`test-${++dbs}`);
  expect(await s.open()).toBe(true);
  return s;
}

const row = (id: string, at: number, origin = 'a', rev = 1): Row => ({ collection: 'settings', id, value: { value: id }, rev, updatedAt: at, origin, deleted: false });

describe('records', () => {
  it('the later write wins; then the higher revision; then the writer, only to break a tie', () => {
    expect(newer(row('x', 2), row('x', 1))).toBe(true);
    expect(newer(row('x', 1), row('x', 2))).toBe(false);
    expect(newer(row('x', 1, 'a', 3), row('x', 1, 'a', 2))).toBe(true);
    expect(newer(row('x', 1, 'b'), row('x', 1, 'a'))).toBe(true);
    expect(newer(row('x', 1, 'a'), row('x', 1, 'a'))).toBe(false);
  });

  it('a write counts up its revision, and moves forward even if the clock went back', () => {
    const a = stamp('settings', 'x', { value: 1 }, undefined, 'me', 1000);
    expect(a.rev).toBe(1);
    const b = stamp('settings', 'x', { value: 2 }, a, 'me', 500);
    expect(b.rev).toBe(2);
    expect(b.updatedAt).toBe(1001);
    expect(newer(b, a)).toBe(true);
  });
});

/** What every store must do, whatever keeps it. */
function storeContract(name: string, make: () => Promise<DataStore>): void {
  describe(`store: ${name}`, () => {
    it('keeps what is written, and puts it in the outbox once (the latest state)', async () => {
      const s = await make();
      await s.write(row('a', 1));
      await s.write(row('b', 2));
      await s.write({ ...row('a', 3), rev: 2 });
      expect((await s.get('settings', 'a'))?.rev).toBe(2);
      const box = await s.outbox(10);
      expect(box.map((b) => b.row.id)).toEqual(['b', 'a']);
      await s.acknowledge([box[0].seq]);
      expect((await s.outbox(10)).map((b) => b.row.id)).toEqual(['a']);
      expect((await s.all()).length).toBe(2);
    });

    it('merges what came from elsewhere only if it wins, and does not send it back', async () => {
      const s = await make();
      await s.write(row('a', 5));
      await s.acknowledge((await s.outbox(10)).map((b) => b.seq));
      expect(await s.merge(row('a', 4, 'b'))).toBe(false);
      expect(await s.merge(row('a', 6, 'b'))).toBe(true);
      expect((await s.get('settings', 'a'))?.origin).toBe('b');
      expect(await s.outbox(10)).toEqual([]);
    });

    it('keeps its own small values', async () => {
      const s = await make();
      expect(await s.getMeta('k')).toBeUndefined();
      await s.setMeta('k', { n: 1 });
      expect(await s.getMeta('k')).toEqual({ n: 1 });
    });
  });
}
storeContract('memory', async () => new MemoryStore());
storeContract('IndexedDB (Dexie)', dexie);

describe('cache', () => {
  it('reads at once what was written, keeps it in the store behind, and has it again after a reload (offline)', async () => {
    const store = await dexie();
    let now = 100;
    const cache = new DataCache(store, 'me', () => now++);
    cache.put('growth', 'ant', { xp: 120, known: ['a'], active: [], items: {} });
    expect(cache.get('growth', 'ant')?.xp).toBe(120);
    await cache.flushed();
    const again = new DataCache(store, 'me');
    await again.load();
    expect(again.get('growth', 'ant')).toEqual({ xp: 120, known: ['a'], active: [], items: {} });
    expect(again.ids('growth')).toEqual(['ant']);
  });

  it('copies what is written (a later change to the object does not reach it), and a removed one is gone but kept', async () => {
    const cache = new DataCache(new MemoryStore(), 'me');
    const v = { slots: ['a'] };
    cache.put('loadout', 'ant', v);
    v.slots.push('b');
    expect(cache.get('loadout', 'ant')).toEqual({ slots: ['a'] });
    cache.remove('loadout', 'ant');
    expect(cache.get('loadout', 'ant')).toBeUndefined();
    expect(cache.row('loadout', 'ant')?.deleted).toBe(true);
    expect(cache.ids('loadout')).toEqual([]);
  });

  it('tells of changes', async () => {
    const cache = new DataCache(new MemoryStore(), 'me');
    const seen: string[] = [];
    const off = cache.onChange((r) => seen.push(r.id));
    cache.put('settings', 'a', { value: 1 });
    off();
    cache.put('settings', 'b', { value: 2 });
    expect(seen).toEqual(['a']);
  });
});

describe('the old localStorage values', () => {
  const old = new Map<string, string>([
    [LEGACY.profile, JSON.stringify({ ant: { xp: 300, known: ['x'], active: ['x'], items: { fuse: 1 } } })],
    [LEGACY.quick, JSON.stringify({ ant: ['blob', '', 'capacitor'] })],
    [LEGACY.sound, JSON.stringify({ volume: 0.5, muted: true })],
    [LEGACY.keys, JSON.stringify({ jump: ['Space'] })],
    [LEGACY.camera, 'moves'],
  ]);
  const storage = { getItem: (k: string) => old.get(k) ?? null };

  it('come in once, the first time', async () => {
    const cache = new DataCache(new MemoryStore(), 'me');
    expect(await importLegacy(cache, storage)).toBe(true);
    expect(cache.get('growth', 'ant')?.xp).toBe(300);
    expect(cache.get('loadout', 'ant')).toEqual({ slots: ['blob', '', 'capacitor'] });
    expect(cache.get('settings', 'sound')).toEqual({ value: { volume: 0.5, muted: true } });
    expect(cache.get('settings', 'camera')).toEqual({ value: 'moves' });
    cache.put('growth', 'ant', { xp: 999, known: [], active: [], items: {} });
    expect(await importLegacy(cache, storage)).toBe(false);
    expect(cache.get('growth', 'ant')?.xp).toBe(999);
  });
});

describe('sync', () => {
  /** A client: its own store and cache, syncing with `server`. */
  async function client(server: MemoryServer, id: string, clock: () => number) {
    const store = await dexie();
    const cache = new DataCache(store, id, clock);
    const sync = new SyncEngine(store, server, (r) => cache.merged(r));
    return { cache, sync };
  }

  it('what one client writes reaches another through the server, deletions too', async () => {
    let now = 1000;
    const clock = () => now++;
    const server = new MemoryServer();
    const a = await client(server, 'a', clock);
    const b = await client(server, 'b', clock);
    a.cache.put('growth', 'ant', { xp: 50, known: [], active: [], items: {} });
    a.cache.put('settings', 'camera', { value: 'stays' });
    await a.cache.flushed();
    expect((await a.sync.sync()).pushed).toBe(2);
    expect((await b.sync.sync()).pulled).toBe(2);
    expect(b.cache.get('growth', 'ant')?.xp).toBe(50);
    a.cache.remove('settings', 'camera');
    await a.cache.flushed();
    await a.sync.sync();
    await b.sync.sync();
    expect(b.cache.get('settings', 'camera')).toBeUndefined();
    // (nothing left to send, nothing new to take)
    expect(await a.sync.sync()).toEqual({ pushed: 0, pulled: 0, replaced: 0 });
  });

  it('two clients edit the same record offline: the later write wins on both, and on the server', async () => {
    let now = 1000;
    const clock = () => now++;
    const server = new MemoryServer();
    const a = await client(server, 'a', clock);
    const b = await client(server, 'b', clock);
    a.cache.put('growth', 'spider', { xp: 10, known: [], active: [], items: {} });
    b.cache.put('growth', 'spider', { xp: 20, known: [], active: [], items: {} });
    await a.cache.flushed();
    await b.cache.flushed();
    // (b wrote later, but a reaches the server second: the server keeps b's, and tells a)
    await b.sync.sync();
    const ra = await a.sync.sync();
    expect(ra.replaced).toBe(1);
    expect(a.cache.get('growth', 'spider')?.xp).toBe(20);
    await b.sync.sync();
    expect(b.cache.get('growth', 'spider')?.xp).toBe(20);
    expect(server.peek('growth/spider')?.origin).toBe('b');
  });
});

describe('openData', () => {
  it('opens IndexedDB, gives this client an id it keeps, and is persistent', async () => {
    const one = await openData('open-test');
    expect(one.persistent).toBe(true);
    one.settings.set('camera', 'stays');
    await one.cache.flushed();
    const origin = one.cache.origin;
    one.cache.store.close();
    const two = await openData('open-test');
    expect(two.cache.origin).toBe(origin);
    expect(two.settings.get('camera')).toBe('stays');
  });
});
