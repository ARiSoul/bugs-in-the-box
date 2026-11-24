import type { Weapon } from '../game/weapons';

/** The emblems of the special attacks (48 by 48, drawn in the current colour). */
const EMBLEMS: Record<string, string> = {
  // a bow of silk, its string drawn, a dart on it
  'web-bow':
    '<path d="M14 5c17 6 17 32 0 38" fill="none" stroke-width="3.4"/><path d="M14 5 6 24l8 19" fill="none" stroke-width="1.6"/><path d="M6 24h35" stroke-width="2.4"/><path d="m36 18 8 6-8 6" fill="none" stroke-width="2.4"/><path d="M18 12c5 8 5 16 0 24M14 17l12 4M14 31l12-4" fill="none" stroke-width="1.1" opacity=".75"/>',
  // ants in a column, coming
  'ant-column':
    '<g><circle cx="24" cy="9" r="3.4" stroke="none" fill="currentColor"/><ellipse cx="24" cy="17" rx="3.2" ry="4.6" stroke="none" fill="currentColor"/><path d="m21 8-4-4m10 4 4-4M21 14l-6-2m6 5h-7m13-3 6-2m-6 5h7" stroke-width="1.7"/></g><g transform="translate(-13 18) scale(.95)"><circle cx="24" cy="9" r="3.4" stroke="none" fill="currentColor"/><ellipse cx="24" cy="17" rx="3.2" ry="4.6" stroke="none" fill="currentColor"/><path d="M21 14l-6-2m6 5h-7m13-3 6-2m-6 5h7" stroke-width="1.7"/></g><g transform="translate(15 18) scale(.95)"><circle cx="24" cy="9" r="3.4" stroke="none" fill="currentColor"/><ellipse cx="24" cy="17" rx="3.2" ry="4.6" stroke="none" fill="currentColor"/><path d="M21 14l-6-2m6 5h-7m13-3 6-2m-6 5h7" stroke-width="1.7"/></g><path d="m17 43 7 4 7-4" fill="none" stroke-width="2"/>',
  // eyes in the dark
  'blackout-swarm':
    '<g stroke="none" fill="currentColor"><ellipse cx="17" cy="24" rx="5" ry="6.5"/><ellipse cx="31" cy="24" rx="5" ry="6.5"/><circle cx="6" cy="10" r="1.7"/><circle cx="11" cy="10" r="1.7"/><circle cx="34" cy="8" r="1.5"/><circle cx="38.5" cy="8" r="1.5"/><circle cx="40" cy="38" r="1.8"/><circle cx="45" cy="38" r="1.8"/><circle cx="7" cy="39" r="1.4"/><circle cx="11" cy="39" r="1.4"/><circle cx="22" cy="43" r="1.4"/><circle cx="26" cy="43" r="1.4"/><circle cx="20" cy="5" r="1.2"/><circle cx="24" cy="5" r="1.2"/></g>',
};

export const art = (id: string): string => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EMBLEMS[id] ?? '<circle cx="24" cy="24" r="14" stroke-width="3"/>'}</svg>`;

/**
 * A special attack's card: it fills with colour clockwise behind a hand of light as its team loads it, and glows when
 * it is ready. Writes to the DOM only when what it shows changes.
 */
export class SkillCard {
  readonly root = document.createElement('div');
  private readonly hot = document.createElement('div');
  private readonly hand = document.createElement('div');
  private readonly cold = document.createElement('div');
  private shown = -1;
  private weapon = '';
  private key = '';

  constructor(
    private readonly wide: number,
    private readonly high: number,
    private readonly named: boolean,
  ) {
    this.root.className = named ? 'skill' : 'skill small';
    this.root.style.width = `${wide}px`;
    this.root.style.height = `${high}px`;
    this.cold.className = 'face cold';
    this.hot.className = 'face hot';
    this.hand.className = 'hand';
    this.root.append(this.cold, this.hot, this.hand);
  }

  /** Show weapon `w` loaded to `load` (0..1), eased; `key`: what picks it. */
  show(w: Weapon, load: number, key: string): void {
    if (w.id !== this.weapon || key !== this.key) {
      this.weapon = w.id;
      this.key = key;
      const face = art(w.id) + (this.named ? `<b>${w.name}</b><i>${key}</i>` : '');
      this.cold.innerHTML = face;
      this.hot.innerHTML = face;
      this.hot.style.color = `#${w.color.toString(16).padStart(6, '0')}`;
      this.root.setAttribute('aria-label', w.name);
      this.shown = -1;
    }
    const was = this.shown;
    this.shown = was < 0 || Math.abs(load - was) < 0.002 ? load : was + (load - was) * 0.07;
    if (this.shown === was) return;
    const full = this.shown >= 0.999;
    this.root.classList.toggle('ready', full);
    this.root.title = full ? `${w.name}: ready` : `${w.name}: ${Math.floor(this.shown * 100)}%`;
    this.hand.style.opacity = full || this.shown < 0.004 ? '0' : '1';
    this.hand.style.transform = `rotate(${(this.shown * 360).toFixed(1)}deg)`;
    this.hot.style.clipPath = full ? 'none' : this.wedge(this.shown);
  }

  /** The part of the card clockwise from twelve o'clock to `f` of the way round. */
  private wedge(f: number): string {
    const { wide: w, high: h } = this;
    const a = f * Math.PI * 2;
    const x = Math.sin(a);
    const y = -Math.cos(a);
    const k = Math.min(w / 2 / Math.max(1e-6, Math.abs(x)), h / 2 / Math.max(1e-6, Math.abs(y)));
    const p = [`${w / 2}px ${h / 2}px`, `${w / 2}px 0px`];
    const corner = Math.atan2(w, h);
    for (const [at, cx, cy] of [
      [corner, w, 0],
      [Math.PI - corner, w, h],
      [Math.PI + corner, 0, h],
      [Math.PI * 2 - corner, 0, 0],
    ])
      if (a > at) p.push(`${cx}px ${cy}px`);
    p.push(`${(w / 2 + x * k).toFixed(1)}px ${(h / 2 + y * k).toFixed(1)}px`);
    return `polygon(${p.join(',')})`;
  }
}
