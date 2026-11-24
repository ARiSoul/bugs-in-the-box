/**
 * Small pieces to build sounds from: every sound of the game is computed (there are no audio files). Pure, no Web
 * Audio and no DOM, so it runs on a worker and in the tests.
 */
export const SAMPLE_RATE = 44100;
const TAU = Math.PI * 2;

export type Rng = () => number;
/** One sample at `t` seconds. Called in order, so it may keep state (filters, phases). */
export type Voice = (t: number) => number;
export type Samples = Float32Array<ArrayBuffer>;

export function render(seconds: number, voice: Voice): Samples {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = voice(i / SAMPLE_RATE);
  return out;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rises in `attack` seconds, then falls by e every `decay` seconds; 0 before `t` = 0. */
export const strike = (t: number, attack: number, decay: number): number => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay));
export const drive = (x: number, amount: number): number => Math.tanh(x * amount);

export const white = (rng: Rng): (() => number) => () => rng() * 2 - 1;

/** A state variable filter (stable while its cutoff moves). */
class Filter {
  low = 0;
  band = 0;
  high = 0;
  private s1 = 0;
  private s2 = 0;

  run(x: number, hz: number, q: number): this {
    const g = Math.tan((Math.PI * Math.max(10, Math.min(hz, SAMPLE_RATE * 0.45))) / SAMPLE_RATE);
    const k = 1 / q;
    const v = (x - this.s2 - (g + k) * this.s1) / (1 + g * (g + k));
    this.high = v;
    this.band = g * v + this.s1;
    this.low = g * this.band + this.s2;
    this.s1 = g * v + this.band;
    this.s2 = g * this.band + this.low;
    return this;
  }
}

export type Pass = (x: number, hz: number, q?: number) => number;
export const lowpass = (): Pass => {
  const f = new Filter();
  return (x, hz, q = 0.7) => f.run(x, hz, q).low;
};
export const highpass = (): Pass => {
  const f = new Filter();
  return (x, hz, q = 0.7) => f.run(x, hz, q).high;
};
/** (its peak stays at the input's level, whatever its q) */
export const bandpass = (): Pass => {
  const f = new Filter();
  return (x, hz, q = 1) => f.run(x, hz, q).band / q;
};

/** A sine whose frequency may move. */
export const sine = (start = 0): ((hz: number) => number) => {
  let p = start;
  return (hz) => {
    p += hz / SAMPLE_RATE;
    return Math.sin(TAU * p);
  };
};
/** A bright, buzzing wave (a saw with its step rounded off). */
export const saw = (start = 0): ((hz: number) => number) => {
  let p = start;
  return (hz) => {
    const d = Math.max(0, hz) / SAMPLE_RATE;
    p += d;
    if (p >= 1) p -= 1;
    let v = 2 * p - 1;
    if (d === 0) return v;
    if (p < d) v -= (2 - p / d) * (p / d) - 1;
    else if (p > 1 - d) {
      const x = (p - 1) / d;
      v -= x * x + 2 * x + 1;
    }
    return v;
  };
};

/** A struck object: its partials (Hz, level, decay in seconds). */
export const modes =
  (list: readonly (readonly [number, number, number])[]): Voice =>
  (t) => {
    if (t < 0) return 0;
    let v = 0;
    for (const [hz, level, decay] of list) v += Math.sin(TAU * hz * t) * level * Math.exp(-t / decay);
    return v * Math.min(1, t * 2500);
  };

/** Values that wander slowly between -1 and 1, `hz` new ones a second. */
export const wander = (rng: Rng, hz: number): Voice => {
  let a = rng() * 2 - 1;
  let b = rng() * 2 - 1;
  let n = 0;
  return (t) => {
    const x = t * hz;
    while (x >= n + 1) {
      n++;
      a = b;
      b = rng() * 2 - 1;
    }
    const u = x - n;
    return a + (b - a) * u * u * (3 - 2 * u);
  };
};

/** A short sound of which there are many. */
export type Grain = (rng: Rng) => { seconds: number; voice: Voice };

/** Add `count` grains between `t0` and `t1` (more towards `t0` with `lean` above 1). */
export function scatter(out: Float32Array, rng: Rng, count: number, t0: number, t1: number, lean: number, level: (u: number) => number, grain: Grain): void {
  for (let k = 0; k < count; k++) {
    const u = rng() ** lean;
    const start = Math.floor((t0 + (t1 - t0) * u) * SAMPLE_RATE);
    const g = grain(rng);
    const v = level(u) * (0.3 + 0.7 * rng());
    const n = Math.min(Math.floor(g.seconds * SAMPLE_RATE), out.length - start);
    for (let i = 0; i < n; i++) out[start + i] += v * g.voice(i / SAMPLE_RATE);
  }
}

/** No steps at the ends, no direct current, its peak at `peak`. */
export function finish(out: Samples, peak = 0.9, fadeOut = 0.02): Samples {
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  const a = Math.min(out.length, 30);
  const b = Math.max(1, Math.min(out.length, Math.round(fadeOut * SAMPLE_RATE)));
  let top = 1e-9;
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] - mean) * Math.min(1, i / a) * Math.min(1, (out.length - 1 - i) / b);
    top = Math.max(top, Math.abs(out[i]));
  }
  for (let i = 0; i < out.length; i++) out[i] *= peak / top;
  return out;
}

/** A seamless loop: its last `cross` seconds are blended into its start. */
export function loop(out: Samples, cross: number, peak = 0.9): Samples {
  const n = Math.round(cross * SAMPLE_RATE);
  const len = out.length - n;
  const res = out.slice(0, len);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    res[i] = out[i] * Math.sqrt(u) + out[len + i] * Math.sqrt(1 - u);
  }
  let mean = 0;
  for (const v of res) mean += v;
  mean /= len;
  let top = 1e-9;
  for (let i = 0; i < len; i++) top = Math.max(top, Math.abs((res[i] -= mean)));
  for (let i = 0; i < len; i++) res[i] *= peak / top;
  return res;
}
