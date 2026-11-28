/**
 * The room server: WebSockets on PORT (default 8787), one lobby of rooms in memory. Run it with `npm run server`; behind
 * a reverse proxy (nginx, Caddy) that ends TLS, the game connects with wss://. See docs/ARCHITECTURE.md, "Multiplayer".
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, type Peer } from './room';

const port = Number(process.env.PORT ?? 8787);
/** Rooms nobody is in are cleared after this long. */
const IDLE_MS = 30 * 60 * 1000;
/** A message bigger than this is not read (a batch of inputs is a few hundred bytes). */
const MAX_BYTES = 256 * 1024;

const lobby = new Lobby();
/** Plain HTTP: a word for a browser that opens the address, and `/health` for whoever watches the server. */
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: lobby.rooms.size }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bugs in the Box: the room server. The game connects here by WebSocket: open the game itself (npm run dev, http://localhost:5173), then Online.');
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_BYTES });
wss.on('connection', (ws: WebSocket) => {
  const peer: Peer = { send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)) };
  ws.on('message', (data) => lobby.hear(peer, String(data)));
  ws.on('close', () => lobby.gone(peer));
  ws.on('error', () => lobby.gone(peer));
});
setInterval(() => lobby.sweep(IDLE_MS), 60 * 1000).unref();
http.listen(port);
console.log(`Bugs in the Box rooms: ws://localhost:${port}`);
