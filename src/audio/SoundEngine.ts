import { SAMPLE_RATE, type Samples } from './dsp';
import type { SoundReply } from './sound.worker';
import { makeEcho, SOUNDS, type SoundId } from './sounds';

export interface PlayOptions {
  /** Where it sounds (world); without it, everywhere. */
  at?: { x: number; y: number; z: number };
  /** Times the sound's own level. */
  level?: number;
  /** Times its speed (and pitch). */
  rate?: number;
  /** Random change of the speed, up to this share (default 0.06 for sounds with a place). */
  vary?: number;
  /** Part of a special attack's scene: not muffled while time runs slow, and stopped with the scene. */
  scene?: boolean;
}

/** A sound that goes on until it is stopped, and may move and change meanwhile. */
export interface LoopSound {
  /** Levels and speeds glide there; `at` (or none) is where it sounds now. */
  set(level: number, rate?: number, x?: number, y?: number, z?: number): void;
}

/** Distance within which a sound is at its full level; farther it falls with the distance. */
const NEAR = 16;
/** The music's level at its full volume. */
const MUSIC = 1.4;
const MAX_VOICES = 40;
/** The same sound again within this (seconds) is one sound. */
const AGAIN = 0.028;
const KEY = 'bugs-in-the-box.sound';

interface Settings {
  volume: number;
  room: number;
  music: number;
  muted: boolean;
}

class Looped implements LoopSound {
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private panner: PannerNode | null = null;
  private level = 0;

  constructor(
    private readonly engine: SoundEngine,
    private readonly id: SoundId,
    private readonly placed: boolean,
    private readonly bus: 'world' | 'scene' | 'room',
    /** How fast it follows `set` (seconds). */
    private readonly glide: number,
  ) {}

  set(level: number, rate = 1, x = 0, y = 0, z = 0): void {
    const c = this.engine.context;
    if (!c || (level <= 0.001 && this.level <= 0.001)) return;
    if (!this.source && !this.start(c)) return;
    this.level = level;
    const now = c.currentTime;
    (this.gain as GainNode).gain.setTargetAtTime(level * SOUNDS[this.id].level, now, this.glide);
    (this.source as AudioBufferSourceNode).playbackRate.setTargetAtTime(rate, now, 0.06);
    if (this.panner && level > 0.001) this.engine.place(this.panner, x, y, z);
    if (level <= 0.001) {
      const s = this.source as AudioBufferSourceNode;
      s.stop(now + this.glide * 8);
      const nodes = [s, this.gain, this.panner];
      s.onended = () => nodes.forEach((n) => n?.disconnect());
      this.source = this.gain = this.panner = null;
      this.level = 0;
    }
  }

  private start(c: AudioContext): boolean {
    const take = this.engine.take(this.id);
    if (!take) return false;
    this.source = c.createBufferSource();
    this.source.buffer = take;
    this.source.loop = true;
    this.gain = c.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.gain);
    let out: AudioNode = this.gain;
    if (this.placed) {
      this.panner = this.engine.panner(c);
      out.connect(this.panner);
      out = this.panner;
    }
    out.connect(this.engine.bus(this.bus));
    this.source.start(0, Math.random() * take.duration);
    return true;
  }
}

/**
 * Plays the game's sounds (Web Audio). They are computed on a worker as the page loads; the context sounds from the
 * player's first click or key (browsers want that). Nothing here may stop the game: without Web Audio it is silent.
 */
export class SoundEngine {
  context: AudioContext | null = null;
  readonly settings: Settings = { volume: 0.8, room: 0.8, music: 0.6, muted: false };
  /** What was played (scripted checks: `__debug.sound.log`), newest last. */
  readonly log: { id: string; at: number }[] = [];
  private readonly takes = new Map<SoundId, { raw: Samples[]; buffers: AudioBuffer[] }>();
  private readonly lastAt = new Map<SoundId, number>();
  private readonly sceneVoices = new Set<GainNode>();
  private readonly loops: Looped[] = [];
  private voices = 0;
  private master!: GainNode;
  private world!: GainNode;
  private muffle!: BiquadFilterNode;
  private scene!: GainNode;
  private room!: GainNode;
  private ui!: GainNode;
  private music!: GainNode;
  private echo!: ConvolverNode;
  private echoIn!: GainNode;
  private echoKind = '';
  private want: [number, number, number] = [1.1, 3000, 0.2];
  /** For checks of the level (made on demand). */
  private meter: AnalyserNode | null = null;

