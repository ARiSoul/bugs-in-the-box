import type { Match } from '../game/match';
import { COLLIDER, MATERIAL_RGB } from '../terrain/materials';
import type { Terrain } from '../terrain/Terrain';

/** Cells of the grid to a pixel of the map; seconds between two redraws of the ground after it changed. */
const STEP = 2;
const AGAIN = 0.5;
const TEAMS = ['#ff5a45', '#5fb4ff', '#ffb547', '#8bd450'];

/**
 * A small map from above, turned with the view: the ground by its height, the bugs by team, the boxes, where the camera
 * looks. What a team may not see of the others' (a perk, later) is left out by `shows`.
 */
export class Minimap {
  readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ground = document.createElement('canvas');
  private dirty = true;
  private wait = 0;
  private w = 0;
  private d = 0;
  /** Opened large over the view (M): the whole map, names on the bugs. */
  big = false;

  toggle(on = !this.big): void {
    this.big = on;
    this.root.classList.toggle('big', on);
  }

  /** Whether a unit shows on the map of the team whose turn it is. */
  shows: (match: Match, unit: number) => boolean = () => true;

  constructor() {
    this.root.className = 'minimap';
    this.root.append(this.canvas);
  }

  /** The ground changed (a blast, a dig, something built). */
  touch(): void {
    this.dirty = true;
  }

  private drawGround(t: Terrain): void {
    const w = Math.ceil(t.sx / STEP);
    const d = Math.ceil(t.sz / STEP);
    this.w = w;
    this.d = d;
    this.ground.width = w;
    this.ground.height = d;
    const g = this.ground.getContext('2d') as CanvasRenderingContext2D;
    const img = g.createImageData(w, d);
    const high = new Float32Array(w * d);
    const kind = new Int16Array(w * d);
    for (let k = 0; k < d; k++)
      for (let i = 0; i < w; i++) {
        const x = i * STEP;
        const z = k * STEP;
        let j = t.sy - 2;
        while (j > 0 && t.dens[t.idx(x, j, z)] >= 0) j--;
        high[i + k * w] = j;
        kind[i + k * w] = j > 0 ? t.material[t.idx(x, j, z)] : -1;
      }
    for (let k = 0; k < d; k++)
      for (let i = 0; i < w; i++) {
        const n = i + k * w;
        const o = n * 4;
        if (kind[n] < 0) {
          img.data[o + 3] = 0;
          continue;
        }
        const h = high[n] / t.sy;
        // (lit from the upper left: a slope towards it is lighter)
        const slope = (high[n] - high[Math.max(0, i - 1) + Math.max(0, k - 1) * w]) * 0.08;
        const rgb = kind[n] === COLLIDER ? [0.32, 0.32, 0.34] : (MATERIAL_RGB[kind[n]] ?? [0.4, 0.4, 0.4]);
        const l = 0.35 + h * 0.9 + slope;
        for (let c = 0; c < 3; c++) img.data[o + c] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.min(1, rgb[c] * 0.6 + 0.12), 0.7) * l)));
        img.data[o + 3] = 235;
      }
    g.putImageData(img, 0, 0);
  }

  /** `yaw`: where the camera looks (radians, as atan2(x, z)); `eye`: where it is. */
  update(t: Terrain, match: Match, yaw: number, eye: { x: number; z: number }, dt: number, visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) return;
    this.wait -= dt;
    if (this.dirty && this.wait <= 0) {
      this.dirty = false;
      this.wait = AGAIN;
      this.drawGround(t);
    }
    const size = Math.round(this.root.clientWidth * (window.devicePixelRatio || 1));
    if (size <= 0) return;
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    const g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, size, size);
    const u = match.activeUnit.bug;
    // (round the active bug, turned so that the view looks up the map; large, the whole of it round its middle)
    const span = this.big ? Math.hypot(t.sx, t.sz) * 1.02 : Math.max(t.sx, t.sz) * 0.62;
    const cx = this.big ? t.sx / 2 : u.x;
    const cz = this.big ? t.sz / 2 : u.z;
    const k = size / span;
    g.save();
    g.beginPath();
    if (this.big) g.rect(0, 0, size, size);
    else g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(10, 8, 7, 0.82)';
    g.fillRect(0, 0, size, size);
    g.translate(size / 2, size / 2);
    g.rotate(yaw + Math.PI);
    g.scale(k, k);
    g.translate(-cx, -cz);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.ground, 0, 0, this.w * STEP, this.d * STEP);
    // the camera's view
    g.fillStyle = 'rgba(255, 255, 255, 0.1)';
    g.beginPath();
    g.moveTo(eye.x, eye.z);
    g.lineTo(eye.x + Math.sin(yaw - 0.55) * span, eye.z + Math.cos(yaw - 0.55) * span);
    g.lineTo(eye.x + Math.sin(yaw + 0.55) * span, eye.z + Math.cos(yaw + 0.55) * span);
    g.fill();
    const px = (1 / k) * (this.big ? 1.6 : 1);
    g.fillStyle = '#ffc040';
    for (const it of match.items.list) if (it.due === 0) g.fillRect(it.x - 2.2 * px, it.z - 2.2 * px, 4.4 * px, 4.4 * px);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    match.units.forEach((q, n) => {
      if (!q.bug.alive || !this.shows(match, n)) return;
      const r = (q === match.activeUnit ? 5 : 3.8) * px;
      g.fillStyle = TEAMS[q.team] ?? '#fff';
      g.strokeStyle = '#0b0908';
      g.lineWidth = 1.6 * px;
      g.beginPath();
      g.arc(q.bug.x, q.bug.z, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (q !== match.activeUnit) return;
      g.strokeStyle = `rgba(255, 240, 200, ${0.4 + 0.6 * pulse})`;
      g.lineWidth = 1.4 * px;
      g.beginPath();
      g.arc(q.bug.x, q.bug.z, r + (3 + 3 * pulse) * px, 0, Math.PI * 2);
      g.stroke();
    });
    g.restore();
    if (this.big) {
      // (names and health, upright)
      const c = Math.cos(yaw + Math.PI);
      const s = Math.sin(yaw + Math.PI);
      g.font = `600 ${Math.round(size * 0.022)}px Bahnschrift, 'Segoe UI', sans-serif`;
      g.textAlign = 'center';
      match.units.forEach((q, n) => {
        if (!q.bug.alive || !this.shows(match, n)) return;
        const dx = (q.bug.x - cx) * k;
        const dz = (q.bug.z - cz) * k;
        const x = size / 2 + dx * c - dz * s;
        const y = size / 2 + dx * s + dz * c - size * 0.03;
        g.fillStyle = 'rgba(10, 8, 7, 0.8)';
        g.fillRect(x - size * 0.045, y - size * 0.026, size * 0.09, size * 0.036);
        g.fillStyle = TEAMS[q.team] ?? '#fff';
        g.fillText(q.name, x, y - size * 0.002);
        g.fillRect(x - size * 0.04, y + size * 0.004, size * 0.08 * Math.max(0, q.bug.health / q.bug.species.health), size * 0.004);
      });
      return;
    }
    g.strokeStyle = 'rgba(255, 181, 71, 0.85)';
    g.lineWidth = Math.max(2, size * 0.012);
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - g.lineWidth, 0, Math.PI * 2);
    g.stroke();
  }
}
