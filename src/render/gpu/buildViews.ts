import * as THREE from 'three/webgpu';
import { abs, float, mix, normalView, positionGeometry, positionViewDirection, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BEAD } from '../../game/build';
import { SCREEN_AHEAD, SCREEN_HIGH, type Match, type MatchEvent, type Unit, type Web } from '../../game/match';
import { COLLIDER, MATERIAL_RGB } from '../../terrain/materials';
import type { Terrain } from '../../terrain/Terrain';
import type { BugView } from '../BugView';
import type { DrawnGround } from '../drawnGround';

/** Beads shown at once: the ones that would be laid, the ones that cool. */
const MOST = 96;
/** Seconds a wall takes to grow, its beads to cool. */
const GROW = 0.45;
const COOL = 2.6;
/** A shelter comes, and goes (seconds). */
const COME = 0.55;
const GO = 0.35;
const CRUMBS = 46;
/** Beads that stand at once, drawn this much larger than they are. */
const LAID = 512;
const OVER = 1.15;
const SPARKS = 70;

const ss = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rnd = (i: number): number => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const UP = new THREE.Vector3(0, 1, 0);

interface Shelter {
  unit: number;
  kind: string;
  root: THREE.Group;
  crumbs: THREE.InstancedMesh | null;
  t: number;
  gone: number;
}
interface ScreenView {
  web: Web;
  root: THREE.Group;
  silk: THREE.MeshStandardNodeMaterial;
  balls: THREE.Mesh[];
  t: number;
  gone: number;
  shake: number;
}
interface Spark {
  at: THREE.Vector3;
  v: THREE.Vector3;
  t: number;
  life: number;
}

