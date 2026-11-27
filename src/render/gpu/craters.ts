import * as THREE from 'three/webgpu';
import { Fn, If, Loop, abs, bool, clamp, float, frontFacing, length, materialColor, materialRoughness, max, mix, mx_noise_float, positionWorld, select, smoothstep, uniform, uniformArray, vec3 } from 'three/tsl';

/** The grey of ash on what is drawn (linear). */
const ASH_GREY = vec3(0.1, 0.095, 0.088);
import { CRATER_MAX, CRATER_MIN, CRATER_ROUGH, CRATER_WEIGHTS, craterShape } from '../../terrain/crater';

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
        e.x.mul(float(1).sub(abs(xx.sub(zz)).mul(2)))
          .add(e.y.mul(float(1).sub(abs(x.mul(z).mul(2)).mul(2))))
          .add(e.z.mul(0.6).mul(float(1).sub(abs(x.mul(xx.sub(zz.mul(3)))).mul(2))))
          .add(e.w.mul(0.6).mul(float(1).sub(abs(z.mul(xx.mul(3).sub(zz))).mul(2))))
          .mul(0.6)
          .mul(float(1).add(a.w.mul(x).add(b.w.mul(z)).mul(0.85))),
      );
    return d.sub(c.w.mul(clamp(float(1).add(s.mul(CRATER_ROUGH)), CRATER_MIN, CRATER_MAX))) as unknown as THREE.Node<'float'>;
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

  /** How much ash lies here (0..1): thick at a crater's rim, thinning out to about 1.8 of its radius, in streaks. */
  private ashNode: THREE.Node<'float'> | null = null;
  private ash(): THREE.Node<'float'> {
    this.ashNode ??= Fn(() => {
      const most = float(0).toVar();
      Loop(this.count, ({ i }) => {
        const c = this.list.element(i) as unknown as THREE.Node<'vec4'>;
        const k = this.gap(i as unknown as THREE.Node<'int'>).div(c.w.max(0.01));
        const v = this.position.sub(c.xyz);
        // (streaks out from its middle)
        const streak = mx_noise_float(vec3(v.x.div(length(v).max(0.01)).mul(9), 0, v.z.div(length(v).max(0.01)).mul(9))).mul(0.5).add(0.6);
        most.assign(max(most, smoothstep(0.8, 0, k).mul(streak).mul(0.75)));
      });
      return most;
    })() as unknown as THREE.Node<'float'>;
    return this.ashNode;
  }

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
      const outside = (m.colorNode ?? materialColor) as unknown as THREE.Node<'vec3'>;
      m.colorNode = select(frontFacing, mix(outside, ASH_GREY.mul(float(0.8).add(mx_noise_float(positionWorld.mul(1.7)).mul(0.4))), this.ash()), grit) as unknown as THREE.Node;
      if ('roughnessNode' in m) m.roughnessNode = select(frontFacing, m.roughnessNode ?? materialRoughness, float(0.95)) as unknown as THREE.Node;
    }
    return material;
  }
}
