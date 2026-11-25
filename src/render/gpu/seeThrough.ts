import * as THREE from 'three/webgpu';
import { Fn, If, bool, cameraPosition, clamp, float, fract, frontFacing, length, mix, positionWorld, screenCoordinate, smoothstep, uniform } from 'three/tsl';

type F = THREE.Node<'float'>;
type B = THREE.Node<'bool'>;

/** How wide the way to the bug is kept free: round the bug itself, and more towards the camera (per unit). */
const ROUND = 1.5;
const WIDER = 0.3;
const WIDEST = 9;
/** What lies this much nearer than the bug is in the way. */
const BEFORE = 1.3;
/** How much of a surface is left where it is seen through: thin slanted lines. */
const LEFT = 0.08;
/** Pixels from one line to the next. */
const PITCH = 9;
/** Seconds to fade. */
const FADE = 0.16;

/**
 * What stands between the camera and a bug is drawn as thin lines, so the bug is seen through it and one still knows that
 * something is there. Every lit, opaque material of the map gets it (colour only: shadows stay whole).
 */
export class SeeThrough {
  private readonly at = uniform(new THREE.Vector3());
  private readonly amount = uniform(0);
  /** Something is seen through now. */
  get on(): boolean {
    return this.amount.value > 0.3;
  }

  private readonly done = new WeakSet<THREE.Material>();
  private readonly masks = new Map<THREE.Node | null, B>();
  private readonly whole = bool(true) as unknown as B;

  /** Follow: where the bug is, and whether something is in the way of it. */
  update(point: THREE.Vector3, hidden: boolean, dt: number): void {
    this.at.value.copy(point);
    const k = 1 - Math.exp(-dt / FADE);
    this.amount.value += ((hidden ? 1 : 0) - this.amount.value) * k;
    if (!hidden && this.amount.value < 0.003) this.amount.value = 0;
  }

  /** Give it to every material under `root` (but not under `skip`). */
  apply(root: THREE.Object3D, skip: readonly THREE.Object3D[]): void {
    if (skip.includes(root)) return;
    const mesh = root as THREE.Mesh;
    if (mesh.isMesh) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.give(m);
    for (const c of root.children) this.apply(c, skip);
  }

  give(material: THREE.Material): void {
    const m = material as THREE.NodeMaterial & { isMeshStandardNodeMaterial?: boolean; isMeshPhysicalNodeMaterial?: boolean };
    if (!m || this.done.has(m) || !(m.isMeshStandardNodeMaterial || m.isMeshPhysicalNodeMaterial) || m.transparent) return;
    this.done.add(m);
    const was = m.maskNode as THREE.Node | null;
    m.maskShadowNode ??= was ?? (this.whole as unknown as THREE.Node);
    let mask = this.masks.get(was);
    // (one node for all that had the same: they share their shaders)
    if (!mask) this.masks.set(was, (mask = this.mask(was as B | null)));
    m.maskNode = mask as unknown as THREE.Node;
    m.needsUpdate = true;
  }

  private mask(was: B | null): B {
    return Fn(() => {
      const keep = (was ?? bool(true)).toVar();
      If(this.amount.greaterThan(0.01), () => {
        const way = this.at.sub(cameraPosition);
        const far = length(way);
        const dir = way.div(far);
        const rel = positionWorld.sub(cameraPosition);
        const along = rel.dot(dir);
        const before = far.sub(along) as unknown as F;
        If(before.greaterThan(BEFORE), () => {
          const off = length(rel.sub(dir.mul(along)));
          const wide = clamp(before.mul(WIDER).add(ROUND), 0, WIDEST);
          // (a back that faces the camera: it is inside of something, or under the ground)
          const back = frontFacing.select(float(0), float(1)) as unknown as F;
          const open = clamp(smoothstep(wide, wide.mul(0.62), off).add(back.mul(smoothstep(wide.mul(2.4), wide.mul(1.4), off))), 0, 1).mul(this.amount);
          const line = fract(screenCoordinate.x.add(screenCoordinate.y).div(PITCH));
          keep.assign(keep.and(line.lessThan(mix(float(1.01), float(LEFT), open))));
        });
      });
      return keep;
    })() as unknown as B;
  }
}
