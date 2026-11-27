import * as THREE from 'three/webgpu';
import { Fn, If, Loop, abs, bool, float, frontFacing, length, materialColor, materialRoughness, mx_noise_float, positionWorld, select, uniform, uniformArray, vec3 } from 'three/tsl';
import { CRATER_ROUGH, CRATER_WEIGHTS, craterShape } from '../../terrain/crater';

/** Most craters a match keeps (explosions and the spheres along a tunnel). */
const MAX_CRATERS = 256;
/** How far the meshed wall of a crater may lie inside and outside its sphere. */
const WALL_IN = 0.9;
const WALL_OUT = 0.12;

/**
 * The spheres gameplay carved out of the terrain (render only, from the match's explosion and dig events).
 * The smooth render-only parts laid over the terrain are cut by the same spheres, so a crater goes through
 * them exactly where the terrain under them was carved, with the same round shape (and in their shadows).
 */
export class Craters {
  private readonly list = uniformArray(Array.from({ length: MAX_CRATERS }, () => new THREE.Vector4(0, -1000, 0, 0)), 'vec4');
  /** Each crater's shape weights, four and four (all 0: a sphere). */
  private readonly shapeA = uniformArray(Array.from({ length: MAX_CRATERS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
  private readonly shapeB = uniformArray(Array.from({ length: MAX_CRATERS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
  private readonly shapeC = uniformArray(Array.from({ length: MAX_CRATERS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
  private readonly w = new Float64Array(CRATER_WEIGHTS);
  private readonly count = uniform(0, 'int');
  private n = 0;

  /** `position`: where a fragment is tested (the world; a turning part passes its own frame). */
  constructor(private readonly position: THREE.Node<'vec3'> = positionWorld as unknown as THREE.Node<'vec3'>) {}

  /** A crater of `radius` at (x, y, z), as `Terrain.carve` makes it (`rough`: a blast's uneven one). */
  add(x: number, y: number, z: number, radius: number, rough = false): void {
    if (this.n >= MAX_CRATERS) return;
    const w = this.w;
    if (rough) craterShape(x, y, z, w);
    else w.fill(0);
    (this.shapeA.array[this.n] as THREE.Vector4).set(w[0], w[1], w[2], w[3]);
    (this.shapeB.array[this.n] as THREE.Vector4).set(w[4], w[5], w[6], w[7]);
    (this.shapeC.array[this.n] as THREE.Vector4).set(w[8], w[9], w[10], w[11]);
    (this.list.array[this.n++] as THREE.Vector4).set(x, y, z, radius);
    this.count.value = this.n;
  }

  /** How far crater `i`'s wall is from `p` (negative: inside it), as `craterReach` shapes it. */
  private gap(i: THREE.Node<'int'>): THREE.Node<'float'> {
    const c = this.list.element(i) as unknown as THREE.Node<'vec4'>;
    const a = this.shapeA.element(i) as unknown as THREE.Node<'vec4'>;
    const b = this.shapeB.element(i) as unknown as THREE.Node<'vec4'>;
    const e = this.shapeC.element(i) as unknown as THREE.Node<'vec4'>;
    const v = this.position.sub(c.xyz);
    const d = length(v).toVar();
    const u = v.div(d.max(1e-6));
    const x = u.x;
    const y = u.y;
    const z = u.z;
    const xx = x.mul(x);
    const yy = y.mul(y);
    const zz = z.mul(z);
    const s = a.x.mul(x).mul(y)
      .add(a.y.mul(y).mul(z))
      .add(a.z.mul(z).mul(x))
      .add(a.w.mul(xx.sub(zz)))
      .add(b.x.mul(yy.sub(xx.add(zz).mul(0.5))))
      .add(b.y.mul(2.6).mul(x).mul(y).mul(z))
      .add(b.z.mul(x).mul(xx.sub(zz.mul(3))).mul(0.5))
      .add(b.w.mul(z).mul(xx.mul(3).sub(zz)).mul(0.5))
      .add(
        e.x.mul(float(1).sub(abs(xx.mul(xx).sub(xx.mul(zz).mul(6)).add(zz.mul(zz))).mul(2)))
          .add(e.y.mul(float(1).sub(abs(xx.mul(x).mul(z).sub(x.mul(zz).mul(z)).mul(4)).mul(2))))
          .add(e.z.mul(float(1).sub(abs(x.mul(xx.mul(xx).sub(xx.mul(zz).mul(10)).add(zz.mul(zz).mul(5)))).mul(2))))
          .add(e.w.mul(float(1).sub(abs(z.mul(xx.mul(xx).mul(5).sub(xx.mul(zz).mul(10)).add(zz.mul(zz)))).mul(2))))
          .mul(0.6),
      );
    return d.sub(c.w.mul(float(1).add(s.mul(CRATER_ROUGH)))) as unknown as THREE.Node<'float'>;
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
    for (let i = 0; i < this.n; i++) {
      (this.list.array[i] as THREE.Vector4).set(0, -1000, 0, 0);
      (this.shapeA.array[i] as THREE.Vector4).set(0, 0, 0, 0);
      (this.shapeB.array[i] as THREE.Vector4).set(0, 0, 0, 0);
      (this.shapeC.array[i] as THREE.Vector4).set(0, 0, 0, 0);
    }
    this.n = 0;
    this.count.value = 0;
  }

  /** The test every cut material shares (one node: materials that differ only in their numbers share a shader). */
  private mask: THREE.Node<'bool'> | null = null;

  /** True on the wall of a crater (a fragment about as far from its middle as its radius). */
  onWall(): THREE.Node<'bool'> {
    return Fn(() => {
      const on = bool(false).toVar();
      Loop(this.count, ({ i }) => {
        const d = this.gap(i as unknown as THREE.Node<'int'>).toVar();
        If(d.greaterThan(-WALL_IN).and(d.lessThan(WALL_OUT)), () => {
          on.assign(true);
        });
      });
      return on;
    })() as unknown as THREE.Node<'bool'>;
  }

  /** Make `material` drop its fragments inside the craters (in colour and in the shadow pass). */
  cut<M extends THREE.NodeMaterial>(material: M): M {
    const count = this.count;
    this.mask ??= Fn(() => {
      const keep = bool(true).toVar();
      Loop(count, ({ i }) => {
        If(this.gap(i as unknown as THREE.Node<'int'>).lessThan(0), () => {
          keep.assign(false);
        });
      });
      return keep;
    })() as unknown as THREE.Node<'bool'>;
    material.maskNode = this.mask;
    // (through a hole, the far side of the part shows from inside; its shadow stays as it was)
    if (material.side === THREE.FrontSide && !material.transparent) {
      material.side = THREE.DoubleSide;
      material.shadowSide ??= THREE.BackSide;
    }
    if (material.side === THREE.DoubleSide && !material.transparent) {
      // (and that inside is what it is broken open to: dull and grainy, not its outside's gloss)
      const grit = vec3(0.1, 0.093, 0.085).mul(float(1).add(mx_noise_float(positionWorld.mul(2.4)).mul(0.4)).add(mx_noise_float(positionWorld.mul(8.1)).mul(0.2)));
      const m = material as unknown as { colorNode: THREE.Node | null; roughnessNode?: THREE.Node | null; metalnessNode?: THREE.Node | null };
      m.colorNode = select(frontFacing, m.colorNode ?? materialColor, grit) as unknown as THREE.Node;
      if ('roughnessNode' in m) m.roughnessNode = select(frontFacing, m.roughnessNode ?? materialRoughness, float(0.95)) as unknown as THREE.Node;
    }
    return material;
  }
}
