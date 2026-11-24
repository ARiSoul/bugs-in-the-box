interface Ant {
  x: number;
  dir: number;
  speed: number;
  size: number;
  phase: number;
  scare: number;
  /** Seconds it stops to look round. */
  rest: number;
  load: boolean;
  /** Seconds it has lain flat (-1: alive). */
  flat: number;
}

const COUNT = 18;
const HIGH = 34;

/** Small ants that march along the edge of the menu's bar, some with a crumb of solder; the pointer scatters them, a click flattens one. */
export class Marchers {
  readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
  private ants: Ant[] = [];
  private frame = 0;
  private last = 0;
  private mouse = { x: -999, y: -999 };
  /** They run for the button. */
  hurry = false;

  constructor() {
    this.canvas.className = 'marchers';
    this.canvas.setAttribute('aria-hidden', 'true');
    window.addEventListener('pointermove', (e) => {
      if (!this.frame) return;
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      const w = this.canvas.clientWidth;
      for (const a of this.ants) if (a.flat < 0 && Math.abs(a.x * w - e.offsetX) < 18) a.flat = 0;
    });
  }

  start(): void {
    if (this.frame) return;
    if (this.ants.length === 0)
      for (let i = 0; i < COUNT; i++)
        this.ants.push({ x: (i + Math.random() * 0.7) / COUNT, dir: i % 6 === 0 ? -1 : 1, speed: 26 + Math.random() * 14, size: 0.95 + Math.random() * 0.35, phase: Math.random() * 6, scare: 0, rest: 0, load: i % 4 === 1, flat: -1 });
    this.last = performance.now();
    const loop = (now: number): void => {
      this.frame = requestAnimationFrame(loop);
      this.draw(Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private draw(dt: number): void {
    const c = this.canvas;
    const w = c.clientWidth;
    const k = Math.min(2, devicePixelRatio);
    if (c.width !== Math.round(w * k) || c.height !== HIGH * k) {
      c.width = Math.round(w * k);
      c.height = HIGH * k;
    }
    const g = this.g;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, w, HIGH);
    for (const a of this.ants) {
      if (a.flat >= 0) {
        a.flat += dt;
        if (a.flat > 2.2) {
          a.flat = -1;
          a.x = a.dir > 0 ? -0.04 : 1.04;
        }
      }
      const x = a.x * w;
      const d = x - this.mouse.x;
      if (a.flat < 0 && Math.abs(d) < 70 && this.mouse.y > -60 && this.mouse.y < 70 && a.scare <= 0) {
        a.scare = 0.9;
        a.dir = d >= 0 ? 1 : -1;
      }
      a.scare -= dt;
      if (a.scare <= 0 && a.rest <= 0 && Math.random() < dt * 0.12) a.rest = 0.5 + Math.random();
      a.rest -= dt;
      if (this.hurry && a.scare <= 0) a.dir = 1;
      const v = a.flat >= 0 ? 0 : a.scare > 0 ? 210 : this.hurry ? 150 : a.rest > 0 ? 0 : a.speed;
      a.phase += v * dt * 0.5;
      a.x += (a.dir * v * dt) / Math.max(1, w);
      if (a.x > 1.04) a.x = -0.04;
      else if (a.x < -0.04) a.x = 1.04;
      this.ant(a, a.x * w, HIGH - 1, a.x < 0.5 ? '#ff6b55' : '#5fb4ff');
    }
  }

  private ant(a: Ant, x: number, y: number, color: string): void {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.scale(a.dir * a.size * (a.flat >= 0 ? 1.3 : 1), a.size * (a.flat >= 0 ? 0.22 : 1));
    g.globalAlpha = a.flat > 1.6 ? Math.max(0, (2.2 - a.flat) / 0.6) : 1;
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const pair = Math.floor(i / 2);
      const beat = a.phase + (i % 2 ? Math.PI : 0) + pair * 0.9;
      const hip = -2.5 + pair * 2.6;
      const foot = hip + (pair - 1) * 4.2 + Math.sin(beat) * 2;
      g.moveTo(hip, -7);
      g.lineTo((hip + foot) / 2 + (pair - 1), -9.6);
      g.lineTo(foot, -Math.max(0, Math.cos(beat)) * 1.8);
    }
    const wag = a.rest > 0 ? Math.sin(performance.now() * 0.012) * 1.5 : 0;
    g.moveTo(8, -9.5);
    g.lineTo(12, -13 + wag);
    g.moveTo(8, -9.5);
    g.lineTo(13, -11 - wag);
    g.stroke();
    g.beginPath();
    g.ellipse(-6.5, -7.6, 5, 3.6, 0.15, 0, 7);
    g.ellipse(0.5, -7.2, 3, 2.2, 0, 0, 7);
    g.ellipse(6, -8.2, 3, 2.7, 0, 0, 7);
    g.fill();
    if (a.load && a.flat < 0) {
      g.fillStyle = '#ffd27a';
      g.beginPath();
      g.ellipse(6, -14.5, 4.4, 3.4, 0.3, 0, 7);
      g.fill();
    }
    g.restore();
  }
}
