import { TICK_RATE } from '../game/bug';
import { WIND_MAX, type Match } from '../game/match';
import type { Weapon } from '../game/weapons';
import type { Terrain } from '../terrain/Terrain';
import { CHUNK } from '../terrain/constants';

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
};

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface HudState {
  /** Where meshing runs ("3 workers", "main thread"). */
  meshing: string;
  generateMs: number;
  /** Until the whole map is on screen. */
  initialMeshMs: number;
  /** Main-thread cost of the last remesh (with workers: copy, post and upload only). */
  lastExplosionMs: number;
  lastExplosionWorkerMs: number;
  /** From the request until the new meshes are on screen (workers only). */
  lastExplosionLatencyMs: number;
  lastExplosionChunks: number;
  triangles: number;
  bench: string;
}

/** DOM HUD. Writes to the DOM only when a shown value changes. */
export class Hud {
  readonly seed = el<HTMLInputElement>('seed');
  readonly scenario = el<HTMLSelectElement>('scenario');
  readonly regen = el<HTMLButtonElement>('regen');
  readonly random = el<HTMLButtonElement>('rand');
  readonly bench = el<HTMLButtonElement>('bench');
  readonly pad = el('pad');
  private readonly stats = el('stats');
  private readonly fps = el('fps');
  private readonly who = el('who');
  private readonly timer = el('timer');
  private readonly windArrow = el('windArrow');
  private readonly windBar = el('windBar');
  private readonly power = el('power').firstElementChild as HTMLElement;
  private readonly weaponList = el('weaponList');
  private readonly teams = el('teams');
  private readonly banner = el('banner');
  private weaponButtons: HTMLButtonElement[] = [];
  private teamRows: { hp: HTMLElement; bar: HTMLElement; max: number }[] = [];
  private readonly last = new Map<string, string>();

  private readonly sorted = new Float32Array(120);

  /** Frame rate and frame-time spread over the last `count` frame times (ms). */
  setFrames(frameMs: Float32Array, count: number): void {
    if (count === 0) return;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      this.sorted[i] = frameMs[i];
      sum += frameMs[i];
    }
    const s = this.sorted.subarray(0, count).sort();
    const p95 = s[Math.min(count - 1, Math.floor(count * 0.95))];
    this.fps.textContent = `${Math.round((1000 * count) / sum)} fps · p95 ${p95.toFixed(1)} ms · worst ${s[count - 1].toFixed(1)} ms`;
  }

  render(terrain: Terrain, s: HudState): void {
    this.stats.textContent =
      `map ${terrain.W}×${terrain.H}×${terrain.D} · ${terrain.chunkCount} chunks of ${CHUNK}³ · ${(s.triangles / 1000).toFixed(1)}k triangles\n` +
      `meshing on ${s.meshing} · generate: ${s.generateMs.toFixed(0)} ms · initial mesh: ${s.initialMeshMs.toFixed(0)} ms\n` +
      `last remesh (${s.lastExplosionChunks} chunks): main thread ${s.lastExplosionMs.toFixed(1)} ms` +
      (s.lastExplosionLatencyMs > 0
        ? ` · worker ${s.lastExplosionWorkerMs.toFixed(1)} ms · on screen after ${s.lastExplosionLatencyMs.toFixed(0)} ms`
        : '') +
      (s.bench ? `\n${s.bench}` : '');
  }

  /** Build the weapon buttons and team bars for a new match. */
  setupMatch(match: Match, weapons: readonly Weapon[], onWeapon: (index: number) => void): void {
    this.weaponButtons = weapons.map((w, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1} ${w.name}`;
      b.addEventListener('click', () => {
        onWeapon(i);
        b.blur();
      });
      return b;
    });
    this.weaponList.replaceChildren(...this.weaponButtons);

    this.teamRows = [];
    this.teams.replaceChildren(
      ...match.teams.map((t, i) => {
        const row = document.createElement('div');
        row.className = 'team';
        const name = document.createElement('span');
        name.textContent = t.name;
        name.style.color = hex(t.color);
        const hp = document.createElement('span');
        const meter = document.createElement('div');
        meter.className = 'meter';
        const bar = document.createElement('div');
        bar.style.background = hex(t.color);
        meter.append(bar);
        row.append(name, hp, meter);
        this.teamRows.push({ hp, bar, max: Math.max(1, match.teamHealth(i)) });
        return row;
      }),
    );
    this.last.clear();
  }

  /** `windAngle`: screen angle of the wind in radians (0 = right, positive = clockwise). */
  renderMatch(match: Match, windAngle: number): void {
    const u = match.activeUnit;
    const team = match.teams[u.team];
    this.set('who', () => {
      this.who.textContent = `${team.name} · ${u.name}`;
      this.who.style.color = hex(team.color);
    }, `${team.name}|${u.name}`);

    const timer =
      match.phase === 'aim'
        ? String(Math.ceil(match.turnTicks / TICK_RATE))
        : match.phase === 'flight' && match.retreatTicks > 0
          ? `retreat ${Math.ceil(match.retreatTicks / TICK_RATE)}`
          : match.phase === 'over'
            ? 'over'
            : '…';
    this.set('timer', () => (this.timer.textContent = timer), timer);

    const strength = Math.min(1, Math.sqrt(match.windX * match.windX + match.windZ * match.windZ) / (WIND_MAX * Math.SQRT2));
    this.windArrow.style.transform = `rotate(${windAngle}rad)`;
    this.set('wind', () => (this.windBar.style.width = `${(strength * 100).toFixed(0)}%`), strength.toFixed(2));

    const power = match.charging ? match.power : 0;
    this.set('power', () => (this.power.style.width = `${(power * 100).toFixed(0)}%`), power.toFixed(2));

    this.set('weapon', () => this.weaponButtons.forEach((b, i) => b.classList.toggle('on', i === match.weapon)), String(match.weapon));

    match.teams.forEach((_t, i) => {
      const h = match.teamHealth(i);
      const row = this.teamRows[i];
      this.set(`team${i}`, () => {
        row.hp.textContent = String(h);
        row.bar.style.width = `${((h / row.max) * 100).toFixed(1)}%`;
      }, String(h));
    });

    const banner =
      match.phase !== 'over' ? '' : match.winner >= 0 ? `${match.teams[match.winner].name} win!` : 'Draw: nobody is left';
    this.set('banner', () => {
      this.banner.style.display = banner ? 'block' : 'none';
      this.banner.replaceChildren();
      if (!banner) return;
      this.banner.append(banner);
      const small = document.createElement('small');
      small.textContent = 'press N (or "new match") to play again';
      this.banner.append(small);
      if (match.winner >= 0) this.banner.style.color = hex(match.teams[match.winner].color);
    }, banner);
  }

  private set(key: string, apply: () => void, value: string): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    apply();
  }
}
