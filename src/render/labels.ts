import * as THREE from 'three';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

const FONT = "Bahnschrift, 'Segoe UI', system-ui, sans-serif";
/** Label height as a fraction of the view height (about 50 px at 1080p). */
const LABEL_H = 0.046;

function textSprite(width: number, height: number): { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, fog: false, sizeAttenuation: false }));
  sprite.renderOrder = 10;
  return { sprite, ctx, texture };
}

/** Name and health floating above a bug, in its team colour. Redraws only when the health changes. */
export class UnitLabel {
  readonly sprite: THREE.Sprite;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private shown = -1;
  private max = 1;

  constructor(
    private readonly name: string,
    private readonly color: number,
  ) {
    const t = textSprite(256, 72);
    this.sprite = t.sprite;
    this.ctx = t.ctx;
    this.texture = t.texture;
    this.sprite.scale.set(LABEL_H * (256 / 72), LABEL_H, 1);
    this.sprite.center.set(0.5, 0); // anchored at its bottom edge: it sits above the bug, never on it
  }

  /**
   * The label keeps one size on screen (`LABEL_H`), so it reads at any distance and does not shimmer.
   * `cameraDistance` lifts it a little so it stays above the bug. `hidden`: the bug is behind terrain; the
   * label hides, unless it is the active bug's (`active`), which dims.
   */
  update(position: THREE.Vector3, height: number, health: number, visible: boolean, cameraDistance = 0, hidden = false, active = false): void {
    // a bug hidden behind terrain shows no label, except the one whose turn it is (dimmed)
    this.sprite.visible = visible && (!hidden || active);
    if (!this.sprite.visible) return;
    this.sprite.material.opacity = hidden ? 0.45 : 1;
    // (the active bug's lies under its feet: over it are its aim and its mark)
    const under = active && cameraDistance < 45;
    this.sprite.center.y = under ? 1 : 0;
    // a small gap over the top of the bug (`height` is from its centre), a little more from afar
    this.sprite.position.set(position.x, under ? position.y - height * 0.75 : position.y + height + 0.4 + cameraDistance * 0.008, position.z);
    if (health === this.shown) return;
    this.shown = health;
    const { ctx } = this;
    ctx.clearRect(0, 0, 256, 72);
    // a slanted plate with a bar of health along its foot
    this.max = Math.max(this.max, health);
    const slant = (x: number, y: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + h * 0.16, y);
      ctx.lineTo(x + w + h * 0.16, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.fill();
    };
    slant(26, 4, 196, 64, 'rgba(15, 12, 11, 0.8)');
    slant(38, 50, 172, 10, 'rgba(255, 255, 255, 0.2)');
    slant(38, 50, 172 * Math.max(0, health / this.max), 10, hex(this.color));
    ctx.font = `700 29px ${FONT}`;
    ctx.textAlign = 'left';
    // the team colour lifted towards white, so dark team colours read on the plate
    ctx.fillStyle = `color-mix(in srgb, ${hex(this.color)} 60%, white)`;
    ctx.fillText(this.name, 44, 38, 112);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f6efdf';
    ctx.fillText(String(health), 212, 38);
    this.texture.needsUpdate = true;
  }

  /**
   * Put the label's centre on a whole pixel of a `width` × `height` view, so its text does not crawl
   * by sub-pixel steps as the camera moves. Call after `update`, once per frame.
   */
  snap(camera: THREE.Camera, width: number, height: number): void {
    if (!this.sprite.visible) return;
    const p = SNAP.copy(this.sprite.position).project(camera);
    if (p.z > 1) return;
    // (not under the strip at the top of the screen)
    if (p.y < 1.2) p.y = Math.min(p.y, STRIP - LABEL_H * 2);
    p.x = ((Math.round(((p.x + 1) / 2) * width) + 0.5) / width) * 2 - 1;
    p.y = ((Math.round(((p.y + 1) / 2) * height) + 0.5) / height) * 2 - 1;
    this.sprite.position.copy(p.unproject(camera));
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

const SNAP = new THREE.Vector3();
/** The foot of the HUD's strip at the top, in the picture's height (-1..1). */
const STRIP = 0.85;

interface Floating {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  t0: number;
  /** How long it lasts, times the usual. */
  life: number;
  y0: number;
}

/** "-23" numbers that rise and fade where a bug got hurt. */
export class FloatingTexts {
  private readonly items: Floating[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  spawn(text: string, color: number, at: THREE.Vector3, life = 1, size = 1): void {
    const wide = Math.max(128, 24 + text.length * 27);
    const { sprite, ctx, texture } = textSprite(wide, 64);
    ctx.font = `800 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = hex(color);
    ctx.strokeText(text, wide / 2, 48);
    ctx.fillText(text, wide / 2, 48);
    // (sprites keep one screen size, whatever the distance)
    sprite.scale.set((0.065 * size * wide) / 64, 0.065 * size, 1);
    sprite.position.copy(at);
    this.scene.add(sprite);
    this.items.push({ sprite, texture, t0: performance.now(), life, y0: at.y });
  }

  /** Away with those that are shown. */
  clear(): void {
    for (const f of this.items) f.life = 0;
  }

  /** Kept off the strip at the top of the screen. */
  clamp(camera: THREE.Camera, top = STRIP - 0.07, bottom = -2): void {
    for (const f of this.items) {
      const p = SNAP.copy(f.sprite.position).project(camera);
      if (p.z > 1 || p.y > 1.2 || p.y < -1.2 || (p.y < top && p.y > bottom)) continue;
      p.y = p.y < bottom ? bottom : top;
      f.sprite.position.copy(p.unproject(camera));
    }
  }

  update(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      const k = (now - f.t0) / (1400 * f.life);
      if (k >= 1) {
        f.texture.dispose();
        f.sprite.material.dispose();
        this.scene.remove(f.sprite);
        this.items.splice(i, 1);
        continue;
      }
      f.sprite.position.y = f.y0 + k * 2;
      f.sprite.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }
}
