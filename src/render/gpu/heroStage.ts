import * as THREE from 'three/webgpu';
import { abs, color, float, floor, fract, hash, max, min, mix, mx_noise_float, positionWorld, screenUV, select, smoothstep, step, uniform, vec3 } from 'three/tsl';

type F = THREE.Node<'float'>;
type V3 = THREE.Node<'vec3'>;

/** Half the width of a trace, in cells. */
const TRACE = 0.085;
const SPARKS = 70;

/** What a floor is made of: its colour, how rough it is, and where the teams' light runs in it. */
interface Floor {
  base: V3;
  rough: F;
  lines: F;
}

const noise = (s: number): F => mx_noise_float(positionWorld.mul(s)) as unknown as F;

/** Each map's floor. */
const FLOORS: Record<string, () => Floor> = {
  'pc-case': () => {
    // a circuit board: in each cell a trace across it, one along it, a bend, or a cross; a round pad at some
    const p = positionWorld.xz.mul(1.15);
    const cell = floor(p);
    const f = fract(p).sub(0.5);
    const kind = hash(cell.x.add(200).mul(127).add(cell.y.add(200).mul(311)));
    const across = smoothstep(TRACE, TRACE * 0.6, abs(f.y));
    const along = smoothstep(TRACE, TRACE * 0.6, abs(f.x));
    const bend = smoothstep(TRACE, TRACE * 0.6, abs(abs(f.x.add(f.y)).sub(0.5)).mul(0.707));
    const trace = select(kind.lessThan(0.5), across, select(kind.lessThan(0.64), along, select(kind.lessThan(0.82), bend, max(across, along)))) as unknown as F;
    const r = f.length();
    const pad = smoothstep(0.24, 0.21, r).mul(step(0.82, kind));
    const hole = smoothstep(0.11, 0.09, r).mul(step(0.82, kind));
    const base = mix(mix(vec3(0.006, 0.014, 0.012), vec3(0.014, 0.026, 0.022), hash(cell.x.add(300).add(cell.y.add(300).mul(13)))), vec3(0.16, 0.075, 0.03), max(trace.mul(0.75), pad)).mul(hole.oneMinus()) as unknown as V3;
    return { base, rough: mix(float(0.78), float(0.5), trace) as unknown as F, lines: max(trace, pad.mul(0.5)).mul(hole.oneMinus()) as unknown as F };
  },
  speaker: () => {
    // damping felt, quilted
    const p = positionWorld.xz.mul(0.62);
    const q = fract(p.x.add(p.y)).sub(0.5);
    const r = fract(p.x.sub(p.y)).sub(0.5);
    const seam = max(smoothstep(0.035, 0.012, abs(q)), smoothstep(0.035, 0.012, abs(r))) as unknown as F;
    const puff = abs(q).min(abs(r)).mul(1.6);
    const base = vec3(0.05, 0.043, 0.04).mul(noise(22).mul(0.35).add(0.8)).mul(puff.add(0.5)) as unknown as V3;
    return { base, rough: float(0.95) as unknown as F, lines: seam.mul(0.8) as unknown as F };
  },
  fridge: () => {
    // a glass shelf with frost on it, cracked by the cold
    const crack = smoothstep(0.05, 0.0, abs(noise(0.75).add(noise(2.3).mul(0.25)))) as unknown as F;
    const frost = smoothstep(-0.1, 0.5, noise(1.1).add(noise(5).mul(0.4))) as unknown as F;
    const base = mix(vec3(0.05, 0.1, 0.125), vec3(0.2, 0.27, 0.31), frost.mul(0.5).add(noise(30).mul(0.05))) as unknown as V3;
    return { base, rough: mix(float(0.2), float(0.8), frost) as unknown as F, lines: crack.mul(0.75) as unknown as F };
  },
  microwave: () => {
    // the turntable's glass: rings, and a spoke at every twelfth
    const r = positionWorld.xz.length();
    const ring = smoothstep(0.07, 0.03, abs(fract(r.mul(0.8)).sub(0.5))) as unknown as F;
    const crumbs = step(0.62, noise(7)).mul(step(0.1, noise(0.6)));
    const base = mix(vec3(0.05, 0.055, 0.05).add(ring.mul(0.07)), vec3(0.3, 0.17, 0.05), crumbs) as unknown as V3;
    return { base, rough: float(0.22) as unknown as F, lines: ring.mul(0.8) as unknown as F };
  },
  desk: () => {
    // oiled wood, in boards
    const x = positionWorld.x;
    const z = positionWorld.z;
    const board = floor(z.mul(0.42));
    const gap = smoothstep(0.035, 0.012, abs(fract(z.mul(0.42)).sub(0.5).abs().sub(0.5))) as unknown as F;
    const grain = fract(mx_noise_float(vec3(x.mul(0.22).add(board.mul(7.3)), z.mul(2.4), board)).mul(6)) as unknown as F;
    const base = mix(vec3(0.075, 0.032, 0.013), vec3(0.19, 0.095, 0.042), grain.mul(0.75).add(hash(board.add(50)).mul(0.25))).mul(gap.mul(0.8).oneMinus()) as unknown as V3;
    return { base, rough: float(0.5) as unknown as F, lines: gap as unknown as F };
  },
  car: () => {
    // the dashboard's grained skin, a seam of stitches now and then
    const z = fract(positionWorld.z.mul(0.3));
    const stitch = smoothstep(0.02, 0.008, abs(z.sub(0.5))).mul(step(0.4, fract(positionWorld.x.mul(2.2)))) as unknown as F;
    const valley = smoothstep(0.06, 0.0, abs(z.sub(0.5))).mul(0.7);
    const base = vec3(0.034, 0.033, 0.035).mul(noise(9).mul(0.35).add(noise(24).mul(0.25)).add(1)).mul(valley.oneMinus()) as unknown as V3;
    return { base, rough: float(0.72) as unknown as F, lines: stitch as unknown as F };
  },
};

