import type { ChunkMesh } from '../terrain/mesher';
import { REGION_BYTES, readRegion, regionArrays, regionBox } from '../terrain/region';
import type { Terrain } from '../terrain/Terrain';
import type { MeshJob, MeshReply, MeshRequest } from '../workers/meshProtocol';

export interface MeshBatch {
  id: number;
  meshes: { id: number; mesh: ChunkMesh }[];
  /** Main-thread time to copy the regions and post them. */
  postMs: number;
  /** Longest worker part of the batch (the parts run in parallel). */
  workerMs: number;
  /** performance.now() when the batch was requested. */
  startedAt: number;
}

interface Pending {
  parts: number;
  meshes: { id: number; seq: number; mesh: ChunkMesh }[];
  postMs: number;
  workerMs: number;
  startedAt: number;
}

const MAX_SPARE_BUFFERS = 32;

/**
 * Meshes dirty chunks on a pool of Web Workers, off the main thread.
 *
 * - Each job carries a copy of only the samples its chunk needs (`terrain/region.ts`, ~200 kB), and the
 *   region buffers travel back for reuse; the meshes are transferred, never copied.
 * - The chunks of one request are spread over the workers, and the whole batch is handed over at
 *   once, so neighbouring chunks of one explosion always appear in the same frame (no seam gaps).
 * - A result is dropped if a newer request for the same chunk was sent (workers may finish out of
 *   order), or if the map was regenerated since (`reset`).
 */
export class MeshWorkers {
  private readonly workers: Worker[] = [];
  private readonly spare: ArrayBuffer[] = [];
  private readonly latest = new Map<number, number>();
  private readonly pending = new Map<number, Pending>();
  private gen = 0;
  private seq = 0;
  private nextBatch = 0;

  private constructor(
    size: number,
    private readonly onBatch: (batch: MeshBatch) => void,
  ) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../workers/mesh.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<MeshReply>) => this.receive(e.data);
      this.workers.push(w);
    }
  }

  /** A pool sized for this device, or null where module workers are not available. */
  static create(onBatch: (batch: MeshBatch) => void, size = defaultSize()): MeshWorkers | null {
    try {
      return new MeshWorkers(size, onBatch);
    } catch {
      return null;
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Batches sent and not handed over yet. */
  get busy(): number {
    return this.pending.size;
  }

  /** The map was regenerated: whatever is in flight is for the old map. */
  reset(): void {
    this.gen++;
    this.pending.clear();
    this.latest.clear();
  }

  /** Send every dirty chunk to the workers and clear the dirty set. Returns the batch id, or -1. */
  request(terrain: Terrain, sharp: boolean): number {
    if (terrain.dirty.size === 0) return -1;
    const startedAt = performance.now();
    const batch = this.nextBatch++;
    const parts: MeshJob[][] = this.workers.map(() => []);
    let n = 0;
    for (const id of terrain.dirty) {
      const buffer = this.spare.pop() ?? new ArrayBuffer(REGION_BYTES);
      const box = regionBox(terrain, id, new Int32Array(6));
      readRegion(terrain, box, regionArrays(buffer));
      const seq = ++this.seq;
      this.latest.set(id, seq);
      parts[n++ % parts.length].push({ id, seq, box, buffer });
    }
    terrain.dirty.clear();

    let sent = 0;
    parts.forEach((jobs, i) => {
      if (jobs.length === 0) return;
      const req: MeshRequest = { gen: this.gen, batch, sharp, cx: terrain.cx, cy: terrain.cy, cz: terrain.cz, jobs };
      this.workers[i].postMessage(req, jobs.map((j) => j.buffer));
      sent++;
    });
    this.pending.set(batch, { parts: sent, meshes: [], postMs: performance.now() - startedAt, workerMs: 0, startedAt });
    return batch;
  }

  private receive(reply: MeshReply): void {
    for (const r of reply.results) if (this.spare.length < MAX_SPARE_BUFFERS) this.spare.push(r.buffer);
    if (reply.gen !== this.gen) return;
    const p = this.pending.get(reply.batch);
    if (!p) return;
    for (const r of reply.results) p.meshes.push({ id: r.id, seq: r.seq, mesh: r.mesh });
    if (reply.ms > p.workerMs) p.workerMs = reply.ms;
    if (--p.parts > 0) return;
    this.pending.delete(reply.batch);
    const meshes = p.meshes.filter((m) => this.latest.get(m.id) === m.seq);
    this.onBatch({ id: reply.batch, meshes, postMs: p.postMs, workerMs: p.workerMs, startedAt: p.startedAt });
  }
}

/** Leave one core for the main thread; more than 4 workers does not pay for 18–75 chunks. */
function defaultSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}
