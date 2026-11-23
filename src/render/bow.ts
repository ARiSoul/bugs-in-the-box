import * as THREE from 'three';
import type { Match } from '../game/match';
import type { DrawnGround } from './drawnGround';
import { dartGeometry } from './projectiles';

/** In radii of the spider: the bow's tips out to the sides, up and ahead; how far the string is drawn back. */
const WIDE = 1.75;
const HIGH = 0.75;
const AHEAD = 1.35;
const DRAW = 1.5;
/** Strings from tip to tip, and how thick silk is. */
const STRINGS = 3;
const SILK = 0.035;
/** The string shakes this long after the shot (ms); a dart stuck in something fades after this long. */
const SNAP = 500;
const STUCK = 9000;
const FADE = 1500;

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * The spider's Web Bow (render only): two tips of silk held up by its front legs and guyed to the ground, a few
 * strings between them drawn back with the charge, the dart on them; and the darts that stuck in terrain.
 */
export class BowView {
  private readonly lines: THREE.Mesh[] = [];
  private used = 0;
  private readonly dart: THREE.Mesh;
  private readonly silk = new THREE.MeshBasicMaterial({ color: 0xe4e5e6, fog: false });
  private readonly strand = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  private readonly stuck: { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; t0: number }[] = [];
  /** When the last shot left, and from which unit. */
  private shotAt = -1e9;
  private shooter = -1;
  private wasCharging = false;
  private readonly dir = new Float64Array(3);
  private readonly aim = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly tips = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly foot = new THREE.Vector3();
  private readonly pull = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    this.dart = new THREE.Mesh(dartGeometry, new THREE.MeshBasicMaterial({ color: 0xf4f4ee, fog: false }));
    this.dart.visible = false;
    scene.add(this.dart);
  }

  /** The active bug stands with the bow in its legs. */
  ready(match: Match): boolean {
    const u = match.activeUnit;
    return match.phase === 'aim' && match.currentWeapon.kind === 'arrow' && u.bug.alive && u.bug.grounded;
  }

  /** A new match. */
  clear(): void {
    for (const s of this.stuck) this.drop(s.mesh);
    this.stuck.length = 0;
    this.shooter = -1;
  }

  /** A dart stays in what it hit. */
  stick(x: number, y: number, z: number, dx: number, dy: number, dz: number, now: number): void {
    const m = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(dartGeometry, new THREE.MeshBasicMaterial({ color: 0xf4f4ee, transparent: true, depthWrite: false, fog: false }));
    m.quaternion.setFromUnitVectors(FORWARD, this.d.set(dx, dy, dz));
    m.position.set(x + dx * 0.7, y + dy * 0.7, z + dz * 0.7);
    this.scene.add(m);
    this.stuck.push({ mesh: m, t0: now });
  }

  /** `at`: where the active bug is drawn. */
  update(match: Match, at: THREE.Vector3, ground: DrawnGround, now: number): void {
    for (let i = this.stuck.length - 1; i >= 0; i--) {
      const s = this.stuck[i];
      const k = (now - s.t0 - STUCK) / FADE;
      if (k >= 1) {
        this.drop(s.mesh);
        this.stuck.splice(i, 1);
      } else s.mesh.material.opacity = k > 0 ? 1 - k : 1;
    }

    const u = match.activeUnit;
    const ready = this.ready(match);
    const charging = ready && match.charging;
    if (this.wasCharging && !charging && match.phase === 'flight') {
      this.shotAt = now;
      this.shooter = u.id;
    }
    this.wasCharging = charging;
    const since = now - this.shotAt;
    const snapping = this.shooter === u.id && since < SNAP && u.bug.alive;
    this.used = 0;
    this.dart.visible = ready;
    if (ready || snapping) {
      const b = u.bug;
      const r = b.species.radius;
      match.aimDirection(u, this.dir);
      this.aim.set(this.dir[0], this.dir[1], this.dir[2]);
      this.up.set(b.nx, b.ny, b.nz);
      this.side.set(b.ny * b.hz - b.nz * b.hy, b.nz * b.hx - b.nx * b.hz, b.nx * b.hy - b.ny * b.hx).normalize();
      // (the string's shake after the shot)
      const shake = snapping ? Math.sin(since * 0.09) * 0.35 * (1 - since / SNAP) : 0;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        // the tips lean in as the string is drawn
        const wide = WIDE - (charging ? match.power * 0.3 : 0);
        this.tips[i].copy(at).addScaledVector(this.side, s * wide * r).addScaledVector(this.up, HIGH * r);
        this.tips[i].x += b.hx * AHEAD * r;
        this.tips[i].y += b.hy * AHEAD * r;
        this.tips[i].z += b.hz * AHEAD * r;
        // two guys from each tip to what is drawn under it
        for (const g of [-0.7, 0.9]) {
          this.foot.copy(this.tips[i]).addScaledVector(this.side, s * 0.7 * r);
          this.foot.x += b.hx * g * r;
          this.foot.y += b.hy * g * r;
          this.foot.z += b.hz * g * r;
          const t = ground.rest(this.foot.x, this.foot.y, this.foot.z, -b.nx, -b.ny, -b.nz, 4 * r);
          this.foot.addScaledVector(this.up, t > 0 ? -t : -(HIGH + 1) * r);
          this.line(this.foot, this.tips[i], SILK * 0.8);
        }
      }
      // the strings, to where they are drawn back
      const back = charging ? match.power * DRAW : 0.12;
      for (let k = 0; k < STRINGS; k++) {
        const off = (k - (STRINGS - 1) / 2) * 0.16 * r;
        this.pull.copy(this.tips[0]).add(this.tips[1]).multiplyScalar(0.5);
        this.pull.addScaledVector(this.aim, -(ready ? back : 0) * r + shake).addScaledVector(this.up, off * 0.5);
        for (const tip of this.tips) {
          this.foot.copy(tip).addScaledVector(this.up, off * 1.8);
          this.line(this.foot, this.pull, SILK);
          if (k === 0) this.line(tip, this.foot, SILK * 1.6);
          else this.line(this.foot, tip, SILK * 1.6);
        }
      }
      if (ready) {
        this.pull.copy(this.tips[0]).add(this.tips[1]).multiplyScalar(0.5).addScaledVector(this.aim, -back * r);
        this.dart.position.copy(this.pull).addScaledVector(this.aim, 2.4);
        this.dart.quaternion.setFromUnitVectors(FORWARD, this.aim);
      }
    }
    for (let i = this.used; i < this.lines.length; i++) this.lines[i].visible = false;
  }

  private line(from: THREE.Vector3, to: THREE.Vector3, radius: number): void {
    let m = this.lines[this.used];
    if (!m) {
      m = new THREE.Mesh(this.strand, this.silk);
      m.frustumCulled = false;
      this.scene.add(m);
      this.lines.push(m);
    }
    this.used++;
    this.d.copy(to).sub(from);
    const len = this.d.length();
    m.visible = len > 1e-4;
    if (len <= 1e-4) return;
    m.position.copy(from);
    m.scale.set(radius, len, radius);
    m.quaternion.setFromUnitVectors(UP, this.d.divideScalar(len));
  }

  private drop(m: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>): void {
    this.scene.remove(m);
    m.material.dispose();
  }
}
