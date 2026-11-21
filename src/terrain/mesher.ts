import { CHUNK } from './constants';
import { MATERIAL_PBR } from './materials';
import { shadeVertex } from './shading';
import type { Terrain } from './Terrain';

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB with ambient occlusion already applied. */
  colors: Float32Array;
  /** Roughness, metalness per vertex (from the material). */
  pbr: Float32Array;
  indices: Uint32Array;
}

/** Farthest the ambient-occlusion probe samples the field from a vertex (cells). Regions are padded for it. */
export const AO_REACH = 3.5;
const AO_STEPS = [1, 2, AO_REACH];
const AO_WEIGHTS = [0.45, 0.33, 0.22];
const AO_STRENGTH = 0.85;
const PBR = new Float32Array(MATERIAL_PBR.flat());

const N = CHUNK + 1; // cells per axis in the working region (chunk + 1 cell of overlap on the negative side)
const NN = N * N;
const REGION = N * N * N;

// Cube corner c has offset (c&1, (c>>1)&1, (c>>2)&1). Edge e connects corners EDGE_A[e] -> EDGE_B[e].
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
const EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];

/**
 * Naive Surface Nets over a chunk of the global density grid.
 *
 * - One vertex per cell that straddles the surface (average of its edge crossings).
 * - One quad per grid edge with a sign change, connecting the 4 cells sharing that edge.
 * - Seams: vertices are computed in cells [start-1, end) and depend only on the global grid, so
 *   neighbouring chunks produce identical vertices on their shared boundary. A chunk only emits the
 *   quads whose minimum-corner edge lies inside it, so no quad is emitted twice.
 * - Normals are the analytic gradient of the cell's trilinear field.
 * - No allocation inside the hot loops: scratch buffers are reused between calls, so call
 *   `mesh()` from one thread/worker at a time per mesher instance.
 */
export class SurfaceNetsMesher {
  private readonly vmap = new Int32Array(REGION); // -1 none, -2 exists but not emitted, >=0 output index
  private readonly vpos = new Float32Array(REGION * 3);
  private readonly vnrm = new Float32Array(REGION * 3);
  private readonly opos = new Float32Array(REGION * 3);
  private readonly onrm = new Float32Array(REGION * 3);
  private readonly ocol = new Float32Array(REGION * 3);
  private readonly opbr = new Float32Array(REGION * 2);
  private readonly oidx = new Uint32Array(REGION * 18);
  private readonly cv = new Float32Array(8);