/** What bugs build and where they hide: where a wall would go, solder as it cools, burrows, cells of wax, screens of silk. Reads the match, never changes it. */
export class BuildViews {
  /** All of it (nobody stands on it: it is no drawn ground). */
  readonly root = new THREE.Group();
  private readonly ghost: THREE.InstancedMesh;
  private readonly ghostColor = uniform(new THREE.Vector3(0.06, 0.5, 1));
  private readonly ghostBeat = uniform(0);
  private readonly hot: THREE.InstancedMesh;
  private readonly heat = uniform(0);
  private hotBeads: number[] = [];
  private hotT = 9;
  /** The beads that stand, as they are drawn (over the terrain's own, coarser ones), and how old each is. */
  private readonly laid: THREE.InstancedMesh;
  private readonly stood: { x: number; y: number; z: number; r: number; age: number; wait: number; turns: boolean }[] = [];
  private turned = 0;
  private dirty = false;
  private readonly sparks: Spark[] = [];
  private readonly sparkMesh: THREE.InstancedMesh;
  private nextSpark = 0;
  private readonly shelters: Shelter[] = [];
  private readonly screens = new Map<number, ScreenView>();
  private readonly beads: number[] = [];
  private ghostKey = '';
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly wax: THREE.MeshStandardNodeMaterial;
  private readonly waxRim: THREE.MeshStandardNodeMaterial;
  private readonly dirt: THREE.MeshStandardNodeMaterial;
  private readonly hole: THREE.MeshBasicNodeMaterial;
  private readonly cell: THREE.BufferGeometry;
  private readonly cellRim: THREE.BufferGeometry;
  private readonly crumb = crumbGeometry();
  private readonly outline: THREE.Mesh;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {
    scene.add(this.root);
    // ---- where it would go
    {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const rim = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 1.6);
      m.colorNode = vec3(this.ghostColor);
      m.opacityNode = rim.mul(0.6).add(0.2).mul(this.ghostBeat.mul(0.25).add(0.85));
      this.ghost = this.instanced(new THREE.IcosahedronGeometry(1, 3), m, MOST);
      this.ghost.renderOrder = 6;
      this.outline = this.add(new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 48), new THREE.MeshBasicNodeMaterial({ color: 0x2a8cff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })));
    }
    // ---- solder as it cools
    {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const face = abs(normalView.dot(positionViewDirection));
      m.colorNode = mix(vec3(0.9, 0.12, 0.01), vec3(3.2, 1.5, 0.5), smoothstep(0.35, 1, this.heat)).mul(this.heat);
      m.opacityNode = smoothstep(0, 0.5, face).mul(smoothstep(0, 0.6, this.heat)).mul(0.85);
      m.fog = false;
      this.hot = this.instanced(new THREE.IcosahedronGeometry(1, 3), m, MOST);
      this.hot.renderOrder = 7;
      const lm = new THREE.MeshStandardNodeMaterial({ color: 0xc9ced6, roughness: 0.3, metalness: 0.6 });
      this.laid = this.instanced(new THREE.IcosahedronGeometry(1, 4), lm, LAID);
      this.laid.castShadow = this.laid.receiveShadow = true;
      const sm = new THREE.MeshBasicNodeMaterial();
      sm.colorNode = vec3(3, 1.5, 0.45);
      sm.fog = false;
      this.sparkMesh = this.instanced(new THREE.IcosahedronGeometry(1, 0), sm, SPARKS);
      for (let i = 0; i < SPARKS; i++) this.sparks.push({ at: new THREE.Vector3(), v: new THREE.Vector3(), t: 9, life: 1 });
    }
    // ---- wax, and dirt
    this.wax = new THREE.MeshStandardNodeMaterial({ color: 0xffa81f, roughness: 0.28, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    {
      const rim = pow(float(1).sub(abs(normalView.dot(positionViewDirection))), 2);
      this.wax.opacityNode = mix(float(0.36), float(0.82), rim).add(smoothstep(1.2, 0, positionGeometry.y).mul(0.22));
      this.wax.emissiveNode = vec3(1, 0.42, 0.05).mul(rim.mul(0.35).add(0.07));
    }
    this.waxRim = new THREE.MeshStandardNodeMaterial({ color: 0xe08a14, roughness: 0.4 });
    this.waxRim.emissiveNode = vec3(0.35, 0.13, 0.01);
    this.dirt = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
    this.hole = new THREE.MeshBasicNodeMaterial({ color: 0x050302 });
    [this.cell, this.cellRim] = cellGeometry();
    // (each drawn once from the start, too small to see: none is compiled when it is first needed)
    for (const [g, m] of [[this.cell, this.wax], [this.cellRim, this.waxRim], [new THREE.CircleGeometry(1, 8), this.hole], [this.crumb, this.dirt]] as [THREE.BufferGeometry, THREE.Material][]) {
      const speck = new THREE.Mesh(g, m);
      speck.position.y = -500;
      speck.scale.setScalar(1e-4);
      speck.frustumCulled = false;
      this.root.add(speck);
    }
  }

  private add<T extends THREE.Object3D>(o: T): T {
    o.frustumCulled = false;
    o.visible = false;
    this.root.add(o);
    return o;
  }
  private instanced(g: THREE.BufferGeometry, m: THREE.Material, n: number): THREE.InstancedMesh {
    const o = new THREE.InstancedMesh(g, m, n);
    o.count = 0;
    return this.add(o);
  }

  /** A new map: nothing is built on it. */
  raze(): void {
    this.stood.length = 0;
    this.laid.count = 0;
  }

  /** A new match: nobody hides, nothing is hot. */
  clear(): void {
    for (const s of this.shelters) this.drop(s);
    this.shelters.length = 0;
    for (const v of this.screens.values()) this.dropScreen(v);
    this.screens.clear();
    this.hotT = 9;
    this.hot.count = 0;
    this.ghost.visible = this.outline.visible = false;
    this.ghostKey = '';
    for (const s of this.sparks) s.t = s.life;
  }

  on(e: MatchEvent, match: Match): void {
    if (e.type === 'built') {
      this.hotBeads = [...e.beads];
      this.hotT = 0;
      const n = e.beads.length / BEAD;
      for (let i = 0; i < n; i++) {
        if (this.stood.length >= LAID) this.stood.shift();
        const tt = match.options.turntable;
        const x = e.beads[i * BEAD];
        const z = e.beads[i * BEAD + 2];
        const turns = tt !== undefined && Math.hypot(x - tt.x, z - tt.z) < tt.radius && e.beads[i * BEAD + 1] > tt.surface - 2;
        this.stood.push({ x, y: e.beads[i * BEAD + 1], z, r: e.beads[i * BEAD + 3], age: 0, wait: (i / n) * GROW * 0.7, turns });
      }
    } else if (e.type === 'explosion' || e.type === 'dig') this.dirty = true;
    else if (e.type === 'hide') this.hide(match.units[e.unit], e.weapon);
    else if (e.type === 'bared') {
      const s = this.shelters.find((q) => q.unit === e.unit && q.gone < 0);
      if (!s) return;
      s.gone = 0;
      if (e.broken) for (let k = 0; k < 10; k++) this.spark(this.a.copy(s.root.position), 5, 0.5);
    } else if (e.type === 'caught') {
      const v = this.screens.get(e.id);
      if (!v) return;
      v.shake = 1;
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), v.silk);
      ball.position.set(e.x, e.y, e.z);
      v.root.updateMatrixWorld();
      v.root.worldToLocal(ball.position);
      v.root.add(ball);
      v.balls.push(ball);
    }
  }

  private spark(at: THREE.Vector3, speed: number, life: number): void {
    const s = this.sparks[this.nextSpark++ % SPARKS];
    s.at.copy(at);
    s.v.set(Math.random() - 0.5, 0.3 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    s.t = 0;
    s.life = life * (0.5 + Math.random());
  }

  // ---------------------------------------------------------------- shelters

  /** What the ground under a bug is made of, as dirt. */
  private groundColor(u: Unit): THREE.Color {
    const b = u.bug;
    const t = this.terrain;
    const c = new THREE.Color(0x4a4036);
    const r = b.species.radius + 0.8;
    const i = Math.round(b.x - b.nx * r);
    const j = Math.round(b.y - b.ny * r);
    const k = Math.round(b.z - b.nz * r);
    if (i < 0 || j < 0 || k < 0 || i >= t.sx || j >= t.sy || k >= t.sz) return c;
    const id = t.material[t.idx(i, j, k)];
    // (what is drawn over a hidden body is not known: crumbs of dust)
    const rgb = MATERIAL_RGB[id];
    if (id !== COLLIDER && rgb) c.setRGB(rgb[0], rgb[1], rgb[2]).lerp(new THREE.Color(0x4a4036), 0.35);
    return c;
  }

  private hide(u: Unit, kind: string): void {
    const root = new THREE.Group();
    const s: Shelter = { unit: u.id, kind, root, crumbs: null, t: 0, gone: -1 };
    const r = u.bug.species.radius;
    if (kind === 'wax-cell') {
      const body = new THREE.Mesh(this.cell, this.wax);
      const rim = new THREE.Mesh(this.cellRim, this.waxRim);
      body.renderOrder = 4;
      rim.castShadow = true;
      root.add(body, rim);
    } else if (kind === 'burrow') {
      root.add(new THREE.Mesh(new THREE.CircleGeometry(1.22 * r, 28).rotateX(-Math.PI / 2).translate(0, 0.05, 0), this.hole));
      const color = this.groundColor(u);
      s.crumbs = new THREE.InstancedMesh(this.crumb, this.dirt, CRUMBS);
      s.crumbs.castShadow = s.crumbs.receiveShadow = true;
      s.crumbs.frustumCulled = false;
      for (let i = 0; i < CRUMBS; i++) s.crumbs.setColorAt(i, new THREE.Color().copy(color).multiplyScalar(0.7 + 0.7 * rnd(i * 3 + 1)));
      root.add(s.crumbs);
    }
    this.root.add(root);
    this.shelters.push(s);
  }

  private drop(s: Shelter): void {
    this.root.remove(s.root);
    s.crumbs?.dispose();
  }

  /** Before the bugs are posed: how each one sits. */
  pose(match: Match, views: readonly BugView[]): void {
    match.units.forEach((u, i) => {
      const v = views[i];
      const id = u.bug.alive ? u.cover?.id : undefined;
      v.sunk = id === 'burrow' ? 1 : 0;
      v.flat = id === 'flatten' ? 1 : 0;
      v.curled = id === 'wax-cell' ? 1 : 0;
    });
  }

  private placeShelter(s: Shelter, u: Unit, view: BugView): void {
    const b = u.bug;
    const r = b.species.radius;
    const come = ss(0, COME, s.t);
    const go = s.gone < 0 ? 1 : 1 - s.gone / GO;
    // (on the ground under it, along its normal)
    if (s.gone < 0) {
      this.p.set(b.nx, b.ny, b.nz);
      this.a.set(b.hx, b.hy, b.hz);
      this.a.addScaledVector(this.p, -this.a.dot(this.p)).normalize();
      this.s.crossVectors(this.p, this.a);
      s.root.quaternion.setFromRotationMatrix(this.m.makeBasis(this.s, this.p, this.a));
      s.root.position.copy(view.restPoint).addScaledVector(this.p, -r);
    }
    if (s.kind === 'wax-cell') {
      const pop = r * come * (1 + 0.18 * Math.sin(Math.PI * come)) * (1.5 - 0.5 * go);
      s.root.scale.set(pop, Math.max(0.01, r * come * go), pop);
      return;
    }
    if (!s.crumbs) return;
    s.root.children[0].scale.setScalar(Math.max(0.01, come * go));
    for (let i = 0; i < CRUMBS; i++) {
      // a ring of crumbs thrown up round the hole, some on its lid
      const an = i * 2.39996 + rnd(i);
      const late = 0.4 * rnd(i * 9 + 2);
      const k = ss(late, late + 0.5, s.t / COME);
      const outer = i < 34;
      const far = r * (outer ? 1.05 + 0.75 * rnd(i * 5) : 0.85 * Math.sqrt(rnd(i * 5 + 3)));
      const size = r * (0.16 + 0.2 * rnd(i * 11)) * (outer ? 1.3 - 0.35 * (far / r - 1.05) : 0.8);
      const up = r * (outer ? 0.3 * Math.max(0, 1.5 - far / r) + 0.04 : 0.14);
      this.p.set(Math.cos(an) * far * k, up + 2.4 * r * k * (1 - k) * (0.5 + rnd(i * 2)) - (1 - go) * 0.4, Math.sin(an) * far * k);
      // (those on the lid lie behind its head)
      if (!outer) this.p.z -= r * 0.75 * k;
      this.q.setFromEuler(this.e.set(rnd(i) * 6 + 5 * (1 - k), rnd(i + 70) * 6, rnd(i + 140) * 6));
      this.s.setScalar(Math.max(1e-3, size * Math.min(1, k * 3) * go));
      s.crumbs.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    s.crumbs.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- screens

  private make(w: Web, ground: DrawnGround): ScreenView {
    const root = new THREE.Group();
    root.position.set(w.x, w.y, w.z);
    root.quaternion.setFromRotationMatrix(this.m.makeBasis(this.p.set(w.nz, 0, -w.nx), UP, this.s.set(w.nx, 0, w.nz)));
    root.updateMatrixWorld();
    const silk = new THREE.MeshStandardNodeMaterial({ color: 0xd2d8de, roughness: 0.5 });
    silk.emissiveNode = vec3(0.1, 0.13, 0.15);
    const parts: THREE.BufferGeometry[] = [];
    const line = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
      const d = b.clone().sub(a);
      const l = d.length();
      if (l < 1e-3) return;
      parts.push(new THREE.CylinderGeometry(r, r, l, 5, 1, true).translate(0, l / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.divideScalar(l))).translate(a.x, a.y, a.z));
    };
    const SPOKES = 18;
    const R = w.radius;
    const ends: THREE.Vector3[] = [];
    const way = new THREE.Vector3();
    for (let k = 0; k < SPOKES; k++) {
      const an = ((k + (rnd(k + w.id) - 0.5) * 0.35) / SPOKES) * Math.PI * 2;
      const e = new THREE.Vector3(Math.cos(an), Math.sin(an), 0).multiplyScalar(R * (0.94 + 0.1 * rnd(k * 5 + w.id)));
      // (it ends where there is something to hold on to)
      way.copy(e).transformDirection(root.matrixWorld);
      const t = ground.raycast(w.x, w.y, w.z, way.x, way.y, way.z, R * 1.05);
      if (t > 0) e.setLength(Math.max(0.6, t + 0.05));
      ends.push(e);
      line(new THREE.Vector3(0, 0, 0.12), e, 0.034);
    }
    for (let k = 0; k < SPOKES; k++) {
      const a = ends[k];
      const b = ends[(k + 1) % SPOKES];
      line(a, b, 0.07);
      for (let n = 1; n < 11; n++) {
        const f = (n + 0.25 * rnd(k * 7 + n)) / 11.2;
        const z = 0.12 * (1 - f);
        const p = a.clone().multiplyScalar(f).setZ(z);
        const q = b.clone().multiplyScalar(f).setZ(z);
        const mid = p.clone().lerp(q, 0.5).multiplyScalar(0.955).setZ(z);
        line(p, mid, 0.024);
        line(mid, q, 0.024);
      }
    }
    // (guys to the ground, before and behind)
    for (const side of [-1, 1])
      for (const z of [-1, 1]) {
        const top = ends.reduce((m, q) => (q.y + q.x * side * 0.8 > m.y + m.x * side * 0.8 ? q : m)).clone();
        const foot = new THREE.Vector3(side * (R + 0.9), 0, z * 2.6);
        root.localToWorld(way.copy(foot));
        const t = ground.raycast(way.x, way.y, way.z, 0, -1, 0, 6);
        if (t <= 0) continue;
        foot.y = -t;
        line(top, foot, 0.04);
      }
    const net = new THREE.Mesh(mergeGeometries(parts), silk);
    net.castShadow = true;
    net.frustumCulled = false;
    root.add(net);
    this.root.add(root);
    return { web: w, root, silk, balls: [], t: 0, gone: -1, shake: 0 };
  }

  private dropScreen(v: ScreenView): void {
    this.root.remove(v.root);
    for (const c of v.root.children) (c as THREE.Mesh).geometry.dispose();
    v.silk.dispose();
  }

  // ---------------------------------------------------------------- every frame

  /** `mine`: a player (not the computer) has the turn and the view. */
  update(match: Match, views: readonly BugView[], ground: DrawnGround, mine: boolean, dt: number, time: number): void {
    this.showGhost(match, mine, time);
    this.showHeat(dt);
    this.showLaid(match, dt);
    for (let i = this.shelters.length - 1; i >= 0; i--) {
      const s = this.shelters[i];
      s.t += dt;
      if (s.gone >= 0) s.gone += dt;
      if (s.gone > GO) {
        this.drop(s);
        this.shelters.splice(i, 1);
        continue;
      }
      this.placeShelter(s, match.units[s.unit], views[s.unit]);
    }
    for (const w of match.webs) if (w.screen >= 0 && !this.screens.has(w.id)) this.screens.set(w.id, this.make(w, ground));
    for (const [id, v] of this.screens) {
      v.t += dt;
      if (v.gone < 0 && !match.webs.includes(v.web)) v.gone = 0;
      if (v.gone >= 0) v.gone += dt;
      if (v.gone > 0.5) {
        this.dropScreen(v);
        this.screens.delete(id);
        continue;
      }
      const e = Math.max(0.01, ss(0, 0.6, v.t));
      const over = 1 + 0.12 * Math.sin(Math.min(1, v.t / 0.8) * Math.PI) * e;
      const fall = v.gone >= 0 ? Math.max(0.02, 1 - ss(0, 0.5, v.gone)) : 1;
      v.shake *= Math.exp(-dt * 5);
      v.root.position.set(v.web.x, v.web.y - (1 - fall) * 2.2, v.web.z);
      v.root.quaternion.setFromRotationMatrix(this.m.makeBasis(this.p.set(v.web.nz, 0, -v.web.nx), UP, this.s.set(v.web.nx, 0, v.web.nz)));
      v.root.scale.set(e * over, e * over * fall, 1);
      v.root.position.addScaledVector(this.s, 0.35 * v.shake * Math.sin(v.t * 34));
    }
  }

  private showGhost(match: Match, mine: boolean, time: number): void {
    const w = match.currentWeapon;
    const u = match.activeUnit;
    const b = u.bug;
    const on = mine && match.phase === 'aim' && b.alive && b.grounded;
    this.ghost.visible = on && (w.kind === 'wall' || w.kind === 'bridge');
    this.outline.visible = on && w.kind === 'screen' && b.ny >= 0.5;
    if (this.outline.visible) {
      const l = Math.hypot(b.fx, b.fz) || 1;
      this.outline.position.set(b.x + (b.fx / l) * SCREEN_AHEAD, b.y - b.species.radius + SCREEN_HIGH, b.z + (b.fz / l) * SCREEN_AHEAD);
      this.outline.scale.setScalar(w.webRadius);
      this.outline.quaternion.setFromAxisAngle(UP, Math.atan2(b.fx, b.fz));
    }
    if (!this.ghost.visible) return;
    this.ghostBeat.value = 0.5 + 0.5 * Math.sin(time * 5);
    const key = `${w.id}|${b.x.toFixed(3)}|${b.y.toFixed(3)}|${b.z.toFixed(3)}|${b.fx.toFixed(4)}|${b.fz.toFixed(4)}|${u.aimV.toFixed(4)}|${match.built}|${match.turnNumber}`;
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    match.beadsFor(u, w, this.beads);
    // (no more this turn: in red)
    if (match.built) this.ghostColor.value.set(1, 0.1, 0.06);
    else this.ghostColor.value.set(0.06, 0.5, 1);
    this.fill(this.ghost, this.beads, 0.97);
  }

  private fill(mesh: THREE.InstancedMesh, beads: readonly number[], scale: number): void {
    const n = Math.min(MOST, beads.length / BEAD);
    for (let i = 0; i < n; i++) {
      const r = beads[i * BEAD + 3] * scale;
      mesh.setMatrixAt(i, this.m.makeScale(r, r, r).setPosition(beads[i * BEAD], beads[i * BEAD + 1], beads[i * BEAD + 2]));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private showLaid(match: Match, dt: number): void {
    const tt = match.options.turntable;
    const by = match.turntableTurns - this.turned;
    this.turned = match.turntableTurns;
    let moved = false;
    if (tt && by > 0 && by < 1) {
      const c = Math.cos((by * Math.PI) / 2);
      const s = Math.sin((by * Math.PI) / 2);
      for (const b of this.stood) {
        if (!b.turns) continue;
        const dx = b.x - tt.x;
        const dz = b.z - tt.z;
        b.x = tt.x + dx * c - dz * s;
        b.z = tt.z + dx * s + dz * c;
        moved = true;
      }
    }
    // (one whose middle was blown away is gone, with a few sparks)
    if (this.dirty) {
      this.dirty = false;
      moved = true;
      for (let i = this.stood.length - 1; i >= 0; i--) {
        const b = this.stood[i];
        if (this.terrain.sample(b.x, b.y, b.z) < -0.25) continue;
        this.spark(this.a.set(b.x, b.y, b.z), 8, 0.6);
        this.stood.splice(i, 1);
      }
    }
    for (const b of this.stood)
      if (b.age < GROW + 0.3) {
        b.age += dt;
        moved = true;
      }
    this.laid.visible = this.stood.length > 0;
    if (!moved) return;
    this.stood.forEach((b, i) => {
      const r = Math.max(1e-3, b.r * OVER * ss(b.wait, b.wait + 0.22, b.age));
      this.laid.setMatrixAt(i, this.m.makeScale(r, r, r).setPosition(b.x, b.y, b.z));
    });
    this.laid.count = this.stood.length;
    this.laid.instanceMatrix.needsUpdate = true;
  }

  private showHeat(dt: number): void {
    this.hot.visible = this.hotT < COOL;
    if (this.hot.visible) {
      this.hotT += dt;
      this.heat.value = 1 - ss(0.25, COOL, this.hotT);
      const n = Math.min(MOST, this.hotBeads.length / BEAD);
      for (let i = 0; i < n; i++) {
        const from = (i / n) * GROW * 0.7;
        const k = ss(from, from + 0.22, this.hotT);
        const x = this.hotBeads[i * BEAD];
        const y = this.hotBeads[i * BEAD + 1];
        const z = this.hotBeads[i * BEAD + 2];
        const r = this.hotBeads[i * BEAD + 3] * (0.14 + 0.96 * k + 0.22 * Math.sin(Math.PI * k));
        this.hot.setMatrixAt(i, this.m.makeScale(r, r, r).setPosition(x, y, z));
        if (k > 0.1 && k < 0.9 && Math.random() < dt * 18) this.spark(this.a.set(x, y + r, z), 6, 0.7);
      }
      this.hot.count = n;
      this.hot.instanceMatrix.needsUpdate = true;
    }
    let n = 0;
    for (const s of this.sparks) {
      if (s.t >= s.life) continue;
      s.t += dt;
      s.v.y -= 16 * dt;
      s.at.addScaledVector(s.v, dt);
      const r = 0.075 * Math.max(0, 1 - s.t / s.life);
      this.q.setFromUnitVectors(UP, this.a.copy(s.v).normalize());
      this.sparkMesh.setMatrixAt(n++, this.m.compose(s.at, this.q, this.s.set(r, r * 3.4, r)));
    }
    this.sparkMesh.count = n;
    this.sparkMesh.visible = n > 0;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }
}

/** A crumb: a lump with uneven faces. */
function crumbGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.8 + 0.3 * rnd(Math.round(x * 9) * 31 + Math.round(y * 9) * 17 + Math.round(z * 9));
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A cell of wax (six walls that lean in, a lid) and its rims, for a bug of radius 1 that stands on y = 0. */
function cellGeometry(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const profile: [number, number][] = [[2.35, 0], [2.5, 0.7], [2.2, 1.7], [1.3, 2.3]];
  const corner = (k: number, [r, y]: [number, number]): THREE.Vector3 => new THREE.Vector3(Math.sin((k * Math.PI) / 3) * r, y, Math.cos((k * Math.PI) / 3) * r);
  const walls: number[] = [];
  const rims: THREE.BufferGeometry[] = [];
  const rim = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
    const d = b.clone().sub(a);
    const l = d.length();
    const g = new THREE.CapsuleGeometry(r, l, 6, 10).translate(0, l / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.divideScalar(l))).translate(a.x, a.y, a.z);
    rims.push(g);
  };
  for (let k = 0; k < 6; k++) {
    for (let j = 0; j < 3; j++) {
      const a = corner(k, profile[j]);
      const b = corner(k + 1, profile[j]);
      const c = corner(k + 1, profile[j + 1]);
      const d = corner(k, profile[j + 1]);
      for (const v of [a, b, c, a, c, d]) walls.push(v.x, v.y, v.z);
      rim(a, d, 0.13);
      rim(a, b, j === 0 ? 0.2 : 0.11);
    }
    const a = corner(k, profile[3]);
    const b = corner(k + 1, profile[3]);
    walls.push(a.x, a.y, a.z, b.x, b.y, b.z, 0, 2.42, 0);
    rim(a, b, 0.15);
    // (drops that ran down)
    const t = corner(k + 0.3 + 0.4 * rnd(k), profile[2]);
    rims.push(new THREE.CapsuleGeometry(0.12 + 0.05 * rnd(k + 9), 0.3 + 0.5 * rnd(k + 4), 6, 10).translate(t.x * 0.92, t.y - 0.4, t.z * 0.92));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
  g.computeVertexNormals();
  return [g, mergeGeometries(rims)];
}
