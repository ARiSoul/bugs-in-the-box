/**
 * The room server: WebSockets on PORT (default 8787), one lobby of rooms in memory. Run it with `npm run server`; behind
 * a reverse proxy (nginx, Caddy) that ends TLS, the game connects with wss://. See docs/ARCHITECTURE.md, "Multiplayer".
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, type Peer } from './room';

const port = Number(process.env.PORT ?? 8787);
/** Rooms nobody is in are cleared after this long. */
const IDLE_MS = 30 * 60 * 1000;
/** A message bigger than this is not read (a batch of inputs is a few hundred bytes). */
const MAX_BYTES = 256 * 1024;

const lobby = new Lobby();
const wss = new WebSocketServer({ port, maxPayload: MAX_BYTES });
wss.on('connection', (ws: WebSocket) => {
  const peer: Peer = { send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)) };
  ws.on('message', (data) => lobby.hear(peer, String(data)));
  ws.on('close', () => lobby.gone(peer));
  ws.on('error', () => lobby.gone(peer));
});
setInterval(() => lobby.sweep(IDLE_MS), 60 * 1000).unref();
console.log(`Bugs in the Box rooms: ws://localhost:${port}`);
