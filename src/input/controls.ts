import type { MatchInput } from '../game/match';

/** What a key or an on-screen button does. */
export type Action = 'forward' | 'back' | 'left' | 'right' | 'aimUp' | 'aimDown' | 'run' | 'jump' | 'fire';

/** The player's actions in menu order, with their names. */
export const ACTIONS: readonly { action: Action; label: string }[] = [
  { action: 'forward', label: 'walk forward' },
  { action: 'back', label: 'walk back' },
  { action: 'left', label: 'turn left' },
  { action: 'right', label: 'turn right' },
  { action: 'run', label: 'run (hold)' },
  { action: 'jump', label: 'jump' },
  { action: 'aimUp', label: 'aim higher' },
  { action: 'aimDown', label: 'aim lower' },
  { action: 'fire', label: 'fire (hold to charge)' },
];

/**
 * Default keys (physical positions, so they work on any keyboard layout). The first key of each action
 * is the one the player can change in the menu; the others (arrows, the right shift) always work too.
 */
export const DEFAULT_KEYS: Readonly<Record<Action, readonly string[]>> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  aimUp: ['ArrowUp'],
  aimDown: ['ArrowDown'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  fire: ['KeyQ'],
};

/** Keys the game keeps for itself: weapons and a new match. */
const RESERVED = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyN', 'Escape']);
const WEAPON_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
const STORAGE = 'bugs-in-the-box.keys';

/**
 * Turns held keys and on-screen buttons into one MatchInput per simulation tick.
 *
 *   W / S        walk forward / back        A / D, ← / →   turn (a tap turns a little)
 *   shift        run (held with W / S)      space          jump
 *   ↑ / ↓        aim higher / lower         Q (hold)       charge, release to fire
 *   1–6          pick a weapon              right drag     turn the view; the bug turns with it
 *
 * The keys can be changed (`rebind`, saved in the browser). On-screen buttons (elements with
 * `data-action`) press the same actions, so mouse and touch play the same game.
 */
export class Controls {
  private readonly held = new Set<string>();
  /** Actions held on the on-screen pad. */
  private readonly padHeld = new Set<Action>();
  private keys: Record<Action, string[]>;
  private handled = new Set<string>();
  private jumpQueued = false;
  private weaponQueued = -1;
  private faceX = 0;
  private faceZ = 0;
  private pitch = 0;
  /** True if the last `next()` carried a facing (from `face`). */
  faced = false;
  /** Set while the menu waits for a key to bind: the next key press goes there instead of the game. */
  private capture: ((code: string) => void) | null = null;
  private readonly out: MatchInput = { move: 0, turn: 0, faceX: 0, faceZ: 0, jump: false, run: false, aim: 0, fire: false, weapon: -1 };