/**
 * The stage of the menus: a floor and a few things of the map's own under and round both fighters, each team's light in
 * it, dust in the air; landings, blows.
 */
export class HeroStage {
  readonly root = new THREE.Group();
  private readonly time = uniform(0);
  /** How bright each side's light is. */
  readonly power = [uniform(1), uniform(1)];
  /** Where the seam is (see `MenuLayer.seam`), and the picture's width over its height. */
  readonly seam = uniform(0);
  readonly aspect = uniform(1.8);
  private readonly fog = uniform(new THREE.Color(0x0a0a0c));
  private readonly rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicNodeMaterial; t: number }[] = [];
  private readonly dust: THREE.Points;
  private readonly sets = new Map<string, THREE.Group>();
  private readonly sparks: THREE.InstancedMesh;
  private readonly sparkV = new Float32Array(SPARKS * 6);
  private sparkT = -1;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(readonly level: number) {
    const n = 150;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.sin(i * 127.1) * 11;
      pos[i * 3 + 1] = level + Math.abs(Math.sin(i * 311.7)) * 7;
      pos[i * 3 + 2] = Math.sin(i * 74.7) * 5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsNodeMaterial({ color: 0xffc98a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 0.5), new THREE.MeshBasicNodeMaterial({ color: 0xffd890 }), SPARKS);
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    this.root.add(this.dust, this.sparks);
  }

  /** The map's own floor and things. */
  setMap(id: string): void {
    let set = this.sets.get(id);
    if (!set) {
      set = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(46, 17).rotateX(-Math.PI / 2), this.floor(FLOORS[id] ?? FLOORS['pc-case']));
      board.position.set(0, this.level, -2.2);
      board.receiveShadow = true;
      set.add(board);
      this.things(id, set);
      this.sets.set(id, set);
      this.root.add(set);
    }
    for (const g of this.sets.values()) g.visible = false;
    set.visible = true;
  }

  private floor(make: () => Floor): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, envMapIntensity: 0.35 });
    const { base, rough, lines } = make();
    // (the two sides meet along the seam, as it stands in the picture)
    const d = screenUV.x.sub(0.5).sub(this.seam).add(screenUV.y.sub(0.5).mul(0.1));
    const side = smoothstep(-0.012, 0.012, d) as unknown as F;
    const team = mix(color(0xff4a30), color(0x3aa0ff), side) as unknown as V3;
    const power = mix(this.power[0], this.power[1], side) as unknown as F;
    // a wave runs out from the middle
    const out = positionWorld.xz.length().mul(0.16).add(noise(0.5).mul(0.12));
    const run = fract(out.sub(this.time.mul(0.42)));
    const pulse = smoothstep(0.6, 0.97, run).mul(smoothstep(1, 0.975, run)) as unknown as F;
    const near = abs(d).mul(this.aspect);
    const hot = smoothstep(0.0032, 0.0014, near).mul(0.9).add(near.mul(-40).exp().mul(0.35)) as unknown as F;
    m.colorNode = mix(base, base.mul(team).mul(1.6), 0.28);
    m.roughnessNode = rough;
    m.emissiveNode = team.mul(lines.mul(pulse.mul(2.4).add(0.16))).mul(power).add(vec3(1, 0.6, 0.22).mul(hot)).add(this.fog.mul(smoothstep(-2, -8, positionWorld.z)).mul(0.6));
    // (it ends softly: the map stands behind it)
    const far = smoothstep(-9, -3.2, positionWorld.z);
    m.opacityNode = min(far, smoothstep(6.4, 5.2, positionWorld.z)).mul(smoothstep(22, 14, abs(positionWorld.x)));
    return m;
  }

  /** What lies about, as on the map: along the back and at the sides. */
  private things(id: string, to: THREE.Group): void {
    const black = new THREE.MeshStandardNodeMaterial({ color: 0x0c0d0f, roughness: 0.4 });
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0xa4abb2, metalness: 0.95, roughness: 0.3 });
    const gold = new THREE.MeshStandardNodeMaterial({ color: 0xc08a3c, metalness: 0.9, roughness: 0.35 });
    const cream = new THREE.MeshStandardNodeMaterial({ color: 0xe9d8c0, roughness: 0.45 });
    const ice = new THREE.MeshStandardNodeMaterial({ color: 0xbfe2f2, roughness: 0.12, transparent: true, opacity: 0.72 });
    const team = [0x8c1a15, 0x174a92].map((c) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: 0.35 }));
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, this.level + y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true;
      to.add(m);
      return m;
    };
    const can = (x: number, z: number, r: number, h: number, s: number): void => {
      add(new THREE.CylinderGeometry(r, r, h, 32), team[s], x, h / 2, z);
      add(new THREE.CylinderGeometry(r * 0.9, r * 0.96, 0.06, 32), steel, x, h + 0.02, z);
      for (const a of [0, Math.PI / 2]) add(new THREE.BoxGeometry(r * 1.5, 0.02, 0.05), black, x, h + 0.055, z, 0, a);
    };
    const chip = (x: number, z: number, w: number, d: number, ry: number): void => {
      add(new THREE.BoxGeometry(w, 0.28, d), black, x, 0.24, z, 0, ry);
      const n = Math.floor(w / 0.3);
      const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.16, 0.24), steel, n * 2);
      for (let i = 0; i < n; i++) for (const [k, s] of [[0, -1], [1, 1]]) legs.setMatrixAt(i * 2 + k, this.m.makeTranslation((i - (n - 1) / 2) * 0.3, 0.1, s * (d / 2 + 0.09)));
      legs.position.set(x, this.level, z);
      legs.rotation.y = ry;
      to.add(legs);
    };
    const coil = (x: number, z: number, r: number): void => {
      const core = add(new THREE.TorusGeometry(r, r * 0.4, 16, 40).rotateX(Math.PI / 2), black, x, r * 0.45, z);
      const turns = new THREE.InstancedMesh(new THREE.TorusGeometry(r * 0.46, r * 0.075, 8, 20), gold, 26);
      const t = new THREE.Matrix4();
      for (let i = 0; i < 26; i++) turns.setMatrixAt(i, this.m.makeRotationY(-(i / 26) * Math.PI * 1.72).multiply(t.makeTranslation(r, 0, 0)));
      turns.castShadow = true;
      core.add(turns);
    };
    const screw = (x: number, z: number, r: number, h: number, tilt: number): void => {
      const g = new THREE.Group();
      const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, ry = 0): void => {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        m.rotation.y = ry;
        m.castShadow = true;
        g.add(m);
      };
      part(new THREE.CylinderGeometry(r * 0.45, r * 0.4, h, 20), steel, h / 2);
      for (let i = 1; i < 9; i++) part(new THREE.TorusGeometry(r * 0.46, r * 0.07, 8, 24).rotateX(Math.PI / 2 + 0.1), steel, (h * i) / 10);
      part(new THREE.CylinderGeometry(r, r * 0.8, r * 0.5, 28), steel, h);
      for (const a of [0, Math.PI / 2]) part(new THREE.BoxGeometry(r * 1.2, 0.04, r * 0.22), black, h + r * 0.26, a);
      g.position.set(x, this.level, z);
      g.rotation.z = tilt;
      to.add(g);
    };
    for (const [s, x] of [[0, -1], [1, 1]]) {
      if (id === 'pc-case') {
        can(x * 7.8, -4.6, 0.75, 2.6, s);
        can(x * 9.3, -5.2, 0.75, 2.2, s);
        can(x * 5.9, -5.4, 0.5, 1.4, s);
        can(x * 1.6, -5.8, 0.4, 1.0, s);
        chip(x * 3.4, -5.1, 2.6, 1.3, x * 0.06);
        coil(x * 8.4, -2.4, 0.8);
      } else if (id === 'speaker') {
        coil(x * 4.6, -5.2, 1.0);
        coil(x * 8.2, -3.2, 0.8);
        add(new THREE.CylinderGeometry(1.5, 0.6, 0.9, 48, 1, true), black, x * 7, 0.5, -5.6);
        add(new THREE.TorusGeometry(1.5, 0.14, 12, 48).rotateX(Math.PI / 2), team[s], x * 7, 0.95, -5.6);
        add(new THREE.SphereGeometry(0.55, 24, 16), gold, x * 7, 0.55, -5.6);
        screw(x * 2.2, -5.2, 0.4, 0.5, 0);
        add(new THREE.CapsuleGeometry(0.45, 1.6, 8, 24), team[s], x * 9.6, 0.45, -1.2, Math.PI / 2, 0, x * 0.5);
      } else if (id === 'fridge') {
        for (const [ex, ez, e] of [[4.8, -5, 1], [5.9, -4.5, 0.92], [8.6, -2.6, 1.05]]) add(new THREE.SphereGeometry(0.62 * e, 32, 24).scale(1, 1.3, 1), cream, x * ex, 0.75 * e, ez, 0, 0, x * 0.12);
        for (const [ex, ez, e] of [[2.4, -5.4, 0.8], [3.1, -5.0, 0.6], [7.4, -4.4, 1], [8.3, 1.2, 0.5]]) add(new THREE.BoxGeometry(e, e, e, 1, 1, 1), ice, x * ex, e / 2, ez, 0, ex * 1.3, 0);
        add(new THREE.CylinderGeometry(0.62, 0.7, 0.3, 21), team[s], x * 6.9, 0.16, -1.8);
        add(new THREE.CylinderGeometry(0.8, 0.8, 3, 40), team[s], x * 8.8, 1.5, -5.2);
        add(new THREE.CylinderGeometry(0.82, 0.82, 0.5, 40), cream, x * 8.8, 3.1, -5.2);
      } else if (id === 'microwave') {
        for (let i = 0; i < 7; i++) {
          // popcorn: a few round lobes each
          const px = x * (3 + i * 1.05 + Math.sin(i * 5) * 0.3);
          const pz = -5.2 + Math.sin(i * 3.7) * 0.8 + (i > 4 ? (i - 4) * 1.1 : 0);
          for (let k = 0; k < 5; k++) add(new THREE.SphereGeometry(0.26 + 0.07 * Math.sin(k * 4 + i), 14, 10), cream, px + Math.sin(k * 2.4 + i) * 0.26, 0.34 + Math.cos(k * 1.9) * 0.2, pz + Math.cos(k * 2.4) * 0.24);
          add(new THREE.SphereGeometry(0.13, 10, 8), gold, px + 0.2, 0.12, pz + 0.3);
        }
        add(new THREE.CylinderGeometry(0.95, 1.05, 0.9, 48), steel, x * 8.7, 0.45, -3.8);
        add(new THREE.BoxGeometry(0.16, 0.3, 1.8), team[s], x * 8.7, 0.95, -3.8, 0, x * 0.6);
      } else if (id === 'desk') {
        for (const [ex, ez, ry] of [[3.2, -5.4, 0.1], [5.0, -5.1, -0.1], [6.8, -5.3, 0.22]]) {
          add(new THREE.CylinderGeometry(0.62, 0.86, 0.75, 4, 1).rotateY(Math.PI / 4), ez === -5.1 ? team[s] : black, x * ex, 0.38, ez, 0, ry);
        }
        // a pencil, and a clip
        add(new THREE.CylinderGeometry(0.26, 0.26, 5.5, 6), team[s], x * 8.2, 0.26, -2.4, Math.PI / 2, 0, x * 0.75);
        add(new THREE.ConeGeometry(0.26, 0.8, 6), cream, x * (8.2 - 2.15), 0.26, -2.4 + 2.3, Math.PI / 2, 0, x * 0.75);
        add(new THREE.TorusGeometry(0.5, 0.06, 10, 40).scale(1.7, 1, 1).rotateX(Math.PI / 2), steel, x * 7.4, 0.06, 2.6, 0, x * 0.7);
        add(new THREE.CylinderGeometry(0.9, 0.8, 2.4, 40), cream, x * 9, 1.2, -5.2);
      } else {
        screw(x * 5.6, -5.8, 0.45, 1.2, x * 0.1);
        screw(x * 7.4, -5.6, 0.55, 1.9, x * -0.16);
        // fuses: two blades in a coloured body
        for (const [fx, fz, ry] of [[4.9, -5.2, 0.2], [6.3, -4.7, -0.4], [8.2, 1.4, 0.6]]) {
          add(new THREE.BoxGeometry(1.1, 0.7, 0.35), team[s], x * fx, 0.75, fz, 0, ry);
          for (const k of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.26, 0.6, 0.1), steel, x * fx + Math.cos(ry) * k, 0.28, fz - Math.sin(ry) * k, 0, ry);
        }
        add(new THREE.CylinderGeometry(1.1, 1.15, 0.9, 40), black, x * 8.6, 0.45, -5.2);
        add(new THREE.TorusGeometry(1.05, 0.06, 10, 48).rotateX(Math.PI / 2), team[s], x * 8.6, 0.92, -5.2);
      }
    }
  }

  /** A landing: a ring of light runs out over the floor. */
  ring(x: number, z: number, tint: number, large = 1): void {
    let r = this.rings.find((q) => q.t < 0);
    if (!r) {
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72).rotateX(-Math.PI / 2), mat);
      this.root.add(mesh);
      r = { mesh, mat, t: -1 };
      this.rings.push(r);
    }
    r.t = 0;
    r.mat.color.setHex(tint).multiplyScalar(0.8);
    r.mesh.position.set(x, this.level + 0.03, z);
    r.mesh.userData.large = large;
    r.mesh.visible = true;
  }

  /** A blow: sparks in all directions. */
  burst(x: number, y: number, z: number): void {
    this.sparkT = 0;
    this.sparks.visible = true;
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 6;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 1.6 - 0.5;
      const v = 5 + Math.random() * 13;
      this.sparkV.set([x, y, z, Math.cos(a) * v, up * v * 0.7, Math.sin(a) * v * 0.7], o);
    }
  }

  update(dt: number): void {
    this.time.value += dt;
    for (const r of this.rings) {
      if (r.t < 0) continue;
      r.t += dt;
      const u = Math.min(1, r.t / 0.6);
      r.mesh.scale.setScalar((0.4 + 2.6 * (1 - (1 - u) ** 3)) * (r.mesh.userData.large as number));
      r.mat.opacity = (1 - u) ** 2 * 0.8;
      if (u >= 1) {
        r.t = -1;
        r.mesh.visible = false;
      }
    }
    if (this.sparkT >= 0) {
      this.sparkT += dt;
      const k = Math.max(0, 1 - this.sparkT / 0.55);
      for (let i = 0; i < SPARKS; i++) {
        const o = i * 6;
        const p = this.sparkV;
        p[o + 4] -= 22 * dt;
        for (let c = 0; c < 3; c++) p[o + c] += p[o + 3 + c] * dt;
        this.d.set(p[o + 3], p[o + 4], p[o + 5]).normalize();
        this.q.setFromUnitVectors(this.v.set(0, 0, 1), this.d);
        this.sparks.setMatrixAt(i, this.m.compose(this.v.set(p[o], p[o + 1], p[o + 2]), this.q, this.s.set(k, k, k)));
      }
      this.sparks.instanceMatrix.needsUpdate = true;
      if (k === 0) {
        this.sparkT = -1;
        this.sparks.visible = false;
      }
    }
    const p = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, p.getY(i) + dt * (0.12 + (i % 5) * 0.05));
      p.setX(i, p.getX(i) + Math.sin(this.time.value * 0.5 + i) * dt * 0.12);
      if (p.getY(i) > this.level + 7) p.setY(i, this.level);
    }
    p.needsUpdate = true;
  }
}
