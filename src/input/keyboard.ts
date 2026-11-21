import type { BugInput } from '../game/bug';

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const JUMP = 'Space';
const HANDLED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, JUMP]);

/**
 * Turns held keys into one BugInput per simulation tick. Key codes are physical positions,
 * so WASD works on any keyboard layout. Jump fires once per key press, not while held.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private jumpPressed = false;
  private readonly out: BugInput = { move: 0, turn: 0, jump: false };

  constructor(
    target: Window,
    private readonly onKey: (code: string) => void = () => {},
  ) {
    target.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (HANDLED.has(e.code)) {
        e.preventDefault(); // no page scrolling, no "click" on a focused button
        if (e.code === JUMP && !e.repeat) this.jumpPressed = true;
        this.held.add(e.code);
      } else if (!e.repeat) {
        this.onKey(e.code);
      }
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Input for the next tick. The returned object is reused: read it, do not keep it. */
  next(): Readonly<BugInput> {
    const any = (keys: Set<string>): boolean => {
      for (const k of keys) if (this.held.has(k)) return true;
      return false;
    };
    this.out.move = any(FORWARD) ? 1 : any(BACK) ? -1 : 0;
    this.out.turn = any(RIGHT) ? 1 : any(LEFT) ? -1 : 0;
    this.out.jump = this.jumpPressed;
    this.jumpPressed = false;
    return this.out;
  }
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button']);

/** True while the player is typing in a form field (the seed box), where keys must not move the bug. */
function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
