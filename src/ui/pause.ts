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

const LABEL: Record<PauseChoice, [string, string]> = {
  continue: ['Continue', 'Continue'],
  restart: ['Restart', 'Restart? click again'],
  leave: ['Leave match', 'Leave? click again'],
};

/** The box on the page, and its button in the corner of the HUD. */
export class PauseMenu {
  readonly state = new PauseState();
  /** The button in the HUD that opens it. */
  readonly button = document.createElement('button');
  private readonly root = document.createElement('div');
  private readonly choices = new Map<PauseChoice, HTMLButtonElement>();
  private timer = 0;

  constructor(
    private readonly canOpen: () => boolean,
    private readonly on: { open(): void; close(): void; restart(): void; leave(): void },
  ) {
    this.button.className = 'pause-open';
    this.button.title = 'pause (Esc)';
    this.button.setAttribute('aria-label', 'Pause');
    this.button.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 13h28M10 24h28M10 35h28"/></svg>';
    this.button.addEventListener('click', () => {
      this.toggle();
      this.button.blur();
    });
    this.root.id = 'pause';
    this.root.hidden = true;
    this.root.innerHTML = '<div class="pause-box"><h2>Paused</h2></div>';
    const box = this.root.firstElementChild as HTMLElement;
    for (const c of ['continue', 'restart', 'leave'] as const) {
      const b = document.createElement('button');
      b.className = `pause-${c}`;
      b.textContent = LABEL[c][0];
      b.addEventListener('click', () => this.pick(c));
      box.append(b);
      this.choices.set(c, b);
    }
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

  private show(): void {
    this.root.hidden = !this.state.open;
    const now = performance.now();
    for (const [c, b] of this.choices) {
      const waits = this.state.waits(c, now);
      b.textContent = LABEL[c][waits ? 1 : 0];
      b.classList.toggle('armed', waits);
    }
    if (this.state.open) this.choices.get('continue')?.focus();
  }
}
