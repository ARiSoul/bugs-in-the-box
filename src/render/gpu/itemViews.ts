import * as THREE from 'three/webgpu';
import { float, mix, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';
import { BOX, WAY_STEP, type Item, type ItemKind } from '../../game/items';
import type { Match, MatchEvent } from '../../game/match';

const UP = new THREE.Vector3(0, 1, 0);
const BALL = new THREE.SphereGeometry(1, 16, 12);
const BALL_FINE = new THREE.SphereGeometry(1, 40, 30);
const STICK = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
/** Small ants under a box, and how far they reach from its middle. */
const CARRIERS = 4;
const ANT_SIZE = 0.4;
/** Seconds an opened box's lids fly, and its bits. */
const POP = 0.9;
const BITS = 14;

/** Each item's colour, name and emblem (48 by 48 path data, filled). */
export const ITEM_LOOKS: Readonly<Record<ItemKind, { color: string; name: string; path: string }>> = {
  battery: { color: '#8bd450', name: 'Battery', path: 'M18 4h12v5h5v35H13V9h5zM25 14l-8 14h6l-2 11 9-15h-6z' },
  patch: { color: '#ff7fa5', name: 'Flux patch', path: 'M18 6h12v12h12v12H30v12H18V30H6V18h12z' },
  fuse: { color: '#6db4ff', name: 'Fuse', path: 'M10 12h28v18H10zM13 30h6v12h-6zM29 30h6v12h-6z' },
  overclock: { color: '#ff8a4c', name: 'Overclock', path: 'M14 14h20v20H14zM18 4h4v8h-4zM26 4h4v8h-4zM18 36h4v8h-4zM26 36h4v8h-4zM4 18h8v4H4zM4 26h8v4H4zM36 18h8v4h-8zM36 26h8v4h-8z' },
  spring: { color: '#5fdcb0', name: 'Springs', path: 'M12 40l24-5v-4l-20-4 20-4v-4l-20-4 20-4V7l-24 5v4l20 3-20 4v4l20 4-20 5z' },
  paste: { color: '#c3ccd8', name: 'Thermal paste', path: 'M6 36q4-24 18-26 16 4 18 26z' },
  crystal: { color: '#ffd45a', name: 'Spare crystal', path: 'M24 3l13 16-13 26-13-26z' },
  magnet: { color: '#ff5a5a', name: 'Magnet', path: 'M8 6h10v18a6 6 0 0 0 12 0V6h10v18a16 16 0 0 1-32 0z' },
  scrap: { color: '#d8d0c0', name: 'Scrap', path: 'M8 12h20v28H8zM18 6h20v28h-6V10H18z' },
  dud: { color: '#ffb547', name: 'Dud!', path: 'M22 16a14 14 0 1 0 8 0l6-9-4-3z' },
};

interface BoxView {
  item: Item;
  root: THREE.Group;
  lids: THREE.Object3D[];
  beam: THREE.Mesh;
  gem: THREE.Mesh;
  carriers: THREE.Group[];
  bee: THREE.Group | null;
  /** Seconds since it was opened (-1: shut), or blown up. */
  popped: number;
  landed: boolean;
  bits: { mesh: THREE.Mesh; v: THREE.Vector3 }[];
}

/** The boxes of a match, as they come (ants on foot, a bee), lie about, and open. Reads the match, never changes it. */
export class ItemViews {
  private readonly views = new Map<number, BoxView>();
  private readonly pasteViews = new Map<number, THREE.Mesh>();
  private readonly card: THREE.MeshStandardNodeMaterial;
  private readonly tape: THREE.MeshStandardNodeMaterial;
  private readonly inside: THREE.MeshStandardNodeMaterial;
  private readonly antSkin: THREE.MeshStandardNodeMaterial;
  private readonly beeYellow: THREE.MeshStandardNodeMaterial;
  private readonly beeStripes: THREE.MeshStandardNodeMaterial;
  private readonly gem: THREE.MeshStandardNodeMaterial;
  private readonly beeDark: THREE.MeshStandardNodeMaterial;
  private readonly wing: THREE.MeshStandardNodeMaterial;
  private readonly paste: THREE.MeshStandardNodeMaterial;
  private readonly beamMat: THREE.MeshBasicNodeMaterial;
  private readonly time = uniform(0);
  private readonly p = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  constructor(private readonly scene: THREE.Scene) {
    const std = (color: number, roughness: number, metalness = 0): THREE.MeshStandardNodeMaterial => {
      const m = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
      m.fog = false;
      return m;
    };
    this.card = std(0xb07a3e, 0.85);
    this.tape = std(0xf0e2c4, 0.45);
    this.inside = std(0x2a1a0c, 0.9);
    this.inside.emissive.setHex(0xffb547).multiplyScalar(0.9);
    this.antSkin = std(0x3a2418, 0.4);
    this.beeYellow = std(0xf2b01e, 0.6);
    this.beeYellow.emissive.setHex(0x3a2400);
    this.beeDark = std(0x18110b, 0.5);
    this.beeStripes = std(0xffffff, 0.45);
    this.beeStripes.colorNode = mix(vec3(0.02, 0.012, 0.006), vec3(0.9, 0.42, 0.015), smoothstep(-0.25, 0.25, positionLocal.z.mul(13).add(1.2).sin()));
    this.gem = std(0xffb547, 0.3);
    this.gem.emissive.setHex(0xff9a1f);
    this.wing = std(0xdfefff, 0.2);
    this.wing.transparent = true;
    this.wing.opacity = 0.45;
    this.wing.side = THREE.DoubleSide;
    this.paste = std(0xaeb7c4, 0.28, 0.35);
    this.beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.beamMat.fog = false;
    const high = positionLocal.y;
    this.beamMat.colorNode = vec3(1, 0.68, 0.25);
    this.beamMat.opacityNode = smoothstep(1, 0, high).pow(2).mul(0.2).mul(float(0.75).add(this.time.mul(2.4).sin().mul(0.25)));
  }

  /** One of everything, far below, while the shaders are made; the returned function takes it away. */
  samples(): () => void {
    const one = this.make({ id: 0, kind: 'dud', by: 'ants', x: 0, y: -300, z: 0, vy: 0, due: 1, trip: 1, path: [], resting: false });
    one.bee = this.bee();
    const smear = new THREE.Mesh(BALL, this.paste);
    this.scene.add(smear);
    for (const o of [one.root, one.beam, one.gem, one.bee, smear, ...one.carriers]) {
      o.visible = true;
      o.position.y = -300;
    }
    return () => {
      this.drop(one);
      smear.removeFromParent();
    };
  }

  clear(): void {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
    for (const m of this.pasteViews.values()) m.removeFromParent();
    this.pasteViews.clear();
  }

  /** The events of a tick: boxes opened or blown up. */
  on(e: MatchEvent): void {
    if (e.type !== 'open' && e.type !== 'boxGone') return;
    const v = this.views.get(e.id);
    if (!v) return;
    v.popped = 0;
    v.beam.visible = v.gem.visible = false;
    const wild = e.type === 'boxGone' ? 2 : 1;
    for (let i = 0; i < BITS; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.2), i % 4 ? this.card : this.tape);
      mesh.position.set((Math.random() - 0.5) * BOX * 2, (Math.random() - 0.3) * BOX, (Math.random() - 0.5) * BOX * 2);
      v.root.add(mesh);
      v.bits.push({ mesh, v: new THREE.Vector3((Math.random() - 0.5) * 7, 4 + Math.random() * 6, (Math.random() - 0.5) * 7).multiplyScalar(wild) });
    }
  }

  update(match: Match, dt: number, seconds: number): void {
    this.time.value = seconds;
    for (const it of match.items.list) if (!this.views.has(it.id)) this.views.set(it.id, this.make(it));
    for (const [id, v] of this.views) {
      if (v.popped < 0 && !match.items.list.includes(v.item)) {
        // (it fell off the map)
        this.drop(v);
        this.views.delete(id);
        continue;
      }
      if (v.popped >= 0) {
        if (!this.pop(v, dt)) {
          this.drop(v);
          this.views.delete(id);
        }
        continue;
      }
      this.move(v, dt, seconds);
    }
    this.smears(match);
  }

  private make(item: Item): BoxView {
    const root = new THREE.Group();
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = o.receiveShadow = true;
      root.add(o);
      return o;
    };
    const b = BOX;
    mesh(new THREE.BoxGeometry(b * 2, b * 1.9, b * 2), this.card, 0, -0.05 * b, 0);
    mesh(new THREE.BoxGeometry(b * 2.02, b * 1.92, b * 0.42), this.tape, 0, -0.05 * b, 0);
    mesh(new THREE.BoxGeometry(b * 1.7, 0.03, b * 1.7), this.inside, 0, b * 0.9 + 0.005, 0);
    const lids: THREE.Object3D[] = [];
    for (const x of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(x * b, b * 0.93, 0);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(b, 0.05, b * 2), this.card);
      flap.position.x = (-x * b) / 2;
      flap.castShadow = true;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(b, 0.055, b * 0.42), this.tape);
      strip.position.x = (-x * b) / 2;
      hinge.add(flap, strip);
      root.add(hinge);
      lids.push(hinge);
    }
    root.scale.setScalar(0.96);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 1, 20, 1, true).translate(0, 0.5, 0), this.beamMat);
    beam.scale.y = 13;
    beam.visible = false;
    // (a mark over it, so it is seen on a bright floor too)
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), this.gem);
    gem.scale.set(0.75, 1.25, 0.75);
    gem.visible = false;
    this.scene.add(gem);
    this.scene.add(root, beam);
    const carriers: THREE.Group[] = [];
    let bee: THREE.Group | null = null;
    if (item.due > 0 && item.by === 'ants') for (let i = 0; i < CARRIERS; i++) carriers.push(this.ant());
    if (item.due > 0 && item.by === 'bee') bee = this.bee();
    return { item, root, lids, beam, gem, carriers, bee, popped: -1, landed: item.due === 0, bits: [] };
  }

  /** A small ant: three lumps, six legs (its children 3..8) that step. */
  private ant(): THREE.Group {
    const g = new THREE.Group();
    const lump = (z: number, y: number, r: number, l: number): void => {
      const m = new THREE.Mesh(BALL, this.antSkin);
      m.position.set(0, y, z);
      m.scale.set(r, r * 0.9, l);
      m.castShadow = true;
      g.add(m);
    };
    lump(-0.75, 0.62, 0.42, 0.6);
    lump(0, 0.55, 0.26, 0.36);
    lump(0.62, 0.62, 0.34, 0.38);
    for (let i = 0; i < 6; i++) {
      const x = i % 2 ? 1 : -1;
      const leg = new THREE.Mesh(STICK, this.antSkin);
      leg.position.set(x * 0.15, 0.5, (Math.floor(i / 2) - 1) * 0.28);
      leg.scale.set(0.06, 0.95, 0.06);
      g.add(leg);
    }
    g.scale.setScalar(ANT_SIZE);
    this.scene.add(g);
    return g;
  }

  /** A bee: a striped body, two pairs of wings (its children `wings`). */
  private bee(): THREE.Group {
    const g = new THREE.Group();
    const lump = (m: THREE.Material, z: number, y: number, rx: number, ry: number, rz: number): void => {
      const o = new THREE.Mesh(BALL, m);
      o.position.set(0, y, z);
      o.scale.set(rx, ry, rz);
      o.castShadow = true;
      g.add(o);
    };
    const back = new THREE.Mesh(BALL_FINE, this.beeStripes);
    back.position.set(0, -0.12, -0.95);
    back.rotation.x = 0.16;
    back.scale.set(0.56, 0.52, 0.95);
    back.castShadow = true;
    g.add(back);
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 8).rotateX(-Math.PI / 2), this.beeDark);
    sting.position.set(0, -0.28, -1.95);
    g.add(sting);
    lump(this.beeYellow, 0.15, 0.1, 0.5, 0.48, 0.52);
    lump(this.beeDark, 0.72, 0.02, 0.36, 0.34, 0.32);
    // (a fuzzy collar)
    const fluff = new THREE.InstancedMesh(new THREE.ConeGeometry(0.016, 0.12, 4).translate(0, 0.06, 0), this.beeYellow, 900);
    for (let i = 0; i < 900; i++) {
      const y = 1 - (2 * (i + 0.5)) / 900;
      const an = i * 2.39996;
      const r = Math.sqrt(1 - y * y);
      this.p.set(Math.cos(an) * r, y, Math.sin(an) * r);
      this.n.copy(this.p).normalize();
      this.p.multiply(this.s.set(0.48, 0.46, 0.5)).add(this.f.set(0, 0.1, 0.15));
      fluff.setMatrixAt(i, this.m.compose(this.p, new THREE.Quaternion().setFromUnitVectors(UP, this.n), this.s.setScalar(0.7 + 0.5 * Math.abs(Math.sin(i * 9)))));
    }
    g.add(fluff);
    for (const x of [-1, 1]) {
      const eye = new THREE.Mesh(BALL, this.beeDark);
      eye.position.set(x * 0.26, 0.12, 0.88);
      eye.scale.set(0.16, 0.22, 0.18);
      g.add(eye);
      const feeler = new THREE.Mesh(STICK, this.beeDark);
      feeler.position.set(x * 0.12, 0.3, 0.95);
      feeler.rotation.set(0.9, 0, -x * 0.4);
      feeler.scale.set(0.03, 0.5, 0.03);
      g.add(feeler);
      for (const [z, long] of [[0.15, 1.5], [-0.2, 1.1]]) {
        const hinge = new THREE.Group();
        hinge.position.set(x * 0.25, 0.45, z);
        hinge.userData.wing = x;
        const w = new THREE.Mesh(BALL, this.wing);
        w.scale.set(long * 0.55, 0.02, 0.3);
        w.position.x = x * long * 0.55;
        hinge.add(w);
        g.add(hinge);
      }
      for (const z of [0.25, 0, -0.25]) {
        const leg = new THREE.Mesh(STICK, this.beeDark);
        leg.position.set(x * 0.25, -0.3, z);
        leg.rotation.set(0, 0, Math.PI - x * 0.25);
        leg.scale.set(0.05, 0.6, 0.05);
        g.add(leg);
      }
    }
    this.scene.add(g);
    return g;
  }

  private move(v: BoxView, dt: number, seconds: number): void {
    const it = v.item;
    if (it.due > 0) {
      const gone = it.trip - it.due;
      if (it.by === 'ants') this.march(v, gone, seconds);
      else this.fly(v, gone / it.trip, seconds);
      return;
    }
    // it is there: the ants run off under it, the bee climbs away
    for (let i = v.carriers.length - 1; i >= 0; i--) {
      const c = v.carriers[i];
      c.scale.multiplyScalar(Math.exp(-dt * 3));
      c.translateZ(dt * 3);
      if (c.scale.x < ANT_SIZE * 0.1) {
        c.removeFromParent();
        v.carriers.splice(i, 1);
      }
    }
    if (v.bee) {
      v.bee.position.y += dt * 9;
      v.bee.translateZ(dt * 10);
      this.flap(v.bee, seconds);
      if (v.bee.position.y > it.y + 30) {
        v.bee.removeFromParent();
        v.bee = null;
      }
    }
    const was = v.root.position.y;
    v.root.position.set(it.x, it.y, it.z);
    if (it.resting && !v.landed) {
      v.landed = true;
      v.root.scale.set(1.2, 0.7, 1.2);
    }
    if (!it.resting) {
      v.landed = false;
      v.root.rotation.z += (was - it.y) * 0.06;
    } else {
      v.root.rotation.z *= Math.exp(-dt * 12);
      v.root.scale.lerp(this.s.setScalar(0.96), 1 - Math.exp(-dt * 9));
      // (now and then something in it knocks)
      const k = (seconds * 0.55 + it.id * 0.37) % 1;
      v.root.rotation.x = k < 0.12 ? Math.sin(k * 160) * 0.05 * (1 - k / 0.12) : 0;
    }
    v.gem.visible = it.resting;
    v.gem.position.set(it.x, it.y + 2 + Math.sin(seconds * 2.6 + it.id) * 0.18, it.z);
    v.gem.rotation.y = seconds * 2;
    v.beam.visible = it.resting;
    v.beam.position.set(it.x, it.y - BOX, it.z);
  }

  /** The ants carry it along their way. */
  private march(v: BoxView, gone: number, seconds: number): void {
    const path = v.item.path;
    const at = (t: number, out: THREE.Vector3, normal?: THREE.Vector3): void => {
      const k = Math.max(0, Math.min(path.length / WAY_STEP - 1, t));
      const o = Math.floor(k) * WAY_STEP;
      out.set(path[o], path[o + 1], path[o + 2]);
      normal?.set(path[o + 3], path[o + 4], path[o + 5]);
    };
    at(gone, this.p, this.n);
    at(gone + 6, this.f);
    const ahead = this.f.sub(this.p);
    if (ahead.lengthSq() < 1e-4) {
      at(gone - 8, this.s);
      ahead.copy(this.p).sub(this.s);
    }
    ahead.addScaledVector(this.n, -ahead.dot(this.n)).normalize();
    if (ahead.lengthSq() < 0.5) ahead.set(0, 0, 1);
    const side = this.s.crossVectors(this.n, ahead).normalize();
    this.m.makeBasis(side, this.n, ahead);
    // (the path is of a bug's middle, one unit over the ground)
    v.root.quaternion.setFromRotationMatrix(this.m);
    v.root.position.copy(this.p).addScaledVector(this.n, -1 + BOX + 0.32 + Math.abs(Math.sin(seconds * 13)) * 0.05);
    v.root.rotateZ(Math.sin(seconds * 13) * 0.05);
    v.carriers.forEach((c, i) => {
      c.quaternion.setFromRotationMatrix(this.m);
      c.position.copy(this.p).addScaledVector(this.n, -1).addScaledVector(side, (i % 2 ? 1 : -1) * BOX * 0.85).addScaledVector(ahead, (i < 2 ? 1 : -1) * BOX * 0.8);
      for (let k = 0; k < 6; k++) {
        const leg = c.children[3 + k];
        const x = k % 2 ? 1 : -1;
        leg.rotation.set(Math.sin(seconds * 26 + k * Math.PI + i) * 0.5, 0, Math.PI - x * 0.95);
      }
    });
  }

  /** The bee comes in a wide curve, the box under it, and lets go where it is to fall. */
  private fly(v: BoxView, u: number, seconds: number): void {
    const it = v.item;
    const a = it.id * 2.4;
    const left = 1 - u;
    const e = left * left;
    const x = it.x + Math.cos(a + left * 1.6) * 46 * e;
    const z = it.z + Math.sin(a + left * 1.6) * 46 * e;
    const y = it.y + 1.5 + 14 * e + Math.sin(seconds * 5 + it.id) * 0.4;
    const bee = v.bee as THREE.Group;
    this.f.set(x, y, z).sub(bee.position);
    if (this.f.lengthSq() > 1e-6) bee.rotation.set(0.25 * e, Math.atan2(this.f.x, this.f.z), Math.sin(seconds * 3) * 0.12);
    bee.position.set(x, y, z);
    bee.scale.setScalar(1.1);
    this.flap(bee, seconds);
    v.root.position.set(x, y - 1.5, z);
    v.root.rotation.set(Math.sin(seconds * 4) * 0.12, bee.rotation.y, Math.sin(seconds * 5) * 0.12);
  }

  private flap(bee: THREE.Group, seconds: number): void {
    for (const c of bee.children) {
      const x = c.userData.wing as number | undefined;
      if (x) c.rotation.z = x * (0.25 + Math.sin(seconds * 70) * 0.65);
    }
  }

  /** Opened: the lids fly up, bits scatter. False: it is over. */
  private pop(v: BoxView, dt: number): boolean {
    v.popped += dt;
    const u = v.popped / POP;
    if (u >= 1) return false;
    v.lids[0].rotation.z = 2.4 * Math.min(1, u * 5);
    v.lids[1].rotation.z = -2.4 * Math.min(1, u * 5);
    const k = u < 0.35 ? 1 + 0.25 * Math.sin((u / 0.35) * Math.PI) : Math.max(0.01, 1 - (u - 0.35) / 0.5);
    v.root.scale.setScalar(k);
    for (const b of v.bits) {
      b.v.y -= 20 * dt;
      b.mesh.position.addScaledVector(b.v, dt / Math.max(0.2, k));
      b.mesh.rotation.x += dt * 11;
      b.mesh.rotation.y += dt * 8;
    }
    return true;
  }

  /** Thermal paste on the ground. */
  private smears(match: Match): void {
    for (const w of match.webs) {
      if (w.paste < 0 || this.pasteViews.has(w.id)) continue;
      const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 12), this.paste);
      const pos = blob.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const an = Math.atan2(z, x);
        const r = 1 + 0.16 * Math.sin(an * 5 + w.id) + 0.09 * Math.sin(an * 9 + 2);
        pos.setXYZ(i, x * r, pos.getY(i) * 0.09 + 0.02 * Math.sin(x * 11) * Math.cos(z * 9), z * r);
      }
      blob.geometry.computeVertexNormals();
      blob.receiveShadow = true;
      blob.scale.setScalar(w.radius);
      this.scene.add(blob);
      this.pasteViews.set(w.id, blob);
    }
    for (const [id, m] of this.pasteViews) {
      const w = match.webs.find((q) => q.id === id);
      if (!w) {
        m.removeFromParent();
        m.geometry.dispose();
        this.pasteViews.delete(id);
        continue;
      }
      m.position.set(w.x, w.y, w.z);
      m.quaternion.setFromUnitVectors(UP, this.n.set(w.nx, w.ny, w.nz));
    }
  }

  private drop(v: BoxView): void {
    v.root.removeFromParent();
    v.beam.removeFromParent();
    v.gem.removeFromParent();
    v.bee?.removeFromParent();
    for (const c of v.carriers) c.removeFromParent();
  }
}
