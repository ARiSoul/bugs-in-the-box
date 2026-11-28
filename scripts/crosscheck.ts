/**
 * Two clients, one match: whole matches recorded in Node are played again in a real browser (headless Chrome, over the
 * dev server), and the browser's own recordings are played again in Node; every checkpoint and the ground must match,
 * bit for bit. Needs the dev server running (`npm run dev`): `npm run crosscheck -- [port] [ticks] [chrome path]`.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computerGrowth } from '../src/game/progress';
import { TUNING } from '../src/game/tuning';
import { SCENARIOS } from '../src/terrain/scenarios';
import { playRecorded, replay, type MatchRecord, type MatchSetup } from '../src/sim';

const port = Number(process.argv[2] ?? 5173);
const ticks = Number(process.argv[3] ?? 3600);
const chrome = process.argv[4] ?? 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One match per map, the species and levels varied, on a smaller map to keep it quick. */
const PAIRS: [string, string][] = [['ant', 'spider'], ['cockroach', 'bee'], ['bee', 'ant'], ['spider', 'cockroach'], ['ant', 'bee'], ['spider', 'ant']];
const tuning = TUNING.defaults();
const setups: MatchSetup[] = SCENARIOS.map((sc, i) => {
  const [a, b] = PAIRS[i % PAIRS.length];
  const levels = [1 + ((i * 3) % 10), 1 + ((i * 7) % 10)];
  return {
    scenario: sc.id,
    size: sc.mapSize ? [...sc.mapSize] as [number, number, number] : [4, 2, 4],
    seed: 11 + i * 17,
    teams: [a, b].map((species, k) => ({ name: `${species} ${k}`, species, color: 0, size: 3, growth: computerGrowth(species, levels[k]) })),
    rules: { turnSeconds: 30, wind: 1 },
    tuning: { version: tuning.version, changed: {}, hash: tuning.hash },
    fresh: true,
  };
});

async function browser(): Promise<{ run: <T>(expr: string) => Promise<T>; close: () => void }> {
  const cdp = 9400 + Math.floor(Math.random() * 400);
  const p = spawn(chrome, ['--headless=new', `--remote-debugging-port=${cdp}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cross-'))}`, '--use-angle=d3d11', '--enable-unsafe-webgpu', 'about:blank'], { stdio: 'ignore' });
  let ws: WebSocket | null = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // (not up yet)
    }
  }
  if (!ws) throw new Error('no browser');
  const sock = ws;
  await new Promise((r) => sock.addEventListener('open', r));
  let id = 0;
  const waits = new Map<number, (d: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>();
  sock.addEventListener('message', (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && waits.has(d.id)) {
      waits.get(d.id)?.(d);
      waits.delete(d.id);
    }
  });
  const send = (method: string, params: object = {}): Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }> =>
    new Promise((r) => {
      const n = ++id;
      waits.set(n, r);
      sock.send(JSON.stringify({ id: n, method, params }));
    });
  // (a light page of the dev server: the modules are what is wanted, not the game)
  await send('Page.navigate', { url: `http://localhost:${port}/src/sim/index.ts` });
  await sleep(1500);
  const run = async <T>(expr: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value as T;
  };
  return { run, close: () => (sock.close(), p.kill()) };
}

const b = await browser();
const ua = await b.run<string>('navigator.userAgent');
console.log(`Node ${process.version} · ${ua.match(/Chrome\/[\d.]+/)?.[0] ?? ua} · ${ticks} ticks a match`);
let bad = 0;
for (const setup of setups) {
  const t0 = performance.now();
  const node = playRecorded(setup, ticks);
  const self = replay(node);
  // (the browser plays Node's record again, and records the same match itself)
  const there = await b.run<{ same: boolean; firstDiff: number; rec: MatchRecord }>(
    `(async () => { const sim = await import('/src/sim/index.ts'); const r = sim.replay(${JSON.stringify(node)}); const rec = sim.playRecorded(${JSON.stringify(setup)}, ${ticks}); return { same: r.same, firstDiff: r.firstDiff, rec }; })()`,
  );
  const back = replay(there.rec);
  const sameRecord = JSON.stringify(there.rec) === JSON.stringify(node);
  const ok = self.same && there.same && back.same && sameRecord;
  if (!ok) bad++;
  console.log(
    `${ok ? 'same' : 'DIFFERS'}  ${setup.scenario.padEnd(10)} ${node.ticks} ticks, ${node.inputs.length} inputs, ${node.checkpoints.length} checkpoints · Node again ${self.same ? 'same' : `differs at ${self.firstDiff}`} · browser plays Node's ${there.same ? 'same' : `differs at ${there.firstDiff}`} · Node plays the browser's ${back.same ? 'same' : `differs at ${back.firstDiff}`} · records ${sameRecord ? 'identical' : 'differ'} · ${Math.round(performance.now() - t0)} ms`,
  );
}
b.close();
console.log(bad ? `${bad} of ${setups.length} differ` : `all ${setups.length} the same, bit for bit`);
process.exit(bad ? 1 : 0);
