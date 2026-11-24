/** Computes the music of a map, off the main thread. */
import { makeTheme, STEMS, type StemId } from './music';

export interface MusicReply {
  theme: string;
  stems: Record<StemId, [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]>;
}

const scope = self as unknown as { postMessage(message: MusicReply, transfer: Transferable[]): void; onmessage: ((e: MessageEvent<string>) => void) | null };
scope.onmessage = (e) => {
  const stems = makeTheme(e.data);
  scope.postMessage(
    { theme: e.data, stems },
    STEMS.flatMap((s) => stems[s].map((c) => c.buffer)),
  );
};
