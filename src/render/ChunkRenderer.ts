import * as THREE from 'three';
import { ChunkMesher, type ChunkMesh } from '../terrain/mesher';
import type { Terrain } from '../terrain/Terrain';

export interface SyncResult {
  /** Wall-clock ms spent meshing + building geometries. */
  ms: number;
  /** Chunks that were re-meshed. */
  chunks: number;
}

/** Keeps one THREE.Mesh per terrain chunk in sync with the terrain's dirty set. */
export class ChunkRenderer {
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly tris = new Map<number, number>();
  private readonly sharpUniform = { value: 1 };
  private readonly material = terrainMaterial(this.sharpUniform);
  private readonly sharpMesher = new ChunkMesher(true);
  private readonly smoothMesher = new ChunkMesher(false);
  private readonly coords: [number, number, number] = [0, 0, 0];
  /** Sharp edges (Dual Contouring + hard-edge shading) or smooth (Surface Nets): set per scenario. */
  sharp = true;

  constructor(private readonly scene: THREE.Scene) {}

  setSharp(sharp: boolean): void {
    this.sharp = sharp;
    this.sharpUniform.value = sharp ? 1 : 0;
  }

  get triangles(): number {
    let n = 0;
    for (const v of this.tris.values()) n += v;
    return n;
  }

  /** Re-mesh every dirty chunk on this thread and clear the dirty set (fallback, and the CPU benchmark). */
  sync(terrain: Terrain): SyncResult {
    const t0 = performance.now();
    const mesher = this.sharp ? this.sharpMesher : this.smoothMesher;
    let chunks = 0;
    for (const id of terrain.dirty) {
      const [cx, cy, cz] = terrain.chunkCoords(id, this.coords);
      this.apply(id, mesher.mesh(terrain, cx, cy, cz));
      chunks++;
    }
    terrain.dirty.clear();
    return { ms: performance.now() - t0, chunks };
  }

  /** Show `m` as the mesh of chunk `id` (from `sync` or from a worker). */
  apply(id: number, m: ChunkMesh): void {
    let mesh = this.meshes.get(id);
    if (m.indices.length === 0) {
      if (mesh) {
        mesh.geometry.dispose();
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
      this.tris.set(id, 0);
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
    g.setAttribute('pbr', new THREE.BufferAttribute(m.pbr, 2));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeBoundingSphere();
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = g;
    } else {
      mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.set(id, mesh);
    }
    this.tris.set(id, m.indices.length / 3);
  }
}

/**
 * One standard (PBR) material for all terrain, where roughness and metalness come per vertex from the
 * `pbr` attribute (set from the material id by the mesher), so metal parts reflect and plastic does not.
 * With `sharp` at 1, hard edges are shaded hard (see below).
 */
function terrainMaterial(sharp: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSharp = sharp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;\nuniform float uSharp;')
      // Hard edges: vertex normals are averaged across an edge, which shades it round. Where the
      // triangle's own normal disagrees strongly with the interpolated one, use the triangle's.
      .replace(
        '#include <normal_fragment_begin>',
        [
          '#include <normal_fragment_begin>',
          'vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));',
          'normal = normalize(mix(normal, faceNormal, uSharp * smoothstep(0.84, 0.7, dot(faceNormal, normal))));',
        ].join('\n'),
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  return m;
}
