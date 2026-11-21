import { SurfaceNetsMesher, type ChunkMesh } from '../../src/terrain/mesher';
import type { Terrain } from '../../src/terrain/Terrain';

/** Mesh every chunk (ignoring the dirty set). */
export function meshAll(terrain: Terrain): ChunkMesh[] {
  const mesher = new SurfaceNetsMesher();
  const out: ChunkMesh[] = [];
  for (let id = 0; id < terrain.chunkCount; id++) {
    const [cx, cy, cz] = terrain.chunkCoords(id);
    out.push(mesher.mesh(terrain, cx, cy, cz));
  }
  return out;
}

export interface Integrity {
  faces: number;
  /** Fraction of faces whose winding normal agrees with the vertex (field-gradient) normals. */
  orientedOutward: number;
  degenerate: number;
  /** Edges used by exactly one triangle after welding chunk seams: holes. */
  openEdges: number;
  /** Edges used by more than two triangles. Surface Nets produces a few; a sudden jump signals a bug. */
  nonManifoldEdges: number;
}

export function analyze(meshes: ChunkMesh[]): Integrity {
  const key = (P: Float32Array, i: number): string =>
    `${Math.round(P[i] * 1e3)},${Math.round(P[i + 1] * 1e3)},${Math.round(P[i + 2] * 1e3)}`;
  const edgeCount = new Map<string, number>();
  let faces = 0;
  let agree = 0;
  let degenerate = 0;

  for (const m of meshes) {
    const P = m.positions;
    const Nn = m.normals;
    const I = m.indices;
    for (let f = 0; f < I.length; f += 3) {
      const a = I[f] * 3;
      const b = I[f + 1] * 3;
      const c = I[f + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) {
        degenerate++;
        continue;
      }
      faces++;
      const dot =
        (nx * (Nn[a] + Nn[b] + Nn[c]) + ny * (Nn[a + 1] + Nn[b + 1] + Nn[c + 1]) + nz * (Nn[a + 2] + Nn[b + 2] + Nn[c + 2])) / len;
      if (dot > 0) agree++;
      const ks = [key(P, a), key(P, b), key(P, c)];
      for (let e = 0; e < 3; e++) {
        const p = ks[e];
        const q = ks[(e + 1) % 3];
        if (p === q) continue;
        const ek = p < q ? `${p}|${q}` : `${q}|${p}`;
        edgeCount.set(ek, (edgeCount.get(ek) ?? 0) + 1);
      }
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const n of edgeCount.values()) {
    if (n === 1) openEdges++;
    else if (n > 2) nonManifoldEdges++;
  }
  return { faces, orientedOutward: faces ? agree / faces : 1, degenerate, openEdges, nonManifoldEdges };
}
