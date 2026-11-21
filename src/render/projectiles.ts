import * as THREE from 'three';
import type { Projectile } from '../game/projectile';

const geometry = new THREE.SphereGeometry(0.4, 12, 9);

/** One small glowing sphere per projectile in flight, kept in sync with the match by id. */
export class ProjectileViews {
  private readonly meshes = new Map<number, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>();
  private readonly seen = new Set<number>();

  constructor(private readonly scene: THREE.Scene) {}

  /** `alpha` interpolates between the previous and the current tick. */
  sync(projectiles: readonly Projectile[], alpha: number): void {
    this.seen.clear();
    for (const p of projectiles) {
      this.seen.add(p.id);
      let mesh = this.meshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: p.weapon.color }));
        this.scene.add(mesh);
        this.meshes.set(p.id, mesh);
      }
      mesh.position.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
    }
    for (const [id, mesh] of this.meshes) {
      if (this.seen.has(id)) continue;
      mesh.material.dispose();
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  /** Position of the first projectile still flying, for the camera. */
  first(out: THREE.Vector3): boolean {
    for (const mesh of this.meshes.values()) {
      out.copy(mesh.position);
      return true;
    }
    return false;
  }
}
