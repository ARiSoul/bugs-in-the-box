import * as THREE from 'three';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function textSprite(width: number, height: number): { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  return { sprite, ctx, texture };
}

/** Name and health floating above a bug, in its team colour. Redraws only when the health changes. */
export class UnitLabel {
  readonly sprite: THREE.Sprite;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private shown = -1;

  constructor(
    private readonly name: string,
    private readonly color: number,
  ) {
    const t = textSprite(256, 72);
    this.sprite = t.sprite;
    this.ctx = t.ctx;
    this.texture = t.texture;
    this.sprite.scale.set(4.2, 1.18, 1);
  }

  update(position: THREE.Vector3, height: number, health: number, visible: boolean): void {
    this.sprite.visible = visible;
    if (!visible) return;
    this.sprite.position.set(position.x, position.y + height, position.z);
    if (health === this.shown) return;
    this.shown = health;
    const { ctx } = this;
    ctx.clearRect(0, 0, 256, 72);
    ctx.font = '600 26px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = hex(this.color);
    ctx.strokeText(this.name, 128, 28);
    ctx.fillText(this.name, 128, 28);
    ctx.font = '700 30px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(String(health), 128, 62);
    ctx.fillText(String(health), 128, 62);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

interface Floating {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  t0: number;
  y0: number;
}

/** "-23" numbers that rise and fade where a bug got hurt. */
export class FloatingTexts {
  private readonly items: Floating[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  spawn(text: string, color: number, at: THREE.Vector3): void {
    const { sprite, ctx, texture } = textSprite(128, 64);
    ctx.font = '800 44px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.fillStyle = hex(color);
    ctx.strokeText(text, 64, 48);
    ctx.fillText(text, 64, 48);
    sprite.scale.set(3, 1.5, 1);
    sprite.position.copy(at);
    this.scene.add(sprite);
    this.items.push({ sprite, texture, t0: performance.now(), y0: at.y });
  }

  update(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      const k = (now - f.t0) / 1400;
      if (k >= 1) {
        f.texture.dispose();
        f.sprite.material.dispose();
        this.scene.remove(f.sprite);
        this.items.splice(i, 1);
        continue;
      }
      f.sprite.position.y = f.y0 + k * 3;
      f.sprite.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }
  }
}
