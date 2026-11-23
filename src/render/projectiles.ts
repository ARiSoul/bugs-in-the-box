import * as THREE from 'three';
import type { Projectile } from '../game/projectile';
import type { DrawnGround } from './drawnGround';

const RADIUS = 0.4;
const geometry = new THREE.SphereGeometry(RADIUS, 12, 9);
const FORWARD = new THREE.Vector3(0, 0, 1);
const way = new THREE.Vector3();
/** A dart of silk along +z, its tip at the origin. */
export const dartGeometry = new THREE.ConeGeometry(0.11, 2.4, 8).rotateX(Math.PI / 2).translate(0, 0, -1.2);

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
        mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(p.weapon.kind === 'arrow' ? dartGeometry : geometry, new THREE.MeshBasicMaterial({ color: p.weapon.color }));
        this.scene.add(mesh);
        this.meshes.set(p.id, mesh);
      }
      mesh.position.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
      if (p.weapon.kind === 'arrow') mesh.quaternion.setFromUnitVectors(FORWARD, way.set(p.vx, p.vy, p.vz).normalize());
      if (p.weapon.kind === 'grenade') {
        const { x, y, z } = mesh.position;
        const below = ground.rest(x, y + 1, z, 0, -1, 0, 1 + RADIUS) - 1;
        if (below > -1 && below < RADIUS) mesh.position.y += RADIUS - below;
      }
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
