import { CODE_CHARS, isCode } from '../net/protocol';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/**
 * Playing online, the page's part: the box that makes a room with the setup as it is or joins one by its code, the box a
 * room waits in for its second player (its code and its link), and a line in a match: the room, who is there, whose
 * turn, who it waits for.
 */
export class OnlineBox {
  private readonly root = make('div');
  private readonly name: HTMLInputElement;
  private readonly code: HTMLInputElement;
  private readonly note = make('p', 'online-note');

  constructor(
    defaultName: string,
    private readonly on: { create(name: string): Promise<void>; join(code: string, name: string): void; name(name: string): void },
  ) {
    this.root.id = 'online';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Play online');
    const box = make('div', 'online-box');
    box.append(make('h2', '', 'Play online'));
    const who = make('label', 'online-field', '<span>Your name</span>');
    this.name = make('input');
    this.name.maxLength = 24;
    this.name.value = defaultName;
    this.name.addEventListener('change', () => this.on.name(this.name.value.trim()));
    who.append(this.name);
    const create = make('button', 'online-create', '<b>Make a room</b><span>with this map, these teams and rules</span>');
    create.addEventListener('click', () => {
      this.say('Making the room…');
      create.disabled = true;
      void this.on
        .create(this.name.value.trim())
        .catch((e: unknown) => this.say(e instanceof Error ? e.message : String(e), true))
        .finally(() => (create.disabled = false));
    });
    const join = make('div', 'online-join');
    this.code = make('input');
    this.code.placeholder = 'CODE';
    this.code.maxLength = 4;
    this.code.autocapitalize = 'characters';
    this.code.spellcheck = false;
    this.code.addEventListener('input', () => {
      this.code.value = [...this.code.value.toUpperCase()].filter((c) => CODE_CHARS.includes(c)).join('');
    });
    const go = make('button', 'online-go', 'Join');
    const enter = (): void => {
      if (isCode(this.code.value)) this.on.join(this.code.value, this.name.value.trim());
      else this.say('A room code is four letters and digits.', true);
    };
    go.addEventListener('click', enter);
    this.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') enter();
    });
    join.append(make('span', '', 'Or join a room'), this.code, go);
    const close = make('button', 'online-close', 'Close');
    close.addEventListener('click', () => this.toggle(false));
    box.append(who, create, join, this.note, close);
    this.root.append(box);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.toggle(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.root.hidden) {
        e.preventDefault();
        this.toggle(false);
      }
    });
    document.body.append(this.root);
  }

  toggle(on = this.root.hidden): void {
    this.root.hidden = !on;
    if (on) {
      this.say('');
      this.code.focus();
    }
  }

  private say(text: string, bad = false): void {
    this.note.textContent = text;
    this.note.classList.toggle('bad', bad);
  }
}

/** The box a room waits in: its code, its link to send, and the way out. */
export function waitingBox(code: string, link: string, onLeave: () => void): { root: HTMLElement; say(text: string): void } {
  const root = make('div', 'online-wait');
  const text = make('p', '', 'Waiting for the other player…');
  const big = make('div', 'online-code', code);
  const copy = make('button', '', 'Copy the link');
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(link).then(() => (copy.textContent = 'Link copied'));
  });
  const leave = make('button', '', 'Leave');
  leave.addEventListener('click', onLeave);
  const row = make('div', 'online-row');
  row.append(copy, leave);
  root.append(make('h2', '', 'Online room'), big, make('small', '', link), text, row);
  return { root, say: (t) => (text.textContent = t) };
}

/** The line over a match played online. */
export class OnlineStatus {
  readonly root = make('div', 'online-status');

  show(text: string, warn = false): void {
    if (this.root.textContent !== text) this.root.textContent = text;
    this.root.classList.toggle('warn', warn);
  }
}
