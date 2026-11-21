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

interface Bolt {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  t0: number;
}

/** Jagged electric arcs (Short Circuit) and the glow of a dug tunnel. Purely cosmetic. */
export class LineFlashes {
  private readonly bolts: Bolt[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Zig-zag bolt between two points. Render-side randomness is fine: it never feeds the game. */
  arc(a: THREE.Vector3, b: THREE.Vector3): void {
    const segments = 10;
    const pts: THREE.Vector3[] = [];
    const len = a.distanceTo(b);
    for (let i = 0; i <= segments; i++) {
      const p = a.clone().lerp(b, i / segments);
      if (i > 0 && i < segments) p.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(len * 0.12));
      pts.push(p);
    }
    this.add(pts, 0x9fe8ff);
  }

  /** Straight hot line along a tunnel. */
  beam(a: THREE.Vector3, b: THREE.Vector3): void {
    this.add([a, b], 0xff8a3d);
  }

  private add(points: THREE.Vector3[], color: number): void {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false }),
    );
    line.renderOrder = 5;
    this.scene.add(line);
    this.bolts.push({ line, t0: performance.now() });
  }

  update(now: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const k = (now - b.t0) / 450;
      if (k >= 1) {
        b.line.geometry.dispose();
        b.line.material.dispose();
        this.scene.remove(b.line);
        this.bolts.splice(i, 1);
        continue;
      }
      b.line.material.opacity = 1 - k;
    }
  }
}
