import { createRng } from '../terrain/noise';

/**
 * The music, all computed (there are no audio files): a theme per map, written as data (chords, a bass line, figures,
 * a melody, drums) and played by small instruments into three stems that loop together. Pure, no Web Audio and no DOM,
 * so it runs on a worker and in the tests.
 */

export const STEMS = ['base', 'groove', 'tension'] as const;
export type StemId = (typeof STEMS)[number];
export const MUSIC_RATE = 32000;

type Samples = Float32Array<ArrayBuffer>;
/** [beat, step of the scale (0: the chord's root; 7: an octave up), beats long, level]. */
type Note = readonly [number, number, number, number?];
type Instrument = 'pad' | 'glass' | 'keys' | 'bell' | 'marimba' | 'pluck' | 'bass' | 'synthBass' | 'lead' | 'reed';

interface Part {
  instrument: Instrument;
  /** A bar of it (or two, or four), in steps from each bar's chord. */
  notes: readonly Note[];
  bars: number;
  /** Octaves up from the theme's root. */
  octave: number;
  level: number;
  pan: number;
  /** Steps from the key's root, not from the chord's (a melody). */
  fixed?: boolean;
  /** Only in the second half of the loop. */
  second?: boolean;
}

export interface Theme {
  readonly bpm: number;
  /** The key's root (a MIDI note, low) and the semitones of its scale. */
  readonly root: number;
  readonly scale: readonly number[];
  /** The chord of each bar, as a step of the scale (the loop plays them twice). */
  readonly chords: readonly number[];
  /** How late every other eighth comes (0: straight; 0.33: a shuffle). */
  readonly swing: number;
  readonly pad: { instrument: Instrument; level: number };
  readonly base: readonly Part[];
  readonly groove: readonly Part[];
  readonly tension: readonly Part[];
  /** Sixteen steps a bar: x a stroke, o a soft one. */
  readonly drums: { kick: string; snare: string; hat: string; rim?: string };
  readonly tensionDrums: { kick?: string; hat?: string; tom?: string };
  readonly drumLevel: number;
  /** The room round it: how much, and its echo (in beats). */
  readonly wet: number;
  readonly echo: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** A figure of even notes. */
const run = (steps: readonly number[], each: number, level = 1): Note[] => steps.flatMap((s, i): Note[] => (s > -90 ? [[i * each, s, each * 0.95, level * (i % 4 === 0 ? 1 : 0.75)]] : []));
const REST = -99;

export const THEMES: Readonly<Record<string, Theme>> = {
  // the menu: two fighters circle each other, a strutting bass, a hook that asks and answers
  menu: {
    bpm: 106,
    root: 33,
    scale: MINOR,
    chords: [0, 0, 3, 4, 0, 0, 5, 6],
    swing: 0.12,
    pad: { instrument: 'reed', level: 0.18 },
    base: [
      { instrument: 'synthBass', notes: [[0, 0, 0.7], [0.75, 0, 0.2, 0.6], [1.5, 7, 0.4, 0.7], [2, 0, 0.7, 0.9], [2.75, 4, 0.2, 0.6], [3.5, 6, 0.45, 0.8]], bars: 1, octave: 0, level: 0.62, pan: 0 },
      { instrument: 'pluck', notes: [[0.5, 7, 0.3], [1, 9, 0.3, 0.7], [2.5, 7, 0.3], [3, 11, 0.4, 0.7]], bars: 1, octave: 1, level: 0.3, pan: -0.35 },
    ],
    groove: [
      { instrument: 'lead', notes: [[0, 0, 0.5], [0.5, 2, 0.5], [1, 4, 1], [2.5, 4, 0.4], [3, 3, 0.9], [4, 2, 0.5], [4.5, 3, 0.5], [5, 0, 2], [8, 4, 0.5], [8.5, 6, 0.5], [9, 7, 1], [10.5, 7, 0.4], [11, 6, 0.9], [12, 4, 0.5], [12.5, 6, 0.5], [13, 4, 2.4]], bars: 4, octave: 2, level: 0.2, pan: 0.18, fixed: true },
      { instrument: 'marimba', notes: [[1.75, 7, 0.2], [3.25, 9, 0.2, 0.7], [3.75, 11, 0.2, 0.6]], bars: 1, octave: 2, level: 0.24, pan: 0.5, second: true },
    ],
    tension: [{ instrument: 'bass', notes: run([0, 0, 7, 0, 0, 6, 0, 4], 0.5, 0.9), bars: 1, octave: 1, level: 0.3, pan: 0 }],
    drums: { kick: 'x.....x.x..x....', snare: '....x.......x..o', hat: 'x.oox.o.x.oox.oo', rim: '..o.......o..o..' },
    tensionDrums: { kick: 'x...x...x...x...', hat: 'xoxoxoxoxoxoxoxo', tom: '............o.oo' },
    drumLevel: 0.62,
    wet: 0.24,
    echo: 0.75,
  },
  // the tower case: a clear night of machines, an arpeggio that turns like the fans
  'pc-case': {
    bpm: 98,
    root: 33,
    scale: DORIAN,
    chords: [0, 0, 5, 5, 3, 3, 6, 4],
    swing: 0,
    pad: { instrument: 'pad', level: 0.5 },
    base: [
      { instrument: 'bass', notes: [[0, 0, 1.4], [1.5, 0, 0.4, 0.7], [2.5, 7, 0.4, 0.6], [3, 4, 0.9, 0.8]], bars: 1, octave: 0, level: 0.75, pan: 0 },
      { instrument: 'pluck', notes: run([0, 2, 4, 7, 4, 2, 9, 4], 0.5, 0.8), bars: 1, octave: 2, level: 0.26, pan: -0.35 },
    ],
    groove: [
      { instrument: 'lead', notes: [[0, 4, 1.5], [1.5, 7, 0.5], [2, 8, 1], [3, 7, 1], [4, 6, 1.5], [5.5, 4, 0.5], [6, 2, 2], [8, 4, 1.5], [9.5, 7, 0.5], [10, 9, 1.5], [11.5, 8, 0.5], [12, 7, 3]], bars: 4, octave: 2, level: 0.2, pan: 0.15, fixed: true },
      { instrument: 'bell', notes: [[2, 9, 1], [3.5, 11, 0.5, 0.6]], bars: 2, octave: 2, level: 0.14, pan: 0.5, second: true },
    ],
    tension: [{ instrument: 'synthBass', notes: run([0, 0, 7, 0, 0, 6, 0, 7, 0, 0, 7, 0, 4, 6, 7, 9], 0.25, 0.9), bars: 1, octave: 1, level: 0.28, pan: 0 }],
    drums: { kick: 'x.....x.x.......', snare: '....x.......x..o', hat: 'x.o.x.o.x.o.x.oo' },
    tensionDrums: { kick: 'x...x...x...x...', hat: 'xoxoxoxoxoxoxoxo' },
    drumLevel: 0.6,
    wet: 0.28,
    echo: 0.75,
  },
  // the studio monitor: late in the studio, electric piano, a lazy shuffle
  speaker: {
    bpm: 82,
    root: 38,
    scale: DORIAN,
    chords: [0, 3, 0, 3, 6, 5, 1, 4],
    swing: 0.3,
    pad: { instrument: 'reed', level: 0.2 },
    base: [
      { instrument: 'keys', notes: [[0, 2, 1.8], [0, 6, 1.8], [0, 8, 1.8, 0.8], [2.5, 2, 0.6, 0.6], [2.5, 6, 0.6, 0.6], [3.5, 8, 0.5, 0.5]], bars: 1, octave: 1, level: 0.36, pan: -0.1 },
      { instrument: 'bass', notes: [[0, 0, 1.2], [1.5, 4, 0.4, 0.7], [2, 7, 0.9, 0.8], [3.5, 6, 0.4, 0.7]], bars: 1, octave: 0, level: 0.75, pan: 0 },
    ],
    groove: [
      { instrument: 'keys', notes: [[0.5, 9, 0.5], [1, 11, 0.5], [1.5, 9, 1], [3, 8, 0.5], [3.5, 7, 1], [6, 7, 0.5], [6.5, 8, 0.5], [7, 9, 2], [10, 11, 0.7], [11, 9, 0.5], [11.5, 8, 0.5], [12, 7, 2.5]], bars: 4, octave: 2, level: 0.24, pan: 0.25, fixed: true },
    ],
    tension: [{ instrument: 'pluck', notes: run([0, REST, 4, 0, REST, 6, 4, REST], 0.5), bars: 1, octave: 2, level: 0.3, pan: -0.4 }],
    drums: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xo', rim: '..........o....o' },
    tensionDrums: { kick: 'x...x...x...x...', hat: 'o.xxo.xxo.xxo.xx' },
    drumLevel: 0.6,
    wet: 0.3,
    echo: 0.667,
  },
  // the fridge: ice, slow bells, a drop now and then
  fridge: {
    bpm: 70,
    root: 40,
    scale: LYDIAN,
    chords: [0, 1, 0, 1, 5, 4, 3, 1],
    swing: 0,
    pad: { instrument: 'glass', level: 0.42 },
    base: [
      { instrument: 'bell', notes: [[0, 4, 1.5], [1.5, 8, 1, 0.7], [2.75, 9, 1.2, 0.6]], bars: 1, octave: 2, level: 0.26, pan: 0.3 },
      { instrument: 'bass', notes: [[0, 0, 3.4], [3.5, 4, 0.5, 0.5]], bars: 1, octave: 0, level: 0.62, pan: 0 },
    ],
    groove: [
      { instrument: 'glass', notes: [[0, 7, 2.5], [3, 8, 1], [4, 10, 3], [8, 9, 2], [10, 8, 1], [11, 7, 1], [12, 4, 4]], bars: 4, octave: 2, level: 0.3, pan: -0.2, fixed: true },
      { instrument: 'marimba', notes: run([0, REST, 4, REST, 7, 4, REST, 9], 0.5, 0.7), bars: 1, octave: 2, level: 0.24, pan: -0.45 },
    ],
    tension: [{ instrument: 'pluck', notes: run([0, 4, 7, 4, 0, 4, 8, 4], 0.5), bars: 1, octave: 2, level: 0.26, pan: 0.4 }],
    drums: { kick: 'x.........o.....', snare: '........x.......', hat: '....o.......o...', rim: '..o......o....o.' },
    tensionDrums: { kick: 'x.......x.......', hat: 'o.o.x.o.o.o.x.o.', tom: 'x.....x...x.....' },
    drumLevel: 0.42,
    wet: 0.5,
    echo: 1.5,
  },
  // the microwave: a kitchen toy, off-beats and a bell
  microwave: {
    bpm: 112,
    root: 36,
    scale: MIXOLYDIAN,
    chords: [0, 0, 6, 3, 0, 4, 6, 3],
    swing: 0.12,
    pad: { instrument: 'reed', level: 0.16 },
    base: [
      { instrument: 'bass', notes: [[0, 0, 0.45], [1, 4, 0.45, 0.8], [2, 7, 0.45], [3, 4, 0.45, 0.8]], bars: 1, octave: 0, level: 0.75, pan: 0 },
      { instrument: 'marimba', notes: [[0.5, 4, 0.3], [0.5, 2, 0.3], [1.5, 4, 0.3], [1.5, 2, 0.3], [2.5, 4, 0.3], [2.5, 7, 0.3], [3.5, 4, 0.3], [3.5, 2, 0.3]], bars: 1, octave: 2, level: 0.26, pan: -0.3 },
    ],
    groove: [
      { instrument: 'marimba', notes: [[0, 7, 0.5], [0.5, 8, 0.5], [1, 9, 0.5], [2, 7, 0.5], [2.5, 4, 1], [4, 7, 0.5], [4.5, 8, 0.5], [5, 9, 0.5], [6, 11, 1.5], [8, 12, 0.5], [8.5, 11, 0.5], [9, 9, 0.5], [10, 8, 0.5], [10.5, 7, 1], [12, 5, 0.5], [12.5, 6, 0.5], [13, 8, 0.5], [14, 7, 1.5]], bars: 4, octave: 2, level: 0.34, pan: 0.2, fixed: true },
      { instrument: 'bell', notes: [[7, 14, 2]], bars: 2, octave: 2, level: 0.2, pan: 0.5, second: true },
    ],
    tension: [{ instrument: 'reed', notes: run([7, 7, 8, 7, 9, 7, 8, 6], 0.5), bars: 1, octave: 2, level: 0.18, pan: 0.35 }],
    drums: { kick: 'x.......x.......', snare: '....o.......o...', hat: '..x...x...x...x.', rim: 'o..o....o..o..o.' },
    tensionDrums: { kick: 'x...x...x...x...', hat: 'x.xxx.xxx.xxx.xx' },
    drumLevel: 0.55,
    wet: 0.2,
    echo: 0.5,
  },
  // the desk: an easy working day, marimba and soft keys
  desk: {
    bpm: 90,
    root: 41,
    scale: MAJOR,
    chords: [0, 5, 1, 4, 0, 5, 3, 4],
    swing: 0.2,
    pad: { instrument: 'pad', level: 0.3 },
    base: [
      { instrument: 'keys', notes: [[0, 2, 1.4], [0, 4, 1.4], [0, 6, 1.4, 0.8], [2, 4, 0.8, 0.6], [2, 8, 0.8, 0.6], [3.5, 6, 0.4, 0.5]], bars: 1, octave: 1, level: 0.3, pan: -0.15 },
      { instrument: 'bass', notes: [[0, 0, 1.4], [2, 4, 0.9, 0.8], [3, 2, 0.4, 0.7], [3.5, 1, 0.4, 0.6]], bars: 1, octave: 0, level: 0.7, pan: 0 },
    ],
    groove: [
      { instrument: 'marimba', notes: [[0, 4, 0.5], [0.5, 5, 0.5], [1, 7, 1], [2.5, 9, 0.5], [3, 8, 1], [4.5, 7, 0.5], [5, 5, 1], [6, 4, 1.5], [8, 5, 0.5], [8.5, 7, 0.5], [9, 9, 1], [10.5, 11, 0.5], [11, 9, 1], [12, 8, 1], [13, 6, 1], [14, 8, 1.5]], bars: 4, octave: 2, level: 0.34, pan: 0.25, fixed: true },
      { instrument: 'pluck', notes: [[1.5, 4, 0.4], [3.5, 7, 0.4]], bars: 1, octave: 2, level: 0.2, pan: -0.5 },
    ],
    tension: [{ instrument: 'pluck', notes: run([0, 4, 0, 7, 0, 4, 2, 9], 0.5), bars: 1, octave: 2, level: 0.3, pan: 0.35 }],
    drums: { kick: 'x.....o.x.......', snare: '....o..o....o...', hat: 'x.o.x.o.x.o.x.o.', rim: '...o......o.....' },
    tensionDrums: { kick: 'x...x...x...x...', hat: 'xxoxxxoxxxoxxxox' },
    drumLevel: 0.5,
    wet: 0.22,
    echo: 0.75,
  },
  // the car: a drive at night, a pulsing bass, a long line over it
  car: {
    bpm: 104,
    root: 30,
    scale: MINOR,
    chords: [0, 0, 5, 5, 2, 2, 6, 6],
    swing: 0,
    pad: { instrument: 'pad', level: 0.44 },
    base: [
      { instrument: 'synthBass', notes: run([0, 0, 0, 0, 0, 0, 0, 7], 0.5), bars: 1, octave: 1, level: 0.42, pan: 0 },
      { instrument: 'pluck', notes: run([7, REST, 4, REST, 2, REST, 4, REST, 7, REST, 9, REST, 4, REST, 2, REST], 0.25, 0.8), bars: 1, octave: 3, level: 0.2, pan: 0.4 },
    ],
    groove: [
      { instrument: 'lead', notes: [[0, 7, 3], [3, 9, 1], [4, 8, 2], [6, 7, 1], [7, 6, 1], [8, 4, 3], [11, 6, 1], [12, 7, 4]], bars: 4, octave: 2, level: 0.22, pan: -0.15, fixed: true },
      { instrument: 'bell', notes: [[0, 11, 1], [1.5, 9, 1], [3, 7, 1]], bars: 2, octave: 2, level: 0.12, pan: 0.5, second: true },
    ],
    tension: [{ instrument: 'synthBass', notes: run([0, 7, 0, 7, 0, 6, 0, 7, 0, 7, 0, 9, 0, 7, 6, 4], 0.25), bars: 1, octave: 2, level: 0.22, pan: 0 }],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' },
    tensionDrums: { hat: 'xxxxxxxxxxxxxxxx', tom: '..........x..xx.' },
    drumLevel: 0.6,
    wet: 0.34,
    echo: 0.75,
  },
};

// ---------------------------------------------------------------- instruments

const TABLE = 2048;
/** One cycle of a tone with these harmonics. */
function wave(harmonics: readonly number[]): Float32Array {
  const t = new Float32Array(TABLE + 1);
  for (let i = 0; i <= TABLE; i++) for (let k = 0; k < harmonics.length; k++) t[i] += harmonics[k] * Math.sin((2 * Math.PI * (k + 1) * i) / TABLE);
  return t;
}
const saw = (n: number, fall: number): number[] => Array.from({ length: n }, (_, k) => 1 / (k + 1) ** fall);

/** Two tones it goes between as it sounds (bright, then dark), and how. Times in seconds; `hold`: while it is held. */
interface Voice {
  bright: Float32Array;
  dark: Float32Array;
  /** How fast it darkens, rises, and dies (held, and let go). */
  mellow: number;
  attack: number;
  decay: number;
  release: number;
  /** A second and third one beside it (cents), and a slow waver (cents). */
  detune: number;
  waver: number;
}

let voices: Record<Instrument, Voice> | null = null;
function instruments(): Record<Instrument, Voice> {
  voices ??= {
    pad: { bright: wave(saw(9, 1.35)), dark: wave(saw(4, 1.9)), mellow: 0.5, attack: 0.5, decay: 60, release: 0.7, detune: 9, waver: 3 },
    glass: { bright: wave([1, 0, 0.35, 0, 0.12, 0, 0, 0.1]), dark: wave([1, 0.1]), mellow: 0.8, attack: 0.18, decay: 6, release: 0.9, detune: 5, waver: 4 },
    keys: { bright: wave([1, 0.5, 0.1, 0.25, 0.05, 0, 0.14]), dark: wave([1, 0.18]), mellow: 5, attack: 0.004, decay: 1.3, release: 0.12, detune: 3, waver: 0 },
    bell: { bright: wave([1, 0, 0.5, 0, 0, 0.35, 0, 0, 0.22, 0, 0.12]), dark: wave([1, 0.05]), mellow: 2.5, attack: 0.002, decay: 0.9, release: 0.9, detune: 2, waver: 0 },
    marimba: { bright: wave([1, 0, 0, 0.55, 0, 0, 0, 0, 0.16]), dark: wave([1]), mellow: 16, attack: 0.002, decay: 0.24, release: 0.24, detune: 0, waver: 0 },
    pluck: { bright: wave(saw(14, 1)), dark: wave(saw(3, 1.8)), mellow: 9, attack: 0.003, decay: 0.28, release: 0.1, detune: 4, waver: 0 },
    bass: { bright: wave([1, 0.5, 0.25, 0.12]), dark: wave([1, 0.2]), mellow: 7, attack: 0.008, decay: 1.6, release: 0.07, detune: 0, waver: 0 },
    synthBass: { bright: wave(saw(16, 1)), dark: wave(saw(4, 1.5)), mellow: 14, attack: 0.004, decay: 0.5, release: 0.05, detune: 6, waver: 0 },
    lead: { bright: wave([1, 0.15, 0.4, 0.1, 0.22, 0.05, 0.1]), dark: wave([1, 0.1, 0.2]), mellow: 2, attack: 0.05, decay: 6, release: 0.22, detune: 6, waver: 9 },
    reed: { bright: wave([1, 0.6, 0.45, 0.3, 0.15]), dark: wave([1, 0.4, 0.2]), mellow: 1, attack: 0.07, decay: 12, release: 0.18, detune: 4, waver: 5 },
  };
  return voices;
}

interface Mix {
  l: Samples;
  r: Samples;
  rate: number;
}

/** A note into the mix; what rings past the end of the loop rings on at its start. */
function play(m: Mix, name: Instrument, at: number, midi: number, seconds: number, level: number, pan: number): void {
  const v = instruments()[name];
  const { l, r, rate } = m;
  const n = l.length;
  const hz = 440 * 2 ** ((midi - 69) / 12);
  // (too high for the rate: its dark tone alone)
  const clean = hz * 9 < rate * 0.5;
  const tail = Math.min(v.release * 5, 4);
  const end = seconds + tail;
  const count = Math.floor(end * rate);
  const start = Math.round(at * rate);
  const gl = level * Math.cos(((pan + 1) * Math.PI) / 4) * 1.414;
  const gr = level * Math.sin(((pan + 1) * Math.PI) / 4) * 1.414;
  const side = v.detune > 0 ? 3 : 1;
  for (let k = 0; k < side; k++) {
    const off = k === 0 ? 0 : k === 1 ? v.detune : -v.detune;
    const inc = ((hz * 2 ** (off / 1200)) / rate) * TABLE;
    let p = (TABLE * ((k * 0.37 + midi * 0.13) % 1)) % TABLE;
    const gain = side === 1 ? 1 : k === 0 ? 0.5 : 0.36;
    // (its neighbours stand to the sides)
    const kl = gl * gain * (k === 1 ? 1.25 : k === 2 ? 0.55 : 1);
    const kr = gr * gain * (k === 2 ? 1.25 : k === 1 ? 0.55 : 1);
    const w = (v.waver / 1200) * Math.LN2;
    let mel = 1;
    const mk = Math.exp(-v.mellow / rate);
    let dec = 1;
    const dk = Math.exp(-1 / (v.decay * rate));
    let rel = 1;
    const rk = Math.exp(-1 / (v.release * rate));
    const held = Math.floor(seconds * rate);
    const att = Math.max(1, v.attack * rate);
    for (let i = 0; i < count; i++) {
      if (i > held) rel *= rk;
      dec *= dk;
      mel *= mk;
      const a = (i < att ? i / att : 1) * dec * rel;
      const j = p | 0;
      const f = p - j;
      const d = v.dark[j] + (v.dark[j + 1] - v.dark[j]) * f;
      const b = clean ? v.bright[j] + (v.bright[j + 1] - v.bright[j]) * f : d;
      const x = (d + (b - d) * mel) * a * (i > count - 400 ? (count - i) / 400 : 1);
      const q = (start + i) % n;
      l[q] += x * kl;
      r[q] += x * kr;
      p += inc * (w === 0 ? 1 : 1 + w * Math.sin((i / rate) * 31) * Math.min(1, i / (0.4 * rate)));
      if (p >= TABLE) p -= TABLE;
    }
  }
}

type Drum = 'kick' | 'snare' | 'hat' | 'rim' | 'tom';

function drum(m: Mix, kind: Drum, at: number, level: number, rng: () => number): void {
  const { l, r, rate } = m;
  const n = l.length;
  const long = { kick: 0.42, snare: 0.26, hat: 0.07, rim: 0.06, tom: 0.4 }[kind];
  const count = Math.floor(long * rate);
  const start = Math.round(at * rate);
  const pan = { kick: 0, snare: 0.05, hat: 0.3, rim: -0.35, tom: -0.2 }[kind];
  const gl = level * (1 - pan) * 0.8;
  const gr = level * (1 + pan) * 0.8;
  let phase = 0;
  let last = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const white = rng() * 2 - 1;
    const high = white - last;
    last = white;
    let x = 0;
    if (kind === 'kick') {
      phase += (47 + 130 * Math.exp(-t * 38)) / rate;
      x = Math.sin(6.283 * phase) * Math.exp(-t * 9) * 1.1 + high * 0.12 * Math.exp(-t * 220);
    } else if (kind === 'tom') {
      phase += (82 + 70 * Math.exp(-t * 20)) / rate;
      x = Math.sin(6.283 * phase) * Math.exp(-t * 8) * 0.9;
    } else if (kind === 'snare') {
      phase += 178 / rate;
      x = (high * 0.36 + white * 0.14) * Math.exp(-t * 17) + Math.sin(6.283 * phase) * 0.4 * Math.exp(-t * 28);
    } else if (kind === 'hat') x = high * 0.32 * Math.exp(-t * 62);
    else {
      phase += 840 / rate;
      x = (Math.sin(6.283 * phase) * 0.5 + high * 0.2) * Math.exp(-t * 75);
    }
    x *= i > count - 200 ? (count - i) / 200 : 1;
    const q = (start + i) % n;
    l[q] += x * gl;
    r[q] += x * gr;
  }
}

