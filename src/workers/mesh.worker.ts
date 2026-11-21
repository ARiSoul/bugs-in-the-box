/**
 * Meshing worker. Keeps a mirror of the terrain grid in which only the regions it is asked to mesh
 * are up to date (that is all the mesher reads), and runs the same ChunkMesher as the main thread.
 * The output arrays are transferred, not copied.
 */
import { regionArrays, writeRegion } from '../terrain/region';
import { ChunkMesher } from '../terrain/mesher';
import { Terrain } from '../terrain/Terrain';
import type { MeshReply, MeshRequest, MeshResult } from './meshProtocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
  postMessage(message: MeshReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const sharpMesher = new ChunkMesher(true);
const smoothMesher = new ChunkMesher(false);
let mirror: Terrain | null = null;
const coords: [number, number, number] = [0, 0, 0];

scope.onmessage = (e) => {
  const req = e.data;
  const t0 = performance.now();
  if (!mirror || mirror.cx !== req.cx || mirror.cy !== req.cy || mirror.cz !== req.cz) {
    mirror = new Terrain(req.cx, req.cy, req.cz);
  }
  const results: MeshResult[] = [];
  const transfer: Transferable[] = [];
  const mesher = req.sharp ? sharpMesher : smoothMesher;
  for (const job of req.jobs) {
    writeRegion(mirror, job.box, regionArrays(job.buffer));
    const [cx, cy, cz] = mirror.chunkCoords(job.id, coords);
    const mesh = mesher.mesh(mirror, cx, cy, cz);
    results.push({ id: job.id, seq: job.seq, mesh, buffer: job.buffer });
    transfer.push(mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.pbr.buffer, mesh.indices.buffer, job.buffer);
  }
  scope.postMessage({ gen: req.gen, batch: req.batch, ms: performance.now() - t0, results }, transfer);
};
