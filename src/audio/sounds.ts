import { createRng } from '../terrain/noise';
import { bandpass, clamp01, drive, finish, highpass, loop, lowpass, modes, render, SAMPLE_RATE, saw, scatter, sine, smooth, strike, wander, white, type Grain, type Rng, type Samples, type Voice } from './dsp';

/** Every sound of the game as a recipe. */
export interface SoundRecipe {
  /** How many different takes there are (one is picked at each play; default 1). */
  variants?: number;
  /** It repeats without a seam. */
  loop?: boolean;
  /** Level at which it plays. */
  level: number;
  make: (rng: Rng) => Samples;
}

// ---------------------------------------------------------------- shared pieces

/** A dry little knock (a claw, a pebble, a chip of plastic). */
const knock =
  (hz: number, decay: number): Grain =>
  (r) => {
    const f = hz * (0.6 + 0.9 * r());
    const n = white(r);
    const b = bandpass();
    return { seconds: decay * 6, voice: (t) => strike(t, 0.0006, decay) * (b(n(), f, 3) * 4 + 0.5 * Math.sin(6.283 * f * t)) };
  };

/** A blast: a crack, a body that falls in pitch, a roar that darkens, and rubble after it. */
function blast(r: Rng, seconds: number, low: number, rubble: number): Samples {
  const n = white(r);
  const roar = lowpass();
  const rumble = lowpass();
  const crack = highpass();
  const body = sine();
  const wob = wander(r, 26);
  const out = render(seconds, (t) => {
    const x = n();
    const c = crack(x, 1800) * strike(t, 0.0005, 0.018) * 0.9;
    const b = body(low * (1 + 3.2 * Math.exp(-t * 22))) * strike(t, 0.002, seconds * 0.16) * 1.25;
    const m = roar(x, 260 + 5200 * Math.exp(-t * 9), 0.8) * strike(t, 0.003, seconds * 0.13) * (1 + 0.35 * wob(t)) * 1.5;
    const g = rumble(x, 120, 0.9) * smooth(0.01, 0.09, t) * Math.exp(-t / (seconds * 0.26)) * 3.2;
    return drive(c + b + m + g, 1.5);
  });
  scatter(out, r, rubble, 0.09, seconds * 0.85, 1.7, (u) => 0.16 * (1 - u), knock(1500, 0.008));
  return finish(out, 0.95, seconds * 0.25);
}

/** A blast into the ground: muffled, no crack, a thud and a long fall of earth and crumbs. */
function groundBlast(r: Rng, seconds: number, low: number, rubble: number): Samples {
  const n = white(r);
  const lp = lowpass();
  const body = sine();
  const w = wander(r, 18);
  const out = render(seconds, (t) => drive(body(low * (1 + 1.6 * Math.exp(-t * 26))) * strike(t, 0.004, seconds * 0.11) * 1.4 + lp(n(), 130 + 900 * Math.exp(-t * 16), 0.8) * strike(t, 0.006, seconds * 0.14) * (1 + 0.4 * w(t)) * 1.9, 1.3));
  scatter(out, r, rubble, 0.12, seconds * 0.95, 1.2, (u) => 0.3 * (1 - u), knock(380, 0.014));
  return finish(out, 0.92, seconds * 0.25);
}

/** Air going past: its pitch goes from `f0` to `f1` to `f2` Hz. */
function whoosh(r: Rng, seconds: number, f0: number, f1: number, f2: number, q: number, peakAt = 0.4): Samples {
  const n = white(r);
  const b = bandpass();
  const b2 = bandpass();
  return finish(
    render(seconds, (t) => {
      const u = t / seconds;
      const f = u < peakAt ? f0 * (f1 / f0) ** (u / peakAt) : f1 * (f2 / f1) ** ((u - peakAt) / (1 - peakAt));
      const e = (smooth(0, peakAt, u) * (1 - smooth(peakAt, 1, u))) ** 1.3;
      const x = n();
      return (b(x, f, q) + 0.5 * b2(x, f * 2.1, q)) * e;
    }),
  );
}

/** Bright partials that come in one after another and shimmer. */
function shimmer(r: Rng, seconds: number, base: number, rise: number, attack: number): Samples {
  const voices = [1, 1.5, 2, 2.67, 3, 4, 5.33, 6, 8].map((k, i) => ({ s: sine(r()), f: base * k * (1 + 0.006 * (r() - 0.5)), w: wander(r, 4 + 5 * r()), a: 1 / (1 + i * 0.45), d: 0.12 * r() * seconds }));
  return finish(
    render(seconds, (t) => {
      let v = 0;
      for (const o of voices) v += o.s(o.f * (1 + rise * (t / seconds))) * o.a * (0.6 + 0.4 * o.w(t)) * smooth(o.d, o.d + attack, t);
      return v * Math.exp(-Math.max(0, t - attack) * (2.6 / seconds)) * (1 - smooth(seconds * 0.7, seconds, t));
    }),
  );
}

/** A low drone that swells to its end. */
function riser(r: Rng, seconds: number, f0: number, f1: number): Samples {
  const a = saw(r());
  const b = saw(r());
  const c = sine();
  const lp = lowpass();
  const n = white(r);
  const air = bandpass();
  return finish(
    render(seconds, (t) => {
      const u = t / seconds;
      const f = f0 * (f1 / f0) ** (u * u);
      const x = a(f) + b(f * 1.008) + c(f * 0.5) * 1.4;
      return (lp(x, 140 + 1500 * u * u, 1.1) + air(n(), 400 + 3000 * u * u, 1.2) * 0.9 * u) * u ** 1.6;
    }),
    0.9,
    0.06,
  );
}

