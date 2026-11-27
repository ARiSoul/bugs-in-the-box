import type { DataCache } from './cache';
import type { Collections } from './records';

/**
 * What this browser kept before the database, in `localStorage`: brought in once, the first time the database opens
 * (`localStorage` is left as it was, so nothing is lost if this has to run again).
 */

/** Where each thing was kept. */
export const LEGACY = {
  profile: 'bugs-in-the-box.profile',
  quick: 'bugs-in-the-box.quick',
  sound: 'bugs-in-the-box.sound',
  keys: 'bugs-in-the-box.keys',
  camera: 'bugs-in-the-box.camera',
} as const;

const DONE = 'legacy.imported';

/** Something like `localStorage` (tests pass a map). */
export interface LegacyStorage {
  getItem(key: string): string | null;
}

function read(storage: LegacyStorage, key: string): unknown {
  try {
    const s = storage.getItem(key);
    return s === null ? undefined : (JSON.parse(s) as unknown);
  } catch {
    return undefined;
  }
}

/** Bring the old values in, once. True: they were brought now. */
export async function importLegacy(cache: DataCache, storage: LegacyStorage | null): Promise<boolean> {
  if (!storage || (await cache.store.getMeta<boolean>(DONE))) return false;
  const profile = read(storage, LEGACY.profile);
  if (profile && typeof profile === 'object')
    for (const [species, g] of Object.entries(profile as Record<string, unknown>)) {
      if (g && typeof g === 'object' && !cache.get('growth', species)) cache.put('growth', species, g as Collections['growth']);
    }
  const quick = read(storage, LEGACY.quick);
  if (quick && typeof quick === 'object')
    for (const [species, slots] of Object.entries(quick as Record<string, unknown>)) {
      if (Array.isArray(slots) && !cache.get('loadout', species)) cache.put('loadout', species, { slots: slots.map(String) });
    }
  const sound = read(storage, LEGACY.sound);
  if (sound && typeof sound === 'object' && !cache.get('settings', 'sound')) cache.put('settings', 'sound', { value: sound });
  const keys = read(storage, LEGACY.keys);
  if (keys && typeof keys === 'object' && !cache.get('settings', 'keys')) cache.put('settings', 'keys', { value: keys });
  // (the camera's setting was a bare word, not JSON)
  const camera = storage.getItem(LEGACY.camera);
  if (camera !== null && !cache.get('settings', 'camera')) cache.put('settings', 'camera', { value: camera });
  await cache.flushed();
  await cache.store.setMeta(DONE, true);
  return true;
}
