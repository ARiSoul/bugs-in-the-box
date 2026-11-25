import type { SoundEngine } from '../audio/SoundEngine';

type Level = 'volume' | 'music' | 'room';
const LEVELS: readonly [Level, string, string][] = [
  ['volume', 'Volume', 'everything'],
  ['music', 'Music', 'the themes'],
  ['room', 'Room', 'the sound of the place'],
];

/** The sound settings, kept in the browser by the engine: the match menu's row, and the setup screen's panel, in step. */
export class SoundMenu {
  private readonly shown: (() => void)[] = [];

  constructor(private readonly engine: SoundEngine) {
    const id = (name: string): HTMLElement => document.getElementById(name) as HTMLElement;
    this.slider(id('volume') as HTMLInputElement, 'volume');
    this.slider(id('roomVolume') as HTMLInputElement, 'room');
    this.slider(id('musicVolume') as HTMLInputElement, 'music');
    const mute = id('mute');
    mute.addEventListener('click', () => {
      this.toggle();
      mute.blur();
    });
    this.shown.push(() => {
      mute.textContent = engine.settings.muted ? 'sound: off' : 'sound: on';
      mute.classList.toggle('on', engine.settings.muted);
    });
    this.show();
  }

  toggle(): void {
    this.engine.settings.muted = !this.engine.settings.muted;
    this.engine.apply();
    this.show();
  }

  /** A button that opens a panel with the settings (for the setup screen). */
  panel(): HTMLElement {
    const { engine } = this;
    const root = document.createElement('div');
    root.className = 'audio';
    root.innerHTML =
      '<button class="audio-open" aria-label="Sound settings" aria-expanded="false" title="sound (M in the menus, K in a match: on / off)"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 18h8l12-10v32L14 30H6z"/><g class="waves"><path d="M32 17q6 7 0 14"/><path d="M37 11q11 13 0 26"/></g><path class="cross" d="M32 18l11 12M43 18 32 30"/></svg></button>' +
      '<div class="audio-panel" hidden><h3>Sound</h3></div>';
    const open = root.firstElementChild as HTMLButtonElement;
    const box = root.lastElementChild as HTMLElement;
    for (const [level, name, what] of LEVELS) {
      const label = document.createElement('label');
      label.innerHTML = `<span><b>${name}</b><small>${what}</small></span><input type="range" min="0" max="100" aria-label="${name}" /><output></output>`;
      const input = label.querySelector('input') as HTMLInputElement;
      const out = label.querySelector('output') as HTMLOutputElement;
      this.slider(input, level);
      this.shown.push(() => {
        out.textContent = input.value;
        input.style.setProperty('--at', `${input.value}%`);
      });
      box.append(label);
    }
    const mute = document.createElement('button');
    mute.className = 'audio-mute';
    mute.addEventListener('click', () => this.toggle());
    box.append(mute);
    this.shown.push(() => {
      mute.textContent = engine.settings.muted ? 'Turn the sound on' : 'Mute everything';
      root.classList.toggle('muted', engine.settings.muted);
    });
    const set = (on: boolean): void => {
      box.hidden = !on;
      open.setAttribute('aria-expanded', String(on));
    };
    open.addEventListener('click', () => set(box.hidden !== false));
    // (a click anywhere else, or Escape, puts it away)
    window.addEventListener('pointerdown', (e) => {
      if (!box.hidden && !root.contains(e.target as Node)) set(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !box.hidden) set(false);
    });
    this.show();
    return root;
  }

  private slider(input: HTMLInputElement, level: Level): void {
    const s = this.engine.settings;
    this.shown.push(() => {
      input.value = String(Math.round(s[level] * 100));
    });
    input.addEventListener('input', () => {
      s[level] = Number(input.value) / 100;
      this.engine.apply();
      this.show();
    });
    // (the keys are the game's again, and a change of volume is heard)
    input.addEventListener('change', () => {
      input.blur();
      if (level === 'volume') this.engine.play('turn');
    });
  }

  private show(): void {
    for (const f of this.shown) f();
  }
}