/** A small chirring mouth, for a crowd. */
const chirr: Grain = (r) => {
  const f = 2200 + 3200 * r();
  const rate = 60 + 90 * r();
  const len = 0.05 + 0.09 * r();
  const n = white(r);
  const b = bandpass();
  return { seconds: len, voice: (t) => b(n(), f, 6) * (0.5 + 0.5 * Math.sin(6.283 * rate * t)) ** 2 * Math.sin((Math.PI * t) / len) * 5 };
};

/** Many small feet and mouths. */
function crowd(r: Rng, seconds: number, feet: number, mouths: number): Samples {
  const cross = 0.5;
  const n = white(r);
  const lp = bandpass();
  const w = wander(r, 9);
  const out = render(seconds + cross, (t) => lp(n(), 700, 0.6) * 0.05 * (1 + 0.5 * w(t)));
  scatter(out, r, feet * seconds, 0, seconds + cross, 1, () => 0.35, knock(2300, 0.004));
  scatter(out, r, mouths * seconds, 0, seconds + cross, 1, () => 0.4, chirr);
  return loop(out, cross);
}

/** Air moved by a fan: noise, and the blades' tone. */
function fan(r: Rng, blade: number, cut: number, tone: number): Voice {
  const n = white(r);
  const lp = lowpass();
  const lp2 = lowpass();
  const a = sine(r());
  const b = sine(r());
  const w = wander(r, 0.7);
  return (t) => lp2(lp(n(), cut), cut * 1.6) * 0.9 + tone * (a(blade) + 0.5 * b(blade * 2)) * (1 + 0.15 * w(t));
}

/** Mains hum (50 Hz, and what a transformer adds to it). */
function hum(level: number): Voice {
  const a = sine();
  const b = sine(0.2);
  const c = sine(0.6);
  return () => (a(50) * 0.3 + b(100) + c(200) * 0.35) * level;
}

/** A quiet room: dark noise that breathes. */
function room(r: Rng, cut: number): Voice {
  const n = white(r);
  const lp = lowpass();
  const hp = highpass();
  const w = wander(r, 0.25);
  return (t) => hp(lp(n(), cut * (1 + 0.2 * w(t)), 0.5), 40) * (1 + 0.25 * w(t));
}

function hiss(r: Rng, hz: number, level: number): Voice {
  const n = white(r);
  const h = highpass();
  return () => h(n(), hz) * level;
}

/** The seconds an ambience repeats after. */
const AMBIENCE = 8;
const ambience =
  (voices: (r: Rng) => Voice[], more?: (out: Float32Array, r: Rng) => void) =>
  (r: Rng): Samples => {
    const list = voices(r);
    const out = render(AMBIENCE + 1.5, (t) => {
      let v = 0;
      for (const x of list) v += x(t);
      return v;
    });
    const res = loop(out, 1.5, 0.6);
    // (things that happen in it, away from its seam)
    more?.(res, r);
    return res;
  };

/** The sound of a step of the scale: semitones from A4. */
const pitch = (semitones: number): number => 440 * 2 ** (semitones / 12);
/** A plucked, warm little tone. */
const pluck = (hz: number, decay: number): Voice => modes([[hz, 1, decay], [hz * 2, 0.4, decay * 0.6], [hz * 3.01, 0.18, decay * 0.4], [hz * 4.2, 0.08, decay * 0.25]]);
const plucks =
  (low: number, high: number, decay: number): Grain =>
  (r) => ({ seconds: decay * 5, voice: pluck(low + (high - low) * r(), decay) });
/** Notes: when, which (semitones from A4), how long they ring. */
function tune(seconds: number, notes: readonly (readonly [number, number, number])[]): Samples {
  const v = notes.map(([at, n, d]) => ({ at, p: pluck(pitch(n), d) }));
  return finish(
    render(seconds, (t) => {
      let s = 0;
      for (const o of v) s += o.p(t - o.at);
      return s;
    }),
    0.9,
    Math.min(0.1, seconds * 0.4),
  );
}

/** A snap of something dry. */
const snap: Grain = (r) => {
  const f = 500 + 2600 * r();
  const n = white(r);
  const b = bandpass();
  const d = 0.004 + 0.012 * r();
  return { seconds: d * 7, voice: (t) => drive(b(n(), f, 1.6) * 8, 1.3) * strike(t, 0.0004, d) };
};

/** Ground or plastic that splits: a run of snaps. */
function cracking(r: Rng, seconds: number, count: number, lean: number): Samples {
  const n = white(r);
  const lp = lowpass();
  const out = render(seconds, (t) => lp(n(), 170, 0.9) * 1.4 * smooth(0, 0.05, t) * (1 - smooth(0.3 * seconds, seconds, t)));
  scatter(out, r, count, 0, seconds * 0.85, lean, (u) => 0.9 * (1 - 0.6 * u), snap);
  return finish(out, 0.9, seconds * 0.2);
}

// ---------------------------------------------------------------- the list

