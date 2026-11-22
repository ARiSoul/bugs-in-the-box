import type { GpuTimer } from '../render/stage';

/** Frames kept by the log: 60 s at 144 Hz, with room to spare. */
const CAPACITY = 12_000;

export interface PerfReport {
  scenario: string;
  map: string;
  backend: string;
  resolution: string;
  userAgent: string;
  gpuAdapter: string;
  frames: number;
  seconds: number;
  frameMs: Stats;
  gpuMs: Stats | null;
  /** GPU frames over the budget (16.6 ms) and over the target average (6.9 ms). */
  gpuOver16_6: number;
  gpuOver6_9: number;
  heapMB: { start: number; end: number; max: number } | null;
}

export interface Stats {
  avg: number;
  p50: number;
  p99: number;
  max: number;
  count: number;
}

/**
 * Frame-time log for `?perf=1`: wall-clock frame intervals and, where the renderer has timestamp
 * queries, GPU time per frame. Buffers are allocated once; recording a frame allocates nothing.
 * `report()` summarises (average, 99th percentile, max) and `download()` saves it as JSON.
 */
export class PerfLog {
  private readonly frame = new Float32Array(CAPACITY);
  private readonly gpu = new Float32Array(CAPACITY);
  private readonly gpuSeen = new Uint8Array(CAPACITY);
  private n = 0;
  private first = -1;
  private startedAt = 0;
  private heapStart = 0;
  private heapMax = 0;
  private running = false;
  gpuAdapter = '';

  constructor(
    private readonly timer: GpuTimer | null,
    private readonly describe: () => { scenario: string; map: string; backend: string; resolution: string },
  ) {}

  /** Start (or restart) recording. `rendererFrame` is the renderer's frame number of the next frame. */
  start(now: number, rendererFrame: number): void {
    this.n = 0;
    this.first = rendererFrame;
    this.startedAt = now;
    this.gpuSeen.fill(0);
    this.heapStart = heap();
    this.heapMax = this.heapStart;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  get recording(): boolean {
    return this.running;
  }

  /** Record one frame interval (ms). Call once per frame after rendering. */
  record(intervalMs: number): void {
    if (!this.running || this.n >= CAPACITY) return;
    this.frame[this.n++] = intervalMs;
    const h = heap();
    if (h > this.heapMax) this.heapMax = h;
    this.timer?.poll(this.onGpu);
  }

  private readonly onGpu = (frame: number, ms: number): void => {
    const i = frame - this.first;
    if (i < 0 || i >= CAPACITY) return;
    this.gpu[i] = ms;
    this.gpuSeen[i] = 1;
  };

  report(now: number): PerfReport {
    const d = this.describe();
    const frames = this.frame.slice(1, this.n); // the first interval spans the start
    const gpu: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.gpuSeen[i]) gpu.push(this.gpu[i]);
    const hs = heap();
    return {
      ...d,
      userAgent: navigator.userAgent,
      gpuAdapter: this.gpuAdapter,
      frames: this.n,
      seconds: (now - this.startedAt) / 1000,
      frameMs: stats(Array.from(frames)),
      gpuMs: gpu.length ? stats(gpu) : null,
      gpuOver16_6: gpu.filter((v) => v > 16.6).length,
      gpuOver6_9: gpu.filter((v) => v > 6.9).length,
      heapMB: hs > 0 ? { start: this.heapStart / 1048576, end: hs / 1048576, max: this.heapMax / 1048576 } : null,
    };
  }

  download(now: number): void {
    const blob = new Blob([JSON.stringify(this.report(now), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `perf-${this.describe().scenario}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

function stats(values: number[]): Stats {
  if (values.length === 0) return { avg: 0, p50: 0, p99: 0, max: 0, count: 0 };
  const v = values.slice().sort((a, b) => a - b);
  const pick = (q: number): number => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  let sum = 0;
  for (const x of v) sum += x;
  return { avg: sum / v.length, p50: pick(0.5), p99: pick(0.99), max: v[v.length - 1], count: v.length };
}

/** JS heap in use (Chrome only), to see allocation churn during a run. */
function heap(): number {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize : 0;
}
