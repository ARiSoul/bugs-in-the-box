import * as THREE from 'three';
import type { Projectile } from '../game/projectile';
import type { DrawnGround } from './drawnGround';

const RADIUS = 0.4;
const geometry = new THREE.SphereGeometry(RADIUS, 12, 9);

/** A block of the ground an ant tore out: lumpy, faceted, earth and grit. */
function rock(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1.25, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.78 + 0.32 * Math.abs(Math.sin(v.x * 4.1 + v.y * 2.3) * Math.cos(v.z * 3.7 - v.y * 1.9));
    v.multiplyScalar(k);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
    const s = 0.75 + 0.4 * k;
    c.set([0.22 * s, 0.15 * s, 0.09 * s], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g.toNonIndexed();
}
const rockGeometry = rock();
const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });


/** One small glowing sphere per projectile in flight, kept in sync with the match by id. */
export class ProjectileViews {
  private readonly meshes = new Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>();
  private readonly seen = new Set<number>();

  constructor(private readonly scene: THREE.Scene) {}

  /** `alpha` interpolates between the previous and the current tick; a grenade lies on what is drawn (`ground`). */
  sync(projectiles: readonly Projectile[], alpha: number, ground: DrawnGround): void {
    this.seen.clear();
    for (const p of projectiles) {
      this.seen.add(p.id);
      let mesh = this.meshes.get(p.id);
      if (!mesh) {
        mesh =
          p.weapon.kind === 'lift'
            ? (new THREE.Mesh(rockGeometry, rockMaterial) as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>)
            : new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(geometry, new THREE.MeshBasicMaterial({ color: p.weapon.color }));
        mesh.castShadow = p.weapon.kind === 'lift';
        this.scene.add(mesh);
        this.meshes.set(p.id, mesh);
      }
      mesh.visible = p.weapon.kind !== 'arrow';
      mesh.position.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
      // (a block tumbles as it flies)
      if (p.weapon.kind === 'lift') mesh.rotation.set(p.age * 0.09, p.age * 0.05, 0);
      if (p.weapon.kind === 'grenade') {
        const { x, y, z } = mesh.position;
        const below = ground.rest(x, y + 1, z, 0, -1, 0, 1 + RADIUS) - 1;
        if (below > -1 && below < RADIUS) mesh.position.y += RADIUS - below;
      }
    }
    for (const [id, mesh] of this.meshes) {
      if (this.seen.has(id)) continue;
      if (mesh.material !== (rockMaterial as unknown)) mesh.material.dispose();
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  /**
   * The block an ant holds up before it throws it: over its back (`at`, along `up`), risen this far (0..1); null: none.
   */
  hold(at: THREE.Vector3 | null, up: THREE.Vector3, rise: number, high: number): void {
    if (!this.held) {
      this.held = new THREE.Mesh(rockGeometry, rockMaterial);
      this.held.castShadow = true;
      this.scene.add(this.held);
    }
    this.held.visible = at !== null;
    if (!at) return;
    const k = rise * rise * (3 - 2 * rise);
    this.held.position.copy(at).addScaledVector(up, high * k);
    this.held.rotation.set(0.3 * (1 - k), 0.6 * k, 0.15 * Math.sin(rise * 9) * (1 - k));
  }
  private held: THREE.Mesh | null = null;

  /** Position of the first projectile still flying, for the camera. */
  first(out: THREE.Vector3): boolean {
    for (const mesh of this.meshes.values()) {
      out.copy(mesh.position);
      return true;
    }
    return false;
  }
}