// ---------------------------------------------------------------- the players

/** The loop's length, in seconds and beats. */
export function loopOf(t: Theme): { beats: number; seconds: number } {
  const beats = t.chords.length * 2 * 4;
  return { beats, seconds: (beats * 60) / t.bpm };
}

/** Beats to seconds, every other eighth late by the swing. */
function when(t: Theme, beat: number): number {
  const whole = Math.floor(beat);
  const f = beat - whole;
  const late = f >= 0.5 ? 0.5 + t.swing * 0.5 + (f - 0.5) * (1 - t.swing) : f * (1 + t.swing);
  return ((whole + late) * 60) / t.bpm;
}

function pitch(t: Theme, step: number, octave: number): number {
  const n = t.scale.length;
  const o = Math.floor(step / n);
  return t.root + 12 * (octave + o) + t.scale[step - o * n];
}

/** A step of a melody, over this chord: where it rests (a long note, or on the bar's first or third beat) it is one of the chord's. */
function settle(step: number, chord: number, rests: boolean): number {
  if (!rests) return step;
  for (const d of [0, -1, 1]) if ([0, 2, 4, 6].includes((((step + d - chord) % 7) + 7) % 7)) return step + d;
  return step;
}

/** One stem of a theme: left and right, the length of the loop, seamless. `rate`: samples a second. */
export function makeStem(id: string, stem: StemId, rate = MUSIC_RATE): [Samples, Samples] {
  const t = THEMES[id];
  const { beats, seconds } = loopOf(t);
  const n = Math.round(seconds * rate);
  const m: Mix = { l: new Float32Array(n), r: new Float32Array(n), rate };
  const rng = createRng(stem.length * 977 + t.bpm);
  const beat = 60 / t.bpm;
  const bars = beats / 4;
  for (let bar = 0; bar < bars; bar++) {
    const chord = t.chords[bar % t.chords.length];
    if (stem === 'base') for (const s of [0, 2, 4]) play(m, t.pad.instrument, bar * 4 * beat, pitch(t, chord + s, 2) - (chord > 3 ? 12 : 0), 4 * beat, t.pad.level * 0.3, (s - 2) * 0.22);
    for (const p of t[stem]) {
      if (p.second && bar < bars / 2) continue;
      if (bar % p.bars !== 0) continue;
      for (const [b, step, long, level] of p.notes) {
        // (a figure over several bars follows the chords of the bars it is in)
        const under = t.chords[(bar + Math.floor(b / 4)) % t.chords.length];
        const c = p.fixed ? 0 : under;
        // (the melody's second time round ends differently: a step higher)
        const lift = p.fixed && bar >= bars / 2 && b >= p.bars * 4 - 4 && bar % 8 >= 4 ? 2 : 0;
        const low = c > 3 && (p.instrument === 'bass' || p.instrument === 'synthBass') ? -12 : 0;
        play(m, p.instrument, when(t, bar * 4 + b) + (rng() - 0.5) * 0.006, pitch(t, c + (p.fixed ? settle(step + lift, under, long >= 1 || b % 2 === 0) : step), p.octave) + low, long * beat, p.level * (level ?? 1) * (0.92 + 0.16 * rng()), p.pan);
      }
    }
    const kit: Partial<Record<Drum, string>> = stem === 'groove' ? t.drums : stem === 'tension' ? t.tensionDrums : {};
    for (const [kind, line] of Object.entries(kit) as [Drum, string][])
      for (let k = 0; k < 16; k++) {
        const c = line[k];
        if (c === '.') continue;
        drum(m, kind, when(t, bar * 4 + k / 4), t.drumLevel * (c === 'o' ? 0.4 : 1) * (kind === 'hat' ? 0.55 : 0.8) * (0.9 + 0.2 * rng()), rng);
      }
  }
  space(m, t.wet * (stem === 'base' ? 1 : 0.7), t.echo * beat);
  return [m.l, m.r];
}

