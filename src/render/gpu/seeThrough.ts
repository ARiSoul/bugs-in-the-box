import * as THREE from 'three/webgpu';
import { Fn, If, bool, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, float, fract, frontFacing, length, max, min, mix, positionWorld, screenCoordinate, screenSize, smoothstep, step, uniform, vec2, vec4 } from 'three/tsl';

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
/** Below the bug's feet by this, and lower than the camera, nothing is in the way (the ground it stands on, seen from above). */
const UNDER = 0.9;
/** Looking straight up, it is this much wider again; round where the aim goes. */
const UP_WIDER = 2.2;
const AHEAD_ROUND = 4;
/** A bug under the ground (in a tunnel, digging): only round it, this wide, and more of the ground left (ghosted). */
const UNDER_ROUND = 4;
const UNDER_LEFT = 0.09;
/** Right over it, this far round, nothing is left at all (no lines across the bug). */
const UNDER_CLEAR = 1.1;

/**
 * What stands between the camera and a bug is drawn as thin lines, so the bug is seen through it and one still knows that
 * something is there. Every lit, opaque material of the map gets it (colour only: shadows stay whole).
 */
export class SeeThrough {
  private readonly at = uniform(new THREE.Vector3());
  private readonly amount = uniform(0);
  /** Where the aim goes (a way kept free to it too), and how much wider all of it is (looking up from under something). */
  private readonly ahead = uniform(new THREE.Vector3());
  private readonly wider = uniform(1);
  /** 1: the bug is under the ground (only round it, ghosted); 0: as usual. */
  private readonly under = uniform(0);
  /** Something is seen through now. */
  get on(): boolean {
    return this.amount.value > 0.3;
  }

  private readonly done = new WeakSet<THREE.Material>();
  private readonly masks = new Map<THREE.Node | null, B>();
  private readonly whole = bool(true) as unknown as B;

  /** Follow: where the bug is, where its aim goes, how far up the view looks (0..1), whether something is in the way. */
  update(point: THREE.Vector3, ahead: THREE.Vector3, up: number, hidden: boolean, dt: number, under = false): void {
    this.at.value.copy(point);
    this.under.value += ((under ? 1 : 0) - this.under.value) * (1 - Math.exp(-dt / FADE));
    this.ahead.value.copy(ahead);
    this.wider.value += (1 + UP_WIDER * Math.max(0, up) - this.wider.value) * (1 - Math.exp(-dt / FADE));
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

  /** How open a fragment is on the way from the camera to `to` (0..1), with a way this wide round `to`. */
  private open(to: THREE.Node<'vec3'>, round: number): F {
    const way = to.sub(cameraPosition);
    const far = length(way);
    const dir = way.div(far);
    const rel = positionWorld.sub(cameraPosition);
    const along = rel.dot(dir);
    const before = far.sub(along) as unknown as F;
    const off = length(rel.sub(dir.mul(along)));
    const wide = mix(clamp(before.mul(WIDER).add(round), 0, WIDEST).mul(this.wider), float(UNDER_ROUND), this.under);
    // (a back that faces the camera: it is inside of something, or under the ground)
    const back = frontFacing.select(float(0), float(1)) as unknown as F;
    const o = clamp(smoothstep(wide, wide.mul(0.62), off).add(back.mul(smoothstep(wide.mul(2.4), wide.mul(1.4), off))), 0, 1);
    return o.mul(step(BEFORE, before)) as unknown as F;
  }

  private mask(was: B | null): B {
    return Fn(() => {
      const keep = (was ?? bool(true)).toVar();
      If(this.amount.greaterThan(0.01), () => {
        const low = step(min(this.at.y, cameraPosition.y).sub(UNDER), positionWorld.y);
        const ahead = this.open(this.ahead as unknown as THREE.Node<'vec3'>, AHEAD_ROUND).mul(float(1).sub(this.under));
        // (a bug under the ground: one round disc on the screen round it, whatever stands over it, chips or slopes)
        const at = this.at as unknown as THREE.Node<'vec3'>;
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(at, 1));
        const ndc = clip.xy.div(clip.w);
        const px = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5))).mul(screenSize);
        const focal = (cameraProjectionMatrix as unknown as { element(i: number): THREE.Node<'vec4'> }).element(1).y;
        const rpx = float(UNDER_ROUND).div(clip.w).mul(focal).mul(screenSize.y).mul(0.5) as unknown as F;
        const dpx = length(screenCoordinate.xy.sub(px)) as unknown as F;
        const way = at.sub(cameraPosition);
        const before = length(way).sub(positionWorld.sub(cameraPosition).dot(way.div(length(way))));
        const nearer = step(BEFORE * 0.5, before) as unknown as F;
        const disc = smoothstep(rpx, rpx.mul(0.86), dpx).mul(nearer) as unknown as F;
        const open = mix(max(this.open(at, ROUND), ahead).mul(low), disc, this.under).mul(this.amount);
        const line = fract(screenCoordinate.x.add(screenCoordinate.y).div(PITCH));
        keep.assign(keep.and(line.lessThan(mix(float(1.01), mix(float(LEFT), float(UNDER_LEFT), this.under), open))));
        // (right over a bug under the ground, nothing at all: no lines across it)
        If(this.under.greaterThan(0.5).and(this.amount.greaterThan(0.3)).and(dpx.lessThan(rpx.mul(UNDER_CLEAR / UNDER_ROUND))).and(nearer.greaterThan(0.5)), () => {
          keep.assign(false);
        });
      });
      return keep;
    })() as unknown as B;
  }
}
