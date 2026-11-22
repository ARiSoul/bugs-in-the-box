import * as THREE from 'three/webgpu';
import { abs, float, fract, length, mix, mx_noise_float, positionLocal, positionWorld, smoothstep, vec2, vec3 } from 'three/tsl';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import { Craters } from './craters';

/**
 * The microwave's render-only parts: the turntable (glass plate, roller ring, drive coupler), which turns
 * with the match, and perforated sheets (the cavity's vents, the door's screen).
 *
 * The plate's own craters live in the plate's frame (the plate's mesh turns, its holes turn with it, as the
 * grid cylinder under it turns in gameplay). Every other part uses the world's craters.
 */
export class MicrowaveParts {
  private readonly group = new THREE.Group();
  private readonly pieces: THREE.Object3D[] = [];
  /** The plate and the coupler turn with the turntable; the ring at half its speed (it rolls under it). */
  private plate: THREE.Group | null = null;
  private ring: THREE.Group | null = null;
  private axis = new THREE.Vector3();
  private turns = 0;
  /** Craters in the plate's own frame (positionLocal of the plate's meshes). */
  private readonly plateCraters = new Craters(positionLocal);
  private plateRadius = 0;
  private plateTop = 0;
  private readonly perforatedMaterials = new Map<string, THREE.MeshStandardNodeMaterial>();

  constructor(
    scene: THREE.Scene,
    private readonly craters: Craters,
  ) {
    scene.add(this.group);
  }

