import type { MatchInput } from '../game/match';

/**
 * Turns held keys and on-screen buttons into one MatchInput per simulation tick.
 *
 *   W / S        walk forward / back        A / D, ← / →   turn (a tap turns a little)
 *   shift        run (held with W / S)      space          jump
 *   ↑ / ↓        aim higher / lower         F (hold)       charge, release to fire
 *   1–4          pick a weapon              right drag     turn the view; the bug turns with it
 *
 * Key codes are physical positions, so this works on any keyboard layout. On-screen buttons
 * (elements with `data-code`) press the same codes, so mouse and touch play the same game.
 */
const FORWARD = ['KeyW'];
const BACK = ['KeyS'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const AIM_UP = ['ArrowUp'];
const AIM_DOWN = ['ArrowDown'];
const RUN = ['ShiftLeft', 'ShiftRight'];
const FIRE = ['KeyF'];
const JUMP = ['Space'];
const WEAPON_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...AIM_UP, ...AIM_DOWN, ...RUN, ...FIRE, ...JUMP, ...WEAPON_KEYS]);

export class Controls {
  private readonly held = new Set<string>();
  private jumpQueued = false;
  private weaponQueued = -1;
  private faceX = 0;
  private faceZ = 0;
  /** True if the last `next()` carried a facing (from `face`). */
  faced = false;
  private readonly out: MatchInput = { move: 0, turn: 0, faceX: 0, faceZ: 0, jump: false, run: false, aim: 0, fire: false, weapon: -1 };

  constructor(
    target: Window,
    /** Keys the game does not use (e.g. N for a new match). */
    private readonly onOtherKey: (code: string) => void = () => {},
  ) {
    target.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (!HANDLED.has(e.code)) {
        if (!e.repeat) this.onOtherKey(e.code);
        return;
      }
      e.preventDefault(); // no page scrolling, no "click" on a focused button
      if (!e.repeat) this.press(e.code);
    });
    target.addEventListener('keyup', (e) => this.release(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Wire every `[data-code]` element under `root` as a hold-down button (mouse and touch). */
  bindButtons(root: HTMLElement): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-code]')) {
      const code = el.dataset.code ?? '';
      const up = (e: PointerEvent): void => {
        e.preventDefault();
        this.release(code);
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.press(code);
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

  selectWeapon(index: number): void {
    this.weaponQueued = index;
  }

  press(code: string): void {
    this.held.add(code);
    if (JUMP.includes(code)) this.jumpQueued = true;
    const w = WEAPON_KEYS.indexOf(code);
    if (w >= 0) this.weaponQueued = w;
  }

  release(code: string): void {
    this.held.delete(code);
  }

  /** Input for the next tick. The returned object is reused: read it, do not keep it. */
  next(): Readonly<MatchInput> {
    const any = (keys: string[]): boolean => keys.some((k) => this.held.has(k));
    this.out.move = any(FORWARD) ? 1 : any(BACK) ? -1 : 0;
    this.out.turn = any(RIGHT) ? 1 : any(LEFT) ? -1 : 0;
    this.out.run = any(RUN);
    this.out.aim = any(AIM_UP) ? 1 : any(AIM_DOWN) ? -1 : 0;
    this.out.fire = any(FIRE);
    this.out.jump = this.jumpQueued;
    this.out.weapon = this.weaponQueued;
    this.out.faceX = this.faceX;
    this.out.faceZ = this.faceZ;
    this.faced = this.faceX !== 0 || this.faceZ !== 0;
    this.jumpQueued = false;
    this.weaponQueued = -1;
    this.faceX = 0;
    this.faceZ = 0;
    return this.out;
  }
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button']);

/** True while the player is typing in a form field (the seed box), where keys must not play. */
function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
