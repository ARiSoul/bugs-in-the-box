import { TICK_RATE } from '../game/bug';
import { SKILL_FULL, WIND_MAX, type Match } from '../game/match';
import type { ItemKind } from '../game/items';
import { WEAPONS, type Weapon } from '../game/weapons';
import { CHUNK } from '../terrain/constants';
import type { Terrain } from '../terrain/Terrain';
import { ARMS, BUGS } from './emblems';
import { letters } from './lettering';
import { SkillCard } from './skillCard';

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
};

const make = (cls: string, html = ''): HTMLElement => {
  const e = document.createElement('div');
  e.className = cls;
  e.innerHTML = html;
  return e;
};

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
/** The teams' colours in the lettering. */
const TEAM = ['#ff7a68', '#8ccaff'];
/** What each box does, in a few words. */
const WHAT: Record<ItemKind, string> = { battery: 'the special loads', patch: 'patched up', fuse: 'the next blow hurts half', overclock: 'the next shot hits harder', spring: 'jumps high for a while', paste: 'a trap to lay', crystal: '15 seconds more', magnet: 'come here!', scrap: 'a found weapon, twice', dud: 'that one was a dud' };
/** Seconds from which the clock is urgent. */
const URGENT = 5;
/** Degrees between two cards of the hand. */
const FAN = 7;

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

/** The special attack of a team's species. */
function specialOf(match: Match, team: number): number {
  return WEAPONS.findIndex((w) => w.sceneTicks > 0 && w.species === match.teams[team].species.id);
}

interface TeamView {
  root: HTMLElement;
  fill: HTMLElement;
  trail: HTMLElement;
  total: HTMLElement;
  chips: { root: HTMLElement; bar: HTMLElement }[];
  card: SkillCard;
  max: number;
}

/** DOM HUD of a match: the duel (both teams' health, the clock between them), the hand of weapons. Writes only what changed. */
export class Hud {
  readonly seed = el<HTMLInputElement>('seed');
  readonly regen = el<HTMLButtonElement>('regen');
  readonly random = el<HTMLButtonElement>('rand');
  readonly bench = el<HTMLButtonElement>('bench');
  readonly pad = el('pad');
  private readonly stats = el('stats');
  private readonly fps = el('fps');
  private readonly banner = el('banner');
  private readonly root = el('hud');
  private readonly clock = make('clock', '<div class="digits"></div><small></small>');
  private readonly wind = make('wind', '<span>wind</span><i></i><div class="force"><u></u><u></u><u></u><u></u><u></u></div>');
  private readonly call = make('call');
  /** What turned up, or was found, on the map. */
  private readonly news = make('news');
  private readonly deck = make('deck');
  private readonly hand = make('hand');
  private readonly power = make('power', '<u></u><s></s>');
  private readonly aim = make('aim');
  private teams: TeamView[] = [];
  private cards: { root: HTMLButtonElement; key: HTMLElement; index: number }[] = [];
  /** The active team's special attack: a card of the hand that loads. */
  private readonly skill = new SkillCard(0, 0, true);
  private readonly skillHolder = make('slot special-slot');
  private skillWeapon = -1;
  private onWeapon: (index: number) => void = () => {};
  private readonly last = new Map<string, string>();
  private readonly sorted = new Float32Array(120);

  constructor() {
    this.deck.append(this.aim, this.power, this.hand);
    this.root.append(this.clock, this.wind, this.call, this.news, this.deck);
    this.skillHolder.append(this.skill.root);
    this.skill.root.addEventListener('click', () => {
      if (this.skillWeapon >= 0) this.onWeapon(this.skillWeapon);
    });
  }

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

