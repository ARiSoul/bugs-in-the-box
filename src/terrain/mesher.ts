import { CHUNK } from './constants';
import { MATERIAL_PBR } from './materials';
import { shadeNoise, shadeVertex, shadeWithNoise } from './shading';
import type { Terrain } from './Terrain';

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB with ambient occlusion already applied. */
  colors: Float32Array;
  /** Roughness, metalness and glow kind per vertex (from the material, see `MATERIAL_PBR`). */
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

/** Pull of the QEF solution towards the cell's mass point (cell units squared): keeps flat areas stable. */
const QEF_BIAS = 0.05;
/** Keep Dual Contouring vertices this far inside their cell. */
const CELL_MARGIN = 0.02;
/**
 * A cell is a sharp feature (edge or corner) only if two of its crossing normals differ by more than
 * this (cosine; 0.8 ≈ 37°). Smooth curved cells (tubes, rounded rims) keep the Surface Nets point: the
 * QEF fit on a gently curved surface snaps vertices to small ridges, a saw-tooth along the curve.
 */
const FEATURE_DOT = 0.8;

/**
 * Mesher over a chunk of the global density grid: Dual Contouring (default) or naive Surface Nets.
 * Both share the topology (one vertex per surface cell, one quad per sign-changing edge), so both are
 * watertight across chunks; they differ only in where the cell's vertex goes.
 *
 * - Surface Nets: the average of the cell's edge crossings. Smooth, but rounds every edge and corner.
 * - Dual Contouring: the point that best fits the tangent planes at the crossings (a small least-squares
 *   problem, the QEF), so box edges and corners stay sharp. The plane normals must be right for that,
 *   and the trilinear field blurs them near an edge. So each crossing takes its normal from whichever of
 *   the 4 cells around its grid edge is closest to linear (smallest trilinear cross terms): such a cell
 *   sees one face only, and its gradient is that face's normal.
 *
 * - One vertex per cell that straddles the surface.
 * - One quad per grid edge with a sign change, connecting the 4 cells sharing that edge.
 * - Seams: vertices are computed in cells [start-1, end) and depend only on the global grid, so
 *   neighbouring chunks produce identical vertices on their shared boundary. A chunk only emits the
 *   quads whose minimum-corner edge lies inside it, so no quad is emitted twice.
 * - Normals are the analytic gradient of the cell's trilinear field.
 * - No allocation inside the hot loops: scratch buffers are reused between calls, so call
 *   `mesh()` from one thread/worker at a time per mesher instance.
 */
export class ChunkMesher {
  /** `sharp`: Dual Contouring vertex placement (default); false gives plain Surface Nets. */
  constructor(readonly sharp = true) {}

  private readonly gn = new Float64Array(3);
  /** One corner's colour, while blending the materials of a cell. */
  private readonly tmpCol = new Float32Array(3);

