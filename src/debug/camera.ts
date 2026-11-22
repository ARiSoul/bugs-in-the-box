import * as THREE from 'three';
import type { CameraKey } from './views';

/**
 * A closed camera path through keys (centripetal Catmull-Rom for both the position and the look-at
 * point), flown at constant speed per segment. `at(seconds)` is a pure function of time, so a frame at
 * a given time is the same on every run.
 */
export class CameraPath {
  private readonly look: THREE.CatmullRomCurve3;
  /** Camera positions along the loop (even speed), lifted clear of the terrain, xyz per sample. */
  private readonly table: Float32Array;

  /**
   * `field`: the terrain. Where the curve between the keys would pass through or graze terrain (a tube
   * bridge, a wall), the path is lifted until it keeps CLEARANCE units from it, and the lift is
   * smoothed along the path so the camera never jumps.
   */
  constructor(
    keys: readonly CameraKey[],
    readonly duration: number,
    field?: { sample(x: number, y: number, z: number): number },
  ) {
    const pos = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.p)), true, 'centripetal');
    this.look = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.t)), true, 'centripetal');
    const n = PATH_SAMPLES;
    this.table = new Float32Array((n + 1) * 3);
    const lift = new Float32Array(n);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      pos.getPointAt(i / n, p);
      this.table[i * 3] = p.x;
      this.table[i * 3 + 1] = p.y;
      this.table[i * 3 + 2] = p.z;
      if (!field) continue;
      let l = 0;
      while (l < 60 && field.sample(p.x, p.y + l, p.z) < CLEARANCE) l += 0.5;
      lift[i] = l;
    }
    // smooth the lift: widest lift nearby first (so it starts rising before the obstacle), then average
    const W = 30;
    const wide = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -W; k <= W; k++) m = Math.max(m, lift[(i + k + n) % n]);
      wide[i] = m;
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -W; k <= W; k++) sum += wide[(i + k + n) % n];
      this.table[i * 3 + 1] += sum / (2 * W + 1);
    }
    this.table.copyWithin(n * 3, 0, 3); // closed loop
  }

  /** Camera at time `seconds` (loops). No allocations. */
  at(seconds: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
    const u = (((seconds / this.duration) % 1) + 1) % 1;
    const f = u * PATH_SAMPLES;
    const i = Math.floor(f);
    const k = f - i;
    const t = this.table;
    camera.position.set(
      t[i * 3] + (t[i * 3 + 3] - t[i * 3]) * k,
      t[i * 3 + 1] + (t[i * 3 + 4] - t[i * 3 + 1]) * k,
      t[i * 3 + 2] + (t[i * 3 + 5] - t[i * 3 + 2]) * k,
    );
    this.look.getPoint(u, target);
    camera.lookAt(target);
  }
}

/** Samples of the fly-through table (60 s at 60 fps = 3600 frames). */
const PATH_SAMPLES = 2400;
/** Distance the fly-through keeps from any terrain. */
const CLEARANCE = 9;

const SPEED = 30; // units per second
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyR']);

/**
 * Free debug camera: WASD move, Q/E down/up, mouse look (pointer lock: click the canvas), Shift fast,
 * Ctrl slow, mouse wheel changes the speed, R back to the start. Only for inspection; the game camera
 * is the orbit/follow camera. No allocations per frame.
 */
export class FlyCamera {
  private readonly held = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private speedScale = 1;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    private readonly start: CameraKey,
  ) {
    this.reset();
    window.addEventListener('keydown', (e) => {
      if (!MOVE_KEYS.has(e.code)) return;
      e.preventDefault();
      if (e.code === 'KeyR') this.reset();
      else this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0022));
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.speedScale = Math.max(0.1, Math.min(10, this.speedScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      },
      { passive: false },
    );
  }

  /** Back to the start pose. */
  reset(): void {
    const [px, py, pz] = this.start.p;
    const [tx, ty, tz] = this.start.t;
    this.camera.position.set(px, py, pz);
    const dx = tx - px;
    const dy = ty - py;
    const dz = tz - pz;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
  }

  update(dt: number): void {
    const h = this.held;
    let speed = SPEED * this.speedScale;
    if (h.has('ShiftLeft') || h.has('ShiftRight')) speed *= 3;
    if (h.has('ControlLeft') || h.has('ControlRight')) speed *= 0.25;
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
    this.fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const f = (h.has('KeyW') ? 1 : 0) - (h.has('KeyS') ? 1 : 0);
    const r = (h.has('KeyD') ? 1 : 0) - (h.has('KeyA') ? 1 : 0);
    const u = (h.has('KeyE') ? 1 : 0) - (h.has('KeyQ') ? 1 : 0);
    const step = speed * dt;
    this.camera.position.addScaledVector(this.fwd, f * step).addScaledVector(this.right, r * step);
    this.camera.position.y += u * step;
  }
}

/** Put the camera on a fixed pose. */
export function applyPose(camera: THREE.PerspectiveCamera, k: CameraKey): void {
  camera.position.set(k.p[0], k.p[1], k.p[2]);
  camera.lookAt(k.t[0], k.t[1], k.t[2]);
}
