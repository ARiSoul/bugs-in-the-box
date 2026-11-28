import type { Growth } from '../game/progress';
import type { MatchSetup } from '../sim/record';
import { PROTOCOL, type ToClient, type ToServer } from './protocol';

/** Where the room server is: `?server=` in the address, else this host, port 8787 (ws, or wss under https). */
export function serverUrl(params: URLSearchParams, loc: { protocol: string; hostname: string }): string {
  const s = params.get('server');
  if (s && /^wss?:\/\//.test(s)) return s;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:8787`;
}

/** The token a seat in a room comes back with (kept for this tab only). */
export const tokenKey = (code: string): string => `room:${code}`;

/** A connection to the room server: messages in, messages out, as JSON. */
export class NetClient {
  private ws: WebSocket | null = null;
  private readonly listeners: ((m: ToClient) => void)[] = [];
  /** Called once when the connection is lost (not when it is closed on purpose). */
  onLost: (() => void) | null = null;
  private closing = false;

  constructor(readonly url: string) {}

  /** Open it; resolves once it is open, rejects if it cannot be (in `ms`). */
  open(ms = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`no room server at ${this.url}`));
      }, ms);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`no room server at ${this.url}`));
      });
      ws.addEventListener('message', (e) => {
        let m: ToClient;
        try {
          m = JSON.parse(String(e.data)) as ToClient;
        } catch {
          return;
        }
        for (const l of [...this.listeners]) l(m);
      });
      ws.addEventListener('close', () => {
        if (!this.closing) this.onLost?.();
      });
    });
  }

  on(l: (m: ToClient) => void): () => void {
    this.listeners.push(l);
    return () => this.listeners.splice(this.listeners.indexOf(l) >>> 0, 1);
  }

  /** The first message that `pick` takes (or an error from the server). */
  next<T>(pick: (m: ToClient) => T | null | undefined, ms = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = ms > 0 ? setTimeout(() => (off(), reject(new Error('the room server did not answer'))), ms) : 0;
      const off = this.on((m) => {
        if (m.t === 'error') {
          off();
          clearTimeout(timer);
          reject(new Error(m.message));
          return;
        }
        const v = pick(m);
        if (v === null || v === undefined) return;
        off();
        clearTimeout(timer);
        resolve(v);
      });
    });
  }

  send(m: ToServer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closing = true;
    this.send({ t: 'leave' });
    this.ws?.close();
  }

  /** Make a room with `setup`; its code and this seat's token. */
  async create(name: string, setup: MatchSetup): Promise<{ code: string; token: string }> {
    const seat = this.next((m) => (m.t === 'seat' ? m : null), 8000);
    this.send({ t: 'create', protocol: PROTOCOL, name, setup });
    const s = await seat;
    return { code: s.code, token: s.token };
  }

  /** Take a seat in room `code` (with a token: one's own again). */
  join(code: string, name: string, token: string | undefined, growths: Record<string, Growth>): Promise<{ seat: number; token: string }> {
    const seat = this.next((m) => (m.t === 'seat' ? m : null), 8000);
    this.send({ t: 'join', protocol: PROTOCOL, code, name, token, growths });
    return seat;
  }
}