  private readonly vmap = new Int32Array(REGION); // -1 none, -2 exists but not emitted, >=0 output index
  private readonly vpos = new Float32Array(REGION * 3);
  private readonly vnrm = new Float32Array(REGION * 3);
  private readonly opos = new Float32Array(REGION * 3);
  private readonly onrm = new Float32Array(REGION * 3);
  private readonly ocol = new Float32Array(REGION * 3);
  private readonly opbr = new Float32Array(REGION * 3);
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
          // QEF terms (Dual Contouring): AtA (symmetric) and Atb, in cell-local coordinates
          let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
          let b0 = 0, b1 = 0, b2 = 0;
          let f0x = 0, f0y = 0, f0z = 0;
          let minDot = 1;
          for (let e = 0; e < 12; e++) {
            const a = EDGE_A[e];
            const bb = EDGE_B[e];
            const va = cv[a];
            const vb = cv[bb];
            if (va < 0 === vb < 0) continue;
            const tt = va / (va - vb);
            const ax = a & 1;
            const ay = (a >> 1) & 1;
            const az = (a >> 2) & 1;
            const qx = ax + ((bb & 1) - ax) * tt;
            const qy = ay + (((bb >> 1) & 1) - ay) * tt;
            const qz = az + (((bb >> 2) & 1) - az) * tt;
            px += qx;
            py += qy;
            pz += qz;
            cnt++;
            if (this.sharp) {
              const gn = this.edgeNormal(t, i + ax, j + ay, k + az, a ^ bb, i + qx, j + qy, k + qz);
              const nx = gn[0];
              const ny = gn[1];
              const nz = gn[2];
              const d = nx * qx + ny * qy + nz * qz;
              if (cnt === 1) {
                f0x = nx;
                f0y = ny;
                f0z = nz;
              } else {
                const dd = nx * f0x + ny * f0y + nz * f0z;
                if (dd < minDot) minDot = dd;
              }
              a00 += nx * nx; a01 += nx * ny; a02 += nx * nz;
              a11 += ny * ny; a12 += ny * nz; a22 += nz * nz;
              b0 += nx * d; b1 += ny * d; b2 += nz * d;
            }
          }
          px /= cnt;
          py /= cnt;
          pz /= cnt;
          if (this.sharp && minDot < FEATURE_DOT) {
            // Solve (AtA + bias I) y = Atb - AtA c around the mass point c, then x = c + y.
            const r0 = b0 - (a00 * px + a01 * py + a02 * pz);
            const r1 = b1 - (a01 * px + a11 * py + a12 * pz);
            const r2 = b2 - (a02 * px + a12 * py + a22 * pz);
            const m00 = a00 + QEF_BIAS;
            const m11 = a11 + QEF_BIAS;
            const m22 = a22 + QEF_BIAS;
            const c00 = m11 * m22 - a12 * a12;
            const c01 = a02 * a12 - a01 * m22;
            const c02 = a01 * a12 - a02 * m11;
            const det = m00 * c00 + a01 * c01 + a02 * c02;
            if (det > 1e-9) {
              const c11 = m00 * m22 - a02 * a02;
              const c12 = a01 * a02 - m00 * a12;
              const c22 = m00 * m11 - a01 * a01;
              const hi = 1 - CELL_MARGIN;
              const sx0 = px + (c00 * r0 + c01 * r1 + c02 * r2) / det;
              const sy0 = py + (c01 * r0 + c11 * r1 + c12 * r2) / det;
              const sz0 = pz + (c02 * r0 + c12 * r1 + c22 * r2) / det;
              px = sx0 < CELL_MARGIN ? CELL_MARGIN : sx0 > hi ? hi : sx0;
              py = sy0 < CELL_MARGIN ? CELL_MARGIN : sy0 > hi ? hi : sy0;
              pz = sz0 < CELL_MARGIN ? CELL_MARGIN : sz0 > hi ? hi : sz0;
            }
          }

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
      const burn = scorch[si] / 255;
      // Materials: where the cell's corners disagree, blend their colours and finishes (trilinear,
      // solid corners count more) so material borders follow the surface smoothly instead of in steps.
      const ix = Math.min(Math.floor(x), t.W - 1);
      const iy = Math.min(Math.floor(y), t.H - 1);
      const iz = Math.min(Math.floor(z), t.D - 1);
      const c0 = ix + sx * (iy + sy * iz);
      const m0 = material[c0];
      let mixed = false;
      for (let c = 1; c < 8 && !mixed; c++) {
        if (material[c0 + (c & 1) + (c & 2 ? sx : 0) + (c & 4 ? sk : 0)] !== m0) mixed = true;
      }
      let pr = 0;
      let pmet = 0;
      let pglow = 0;
      if (!mixed) {
        shadeVertex(ocol, o3, x, y, z, vnrm[l3 + 1], burn, m0);
        const pm = m0 < MATERIAL_PBR.length ? m0 : 0;
        pr = PBR[pm * 3];
        pmet = PBR[pm * 3 + 1];
        pglow = PBR[pm * 3 + 2];
      } else {
        const fx = x - ix;
        const fy = y - iy;
        const fz = z - iz;
        const tc = this.tmpCol;
        const n = shadeNoise(x, y, z);
        let r = 0;
        let g = 0;
        let b = 0;
        let wsum = 0;
        for (let c = 0; c < 8; c++) {
          const ci = c0 + (c & 1) + (c & 2 ? sx : 0) + (c & 4 ? sk : 0);
          const w = (c & 1 ? fx : 1 - fx) * (c & 2 ? fy : 1 - fy) * (c & 4 ? fz : 1 - fz) * (dens[ci] < 0 ? 1 : 0.3) + 1e-6;
          const cm = material[ci];
          shadeWithNoise(tc, 0, n, vnrm[l3 + 1], burn, cm);
          r += tc[0] * w;
          g += tc[1] * w;
          b += tc[2] * w;
          const pm = cm < MATERIAL_PBR.length ? cm : 0;
          pr += PBR[pm * 3] * w;
          pmet += PBR[pm * 3 + 1] * w;
          pglow += PBR[pm * 3 + 2] * w;
          wsum += w;
        }
        ocol[o3] = r / wsum;
        ocol[o3 + 1] = g / wsum;
        ocol[o3 + 2] = b / wsum;
        pr /= wsum;
        pmet /= wsum;
        pglow /= wsum;
      }
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
      opbr[vi * 3] = pr;
      opbr[vi * 3 + 1] = pmet;
      opbr[vi * 3 + 2] = pglow;
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
      pbr: opbr.slice(0, nv * 3),
      indices: oidx.slice(0, ni),
    };
  }

  /**
   * Unit normal for the crossing at (px, py, pz) on the grid edge that starts at sample (ex, ey, ez)
   * and runs along `axisBit` (1 = x, 2 = y, 4 = z): the gradient of the most linear of the 4 cells
   * around that edge (see the class comment). Written into `this.gn`.
   */
  private edgeNormal(t: Terrain, ex: number, ey: number, ez: number, axisBit: number, px: number, py: number, pz: number): Float64Array {
    const { sx, sy, dens } = t;
    const sk = sx * sy;
    const gn = this.gn;
    let best = Infinity;
    for (let q = 0; q < 4; q++) {
      // the two axes across the edge each step back 0 or 1 cell
      const u = q & 1;
      const v = (q >> 1) & 1;
      const ci = axisBit === 1 ? ex : ex - u;
      const cj = axisBit === 2 ? ey : axisBit === 1 ? ey - u : ey - v;
      const ck = axisBit === 4 ? ez : ez - v;
      if (ci < 0 || cj < 0 || ck < 0 || ci >= t.W || cj >= t.H || ck >= t.D) continue;
      const b = ci + sx * (cj + sy * ck);
      const c0 = dens[b];
      const c1 = dens[b + 1];
      const c2 = dens[b + sx];
      const c3 = dens[b + sx + 1];
      const c4 = dens[b + sk];
      const c5 = dens[b + sk + 1];
      const c6 = dens[b + sk + sx];
      const c7 = dens[b + sk + sx + 1];
      const nonLinear =
        Math.abs(c0 - c1 - c2 + c3) + Math.abs(c0 - c1 - c4 + c5) + Math.abs(c0 - c2 - c4 + c6) +
        Math.abs(-c0 + c1 + c2 - c3 + c4 - c5 - c6 + c7);
      if (nonLinear >= best) continue;
      best = nonLinear;
      const fx = px - ci;
      const fy = py - cj;
      const fz = pz - ck;
      gn[0] = ((c1 - c0) * (1 - fy) + (c3 - c2) * fy) * (1 - fz) + ((c5 - c4) * (1 - fy) + (c7 - c6) * fy) * fz;
      gn[1] = ((c2 - c0) * (1 - fx) + (c3 - c1) * fx) * (1 - fz) + ((c6 - c4) * (1 - fx) + (c7 - c5) * fx) * fz;
      gn[2] = ((c4 - c0) * (1 - fx) + (c5 - c1) * fx) * (1 - fy) + ((c6 - c2) * (1 - fx) + (c7 - c3) * fx) * fy;
    }
    const l = Math.sqrt(gn[0] * gn[0] + gn[1] * gn[1] + gn[2] * gn[2]) || 1;
    gn[0] /= l;
    gn[1] /= l;
    gn[2] /= l;
    return gn;
  }
}
