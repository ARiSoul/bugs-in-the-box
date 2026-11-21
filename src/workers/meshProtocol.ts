import type { ChunkMesh } from '../terrain/mesher';

/** One chunk to mesh. `buffer` holds the packed region (see `terrain/region.ts`); it is transferred. */
export interface MeshJob {
  id: number;
  /** Request number: a result is used only if no newer request for the same chunk was sent. */
  seq: number;
  box: Int32Array;
  buffer: ArrayBuffer;
}

export interface MeshRequest {
  /** Map generation: results from an older map are dropped. */
  gen: number;
  batch: number;
  /** Terrain size in chunks, so the worker can size its mirror grid. */
  cx: number;
  cy: number;
  cz: number;
  jobs: MeshJob[];
}

export interface MeshResult {
  id: number;
  seq: number;
  mesh: ChunkMesh;
  /** The job's region buffer, sent back for reuse. */
  buffer: ArrayBuffer;
}

export interface MeshReply {
  gen: number;
  batch: number;
  /** Time the worker spent on this part of the batch. */
  ms: number;
  results: MeshResult[];
}
