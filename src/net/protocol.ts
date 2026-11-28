import type { Growth } from '../game/progress';
import type { InputChange, MatchSetup } from '../sim/record';

/**
 * What clients and the room server say to each other (JSON over a WebSocket). A match goes over the wire as its setup
 * and its inputs: each client simulates it, and the server too, to check. Pure data, shared by both sides.
 */
export const PROTOCOL = 1;

/** A batch of inputs of the ticks `from` to `upTo` (not included), from the player whose turn they are. */
export interface Inputs {
  readonly t: 'inputs';
  readonly from: number;
  readonly upTo: number;
  readonly changes: readonly InputChange[];
}

export type ToServer =
  | { readonly t: 'create'; readonly protocol: number; readonly name: string; readonly setup: MatchSetup }
  /** `growths`: what its player has grown with each species (the room's creator chose which it plays). */
  | { readonly t: 'join'; readonly protocol: number; readonly code: string; readonly name: string; readonly token?: string; readonly growths?: Readonly<Record<string, Growth>> }
  | Inputs
  /** A checkpoint of the match as this client has it (see `sim/record.ts`). */
  | { readonly t: 'check'; readonly tick: number; readonly digest: string }
  /** On its own turn, this client holds the match (reading, or paused), with so many seconds of it left; null: no more. */
  | Hold
  | { readonly t: 'leave' };

/** Why a player holds the match on its own turn. */
export type HoldWhy = 'reading' | 'paused';
export interface Hold {
  readonly t: 'hold';
  readonly why: HoldWhy | null;
  readonly left: number;
}

export type ToClient =
  /** The room is made, or joined: this client's seat (its team), and the token to come back with. */
  | { readonly t: 'seat'; readonly code: string; readonly seat: number; readonly token: string }
  /** Both seats are taken: the match, as both play it, and every input so far (for one that comes back). */
  | { readonly t: 'start'; readonly setup: MatchSetup; readonly inputs: readonly InputChange[]; readonly known: number }
  | Inputs
  /** The other holds the match on its turn: why, and how long it still may (null: it goes on). */
  | { readonly t: 'held'; readonly seat: number; readonly why: HoldWhy | null; readonly left: number }
  /** Who is there, by seat, and their names. */
  | { readonly t: 'presence'; readonly here: readonly boolean[]; readonly names: readonly string[] }
  /** A client's match went another way from the server's at this checkpoint. */
  | { readonly t: 'desync'; readonly tick: number; readonly seat: number }
  /** What was sent was not taken (not its turn, a tick out of order...). */
  | { readonly t: 'refused'; readonly why: string }
  | { readonly t: 'error'; readonly message: string };

/** Room codes: four letters and digits that cannot be mistaken for each other. */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const isCode = (s: unknown): s is string => typeof s === 'string' && s.length === 4 && [...s].every((c) => CODE_CHARS.includes(c));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** A batch of inputs, if `m` is a well-formed one: its changes in order, inside its ticks. */
export function readInputs(m: Record<string, unknown>): Inputs | null {
  if (m.t !== 'inputs' || !isInt(m.from) || !isInt(m.upTo) || m.upTo < m.from || !Array.isArray(m.changes)) return null;
  let last = -1;
  for (const c of m.changes) {
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0]) || !isObj(c[1])) return null;
    if (c[0] < m.from || c[0] >= m.upTo || c[0] <= last) return null;
    last = c[0];
  }
  return { t: 'inputs', from: m.from, upTo: m.upTo, changes: m.changes as InputChange[] };
}

/** What a client sent, if it is something the server takes (anything else: null). */
export function readToServer(raw: string): ToServer | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  const name = typeof m.name === 'string' ? m.name.slice(0, 24) : '';
  switch (m.t) {
    case 'create':
      return isObj(m.setup) && m.protocol === PROTOCOL ? { t: 'create', protocol: PROTOCOL, name, setup: m.setup as unknown as MatchSetup } : null;
    case 'join':
      return isCode(m.code) && m.protocol === PROTOCOL
        ? { t: 'join', protocol: PROTOCOL, code: m.code, name, token: typeof m.token === 'string' ? m.token : undefined, growths: isObj(m.growths) ? (m.growths as unknown as Record<string, Growth>) : undefined }
        : null;
    case 'inputs':
      return readInputs(m);
    case 'check':
      return isInt(m.tick) && typeof m.digest === 'string' ? { t: 'check', tick: m.tick, digest: m.digest.slice(0, 16) } : null;
    case 'hold':
      return m.why === null || m.why === 'reading' || m.why === 'paused' ? { t: 'hold', why: m.why, left: typeof m.left === 'number' && Number.isFinite(m.left) ? Math.max(0, Math.min(3600, m.left)) : 0 } : null;
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}