const RECIPES = {
  // ---- menus and turns
  select: { level: 0.16, make: () => tune(0.12, [[0, 14, 0.03]]) },
  turn: { level: 0.24, make: () => tune(0.9, [[0, -5, 0.2], [0.11, 2, 0.28]]) },
  tick: { level: 0.2, make: () => tune(0.12, [[0, 7, 0.02], [0.003, 19, 0.01]]) },
  skillReady: { level: 0.3, make: () => tune(1.5, [[0, 2, 0.2], [0.09, 7, 0.2], [0.18, 14, 0.5], [0.18, 19, 0.4]]) },
  win: { level: 0.4, make: () => tune(3.2, [[0, -5, 0.5], [0.14, -1, 0.5], [0.28, 2, 0.5], [0.42, 7, 0.9], [0.42, 2, 0.9], [0.8, 11, 1], [0.8, 14, 1]]) },
  draw: { level: 0.36, make: () => tune(2.2, [[0, 2, 0.5], [0.25, -2, 0.5], [0.5, -7, 0.9]]) },

  // ---- bugs
  step: {
    variants: 8,
    level: 0.13,
    make: (r) => {
      const k = knock(1900, 0.006)(r);
      const n = white(r);
      const lp = lowpass();
      return finish(render(0.07, (t) => k.voice(t) + lp(n(), 500) * strike(t, 0.001, 0.01) * 0.5), 0.8);
    },
  },
  jump: {
    variants: 2,
    level: 0.22,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const b = bandpass();
      const f = 190 + 40 * r();
      return finish(render(0.24, (t) => s(f + 1300 * t) * strike(t, 0.008, 0.06) * 0.5 + b(n(), 900 + 4000 * t, 1.5) * 1.5 * strike(t, 0.01, 0.06)));
    },
  },
  land: {
    variants: 3,
    level: 0.34,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const lp = lowpass();
      const out = render(0.3, (t) => s(80 + 90 * Math.exp(-t * 40)) * strike(t, 0.002, 0.05) + lp(n(), 900) * strike(t, 0.001, 0.025) * 0.8);
      scatter(out, r, 6, 0, 0.05, 1, () => 0.4, knock(1700, 0.006));
      return finish(out);
    },
  },
  hurt: {
    variants: 3,
    level: 0.34,
    make: (r) => {
      const a = saw();
      const b = bandpass();
      const b2 = bandpass();
      const f = 520 + 140 * r();
      return finish(
        render(0.34, (t) => {
          const x = a(f * (1 - 1.1 * t) * (1 + 0.05 * Math.sin(t * 260)));
          return (b(x, 1300 - 1400 * t, 4) + b2(x, 2600, 5) * 0.6) * strike(t, 0.008, 0.09);
        }),
      );
    },
  },
  death: {
    variants: 2,
    level: 0.58,
    make: (r) => {
      const a = saw();
      const b = bandpass();
      const s = sine();
      const n = white(r);
      const lp = lowpass();
      const f = 480 + 80 * r();
      // (a cry that falls, then a thump)
      const out = render(1.2, (t) => {
        const cry = b(a(f * Math.exp(-t * 2.4) * (1 + 0.08 * Math.sin(t * 70))), 1500 * Math.exp(-t * 2), 3) * 2.5 * strike(t, 0.01, 0.22);
        const p = t - 0.46;
        return cry + (s(70 + 130 * Math.exp(-Math.max(0, p) * 26)) * 1.1 + lp(n(), 1600) * 0.7) * strike(p, 0.003, 0.09);
      });
      scatter(out, r, 16, 0.48, 1.05, 1.6, (u) => 0.35 * (1 - u), knock(1300, 0.008));
      return finish(out, 0.9, 0.15);
    },
  },

  // ---- weapons
  charge: {
    loop: true,
    level: 0.15,
    make: (r) => {
      const a = saw();
      const b = sine();
      const lp = lowpass();
      const n = white(r);
      const bp = bandpass();
      return loop(render(1.4, (t) => lp(a(110), 900, 1.2) * 0.7 + b(220) * 0.4 + bp(n(), 1800, 2) * 0.5 * (0.6 + 0.4 * Math.sin(t * 6.283 * 22))), 0.4);
    },
  },
  lob: {
    variants: 2,
    level: 0.42,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const b = bandpass();
      return finish(render(0.4, (t) => s(110 + 420 * Math.exp(-t * 30)) * strike(t, 0.002, 0.06) + b(n(), 600 + 2200 * Math.exp(-t * 9), 0.9) * strike(t, 0.004, 0.08)));
    },
  },
  spark: {
    level: 0.36,
    make: (r) => {
      const n = white(r);
      const h = highpass();
      const a = saw();
      const w = wander(r, 160);
      return finish(render(0.4, (t) => (h(n(), 2400) * 0.8 + a(180 + 900 * t) * 0.4) * strike(t, 0.002, 0.09) * (0.5 + 0.5 * w(t))));
    },
  },
  flight: {
    loop: true,
    level: 0.16,
    make: (r) => {
      const n = white(r);
      const b = bandpass();
      const b2 = bandpass();
      const w = wander(r, 7);
      return loop(
        render(2, (t) => {
          const x = n();
          return b(x, 900 + 120 * w(t), 3) + 0.4 * b2(x, 2100, 4);
        }),
        0.4,
      );
    },
  },
  bounce: {
    variants: 4,
    level: 0.38,
    make: (r) => {
      // (a little tin can)
      const f = 780 + 220 * r();
      const m = modes([[f, 1, 0.05], [f * 1.63, 0.7, 0.04], [f * 2.41, 0.5, 0.03], [f * 3.9, 0.35, 0.015], [170, 0.9, 0.03]]);
      const n = white(r);
      return finish(render(0.3, (t) => m(t) + n() * strike(t, 0.0004, 0.004)));
    },
  },
  fuse: { level: 0.2, make: () => finish(render(0.09, (t) => Math.sin(6.283 * 1760 * t) * strike(t, 0.002, 0.018))) },
  blast: { variants: 3, level: 0.95, make: (r) => blast(r, 2, 46, 46) },
  // (a blast that hurts nobody: into the ground, dull, and what it threw up comes down)
  blastMiss: {
    variants: 3,
    level: 0.72,
    make: (r) => groundBlast(r, 1.7, 40, 44),
  },
  blastMissSmall: { variants: 2, level: 0.55, make: (r) => groundBlast(r, 1.1, 58, 34) },
  // (one that hits a bug: a crunch of shell, a bright ring over it)
  impact: {
    variants: 3,
    level: 1.15,
    make: (r) => {
      const f = 980 + 120 * r();
      const ring = modes([[f, 0.6, 0.26], [f * 1.5, 0.45, 0.2], [f * 2.02, 0.25, 0.12]]);
      const s = sine();
      const n = white(r);
      const b = bandpass();
      const out = render(0.8, (t) => drive(s(95 + 240 * Math.exp(-t * 45)) * strike(t, 0.001, 0.06) * 1.4 + b(n(), 1900, 1.2) * strike(t, 0.0005, 0.03) * 2.6, 1.5) + ring(t - 0.02) * 0.6);
      scatter(out, r, 16, 0.004, 0.16, 1.4, (u) => 0.75 * (1 - u), snap);
      return finish(out, 0.95, 0.15);
    },
  },
  // (the last blow)
  impactKill: {
    level: 1.3,
    make: (r) => {
      const ring = modes([[523, 0.5, 0.34], [784, 0.45, 0.3], [1046, 0.35, 0.24], [1568, 0.2, 0.16]]);
      const s = sine();
      const n = white(r);
      const b = bandpass();
      const out = render(1.2, (t) => drive(s(62 + 230 * Math.exp(-t * 30)) * strike(t, 0.001, 0.12) * 1.5 + b(n(), 1500, 1) * strike(t, 0.0005, 0.045) * 2.6, 1.6) + ring(t - 0.03) * 0.6);
      scatter(out, r, 34, 0.004, 0.35, 1.5, (u) => 0.8 * (1 - u), snap);
      return finish(out, 0.95, 0.25);
    },
  },
  blastSmall: { variants: 2, level: 0.7, make: (r) => blast(r, 1.2, 70, 22) },
  zap: {
    variants: 3,
    level: 0.5,
    make: (r) => {
      const n = white(r);
      const b = bandpass();
      const a = saw(r());
      const w = wander(r, 240);
      const h = highpass();
      const out = render(0.6, (t) => {
        const v = w(t);
        const gate = v > -0.15 ? 1 : 0.12;
        return drive((b(n(), 3200 + 1600 * v, 1.2) * 2 + a(100) * 0.6 + h(n(), 5000) * 0.6) * gate, 1.6) * strike(t, 0.001, 0.16);
      });
      scatter(out, r, 18, 0, 0.5, 1.4, () => 0.5, knock(4200, 0.003));
      return finish(out, 0.9, 0.1);
    },
  },
  drill: {
    level: 0.5,
    make: (r) => {
      // (a hot iron that goes through: a hiss, a sizzle, bubbling plastic)
      const n = white(r);
      const h = highpass();
      const b = bandpass();
      const w = wander(r, 55);
      const lp = lowpass();
      const s = saw();
      const out = render(1.1, (t) => {
        const e = smooth(0, 0.03, t) * (1 - smooth(0.55, 1.1, t));
        const x = n();
        return (h(x, 3600) * (0.3 + 0.25 * w(t)) + b(x, 1100 + 700 * t, 2) * 1.2 + lp(s(72 + 30 * t), 500) * 0.5) * e;
      });
      scatter(out, r, 40, 0.05, 1, 1.1, (u) => 0.35 * (1 - u), knock(800, 0.01));
      return finish(out, 0.9, 0.15);
    },
  },

  // ---- silk
  spit: {
    variants: 2,
    level: 0.4,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const b = bandpass();
      return finish(render(0.4, (t) => s(300 + 900 * t) * strike(t, 0.01, 0.05) * 0.4 + b(n(), 2600 - 3200 * t, 2) * 2 * strike(t, 0.006, 0.08)));
    },
  },
  webOpen: {
    variants: 2,
    level: 0.5,
    make: (r) => {
      const n = white(r);
      const b = bandpass();
      const s = sine();
      const out = render(0.9, (t) => b(n(), 500 + 1900 * Math.exp(-t * 8), 1) * strike(t, 0.004, 0.09) * 1.4 + s(150 + 170 * Math.exp(-t * 30)) * strike(t, 0.002, 0.06));
      scatter(out, r, 16, 0.02, 0.5, 1.6, (u) => 0.3 * (1 - u), plucks(700, 2200, 0.05));
      return finish(out, 0.9, 0.15);
    },
  },
  webTear: { level: 0.42, make: (r) => cracking(r, 0.6, 46, 1.3) },
  thread: {
    level: 0.3,
    make: () => {
      const p = pluck(392, 0.09);
      const q = pluck(588, 0.07);
      return finish(render(0.5, (t) => p(t) + 0.6 * q(t - 0.03)));
    },
  },

  // ---- the Web Bow
  bowRise: { level: 0.5, make: (r) => riser(r, 1.5, 40, 120) },
  cloth: { variants: 2, level: 0.3, make: (r) => whoosh(r, 0.34, 700, 2600, 900, 1.1) },
  eyes: { level: 0.3, make: (r) => shimmer(r, 1.3, 660, 0.04, 0.05) },
  bowBurst: {
    level: 0.75,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const lp = lowpass();
      const b = bandpass();
      const tones = [1, 1.5, 2, 3].map((k) => ({ k, s: sine(r()) }));
      return finish(
        render(2.2, (t) => {
          const x = n();
          let chord = 0;
          for (const o of tones) chord += o.s(220 * o.k) / o.k;
          return s(38 + 70 * Math.exp(-t * 12)) * strike(t, 0.004, 0.4) * 1.2 + lp(x, 300 + 6000 * Math.exp(-t * 7)) * strike(t, 0.004, 0.16) + b(x, 2400 + 1800 * t, 1.5) * 0.35 * strike(t, 0.2, 0.5) + chord * 0.16 * strike(t, 0.1, 0.6);
        }),
        0.95,
        0.4,
      );
    },
  },
  bowGrow: {
    level: 0.42,
    make: (r) => {
      const creak = saw();
      const b = bandpass();
      const w = wander(r, 14);
      const n = white(r);
      const air = bandpass();
      const out = render(1.2, (t) => (b(creak(60 + 70 * t + 18 * w(t)), 700 + 1500 * t, 3) * 2 + air(n(), 1200 + 3200 * t, 2)) * Math.sin((Math.PI * t) / 1.2));
      scatter(out, r, 28, 0.05, 1.1, 1, () => 0.25, plucks(500, 1800, 0.035));
      return finish(out, 0.9, 0.1);
    },
  },
  bowGather: { level: 0.36, make: (r) => shimmer(r, 1.1, 440, 0.5, 0.45) },
  bowReady: { level: 0.34, make: (r) => shimmer(r, 1.6, 330, 0, 0.02) },
  bowHum: {
    loop: true,
    level: 0.12,
    make: (r) => {
      const v = [1, 1.5, 2, 3, 4].map((k) => ({ k, s: sine(r()), w: wander(r, 1.5) }));
      return loop(
        render(4.6, (t) => {
          let s = 0;
          for (const o of v) s += (o.s(110 * o.k) / o.k) * (0.7 + 0.3 * o.w(t));
          return s;
        }),
        0.6,
      );
    },
  },
  bowDraw: {
    loop: true,
    level: 0.22,
    make: (r) => {
      const a = saw();
      const b = bandpass();
      const w = wander(r, 18);
      const n = white(r);
      const c = bandpass();
      return loop(
        render(1.9, (t) => {
          const v = w(t);
          return b(a(52 + 9 * v), 900 + 200 * v, 5) * 3 * (0.7 + 0.3 * v) + c(n(), 2400, 3) * 0.3;
        }),
        0.4,
      );
    },
  },
  bowShot: {
    level: 0.85,
    make: (r) => {
      const m = modes([[98, 1, 0.22], [196, 0.7, 0.16], [294, 0.45, 0.12], [441, 0.3, 0.08], [735, 0.2, 0.05]]);
      const n = white(r);
      const b = bandpass();
      const h = highpass();
      return finish(
        render(1.3, (t) => {
          const x = n();
          return m(t) * (1 + 0.3 * Math.sin(t * 190)) + h(x, 2000) * strike(t, 0.0005, 0.02) * 0.9 + b(x, 400 + 3600 * Math.exp(-t * 5), 1.1) * strike(t, 0.03, 0.22) * 1.5;
        }),
        0.95,
        0.25,
      );
    },
  },
  dart: {
    loop: true,
    level: 0.3,
    make: (r) => {
      const n = white(r);
      const b = bandpass();
      const s = sine();
      const q = sine(0.3);
      return loop(render(1.4, () => b(n(), 1700, 2.5) + s(520) * 0.1 + q(780) * 0.06), 0.4);
    },
  },
  bowHit: {
    level: 0.9,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const lp = lowpass();
      const ring = modes([[330, 0.5, 0.5], [495, 0.35, 0.45], [660, 0.3, 0.4], [990, 0.2, 0.3], [1320, 0.12, 0.2]]);
      const out = render(2.4, (t) => drive(s(42 + 110 * Math.exp(-t * 18)) * strike(t, 0.002, 0.28) * 1.3 + lp(n(), 250 + 7000 * Math.exp(-t * 12)) * strike(t, 0.001, 0.09) * 1.2, 1.4) + ring(t - 0.05) * 0.4);
      scatter(out, r, 40, 0.06, 1.2, 1.5, (u) => 0.2 * (1 - u), plucks(600, 2400, 0.06));
      return finish(out, 0.95, 0.4);
    },
  },

  // (the dart into the ground: a thud, and its shaft quivers)
  bowMiss: {
    level: 0.6,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const lp = lowpass();
      const q = sine();
      return finish(render(0.9, (t) => drive(s(70 + 120 * Math.exp(-t * 40)) * strike(t, 0.001, 0.07) * 1.3 + lp(n(), 900) * strike(t, 0.0006, 0.02) * 1.6, 1.3) + q(148 + 5 * Math.sin(t * 230)) * strike(t - 0.02, 0.004, 0.16) * (0.5 + 0.5 * Math.sin(6.283 * 31 * t)) * 0.7), 0.9, 0.15);
    },
  },

  // ---- the Ant Column
  columnRear: {
    level: 0.5,
    make: (r) => {
      const out = riser(r, 1.3, 40, 96);
      scatter(out, r, 46, 0.1, 1.2, 0.7, (u) => 0.5 * u, chirr);
      return finish(out, 0.9, 0.04);
    },
  },
  slam: {
    level: 0.95,
    make: (r) => {
      const out = blast(r, 1.9, 38, 30);
      scatter(out, r, 34, 0.03, 0.9, 1.5, (u) => 0.35 * (1 - u), knock(900, 0.012));
      return finish(out, 0.95, 0.5);
    },
  },
  cracks: { variants: 2, level: 0.5, make: (r) => cracking(r, 1.1, 80, 1.5) },
  holes: {
    level: 0.55,
    make: (r) => {
      const n = white(r);
      const lp = lowpass();
      const w = wander(r, 12);
      const out = render(1.8, (t) => lp(n(), 150 + 60 * w(t), 1) * 2.4 * smooth(0, 0.3, t) * (1 - smooth(0.9, 1.8, t)));
      scatter(out, r, 150, 0.05, 1.6, 1.1, (u) => 0.4 * (1 - 0.6 * u), knock(1100, 0.007));
      return finish(out, 0.9, 0.3);
    },
  },
  // ---- Queen's Flight
  buzz: {
    loop: true,
    level: 0.5,
    make: (r) => {
      // (two dozen wings, each a little off the next, wavering)
      const n = 22;
      const s = Array.from({ length: n }, () => saw(r()));
      const hz = Array.from({ length: n }, () => 190 + 85 * r());
      const w = Array.from({ length: n }, () => wander(r, 5));
      const lp = lowpass();
      return loop(
        render(3.4, (t) => {
          let v = 0;
          for (let i = 0; i < n; i++) {
            const k = w[i](t);
            v += s[i](hz[i] * (1 + 0.07 * k)) * (0.75 + 0.25 * k);
          }
          return (lp(v / n, 2100, 0.8)) * 2;
        }),
        0.4,
      );
    },
  },
  queenRise: { level: 0.5, make: (r) => shimmer(r, 1.0, 520, 2.2, 0.8) },
  crown: { level: 0.6, make: () => tune(2.4, [[0, 3, 1.2], [0.02, 10, 1.2], [0.04, 15, 1.4], [0.07, 19, 1.5], [0.12, 22, 1.6], [0.2, 27, 1.3]]) },
  beesOut: {
    level: 0.55,
    make: (r) => {
      const n = 12;
      const s = Array.from({ length: n }, () => saw(r()));
      const hz = Array.from({ length: n }, () => 200 + 90 * r());
      const lp = lowpass();
      const air = white(r);
      const bp = bandpass();
      return finish(
        render(1.5, (t) => {
          let v = 0;
          const up = 1 + 0.35 * smooth(0, 0.35, t) - 0.12 * smooth(0.5, 1.5, t);
          for (let i = 0; i < n; i++) v += s[i](hz[i] * up);
          return (lp(v / n, 2600, 0.8) * 1.8 + bp(air(), 700 + 900 * t, 1) * 0.5) * smooth(0, 0.16, t) * (1 - smooth(0.4, 1.5, t));
        }),
        0.9,
        0.2,
      );
    },
  },
  ring: { level: 0.6, make: () => tune(1.3, [[0, 10, 0.5], [0.05, 15, 0.6], [0.1, 22, 0.8], [0.16, 27, 0.7]]) },
  sting: {
    level: 0.95,
    make: (r) => {
      const out = blast(r, 1.8, 52, 8);
      const ring = tune(1.8, [[0.02, -9, 1.2], [0.03, 3, 1.2], [0.05, 10, 1.3], [0.08, 15, 1.4]]);
      const air = whoosh(r, 0.9, 300, 2600, 500, 1.2, 0.15);
      return finish(out.map((v, i) => v * 0.75 + (ring[i] ?? 0) * 0.45 + (air[i] ?? 0) * 0.4), 0.95, 0.4);
    },
  },
  swarm: { loop: true, level: 0.5, make: (r) => crowd(r, 3, 240, 26) },
  pour: {
    level: 0.5,
    make: (r) => {
      const out = render(2.3, () => 0);
      scatter(out, r, 900, 0, 2.2, 0.8, (u) => 0.5 * smooth(0, 0.4, u) * (1 - smooth(0.75, 1, u)), knock(2300, 0.004));
      scatter(out, r, 70, 0.2, 2.2, 0.9, (u) => 0.5 * (1 - u), chirr);
      return finish(out, 0.9, 0.2);
    },
  },
  ranks: {
    level: 0.6,
    make: (r) => {
      // (they come to attention: three beats of many feet)
      const out = render(1.1, () => 0);
      for (const [at, v] of [[0, 0.6], [0.22, 0.75], [0.44, 1]] as const) {
        const s = sine();
        const beat = render(0.6, (t) => s(58 + 60 * Math.exp(-t * 30)) * strike(t, 0.002, 0.09) * v);
        out.set(
          beat.map((x, i) => x + out[Math.floor(at * SAMPLE_RATE) + i]),
          Math.floor(at * SAMPLE_RATE),
        );
        scatter(out, r, 70, at, at + 0.05, 1, () => 0.2 * v, knock(1500, 0.006));
      }
      return finish(out, 0.95, 0.2);
    },
  },
  command: {
    level: 0.6,
    make: (r) => {
      const a = saw();
      const c = saw(0.4);
      const b = bandpass();
      const b2 = bandpass();
      const s = sine();
      const n = white(r);
      return finish(
        render(1.1, (t) => {
          const f = 210 + 120 * smooth(0, 0.12, t) - 60 * smooth(0.3, 0.9, t);
          const x = a(f) + c(f * 1.5) * 0.6 + n() * 0.15;
          return (b(x, 900 + 500 * smooth(0, 0.15, t), 3) * 2 + b2(x, 2300, 4) * 1.4) * smooth(0, 0.02, t) * Math.exp(-t * 3.4) * (0.75 + 0.25 * Math.sin(t * 300)) + s(48 + 50 * Math.exp(-t * 20)) * strike(t, 0.003, 0.2) * 0.7;
        }),
        0.95,
        0.2,
      );
    },
  },
  bite: {
    variants: 4,
    level: 0.4,
    make: (r) => {
      const out = render(0.22, () => 0);
      scatter(out, r, 9, 0, 0.12, 1.2, () => 0.8, snap);
      return finish(out);
    },
  },
  collapse: {
    level: 1,
    make: (r) => {
      const out = blast(r, 3.2, 34, 120);
      const n = white(r);
      const lp = lowpass();
      for (let i = 0; i < out.length; i++) {
        const t = i / SAMPLE_RATE;
        out[i] += lp(n(), 130, 1) * 0.9 * smooth(0.2, 0.5, t) * (1 - smooth(1, 3, t));
      }
      scatter(out, r, 160, 0.3, 2.8, 1.4, (u) => 0.32 * (1 - u), knock(700, 0.014));
      return finish(out, 0.95, 0.8);
    },
  },
  finale: {
    level: 0.55,
    make: () => {
      const s = sine();
      const m = modes([[110, 0.8, 0.5], [165, 0.5, 0.45], [220, 0.35, 0.4], [330, 0.2, 0.3]]);
      return finish(render(1.6, (t) => s(40 + 60 * Math.exp(-t * 16)) * strike(t, 0.003, 0.3) + m(t) * 0.6), 0.95, 0.3);
    },
  },

  // ---- the Blackout Swarm
  wings: {
    variants: 2,
    level: 0.5,
    make: (r) => {
      // (a file drawn over a comb, again and again)
      const n = white(r);
      const b = bandpass();
      const b2 = bandpass();
      const a = saw(r());
      const w = wander(r, 11);
      return finish(
        render(1.1, (t) => {
          const u = (t * 5.5) % 1;
          const stroke = smooth(0, 0.15, u) * (1 - smooth(0.6, 0.95, u));
          const x = n() * 0.6 + a(168 + 14 * w(t)) * 0.8;
          return (b(x, 2900 + 900 * u, 5) * 2 + b2(x, 5200, 4)) * stroke * (0.55 + 0.45 * Math.sin(6.283 * 84 * t)) * smooth(0, 0.1, t) * (1 - smooth(0.8, 1.1, t));
        }),
        0.9,
        0.1,
      );
    },
  },
  powerFail: {
    level: 0.75,
    make: (r) => {
      // (contacts that spit, then everything runs down)
      const a = saw();
      const s = sine();
      const lp = lowpass();
      const n = white(r);
      const h = highpass();
      const down = sine();
      const spits = [0, 0.17, 0.24, 0.39, 0.51, 0.63];
      const out = render(2, (t) => {
        let sp = 0;
        for (const at of spits) sp += strike(t - at, 0.0008, 0.025);
        const run = Math.exp(-Math.max(0, t - 0.6) * 2.2);
        const on = t < 0.85 ? (Math.sin(6.283 * 11 * t) > -0.3 ? 1 : 0.25) : 1;
        return h(n(), 2600) * sp * 0.8 + (lp(a(100 * run), 700 * run + 60) * 0.7 + s(50 * run) * 0.5) * on * (1 - smooth(1.2, 1.9, t)) + down(52 * Math.exp(-Math.max(0, t - 0.8) * 1.2)) * strike(t - 0.8, 0.01, 0.4) * 1.1;
      });
      return finish(out, 0.95, 0.3);
    },
  },
  eyesOpen: {
    variants: 2,
    level: 0.4,
    make: (r) => {
      const out = render(1.4, () => 0);
      scatter(out, r, 26, 0, 1.1, 1, () => 0.5, plucks(1300, 3800, 0.03));
      scatter(out, r, 30, 0, 1.2, 0.9, () => 0.4, chirr);
      return finish(out, 0.9, 0.2);
    },
  },
  blackout: {
    loop: true,
    level: 0.2,
    make: (r) => {
      const v = [0.5, 0.75, 1.01, 1.5].map((k) => ({ k, s: sine(r()), w: wander(r, 0.6) }));
      const n = white(r);
      const lp = lowpass();
      const out = render(7, (t) => {
        let s = lp(n(), 130) * 0.6;
        for (const o of v) s += (o.s(82 * o.k) / (0.6 + o.k)) * (0.6 + 0.4 * o.w(t));
        return s;
      });
      scatter(out, r, 34, 0, 6.8, 1, () => 0.12, chirr);
      return loop(out, 1);
    },
  },
  powerOn: {
    level: 0.85,
    make: (r) => {
      const s = sine();
      const n = white(r);
      const h = highpass();
      const a = saw();
      const lp = lowpass();
      const tube = modes([[1870, 0.3, 0.03], [2950, 0.25, 0.03], [4100, 0.2, 0.02]]);
      return finish(
        render(1.5, (t) => {
          let v = s(46 + 90 * Math.exp(-t * 18)) * strike(t, 0.002, 0.22) * 1.2;
          for (const at of [0, 0.09, 0.2]) v += tube(t - at) + h(n(), 3000) * strike(t - at, 0.0005, 0.02) * 0.5;
          return v + lp(a(100), 600) * 0.35 * strike(t - 0.2, 0.05, 0.4);
        }),
        0.95,
        0.3,
      );
    },
  },
  shellCrack: {
    level: 0.75,
    make: (r) => {
      const m = modes([[620, 0.8, 0.03], [1130, 0.6, 0.025], [1890, 0.4, 0.02], [210, 1, 0.05]]);
      const n = white(r);
      const out = render(0.8, (t) => m(t) + n() * strike(t, 0.0004, 0.006));
      scatter(out, r, 30, 0.01, 0.5, 1.6, (u) => 0.7 * (1 - u), snap);
      return finish(out, 0.95, 0.1);
    },
  },

  // ---- the maps
  turntable: {
    loop: true,
    level: 0.3,
    make: (r) => {
      const a = saw();
      const s = sine();
      const lp = lowpass();
      const n = white(r);
      const b = bandpass();
      return loop(render(2.4, (t) => lp(a(50), 400) + 0.5 * s(100) + b(n(), 1400, 1.2) * 0.5 * (0.6 + 0.4 * Math.sin(6.283 * 5 * t))), 0.4);
    },
  },
  'room:pc-case': { loop: true, level: 0.15, make: ambience((r) => [fan(r, 118, 520, 0.02), fan(r, 163, 900, 0.012), hum(0.012)]) },
  'room:speaker': { loop: true, level: 0.1, make: ambience((r) => [room(r, 320), hum(0.03), hiss(r, 5200, 0.012)]) },
  'room:fridge': { loop: true, level: 0.15, make: ambience((r) => [room(r, 240), hum(0.045), fan(r, 47, 200, 0.03)]) },
  'room:microwave': {
    loop: true,
    level: 0.11,
    make: ambience(
      (r) => [room(r, 420), hum(0.014)],
      (out, r) => {
        // (a kitchen clock)
        for (let k = 0; k < AMBIENCE; k++) scatter(out, r, 1, k + 0.4, k + 0.401, 1, () => 0.16, knock(k % 2 ? 2300 : 2700, 0.005));
      },
    ),
  },
  'room:desk': { loop: true, level: 0.11, make: ambience((r) => [room(r, 380), fan(r, 92, 420, 0.008)]) },
  'room:car': {
    loop: true,
    level: 0.12,
    make: ambience(
      (r) => [room(r, 260), hum(0.006)],
      (out, r) => {
        // (the hazard lights' relay)
        for (let k = 0; k < AMBIENCE; k++) {
          scatter(out, r, 1, k + 0.2, k + 0.201, 1, () => 0.28, knock(1500, 0.006));
          scatter(out, r, 1, k + 0.7, k + 0.701, 1, () => 0.2, knock(1100, 0.006));
        }
      },
    ),
  },
} satisfies Record<string, SoundRecipe>;

export type SoundId = keyof typeof RECIPES;
export const SOUNDS: Readonly<Record<SoundId, SoundRecipe>> = RECIPES;
export const SOUND_IDS = Object.keys(RECIPES) as SoundId[];

/** The takes of a sound: the same on every run. */
export function makeSound(id: SoundId): Samples[] {
  const s = SOUNDS[id];
  let seed = 7;
  for (let i = 0; i < id.length; i++) seed = (Math.imul(seed, 31) + id.charCodeAt(i)) | 0;
  return Array.from({ length: s.variants ?? 1 }, (_, k) => s.make(createRng(seed + k * 7919)));
}

/** The echo of a place, two channels: `seconds` to die, `cut`: how bright it is. */
export function makeEcho(seconds: number, cut: number): Samples[] {
  return [1, 2].map((k) => {
    const n = white(createRng(k * 101));
    const lp = lowpass();
    return render(seconds, (t) => lp(n(), cut * (1 - 0.6 * clamp01(t / seconds))) * smooth(0, 0.006, t) * Math.exp((-5.5 * t) / seconds));
  });
}
