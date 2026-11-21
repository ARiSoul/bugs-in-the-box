import * as THREE from 'three';

interface Flash {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  t0: number;
  radius: number;
}

/** Short-lived expanding fireball at each explosion. Purely cosmetic. */
export class ExplosionFlashes {
  private readonly flashes: Flash[] = [];
  private readonly geometry = new THREE.SphereGeometry(1, 20, 14);

  constructor(private readonly scene: THREE.Scene) {}

  spawn(position: THREE.Vector3, radius: number): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius * 0.6);
    this.scene.add(mesh);
    this.flashes.push({ mesh, t0: performance.now(), radius });
  }

  update(now: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const k = (now - f.t0) / 380;
      if (k >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      f.mesh.scale.setScalar(f.radius * (0.6 + k * 0.9));
      f.mesh.material.opacity = 0.9 * (1 - k);
    }
  }
}