/** An echo from side to side and a soft room, round the loop (its end rings into its start). */
function space(m: Mix, wet: number, echo: number): void {
  const { l, r, rate } = m;
  const n = l.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const d = Math.max(1, Math.min(n - 1, Math.round(echo * rate)));
  const eL = new Float32Array(d);
  const eR = new Float32Array(d);
  let e = 0;
  let fL = 0;
  let fR = 0;
  const combs = [0.0297, 0.0371, 0.0411, 0.0437, 0.0531, 0.0607].map((s, i) => ({ buf: new Float32Array(Math.round(s * rate)), k: 0, low: 0, left: i % 2 === 0 }));
  // (twice round: the second time with what still rang)
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const a = eL[e];
      const b = eR[e];
      fL += (a - fL) * 0.45;
      fR += (b - fR) * 0.45;
      eL[e] = l[i] * 0.6 + fR * 0.42;
      eR[e] = r[i] * 0.4 + fL * 0.42;
      if (++e >= d) e = 0;
      const into = (l[i] + r[i]) * 0.5 + (a + b) * 0.3;
      let rl = 0;
      let rr = 0;
      for (const c of combs) {
        const x = c.buf[c.k];
        c.low += (x - c.low) * 0.5;
        c.buf[c.k] = into * 0.3 + c.low * 0.8;
        if (++c.k >= c.buf.length) c.k = 0;
        if (c.left) rl += x;
        else rr += x;
      }
      if (pass === 0) continue;
      outL[i] = l[i] + (a * 0.55 + rl * 0.5) * wet;
      outR[i] = r[i] + (b * 0.55 + rr * 0.5) * wet;
    }
  l.set(outL);
  r.set(outR);
}