  setLayout(layout: SceneLayout): void {
    for (const p of this.pieces) {
      this.group.remove(p);
      p.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.pieces.length = 0;
    this.plate = null;
    this.ring = null;
    this.turns = 0;
    this.plateCraters.clear();
    for (const f of layout.features) {
      if (f.kind === 'turntable') this.addTurntable(f);
      else if (f.kind === 'perforated') this.addPerforated(f);
      else if (f.kind === 'marble') this.addMarble(f);
      else if (f.kind === 'blower') this.addBlower(f);
    }
  }

  /** The turntable's turn, in quarter turns (+x towards +z, as the gameplay grid turns). */
  setTurns(turns: number): void {
    this.turns = turns;
    const a = -turns * (Math.PI / 2);
    if (this.plate) this.plate.rotation.y = a;
    if (this.ring) this.ring.rotation.y = a / 2;
  }

  /** An explosion: if it reaches the plate, it is kept in the plate's frame (it turns with it from now on). */
  addCrater(x: number, y: number, z: number, radius: number): void {
    if (!this.plate) return;
    const dx = x - this.axis.x;
    const dz = z - this.axis.z;
    const reach = this.plateRadius + radius;
    if (dx * dx + dz * dz > reach * reach || Math.abs(y - this.plateTop) > radius + 2) return;
    // into the plate's frame: undo its turn so far
    const a = this.turns * (Math.PI / 2);
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.plateCraters.add(dx * c + dz * s, y - this.axis.y, -dx * s + dz * c, radius);
  }

  private addTurntable(f: Feature): void {
    const r = f.radius;
    const [ringR, floorY] = f.path;
    this.plateRadius = r;
    this.plateTop = f.y;
    this.axis.set(f.x, f.y, f.z);
    const m = (color: number, metalness: number, roughness: number, cut = true): THREE.MeshStandardNodeMaterial => {
      const mat = new THREE.MeshStandardNodeMaterial({ color, metalness, roughness });
      return cut ? this.craters.cut(mat) : mat;
    };
    // the plate: thick, faintly green glass with a raised rim and a ring of moulded bumps underneath
    const glass = this.plateCraters.cut(new THREE.MeshStandardNodeMaterial({ color: 0xf2f6f3, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.2, depthWrite: false }));
    const edge = this.plateCraters.cut(new THREE.MeshStandardNodeMaterial({ color: 0xa9cdb6, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.5, depthWrite: false }));
    const plate = new THREE.Group();
    plate.position.set(f.x, f.y, f.z);
    // (top and bottom faces clear; the side band only faintly green, with a thin dark line at its foot)
    const sideMat = this.plateCraters.cut(new THREE.MeshStandardNodeMaterial({ color: 0xb9d7c3, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.26, depthWrite: false }));
    const lineMat = this.plateCraters.cut(new THREE.MeshStandardNodeMaterial({ color: 0x3d4f46, metalness: 0, roughness: 0.3, transparent: true, opacity: 0.6, depthWrite: false }));
    const disc = new THREE.Group();
    const topFace = new THREE.Mesh(new THREE.CircleGeometry(r, 96).rotateX(-Math.PI / 2), glass);
    const bottomFace = new THREE.Mesh(new THREE.CircleGeometry(r - 0.4, 96).rotateX(Math.PI / 2), glass);
    bottomFace.position.y = -1.6;
    const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r - 0.4, 1.6, 96, 1, true), sideMat);
    side.position.y = -0.8;
    const foot = new THREE.Mesh(new THREE.TorusGeometry(r - 0.4, 0.06, 6, 96), lineMat);
    foot.rotation.x = Math.PI / 2;
    foot.position.y = -1.6;
    disc.add(topFace, bottomFace, side, foot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r - 0.45, 0.45, 12, 96), edge);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    const groove = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.35, 8, 96), edge);
    groove.rotation.x = Math.PI / 2;
    groove.position.y = -1.6;
    plate.add(disc, rim, groove);
    // the coupler: a three-lobed hub under the plate's centre, turning with it
    const plastic = m(0x2b2c2e, 0, 0.5, false);
    // (a centre boss and three rounded lobes reaching out from it, a third of a turn apart)
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1.6, 32), plastic);
    boss.position.y = -2.4;
    plate.add(boss);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i * 2 * Math.PI) / 3;
      const lobe = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 2.6, 8, 16), plastic);
      lobe.rotation.z = Math.PI / 2;
      lobe.position.set(2.4, -2.4, 0);
      arm.add(lobe);
      plate.add(arm);
    }
    // the roller ring: a thin plastic ring with three wheels, on the cavity floor (it rolls at half speed)
    const ring = new THREE.Group();
    ring.position.set(f.x, floorY, f.z);
    const ringMat = m(0x3a3c3f, 0, 0.55);
    const band = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.35, 8, 96), ringMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.6;
    ring.add(band);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 1.2, 32), ringMat);
    hub.position.y = 0.6;
    ring.add(hub);
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(ringR, 0.5, 0.7), ringMat);
      spoke.position.set((Math.cos(a) * ringR) / 2, 0.6, (Math.sin(a) * ringR) / 2);
      spoke.rotation.y = -a;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.7, 28), ringMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.rotation.y = -a;
      wheel.position.set(Math.cos(a) * ringR, 1.1, Math.sin(a) * ringR);
      ring.add(spoke, wheel);
    }
    for (const g of [plate, ring]) {
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          // (the glass neither casts nor takes hard shadows: a shadow edge across it reads as a seam)
          const clear = o.material === glass || o.material === edge || o.material === sideMat || o.material === lineMat;
          o.castShadow = !clear;
          o.receiveShadow = !clear;
        }
      });
      this.push(g);
    }
    this.plate = plate;
    this.ring = ring;
    this.setTurns(this.turns);
  }

  /** A perforated sheet: a thin plate with a grid of round holes (dark), across `axis`; optionally tilted. */
  private addPerforated(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const pitch = f.radius;
    const key = `${f.color}|${pitch}|${f.axis}`;
    let mat = this.perforatedMaterials.get(key);
    if (!mat) {
      mat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ metalness: 0.3, roughness: 0.5 }));
      const p = positionLocal;
      const uv = f.axis === 0 ? vec2(p.y, p.z) : f.axis === 1 ? vec2(p.x, p.z) : vec2(p.x, p.y);
      const cell = fract(uv.div(pitch)).sub(0.5);
      // (holes on a staggered grid: offset every other row by half a pitch)
      const row = fract(uv.y.div(pitch * 2)).greaterThan(0.5);
      const cellX = abs(fract(uv.x.div(pitch).add(row.select(float(0.5), float(0)))).sub(0.5));
      const d = length(vec2(cellX, cell.y));
      const hole = smoothstep(0.3, 0.24, d);
      const base = new THREE.Color(f.color);
      mat.colorNode = mix(vec3(base.r, base.g, base.b), vec3(0.015, 0.015, 0.017), hole);
      this.perforatedMaterials.set(key, mat);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (f.path.length === 2) mesh.rotation.x = Math.atan2(f.path[1], f.path[0]);
    mesh.receiveShadow = true;
    this.push(mesh);
  }

  /** A polished marble sheet: warm white with fine, wandering grey veins (in world space: sheets join up). */
  private addMarble(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const mat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.32 }));
    const p = positionWorld;
    // (main veins: long, mostly diagonal, their width swelling and thinning along them; fine hairline
    // branches in a second direction; a very faint cloud)
    const warp = mx_noise_float(p.mul(0.018)).mul(9).add(mx_noise_float(p.mul(0.07)).mul(1.6));
    const u = p.x.mul(0.7).add(p.z.mul(0.7)).add(p.y.mul(0.5)).add(warp);
    const dMain = abs(fract(u.div(70)).sub(0.5)).mul(70);
    const width = mx_noise_float(p.mul(0.03)).mul(0.5).add(0.6).mul(1.4);
    const main = smoothstep(width, width.mul(0.15), dMain);
    const u2 = p.x.mul(-0.4).add(p.z.mul(0.9)).add(p.y.mul(0.3)).add(warp.mul(0.7)).add(mx_noise_float(p.mul(0.2)).mul(0.8));
    const dHair = abs(fract(u2.div(23)).sub(0.5)).mul(23);
    const hair = smoothstep(0.35, 0.05, dHair).mul(smoothstep(0.1, 0.5, mx_noise_float(p.mul(0.04))));
    const vein = main.mul(1).add(hair.mul(0.3));
    const cloud = mx_noise_float(p.mul(0.025)).mul(0.018);
    mat.colorNode = mix(vec3(0.87, 0.865, 0.85).add(cloud), vec3(0.47, 0.48, 0.5), vein.clamp(0, 1));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    this.push(mesh);
  }

  /** A fan's impeller in its shroud: a hub, seven swept blades and a wire guard in front. */
  private addBlower(f: Feature): void {
    const g = new THREE.Group();
    g.position.set(f.x, f.y, f.z);
    if (f.axis === 0) g.rotation.y = Math.PI / 2;
    else if (f.axis === 1) g.rotation.x = -Math.PI / 2;
    const r = f.radius;
    const blade = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: 0.1, roughness: 0.5 }));
    const metal = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: 0x8f9398, metalness: 0.85, roughness: 0.35 }));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.26, r * 0.28, 1.6, 32), blade);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.72, r * 0.3, 0.25), blade);
      const pivot = new THREE.Group();
      pivot.rotation.z = (i * 2 * Math.PI) / 7;
      b.position.x = r * 0.6;
      b.rotation.x = 0.55; // (pitched: the blades are swept)
      b.rotation.z = 0.25;
      pivot.add(b);
      g.add(pivot);
    }
    for (const k of [-0.5, 0, 0.5]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2 * r * Math.sqrt(1 - k * k), 8), metal);
      bar.position.set(r * k, 0, 1.1);
      g.add(bar);
    }
    const ringG = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.14, 8, 64), metal);
    ringG.position.z = 1.1;
    g.add(ringG);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.push(g);
  }

  private push(object: THREE.Object3D): void {
    this.group.add(object);
    this.pieces.push(object);
  }
}
