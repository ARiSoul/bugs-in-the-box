import * as THREE from 'three/webgpu';
import { abs, cameraPosition, clamp, dot, float, length, mrt, mx_noise_float, normalize, positionWorld, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl';
import { POST_LAYER } from './atmosphere';

/** Brightness of the light sheets (additive, before tone mapping). */
const SHEET_GLOW = 0.03;

/**
 * Visible shafts of light in the dusty air: one soft, additive sheet per gap between the window blinds,
 * running from the glass down to the floor along the light. Seen edge-on a sheet looks like a bright
 * shaft (the light path through it is long); seen face-on it fades to a faint veil. Ends, edges and the
 * air near the camera fade out, and a slow noise breaks it up like dust. Render-only; adds to the
 * ray-marched god rays, which give the overall warm veil but average the sheets away from most views.
 */
export class LightSheets {
  private readonly group = new THREE.Group();
  private readonly material: THREE.MeshBasicNodeMaterial;
  private readonly normal = uniform(new THREE.Vector3(1, 0, 0));
  readonly strength = uniform(SHEET_GLOW);
  /** Inside of the case on the floor plane (x0, z0, x1, z1): the sheets stop at the walls. */
  private readonly room = uniform(new THREE.Vector4(0, 0, 1, 1));

  constructor(
    scene: THREE.Scene,
    color: THREE.Color,
    time: THREE.Node<'float'>,
  ) {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.fog = false;
    // transparent: leave the emissive buffer (bloom input) as it is under it, or the glow behind is wiped
    m.mrtNode = mrt({ emissive: vec4(0, 0, 0, 0) });
    const view = normalize(cameraPosition.sub(positionWorld));
    // edge-on: long path through the sheet
    const edgeOn = clamp(float(0.1).div(abs(dot(this.normal, view)).add(0.12)), 0, 0.8);
    const t = uv();
    const ends = smoothstep(0, 0.25, t.y).mul(smoothstep(1, 0.45, t.y)); // y: 0 at the floor, 1 at the glass
    const sides = smoothstep(0, 0.2, t.x).mul(smoothstep(1, 0.8, t.x)); // x: along the case depth
    const near = smoothstep(6, 30, length(cameraPosition.sub(positionWorld)));
    const r = this.room;
    const inside = smoothstep(r.x, r.x.add(4), positionWorld.x).mul(smoothstep(r.z, r.z.sub(4), positionWorld.x));
    const dust = mx_noise_float(vec3(positionWorld.mul(0.06)).add(vec3(0, time.mul(0.05), 0))).mul(0.35).add(0.75);
    m.colorNode = vec3(color.r, color.g, color.b).mul(this.strength).mul(edgeOn).mul(ends).mul(sides).mul(near).mul(inside).mul(dust);
    this.material = m;
    scene.add(this.group);
  }

  /**
   * Sheets for the gaps between slats at x = firstX + (i + 0.5) * pitch, at height `blindsY`,
   * for light travelling along -`toSun`, across the case depth z0..z1, from the glass down to `floorY`.
   */
  set(firstX: number, pitch: number, blindsY: number, toSun: THREE.Vector3, x0: number, x1: number, z0: number, z1: number, glassY: number, floorY: number): void {
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.group.clear();
    const d = toSun.clone().normalize();
    // plane of each sheet: spanned by z and the light direction
    this.normal.value.set(0, 0, 1).cross(d).normalize();
    this.room.value.set(x0, z0, x1, z1);
    const topT = (blindsY - glassY) / d.y;
    const botT = (blindsY - floorY) / d.y;
    for (let i = 0; ; i++) {
      const gx = firstX + (i + 0.5) * pitch;
      if (gx - d.x * topT > x1 + 20) break;
      // where the sheet meets the glass and the floor
      const topX = gx - d.x * topT;
      const botX = gx - d.x * botT;
      if (Math.max(topX, botX) < x0 || Math.min(topX, botX) > x1) continue;
      const g = new THREE.BufferGeometry();
      const z = [z0, z1];
      const pos = new Float32Array([botX, floorY, z[0], botX, floorY, z[1], topX, glassY, z[0], topX, glassY, z[1]]);
      const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(g, this.material);
      mesh.layers.set(POST_LAYER);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      this.group.add(mesh);
    }
  }
}
