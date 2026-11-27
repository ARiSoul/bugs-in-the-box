import { letters } from './lettering';

/**
 * The pause box of a match: Continue, Restart, Leave match. Esc or its button opens it; a local match stops while it is
 * open (an online one will not: the box is then only the way out). Restart and Leave ask a second click.
 */

export type PauseChoice = 'continue' | 'restart' | 'leave';

/** How long a first click on Restart or Leave stays armed for the second (ms). */
export const CONFIRM_MS = 3000;

/** What the box does, without the page (pure: tested on its own). */
export class PauseState {
  open = false;
  /** The choice that waits for its second click, and since when. */
  armed: PauseChoice | null = null;
  private armedAt = 0;

  /** Esc, or the button: open it (if a match may pause now), or close it. True if it changed. */
  toggle(canOpen: boolean): boolean {
    if (this.open) {
      this.close();
      return true;
    }
    if (!canOpen) return false;
    this.open = true;
    this.armed = null;
    return true;
  }

  close(): void {
    this.open = false;
    this.armed = null;
  }

  /** A click on a choice at time `now` (ms): what to do now, or null (only armed: it asks again). */
  choose(c: PauseChoice, now: number): PauseChoice | null {
    if (!this.open) return null;
    if (c === 'continue' || (this.armed === c && now - this.armedAt <= CONFIRM_MS)) {
      this.close();
      return c;
    }
    this.armed = c;
    this.armedAt = now;
    return null;
  }

  /** Whether `c` still waits for its second click at `now`. */
  waits(c: PauseChoice, now: number): boolean {
    return this.armed === c && now - this.armedAt <= CONFIRM_MS;
  }
}

/** What the box tells of the match it stopped. */
export interface PauseInfo {
  place: string;
  turn: number;
  teams: readonly { name: string; color: string; health: number; alive: number }[];
}

const LABEL: Record<PauseChoice, [string, string]> = {
  continue: ['Continue', 'Continue'],
  restart: ['Restart', 'Restart? Click again'],
  leave: ['Leave match', 'Leave? Click again'],
};

const ICON: Record<'restart' | 'leave', string> = {
  restart: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M38 24a14 14 0 1 1-4.1-9.9"/><path d="M36 6v9h-9"/></svg>',
  leave: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M20 8H9v32h11"/><path d="M22 24h19M33 15l9 9-9 9"/></svg>',
};

const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The box on the page, and its button in the corner of the HUD. */
export class PauseMenu {
  readonly state = new PauseState();
  /** The button in the HUD that opens it. */
  readonly button = document.createElement('button');
  private readonly root = document.createElement('div');
  private readonly about = document.createElement('div');
  private readonly choices = new Map<PauseChoice, HTMLButtonElement>();
  private timer = 0;

  constructor(
    private readonly canOpen: () => boolean,
    private readonly on: { open(): void; close(): void; restart(): void; leave(): void },
    private readonly info: () => PauseInfo | null = () => null,
  ) {
    this.button.className = 'pause-open';
    this.button.title = 'pause (Esc)';
    this.button.setAttribute('aria-label', 'Pause');
    this.button.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 11v26M31 11v26"/></svg>';
    this.button.addEventListener('click', () => {
      this.toggle();
      this.button.blur();
    });
    this.root.id = 'pause';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Paused');
    const box = document.createElement('div');
    box.className = 'pause-box';
    const title = document.createElement('div');
    title.className = 'pause-title';
    title.innerHTML = letters('Paused', { fill: '#ffb547', each: 'slam1' });
    this.about.className = 'pause-about';
    const go = document.createElement('button');
    go.className = 'pause-continue';
    go.innerHTML = `<span>${letters('Continue', { fill: '#1b1206', ink: 'none', shadow: 'none', outline: 0, drop: 0 })}</span><kbd>Esc</kbd>`;
    go.setAttribute('aria-label', 'Continue');
    go.addEventListener('click', () => this.pick('continue'));
    this.choices.set('continue', go);
    const row = document.createElement('div');
    row.className = 'pause-row';
    for (const c of ['restart', 'leave'] as const) {
      const b = document.createElement('button');
      b.className = `pause-${c}`;
      b.innerHTML = `${ICON[c]}<span>${LABEL[c][0]}</span><i></i>`;
      b.addEventListener('click', () => this.pick(c));
      row.append(b);
      this.choices.set(c, b);
    }
    box.append(title, this.about, go, row);
    this.root.append(box);
    // (a click beside the box goes on with the match)
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.pick('continue');
    });
    document.body.append(this.root);
  }

  get open(): boolean {
    return this.state.open;
  }

  /** Esc, or the button. True if it opened or closed. */
  toggle(): boolean {
    const was = this.state.open;
    if (!this.state.toggle(!was && this.canOpen())) return false;
    if (this.state.open) this.tell();
    this.show();
    if (this.state.open) this.on.open();
    else this.on.close();
    return true;
  }

  /** Close it, without a choice (the match ended by itself, say). */
  close(): void {
    if (!this.state.open) return;
    this.state.close();
    this.show();
    this.on.close();
  }

  private pick(c: PauseChoice): void {
    const now = performance.now();
    const go = this.state.choose(c, now);
    this.show();
    if (go === null) {
      // (back to its first words once the second click is no longer waited for)
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.show(), CONFIRM_MS + 50);
      return;
    }
    this.on.close();
    if (go === 'restart') this.on.restart();
    else if (go === 'leave') this.on.leave();
  }

  /** Where the match stands: the place, the turn, each side's health. */
  private tell(): void {
    const i = this.info();
    if (!i) {
      this.about.innerHTML = '';
      return;
    }
    const total = i.teams.reduce((s, q) => s + q.health, 0) || 1;
    const sides = i.teams
      .map((q, k) => `<span class="pause-side side${k}" style="--c:${q.color}"><b>${escape(q.name)}</b><em>${q.health}</em><small>${q.alive} left</small></span>`)
      .join('<span class="pause-vs">vs</span>');
    const bar = i.teams.map((q) => `<u style="--c:${q.color};flex:${q.health / total}"></u>`).join('');
    this.about.innerHTML = `<p class="pause-where">${escape(i.place)} <span>·</span> turn ${i.turn}</p><div class="pause-sides">${sides}</div><div class="pause-bar">${bar}</div>`;
  }

  private show(): void {
    this.root.hidden = !this.state.open;
    const now = performance.now();
    for (const [c, b] of this.choices) {
      if (c === 'continue') continue;
      const waits = this.state.waits(c, now);
      (b.querySelector('span') as HTMLElement).textContent = LABEL[c][waits ? 1 : 0];
      b.classList.toggle('armed', waits);
    }
    if (this.state.open) this.choices.get('continue')?.focus();
  }
}