/** How loud it is above the bass (which the ear hears less of). */
function loudness(ch: readonly Samples[], rate: number): number {
  const k = 1 - Math.exp((-2 * Math.PI * 260) / rate);
  let sum = 1e-9;
  for (const c of ch) {
    let low = 0;
    for (let i = 0; i < c.length; i++) {
      low += (c[i] - low) * k;
      sum += (c[i] - low) * (c[i] - low);
    }
  }
  return Math.sqrt(sum / (2 * ch[0].length));
}

/** All stems of a theme, loud enough together (their sum peaks at 0.9). */
export function makeTheme(id: string, rate = MUSIC_RATE): Record<StemId, [Samples, Samples]> {
  const out = {} as Record<StemId, [Samples, Samples]>;
  for (const s of STEMS) out[s] = makeStem(id, s, rate);
  // (as loud to the ear as they should be to each other, whatever is in them)
  const heard = loudness(out.base, rate);
  for (const [s, share] of [['groove', 1.05], ['tension', 0.75]] as const) {
    const g = (heard * share) / loudness(out[s], rate);
    for (const ch of out[s]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }
  let peak = 1e-6;
  const n = out.base[0].length;
  for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out.base[c][i] + out.groove[c][i] + out.tension[c][i]));
  for (const s of STEMS) for (const ch of out[s]) for (let i = 0; i < n; i++) ch[i] *= 0.9 / peak;
  return out;
}
