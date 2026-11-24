/** Computes every sound of the game, off the main thread: one message per sound. */
import type { Samples } from './dsp';
import { makeSound, SOUND_IDS, type SoundId } from './sounds';

export interface SoundReply {
  id: SoundId;
  takes: Samples[];
}

const scope = self as unknown as { postMessage(message: SoundReply, transfer: Transferable[]): void };
for (const id of SOUND_IDS) {
  const takes = makeSound(id);
  scope.postMessage(
    { id, takes },
    takes.map((t) => t.buffer),
  );
}