  mesh(t: Terrain, cxI: number, cyI: number, czI: number): ChunkMesh {
    const { sx, sy, dens, scorch, material } = t;
    const sk = sx * sy;
    const x0 = cxI * CHUNK;
    const y0 = cyI * CHUNK;
    const z0 = czI * CHUNK;
    const x1 = x0 + CHUNK;
    const y1 = y0 + CHUNK;
    const z1 = z0 + CHUNK;
    const ex0 = x0 - 1;
    const ey0 = y0 - 1;
    const ez0 = z0 - 1;
    const { vmap, vpos, vnrm, opos, onrm, ocol, opbr, oidx, cv } = this;
    vmap.fill(-1);
    let nv = 0;
    let ni = 0;

    // 1) A vertex per surface-straddling cell.
    for (let k = Math.max(0, ez0); k < Math.min(z1, t.D); k++) {
      for (let j = Math.max(0, ey0); j < Math.min(y1, t.H); j++) {
        for (let i = Math.max(0, ex0); i < Math.min(x1, t.W); i++) {
          const b = i + sx * (j + sy * k);
          const c0 = dens[b];
          const c1 = dens[b + 1];
          const c2 = dens[b + sx];
          const c3 = dens[b + sx + 1];
          const c4 = dens[b + sk];
          const c5 = dens[b + sk + 1];
          const c6 = dens[b + sk + sx];
          const c7 = dens[b + sk + sx + 1];
          const mask =
            +(c0 < 0) | (+(c1 < 0) << 1) | (+(c2 < 0) << 2) | (+(c3 < 0) << 3) |
            (+(c4 < 0) << 4) | (+(c5 < 0) << 5) | (+(c6 < 0) << 6) | (+(c7 < 0) << 7);
          if (mask === 0 || mask === 255) continue;
          cv[0] = c0; cv[1] = c1; cv[2] = c2; cv[3] = c3; cv[4] = c4; cv[5] = c5; cv[6] = c6; cv[7] = c7;

          let px = 0;
          let py = 0;
          let pz = 0;
          let cnt = 0;
          for (let e = 0; e < 12; e++) {
            const a = EDGE_A[e];
            const bb = EDGE_B[e];
            const va = cv[a];
            const vb = cv[bb];
            if (va < 0 === vb < 0) continue;
            const tt = va / (va - vb);
            px += (a & 1) + ((bb & 1) - (a & 1)) * tt;
            py += ((a >> 1) & 1) + (((bb >> 1) & 1) - ((a >> 1) & 1)) * tt;
            pz += ((a >> 2) & 1) + (((bb >> 2) & 1) - ((a >> 2) & 1)) * tt;
            cnt++;
          }
          px /= cnt;
          py /= cnt;
          pz /= cnt;

          const local = i - ex0 + N * (j - ey0) + NN * (k - ez0);
          vmap[local] = -2;
          const l3 = local * 3;
          vpos[l3] = i + px;
          vpos[l3 + 1] = j + py;
          vpos[l3 + 2] = k + pz;

          // Gradient of the trilinear interpolation at (px,py,pz).
          const gx = ((c1 - c0) * (1 - py) + (c3 - c2) * py) * (1 - pz) + ((c5 - c4) * (1 - py) + (c7 - c6) * py) * pz;
          const gy = ((c2 - c0) * (1 - px) + (c3 - c1) * px) * (1 - pz) + ((c6 - c4) * (1 - px) + (c7 - c5) * px) * pz;
          const gz = ((c4 - c0) * (1 - px) + (c5 - c1) * px) * (1 - py) + ((c6 - c2) * (1 - px) + (c7 - c3) * px) * py;
          const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
          vnrm[l3] = gx / gl;
          vnrm[l3 + 1] = gy / gl;
          vnrm[l3 + 2] = gz / gl;
        }
      }
    }

    // 2) Output vertices are created lazily, the first time a quad of this chunk uses them.
    const emit = (local: number): number => {
      let vi = vmap[local];
      if (vi >= 0) return vi;
      vi = nv++;
      const l3 = local * 3;
      const o3 = vi * 3;
      const x = vpos[l3];
      const y = vpos[l3 + 1];
      const z = vpos[l3 + 2];
      opos[o3] = x;
      opos[o3 + 1] = y;
      opos[o3 + 2] = z;
      onrm[o3] = vnrm[l3];
      onrm[o3 + 1] = vnrm[l3 + 1];
      onrm[o3 + 2] = vnrm[l3 + 2];
      const si = Math.round(x) + sx * (Math.round(y) + sy * Math.round(z));
      const mat = material[si];
      shadeVertex(ocol, o3, x, y, z, vnrm[l3 + 1], scorch[si] / 255, mat);
      // Ambient occlusion from the field itself: probe outward along the normal; where something is
      // closer than the probe distance, the vertex sits in a crease and gets darker.
      let occ = 0;
      for (let s = 0; s < 3; s++) {
        const k = AO_STEPS[s];
        const d = t.sample(x + vnrm[l3] * k, y + vnrm[l3 + 1] * k, z + vnrm[l3 + 2] * k);
        const o = (k - d) / k;
        occ += AO_WEIGHTS[s] * (o < 0 ? 0 : o > 1 ? 1 : o);
      }
      const ao = 1 - AO_STRENGTH * occ;
      ocol[o3] *= ao;
      ocol[o3 + 1] *= ao;
      ocol[o3 + 2] *= ao;
      const pm = mat < MATERIAL_PBR.length ? mat : 0;
      opbr[vi * 2] = PBR[pm * 2];
      opbr[vi * 2 + 1] = PBR[pm * 2 + 1];
      vmap[local] = vi;
      return vi;
    };

    // 3) Quads. Axis a with (u,v) the other two axes in cyclic order: x:(y,z) y:(z,x) z:(x,y).
    //    Cells around the edge, counter-clockwise seen from +a: (-1,-1) (0,-1) (0,0) (-1,0) in (u,v).
    const lstr = [1, N, NN];
    for (let k = z0; k < z1; k++) {
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const base = i + sx * (j + sy * k);
          const solid0 = dens[base] < 0;
          const L = i - ex0 + N * (j - ey0) + NN * (k - ez0);
          for (let ax = 0; ax < 3; ax++) {
            if (ax === 0 ? i >= t.W : ax === 1 ? j >= t.H : k >= t.D) continue;
            const nb = ax === 0 ? base + 1 : ax === 1 ? base + sx : base + sk;
            if (dens[nb] < 0 === solid0) continue;
            const u = ax === 0 ? 1 : ax === 1 ? 2 : 0;
            const v = ax === 0 ? 2 : ax === 1 ? 0 : 1;
            const cu = u === 0 ? i : u === 1 ? j : k;
            const cvv = v === 0 ? i : v === 1 ? j : k;
            if (cu < 1 || cvv < 1) continue;
            const su = lstr[u];
            const sv = lstr[v];
            const l0 = L - su - sv;
            const l1 = L - sv;
            const l3 = L - su;
            if (vmap[l0] === -1 || vmap[l1] === -1 || vmap[L] === -1 || vmap[l3] === -1) continue;
            const q0 = emit(l0);
            const q1 = emit(l1);
            const q2 = emit(L);
            const q3 = emit(l3);
            if (solid0) {
              oidx[ni++] = q0; oidx[ni++] = q1; oidx[ni++] = q2;
              oidx[ni++] = q0; oidx[ni++] = q2; oidx[ni++] = q3;
            } else {
              oidx[ni++] = q0; oidx[ni++] = q2; oidx[ni++] = q1;
              oidx[ni++] = q0; oidx[ni++] = q3; oidx[ni++] = q2;
            }
          }
        }
      }
    }

    return {
      positions: opos.slice(0, nv * 3),
      normals: onrm.slice(0, nv * 3),
      colors: ocol.slice(0, nv * 3),
      pbr: opbr.slice(0, nv * 2),
      indices: oidx.slice(0, ni),
    };
  }
}