  constructor() {
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
    } catch {
      // (a private window may refuse it)
    }
    if (typeof AudioContext === 'undefined') return;
    const worker = new Worker(new URL('./sound.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SoundReply>) => this.takes.set(e.data.id, { raw: e.data.takes, buffers: [] });
    // (making the context takes some 50 ms: while the page loads, not at the first click, which only lets it sound)
    setTimeout(() => {
      if (!this.context) this.open();
    }, 0);
    const unlock = (): void => {
      if (!this.context) this.open();
      void this.context?.resume();
    };
    for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.context?.suspend();
      else void this.context?.resume();
    });
  }

  private open(): void {
    const c = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
    this.context = c;
    const gain = (to: AudioNode): GainNode => {
      const g = c.createGain();
      g.connect(to);
      return g;
    };
    // (two loud things at once: held down, not clipped)
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -9;
    limit.knee.value = 8;
    limit.ratio.value = 12;
    limit.attack.value = 0.002;
    limit.release.value = 0.18;
    limit.connect(c.destination);
    this.master = gain(limit);
    this.echo = c.createConvolver();
    this.echo.connect(this.master);
    this.echoIn = gain(this.echo);
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);
    this.muffle.connect(this.echoIn);
    this.world = gain(this.muffle);
    this.scene = gain(this.master);
    this.scene.connect(this.echoIn);
    this.room = gain(this.master);
    this.ui = gain(this.master);
    this.music = gain(this.master);
    this.setEcho(...this.want);
    this.apply();
  }

  /** The settings changed. */
  apply(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // (not kept, then)
    }
    if (!this.context) return;
    const { volume, muted, room, music } = this.settings;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : volume * volume, now, 0.03);
    this.room.gain.setTargetAtTime(room * room * this.roomLevel, now, 0.3);
    this.music.gain.setTargetAtTime(music * music * MUSIC, now, 0.1);
  }

  private roomLevel = 1;

  /** The ambience's level (a special attack's scene holds it down). */
  setRoomLevel(level: number): void {
    if (level === this.roomLevel) return;
    this.roomLevel = level;
    if (this.context) this.room.gain.setTargetAtTime(this.settings.room ** 2 * level, this.context.currentTime, 0.3);
  }

  /** How the place echoes: seconds, brightness (Hz), how much of it is heard. */
  setEcho(seconds: number, cut: number, level: number): void {
    this.want = [seconds, cut, level];
    const c = this.context;
    if (!c) return;
    this.echoIn.gain.value = level;
    const kind = `${seconds}|${cut}`;
    if (kind === this.echoKind) return;
    this.echoKind = kind;
    const [l, r] = makeEcho(seconds, cut);
    const b = c.createBuffer(2, l.length, SAMPLE_RATE);
    b.copyToChannel(l, 0);
    b.copyToChannel(r, 1);
    this.echo.buffer = b;
  }

  private slow = 1;

  /** How fast time runs (a special attack slows it): the world's sounds go dull with it. */
  setTimeScale(scale: number): void {
    if (Math.abs(scale - this.slow) < 0.02) return;
    this.slow = scale;
    if (this.context) this.muffle.frequency.setTargetAtTime(scale > 0.95 ? 20000 : 500 + 6000 * scale * scale, this.context.currentTime, scale > 0.95 ? 0.25 : 0.04);
  }

  /** The view: where the player hears from. */
  listen(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const l = this.context?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = px;
      l.positionY.value = py;
      l.positionZ.value = pz;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Where sounds go: the world's dull in slow motion, a scene's not, the room's has its own level. */
  bus(name: 'world' | 'scene' | 'room' | 'ui' | 'music'): GainNode {
    return this[name];
  }

  panner(c: AudioContext): PannerNode {
    const p = c.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = NEAR;
    p.rolloffFactor = 1.1;
    return p;
  }

  place(p: PannerNode, x: number, y: number, z: number): void {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  }

  /** One of the takes of a sound (null: not ready yet). */
  take(id: SoundId): AudioBuffer | null {
    const t = this.takes.get(id);
    const c = this.context;
    if (!t || !c) return null;
    const k = Math.floor(Math.random() * t.raw.length);
    if (!t.buffers[k]) {
      const b = c.createBuffer(1, t.raw[k].length, SAMPLE_RATE);
      b.copyToChannel(t.raw[k], 0);
      t.buffers[k] = b;
    }
    return t.buffers[k];
  }

  play(id: SoundId, o: PlayOptions = {}): void {
    const c = this.context;
    if (!c || c.state !== 'running' || this.settings.muted) return;
    const now = c.currentTime;
    if (now - (this.lastAt.get(id) ?? -1) < AGAIN) return;
    // (the last voices are for what matters)
    if (this.voices >= MAX_VOICES && SOUNDS[id].level < 0.5) return;
    const take = this.take(id);
    if (!take) return;
    this.lastAt.set(id, now);
    this.log.push({ id, at: now });
    if (this.log.length > 400) this.log.shift();
    const s = c.createBufferSource();
    s.buffer = take;
    const vary = o.vary ?? (o.at ? 0.06 : 0);
    s.playbackRate.value = (o.rate ?? 1) * (1 + vary * (Math.random() * 2 - 1));
    const g = c.createGain();
    g.gain.value = SOUNDS[id].level * (o.level ?? 1);
    s.connect(g);
    let out: AudioNode = g;
    let p: PannerNode | null = null;
    if (o.at) {
      p = this.panner(c);
      this.place(p, o.at.x, o.at.y, o.at.z);
      g.connect(p);
      out = p;
    }
    out.connect(o.scene ? this.scene : o.at ? this.world : this.ui);
    if (o.scene) this.sceneVoices.add(g);
    this.voices++;
    s.onended = () => {
      this.voices--;
      this.sceneVoices.delete(g);
      for (const n of [s, g, p]) n?.disconnect();
    };
    s.start();
  }

  /** A special attack was called off: its sounds go. */
  stopScene(): void {
    const c = this.context;
    if (!c) return;
    for (const g of this.sceneVoices) g.gain.setTargetAtTime(0, c.currentTime, 0.08);
  }

  /** A sound that goes on, silent until its first `set`. */
  loop(id: SoundId, placed: boolean, bus: 'world' | 'scene' | 'room' = 'world', glide = 0.06): LoopSound {
    const l = new Looped(this, id, placed, bus, glide);
    this.loops.push(l);
    return l;
  }

  /** The loudest sample of what goes out now (for checks). */
  peak(): number {
    const c = this.context;
    if (!c) return 0;
    if (!this.meter) {
      this.meter = c.createAnalyser();
      this.meter.fftSize = 8192;
      this.master.connect(this.meter);
    }
    const d = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(d);
    let top = 0;
    for (const v of d) top = Math.max(top, Math.abs(v));
    return top;
  }

  get ready(): number {
    return this.takes.size;
  }
}
