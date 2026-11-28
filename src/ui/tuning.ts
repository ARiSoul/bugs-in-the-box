import type { Settings as Defined, SettingsSet } from '../game/engine';

/** What is kept of a set: its version and what it changes (the rest is as shipped). */
export interface KeptSet {
  version: number;
  changed: Record<string, number>;
}

/** A set as kept (and as exported, and imported), from what was read: anything unknown or wrong is left out. */
export function readKept(of: Defined, raw: unknown): SettingsSet {
  const o = raw && typeof raw === 'object' ? (raw as Partial<KeptSet>) : {};
  const changed: Record<string, number> = {};
  if (o.changed && typeof o.changed === 'object') for (const [k, v] of Object.entries(o.changed)) if (typeof v === 'number') changed[k] = v;
  return of.make(changed, typeof o.version === 'number' && o.version >= 0 ? Math.floor(o.version) : 0);
}

export const keptOf = (s: SettingsSet): KeptSet => ({ version: s.version, changed: { ...s.changed } });

/** How many decimals a step shows. */
const decimals = (step: number): number => (step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));

/**
 * The settings page (local, in development): every setting by its group, with its range; what is changed is marked, and
 * each goes back as shipped by itself or all at once; a set is exported and imported as JSON. The numbers of the
 * simulation take effect from the next match (Restart plays the same match with them).
 */
export class TuningPage {
  private readonly root = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly head = document.createElement('div');
  private readonly search = document.createElement('input');
  private only = false;

  constructor(
    private readonly of: Defined,
    private set: SettingsSet,
    private readonly onChange: (s: SettingsSet) => void,
    /** The set the match being played took (its hash is shown beside the one being made). */
    private readonly playing: () => SettingsSet | null,
    /** More for testing, drawn above the settings (the player's growth, say). */
    private readonly extra: ((into: HTMLElement) => void) | null = null,
  ) {
    this.root.id = 'tuning';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Settings');
    const bar = document.createElement('div');
    bar.className = 'tuning-bar';
    this.search.type = 'search';
    this.search.placeholder = 'Search settings';
    this.search.addEventListener('input', () => this.draw());
    const button = (label: string, title: string, act: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', act);
      return b;
    };
    const changedOnly = button('Changed only', 'show only what differs from the game as shipped', () => {
      this.only = !this.only;
      changedOnly.classList.toggle('on', this.only);
      this.draw();
    });
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((text) => {
        try {
          const read = readKept(this.of, JSON.parse(text));
          this.put(this.of.make(read.changed, this.set.version + 1));
        } catch {
          alert('That file is not a settings set.');
        }
        file.value = '';
      });
    });
    bar.append(
      this.search,
      changedOnly,
      button('Reset all', 'every setting back as shipped', () => {
        if (!this.set.shipped && confirm('Put every setting back as shipped?')) this.put(this.of.make({}, this.set.version + 1));
      }),
      button('Export', 'save this set as a JSON file', () => this.download()),
      button('Import', 'load a set from a JSON file', () => file.click()),
      button('Close', 'close (Esc)', () => this.close()),
      file,
    );
    this.head.className = 'tuning-head';
    this.list.className = 'tuning-list';
    this.root.append(this.head, bar, this.list);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.root.hidden) {
        e.preventDefault();
        this.close();
      }
    });
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  toggle(on = this.root.hidden): void {
    this.root.hidden = !on;
    if (on) {
      this.draw();
      this.search.focus();
    }
  }

  close(): void {
    this.toggle(false);
  }

  /** Draw it again, if it is open (what the extra part shows changed). */
  refresh(): void {
    if (this.open) this.draw();
  }

  private put(s: SettingsSet): void {
    this.set = s;
    this.onChange(s);
    this.draw();
  }

  private download(): void {
    const blob = new Blob([JSON.stringify(keptOf(this.set), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bugs-settings-v${this.set.version}-${this.set.hash}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private draw(): void {
    const playing = this.playing();
    const n = Object.keys(this.set.changed).length;
    const stale = playing !== null && playing.hash !== this.set.hash;
    this.head.innerHTML =
      `<h2>Settings</h2><p>Set <b>v${this.set.version}</b> · <code>${this.set.hash}</code> · ${n === 0 ? 'as shipped' : `${n} changed`}` +
      (stale ? ' · <em>the match being played has other numbers: they apply from the next match (Restart)</em>' : '') +
      '</p>';
    const q = this.search.value.trim().toLowerCase();
    this.list.replaceChildren();
    if (this.extra && !q && !this.only) {
      const box = document.createElement('section');
      box.className = 'tuning-extra';
      this.extra(box);
      this.list.append(box);
    }
    // (one box a group, wherever its settings were defined: a weapon's numbers and its rules together)
    const boxes = new Map<string, HTMLElement>();
    for (const d of this.of.all()) {
      const changed = d.id in this.set.changed;
      if (this.only && !changed) continue;
      if (q && !`${d.group} ${d.label} ${d.id}`.toLowerCase().includes(q)) continue;
      let box = boxes.get(d.group);
      if (!box) {
        box = document.createElement('section');
        box.innerHTML = `<h3>${d.group}</h3>`;
        boxes.set(d.group, box);
        this.list.append(box);
      }
      box.append(this.row(d.id, changed));
    }
    if (!this.list.querySelector('.tuning-row')) this.list.innerHTML = '<p class="tuning-none">Nothing matches.</p>';
  }

  private row(id: string, changed: boolean): HTMLElement {
    const d = this.of.get(id);
    const v = this.set.get(id);
    const k = decimals(d.step);
    const row = document.createElement('div');
    row.className = `tuning-row${changed ? ' changed' : ''}`;
    row.title = `${d.id}${d.help ? ` — ${d.help}` : ''}`;
    const name = document.createElement('span');
    name.textContent = d.label;
    const range = document.createElement('input');
    range.type = 'range';
    const num = document.createElement('input');
    num.type = 'number';
    for (const i of [range, num]) {
      i.min = String(d.min);
      i.max = String(d.max);
      i.step = String(d.step);
      i.value = v.toFixed(k);
    }
    const unit = document.createElement('small');
    unit.textContent = d.unit ?? '';
    const back = document.createElement('button');
    back.className = 'tuning-back';
    back.textContent = '↺';
    back.title = `back as shipped: ${d.value}`;
    back.disabled = !changed;
    back.addEventListener('click', () => this.put(this.set.without(id)));
    range.addEventListener('input', () => {
      num.value = Number(range.value).toFixed(k);
    });
    const commit = (raw: string): void => {
      const x = Number(raw);
      if (!Number.isFinite(x)) return;
      // (on the step's grid, so a slider's float noise is not a change)
      const snapped = Number((Math.round(x / d.step) * d.step).toFixed(k));
      this.put(this.set.with({ [id]: snapped }));
    };
    range.addEventListener('change', () => commit(range.value));
    num.addEventListener('change', () => commit(num.value));
    row.append(name, range, num, unit, back);
    return row;
  }
}