  constructor(
    target: Window,
    /** Keys the game does not use (e.g. N for a new match). */
    private readonly onOtherKey: (code: string) => void = () => {},
  ) {
    this.keys = loadKeys();
    this.refresh();
    target.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const done = this.capture;
        this.capture = null;
        done(e.code);
        return;
      }
      if (isTyping(e.target)) return;
      if (!this.handled.has(e.code)) {
        if (!e.repeat) this.onOtherKey(e.code);
        return;
      }
      e.preventDefault(); // no page scrolling, no "click" on a focused button
      if (!e.repeat) this.press(e.code);
    });
    target.addEventListener('keyup', (e) => this.release(e.code));
    target.addEventListener('blur', () => {
      this.held.clear();
      this.padHeld.clear();
    });
  }

  /** The keys of an action (the first one is the player's choice). */
  keysOf(action: Action): readonly string[] {
    return this.keys[action];
  }

  /**
   * Make `code` the main key of `action` (it leaves any other action it was on). Returns false for a key
   * the game keeps for itself (weapons, new match).
   */
  rebind(action: Action, code: string): boolean {
    if (RESERVED.has(code)) return false;
    for (const a of Object.keys(this.keys) as Action[]) {
      if (a !== action) this.keys[a] = this.keys[a].filter((k) => k !== code);
    }
    const rest = DEFAULT_KEYS[action].slice(1).filter((k) => k !== code);
    this.keys[action] = [code, ...rest];
    this.refresh();
    saveKeys(this.keys);
    return true;
  }

  /** Back to the default keys. */
  resetKeys(): void {
    this.keys = copyKeys(DEFAULT_KEYS);
    this.refresh();
    saveKeys(this.keys);
  }

  /** Send the next key press to `done` (the menu is binding a key) instead of the game. */
  captureNextKey(done: (code: string) => void): void {
    this.capture = done;
  }

  /** -1, 0 or +1: the turn keys held right now (without taking the tick's input). */
  get turnHeld(): -1 | 0 | 1 {
    return this.any('right') ? 1 : this.any('left') ? -1 : 0;
  }

  /** Wire every `[data-action]` element under `root` as a hold-down button (mouse and touch). */
  bindButtons(root: HTMLElement): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-action]')) {
      const action = el.dataset.action as Action;
      const up = (e: PointerEvent): void => {
        e.preventDefault();
        this.padHeld.delete(action);
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.padHeld.add(action);
        if (action === 'jump') this.jumpQueued = true;
        el.classList.add('down');
      });
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /**
   * Make the bug face the horizontal direction (x, z) on the next tick (the view's, while the player turns
   * it). Rounded to 1/4096, so the input is short and the same on every client.
   */
  face(x: number, z: number): void {
    const l = Math.sqrt(x * x + z * z);
    if (l < 1e-6) return;
    this.faceX = Math.round((x / l) * 4096) / 4096;
    this.faceZ = Math.round((z / l) * 4096) / 4096;
  }

  /** Raise the aim by `a` radians on the next tick (in a stance), rounded like `face`. */
  tilt(a: number): void {
    this.pitch = Math.round((this.pitch + a) * 4096) / 4096;
  }

  /** The weapons on offer, in the order of the number keys (set by the game). */
  weaponSlots: () => readonly number[] = () => [0, 1, 2, 3, 4, 5];

  selectWeapon(index: number): void {
    this.weaponQueued = index;
  }

  press(code: string): void {
    this.held.add(code);
    if (this.keys.jump.includes(code)) this.jumpQueued = true;
    const w = WEAPON_KEYS.indexOf(code);
    if (w >= 0) this.weaponQueued = this.weaponSlots()[w] ?? -1;
  }

  release(code: string): void {
    this.held.delete(code);
  }

  /** Input for the next tick. The returned object is reused: read it, do not keep it. */
  next(): Readonly<MatchInput> {
    this.out.move = this.any('forward') ? 1 : this.any('back') ? -1 : 0;
    this.out.turn = this.turnHeld;
    this.out.run = this.any('run');
    this.out.aim = this.any('aimUp') ? 1 : this.any('aimDown') ? -1 : 0;
    this.out.fire = this.any('fire');
    this.out.jump = this.jumpQueued;
    this.out.weapon = this.weaponQueued;
    this.out.faceX = this.faceX;
    this.out.faceZ = this.faceZ;
    this.faced = this.faceX !== 0 || this.faceZ !== 0;
    this.jumpQueued = false;
    this.weaponQueued = -1;
    this.faceX = 0;
    this.faceZ = 0;
    this.out.pitch = this.pitch;
    this.pitch = 0;
    return this.out;
  }

  private any(action: Action): boolean {
    if (this.padHeld.has(action)) return true;
    for (const k of this.keys[action]) if (this.held.has(k)) return true;
    return false;
  }

  private refresh(): void {
    this.handled = new Set([...WEAPON_KEYS, ...Object.values(this.keys).flat()]);
  }
}

function copyKeys(k: Readonly<Record<Action, readonly string[]>>): Record<Action, string[]> {
  const out = {} as Record<Action, string[]>;
  for (const a of Object.keys(k) as Action[]) out[a] = [...k[a]];
  return out;
}

/** The saved keys, over the defaults (an unknown or broken entry falls back to them). */
function loadKeys(): Record<Action, string[]> {
  const keys = copyKeys(DEFAULT_KEYS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Partial<Record<Action, unknown>>;
    for (const a of Object.keys(keys) as Action[]) {
      const v = saved[a];
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) keys[a] = v as string[];
    }
  } catch {
    // (no storage, or a broken entry: the defaults)
  }
  return keys;
}

function saveKeys(keys: Record<Action, string[]>): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(keys));
  } catch {
    // (storage unavailable: the keys last for this visit)
  }
}

/** A key's name for the menu ("KeyQ" -> "Q", "ArrowUp" -> "↑", "ShiftLeft" -> "shift"). */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'shift',
    ShiftRight: 'right shift',
    ControlLeft: 'ctrl',
    ControlRight: 'right ctrl',
    AltLeft: 'alt',
    Space: 'space',
    Enter: 'enter',
    Tab: 'tab',
  };
  return names[code] ?? code;
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button']);

/** True while the player is typing in a form field (the seed box), where keys must not play. */
function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