  /** Build the duel and the hand for a new match. */
  setupMatch(match: Match, weapons: readonly Weapon[], onWeapon: (index: number) => void): void {
    this.onWeapon = onWeapon;
    for (const t of this.teams) t.root.remove();
    this.teams = match.teams.map((t, i) => {
      const root = make(`duel side${i}`);
      const bar = make('health', '<s></s><u></u>');
      const total = make('total');
      const row = make('row3');
      const chips = match.units
        .filter((u) => u.team === i)
        .map((u) => {
          const chip = make('chip', `<svg viewBox="0 0 100 60" aria-hidden="true">${BUGS[u.bug.species.id]}</svg><i><u></u></i>`);
          chip.title = u.name;
          row.append(chip);
          return { root: chip, bar: chip.querySelector('u') as HTMLElement };
        });
      const card = new SkillCard(0, 0, false);
      row.prepend(card.root);
      root.title = t.name;
      root.append(bar, total, row);
      this.root.append(root);
      return { root, fill: bar.querySelector('u') as HTMLElement, trail: bar.querySelector('s') as HTMLElement, total, chips, card, max: Math.max(1, match.teamHealth(i)) };
    });
    this.cards = weapons.map((w, index) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.style.setProperty('--w', hex(w.color));
      const power = Math.min(5, Math.round((w.damage + w.arcDamage * 0.5) / 11));
      b.innerHTML = `<em></em><svg viewBox="0 0 48 48" aria-hidden="true">${ARMS[w.id] ?? ''}</svg><span>${w.name}</span><div class="facts"><i title="damage">${'<u class="on"></u>'.repeat(power)}${'<u></u>'.repeat(5 - power)}</i><small>${w.kind === 'tunnel' ? 'digs' : w.kind === 'grenade' ? 'bounces' : w.kind === 'web' || w.kind === 'trap' ? 'holds' : w.arcs ? 'arcs' : 'bursts'}${w.windFactor > 0.5 ? ' · wind' : ''}</small></div>`;
      b.setAttribute('aria-label', w.name);
      b.addEventListener('click', () => {
        onWeapon(index);
        b.blur();
      });
      return { root: b, key: b.firstElementChild as HTMLElement, index };
    });
    this.last.clear();
  }

  private tell(html: string, color: string): void {
    const line = make('line', html);
    line.style.setProperty('--k', color);
    this.news.append(line);
    while (this.news.children.length > 3) this.news.firstElementChild?.remove();
    setTimeout(() => line.remove(), 3600);
  }

  /** A box sets out. */
  box(by: 'ants' | 'bee'): void {
    this.tell(`<span>${by === 'bee' ? 'a bee brings a box' : 'ants carry in a box'}</span>`, '#ffb547');
  }

  /** A bug opened a box. */
  found(match: Match, unit: number, kind: ItemKind, look: { color: string; name: string; path: string }): void {
    this.tell(`<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${look.path}"/></svg><b>${look.name}</b><span>${match.units[unit].name}: ${WHAT[kind]}</span>`, look.color);
  }

  /** `windAngle`: screen angle of the wind in radians (0 = right, positive = clockwise). */
  renderMatch(match: Match, windAngle: number, computer = false): void {
    const u = match.activeUnit;
    const team = match.teams[u.team];

    const seconds = match.phase === 'aim' ? Math.ceil(match.turnTicks / TICK_RATE) : match.phase === 'flight' && match.retreatTicks > 0 ? Math.ceil(match.retreatTicks / TICK_RATE) : -1;
    const what = match.phase === 'aim' ? '' : seconds >= 0 ? 'retreat' : '';
    this.set('clock', () => {
      const digits = this.clock.firstElementChild as HTMLElement;
      digits.innerHTML = seconds >= 0 ? letters(String(seconds), { fill: '#1b1206', ink: 'none', shadow: 'none', outline: 0, drop: 0 }) : '<b></b><b></b><b></b>';
      (this.clock.lastElementChild as HTMLElement).textContent = what;
      const urgent = match.phase === 'aim' && seconds <= URGENT;
      this.clock.classList.toggle('urgent', urgent);
      this.clock.classList.toggle('retreat', what !== '');
      if (urgent) {
        this.clock.classList.remove('tick');
        void this.clock.offsetWidth;
        this.clock.classList.add('tick');
      }
    }, `${seconds}|${what}`);

    const strength = Math.min(1, Math.sqrt(match.windX * match.windX + match.windZ * match.windZ) / (WIND_MAX * Math.SQRT2));
    (this.wind.children[1] as HTMLElement).style.transform = `rotate(${windAngle.toFixed(2)}rad)`;
    this.set('wind', () => {
      const n = strength < 0.02 ? 0 : Math.max(1, Math.round(strength * 5));
      [...this.wind.children[2].children].forEach((k, i) => k.classList.toggle('on', i < n));
      this.wind.classList.toggle('calm', n === 0);
    }, strength.toFixed(2));

    this.teams.forEach((t, i) => {
      const h = match.teamHealth(i);
      t.card.show(WEAPONS[specialOf(match, i)], match.skill[i] / SKILL_FULL, '');
      this.set(`team${i}`, () => {
        const f = `${((h / t.max) * 100).toFixed(1)}%`;
        t.fill.style.width = f;
        t.trail.style.width = f;
        t.total.textContent = String(h);
        if (this.last.get(`was${i}`) !== undefined && Number(this.last.get(`was${i}`)) > h) {
          t.root.classList.remove('hurt');
          void t.root.offsetWidth;
          t.root.classList.add('hurt');
        }
        this.last.set(`was${i}`, String(h));
      }, String(h));
      this.set(`turn${i}`, () => t.root.classList.toggle('on', u.team === i && match.phase !== 'over'), `${u.team}|${match.phase === 'over'}`);
      let k = 0;
      for (const q of match.units) {
        if (q.team !== i) continue;
        const chip = t.chips[k++];
        this.set(`gift${q.id}`, () => {
          chip.root.classList.toggle('fused', q.fuse);
          chip.root.classList.toggle('boosted', q.boost);
        }, `${q.fuse}|${q.boost}`);
        this.set(`unit${q.id}`, () => {
          chip.bar.style.width = `${Math.max(0, (q.bug.health / q.bug.species.health) * 100).toFixed(0)}%`;
          chip.root.classList.toggle('dead', !q.bug.alive);
          chip.root.classList.toggle('active', q === u && q.bug.alive);
        }, `${q.bug.health}|${q.bug.alive}|${q === u}`);
      }
    });

    this.set('call', () => {
      this.deck.classList.toggle('away', computer);
      if (match.phase !== 'aim') return;
      this.call.innerHTML = letters(u.name.toUpperCase(), { fill: TEAM[u.team] ?? '#f6efdf' }) + `<span>${computer ? 'the computer is up' : 'your turn'}</span>`;
      this.call.classList.remove('on');
      void this.call.offsetWidth;
      this.call.classList.add('on');
    }, `${match.turnNumber}|${computer}`);

    // the hand (a weapon of another species is not in it; the special attack is the last card)
    this.set('hand', () => {
      const own = this.cards.filter((c) => match.has(u, c.index) && WEAPONS[c.index].sceneTicks === 0);
      this.skillWeapon = this.cards.find((c) => match.has(u, c.index) && WEAPONS[c.index].sceneTicks > 0)?.index ?? -1;
      const slots: HTMLElement[] = own.map((c, i) => {
        const s = make('slot');
        s.append(c.root);
        c.key.textContent = String(i + 1);
        c.root.dataset.left = match.stock[u.team][c.index] > 0 ? `×${match.stock[u.team][c.index]}` : '';
        return s;
      });
      if (this.skillWeapon >= 0) slots.push(this.skillHolder);
      slots.forEach((s, i) => {
        s.style.setProperty('--a', `${((i - (slots.length - 1) / 2) * FAN).toFixed(2)}deg`);
        s.style.setProperty('--i', String(i));
      });
      this.hand.replaceChildren(...slots);
      this.hand.classList.remove('deal');
      void this.hand.offsetWidth;
      this.hand.classList.add('deal');
      this.hand.style.setProperty('--c', TEAM[u.team] ?? '#ffb547');
    }, `${u.bug.species.id}|${u.team}|${match.turnNumber}|${match.stock[u.team].join()}`);
    if (this.skillWeapon >= 0) this.skill.show(WEAPONS[this.skillWeapon], match.skill[u.team] / SKILL_FULL, String(this.hand.children.length));
    this.set('weapon', () => {
      for (const c of this.cards) c.root.parentElement?.classList.toggle('on', c.index === match.weapon);
      this.skillHolder.classList.toggle('on', match.weapon === this.skillWeapon);
    }, `${match.weapon}|${match.turnNumber}|${match.stock[u.team].join()}`);
    this.set('spent', () => this.deck.classList.toggle('spent', match.phase !== 'aim' && match.phase !== 'special'), match.phase);

    const power = match.charging ? match.power : 0;
    this.set('power', () => {
      (this.power.firstElementChild as HTMLElement).style.width = `${(power * 100).toFixed(0)}%`;
      this.power.classList.toggle('on', match.charging);
      this.deck.classList.toggle('charging', match.charging);
      this.power.classList.toggle('hot', power > 0.85);
    }, `${power.toFixed(2)}|${match.charging}`);

    // the aim angle above the horizon, in degrees, for fine aiming
    const brood = match.currentWeapon.kind === 'brood' && match.stance;
    const aim = computer
      ? ''
      : brood && !match.mark
        ? 'point at a spot nearer to it'
        : brood
          ? 'point at a spot, click (or the fire key) to call them · W/S move, right drag turns the view'
          : match.phase === 'aim'
            ? `<b>${match.currentWeapon.name}</b> aim ${((Math.atan2(u.aimV, u.aimH) * 180) / Math.PI).toFixed(1)}°`
            : '';
    this.set('aim', () => (this.aim.innerHTML = aim), aim);

    const banner = match.phase !== 'over' || document.body.classList.contains('menu') ? '' : match.winner >= 0 ? `${team.name ? match.teams[match.winner].name : ''} win` : 'Nobody left';
    this.set('banner', () => {
      this.banner.style.display = banner ? 'block' : 'none';
      this.banner.innerHTML = banner ? letters(banner.replace('Cockroaches', 'Roaches'), { fill: TEAM[match.winner] ?? '#ffb547' }) : '';
    }, banner);
  }

  private set(key: string, apply: () => void, value: string): void {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    apply();
  }
}
