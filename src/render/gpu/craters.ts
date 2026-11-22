import * as THREE from 'three/webgpu';
import { Fn, If, Loop, bool, length, positionWorld, uniform, uniformArray } from 'three/tsl';

/** Most craters a match keeps (explosions and the spheres along a tunnel). */
const MAX_CRATERS = 256;

/**
 * The spheres gameplay carved out of the terrain (render only, from the match's explosion and dig events).
 * The smooth render-only parts laid over the terrain are cut by the same spheres, so a crater goes through
 * them exactly where the terrain under them was carved, with the same round shape (and in their shadows).
 */
export class Craters {
  private readonly list = uniformArray(Array.from({ length: MAX_CRATERS }, () => new THREE.Vector4(0, -1000, 0, 0)), 'vec4');
  private readonly count = uniform(0, 'int');
  private n = 0;

  /** `position`: where a fragment is tested (the world; a turning part passes its own frame). */
  constructor(private readonly position: THREE.Node<'vec3'> = positionWorld as unknown as THREE.Node<'vec3'>) {}

  /** A crater of `radius` at (x, y, z), as `Terrain.carve` makes it. */
  add(x: number, y: number, z: number, radius: number): void {
    if (this.n >= MAX_CRATERS) return;
    (this.list.array[this.n++] as THREE.Vector4).set(x, y, z, radius);
    this.count.value = this.n;
  }

  /** A tunnel from (x1, y1, z1) to (x2, y2, z2): spheres along it, as the dig carves them. */
  addTunnel(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.max(1, Math.ceil(len / (radius * 0.7)));
    for (let i = 0; i <= steps; i++) this.add(x1 + (dx * i) / steps, y1 + (dy * i) / steps, z1 + (dz * i) / steps, radius);
  }

  /** A new map: no craters. */
  clear(): void {
    for (let i = 0; i < this.n; i++) (this.list.array[i] as THREE.Vector4).set(0, -1000, 0, 0);
    this.n = 0;
    this.count.value = 0;
  }

  /** Make `material` drop its fragments inside the craters (in colour and in the shadow pass). */
  cut<M extends THREE.NodeMaterial>(material: M): M {
    const list = this.list;
    const count = this.count;
    material.maskNode = Fn(() => {
      const keep = bool(true).toVar();
      Loop(count, ({ i }) => {
        const c = list.element(i) as unknown as THREE.Node<'vec4'>;
        If(length(this.position.sub(c.xyz)).lessThan(c.w), () => {
          keep.assign(false);
        });
      });
      return keep;
    })();
    return material;
  }
}
