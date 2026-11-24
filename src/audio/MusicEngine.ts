import { loopOf, MUSIC_RATE, STEMS, THEMES, type StemId } from './music';
import type { MusicReply } from './music.worker';
import type { SoundEngine } from './SoundEngine';

/** What the music should be like now. */
export interface MusicMood {
  /** 0..1: the base (chords and bass), the groove (melody and drums), the tension. */
  base: number;
  groove: number;
  tension: number;
  /** It sounds from behind a wall (a special attack's scene, slow motion): 0..1. */
  far: number;
}

interface Playing {
  theme: string;
  sources: AudioBufferSourceNode[];
  gains: Record<StemId, GainNode>;
  out: GainNode;
  startedAt: number;
}

/** Seconds a new map's music takes to come in, the old one's to go. */
const FADE = 1.6;

/**
 * Plays the map's music: its stems loop together, and their levels follow the match. They are computed on a worker when
 * the map is chosen; nothing is heard until then, nor before the player's first click or key.
 */
export class MusicEngine {
  private worker: Worker | null = null;
  private want = '';
  private ready: MusicReply | null = null;
  private now: Playing | null = null;
  private filter: BiquadFilterNode | null = null;
  private out: GainNode | null = null;
  private duckUntil = 0;

  constructor(private readonly engine: SoundEngine) {
    if (typeof AudioContext === 'undefined') return;
    this.worker = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<MusicReply>) => {
      if (e.data.theme === this.want) this.ready = e.data;
    };
  }

  /** The map's music from now on. */
  choose(theme: string): void {
    if (theme === this.want || !(theme in THEMES)) return;
    this.want = theme;
    this.ready = null;
    this.worker?.postMessage(theme);
  }

  /** The music makes room for a blast. */
  duck(seconds: number): void {
    const c = this.engine.context;
    if (c) this.duckUntil = Math.max(this.duckUntil, c.currentTime + seconds);
  }

  /** Beats since the loop began (for what moves to it; -1: no music). */
  get beat(): number {
    const c = this.engine.context;
    if (!c || !this.now) return -1;
    const t = THEMES[this.now.theme];
    return (((c.currentTime - this.now.startedAt) * t.bpm) / 60) % loopOf(t).beats;
  }

  get playing(): string {
    return this.now?.theme ?? '';
  }

  /** Every frame. */
  frame(mood: MusicMood): void {
    const c = this.engine.context;
    if (!c || c.state !== 'running') return;
    if (!this.filter || !this.out) {
      this.filter = c.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.Q.value = 0.4;
      this.out = c.createGain();
      this.out.gain.value = 0;
      this.filter.connect(this.out);
      this.out.connect(this.engine.bus('music'));
    }
    if (this.now && this.now.theme !== this.want) this.stop(c);
    if (!this.now && this.ready) this.start(c, this.ready);
    const t = c.currentTime;
    const ducked = t < this.duckUntil;
    this.out.gain.setTargetAtTime(ducked ? 0.45 : 1 - 0.55 * mood.far, t, ducked ? 0.03 : 0.35);
    this.filter.frequency.setTargetAtTime(16000 * 0.028 ** mood.far, t, 0.15);
    if (!this.now) return;
    for (const s of STEMS) this.now.gains[s].gain.setTargetAtTime(mood[s], t, s === 'tension' ? 0.5 : 0.7);
  }

  private start(c: AudioContext, r: MusicReply): void {
    this.ready = null;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, c.currentTime, FADE / 2);
    out.connect(this.filter as BiquadFilterNode);
    const gains = {} as Record<StemId, GainNode>;
    const sources: AudioBufferSourceNode[] = [];
    const at = c.currentTime + 0.1;
    for (const s of STEMS) {
      const [left, right] = r.stems[s];
      const b = c.createBuffer(2, left.length, MUSIC_RATE);
      b.copyToChannel(left, 0);
      b.copyToChannel(right, 1);
      const src = c.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(out);
      src.start(at);
      gains[s] = g;
      sources.push(src);
    }
    this.now = { theme: r.theme, sources, gains, out, startedAt: at };
  }

  private stop(c: AudioContext): void {
    const p = this.now as Playing;
    this.now = null;
    p.out.gain.setTargetAtTime(0, c.currentTime, FADE / 4);
    for (const s of p.sources) s.stop(c.currentTime + FADE * 1.5);
    p.sources[0].onended = () => {
      for (const n of [...p.sources, ...Object.values(p.gains), p.out]) n.disconnect();
    };
  }
}
