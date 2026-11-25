import type { BugSpecies } from '../game/species';
import { SPECIES } from '../game/species';
import { brings, type Gain, type Level } from '../game/progress';
import { WEAPONS } from '../game/weapons';
import { SCENARIOS } from '../terrain/scenarios';
import { letters } from './lettering';
import { BUGS } from './emblems';
import { Marchers } from './marchers';
import { art } from './skillCard';

/** What a match is set up with. */
export interface SetupChoice {
  scenario: string;
  species: [BugSpecies, BugSpecies];
  players: [string, string];
  size: number;
  seconds: number;
  wind: number;
  seed: number;
  /** Nobody has levels in this match. */
  equal: boolean;
}

export interface SetupHooks {
  /** A side's level with its species (0: none to show), and its page. */
  level(side: number): number;
  onSpeciesPage(side: number): void;
  /** Another map, or another seed for it. */
  onMap(): void;
  onSpecies(side: number): void;
  onPlay(): void;
  /** The pointer is on a side's fighter. */
  onHover(side: number): void;
  /** The pointer is on Play (or left it). */
  onReady(on: boolean): void;
  /** A control was used (a sound). */
  onPick(strong: boolean): void;
  random(): number;
  /** The mute key. */
  onMute(): void;
}

const PLURAL: Record<string, string> = { ant: 'Ants', spider: 'Spiders', cockroach: 'Cockroaches', bee: 'Bees' };
/** Short enough to stand large. */
const SHORT: Record<string, string> = { ant: 'Ants', spider: 'Spiders', cockroach: 'Roaches', bee: 'Bees' };
const SIDES = ['Red', 'Blue'];
const PLAYERS: [string, string][] = [['human', 'You'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
const SECONDS = [15, 30, 45, 60];
const WINDS: [number, string][] = [[0, 'Off'], [0.5, 'Breeze'], [1, 'Windy'], [1.6, 'Gale']];
/** A line for each species, its own trait, its special attack in a few words. */
const ABOUT: Record<string, [string, string, string]> = {
  ant: ['Tough. Never alone.', 'The most health of all', 'March a column of workers at them'],
  spider: ['Patient. Hard to corner.', 'Web Shot, and hangs by a thread', 'Draw a bow of silk, let the dart fly'],
  bee: ['Sweet. Until it is not.', 'Flies: 3 seconds a turn', 'Take the crown, fly the swarm yourself'],
  cockroach: ['Fast. Refuses to die.', 'Hard Shell: outlives one blow', 'Kill the lights, send in the brood'],
};
/** A line for each device, and its colour. */
const PLACES: Record<string, [string, string]> = {
  'pc-case': ['Fans, cables and a hot graphics card', '#b06cff'],
  speaker: ['Cones and coils, opened up', '#ffb347'],
  fridge: ['Cold shelves, sticky bottles', '#8fd8f0'],
  microwave: ['The plate turns each turn', '#ffd84d'],
  desk: ['Screens on, nobody home', '#7fd0a0'],
  car: ['Ignition on, glove box open', '#ff7a4d'],
};
const ICONS: Record<string, string> = {
  'pc-case': '<path class="a" d="M10 3h28v42H10z"/><path class="b" d="M15 8h18v4H15zM15 15h18v3H15z"/><circle class="b" cx="24" cy="31.5" r="10"/><g class="spin"><path class="a" d="M24 31.5l-2.6-8.6h5.2zM24 31.5l8.7 2-2.6 4.6zM24 31.5l-6.1 6.6-2.6-4.6z"/><circle class="a" cx="24" cy="31.5" r="2.6"/></g>',
  speaker: '<path class="a" d="M10 3h28v42H10z"/><circle class="b" cx="24" cy="12.5" r="5.5"/><circle class="a" cx="24" cy="12.5" r="2"/><g class="thump"><circle class="b" cx="24" cy="31" r="11"/><circle class="a" cx="24" cy="31" r="6.4"/><circle class="b" cx="24" cy="31" r="2.8"/></g>',
  fridge: '<path class="a" d="M11 3h26v42H11z"/><path class="b" d="M11 17h26v2.6H11z"/><path class="b swing" d="M15 8h2.8v7H15zM15 22.5h2.8V33H15z"/>',
  microwave: '<path class="a" d="M3 10h42v29H3z"/><path class="b" d="M8 15h24v19H8z"/><path class="a slide" d="M11 28h18v2.6H11zM16 22h8v5h-8z"/><path class="b" d="M36 16h5v3h-5zM36 22h5v3h-5zM36 28h5v3h-5z"/>',
  desk: '<path class="a" d="M3 31h42v4H3zM7 35h4v10H7zM37 35h4v10h-4z"/><path class="a" d="M11 6h26v19H11zM22 25h4v6h-4z"/><path class="b" d="M14 9h20v13H14z"/><path class="a blink" d="M17 12h9v2H17zM17 16h13v2H17z"/>',
  car: '<path class="a" d="M3 43V30C6 8 42 8 45 30v13z"/><circle class="b" cx="15" cy="31" r="7.5"/><circle class="b" cx="33" cy="31" r="7.5"/><path class="a needle" d="M15 31l-5-4 1.4-1.6z"/><path class="a needle" d="M33 31l-5-4 1.4-1.6z"/>',
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** The game's name: BUGS over BOX, feelers on the U, a fan in the O, a small plate between them. */
function logo(): string {
  const ink = '#130f0c';
  const feelers = `<g class="feel"><path d="M20-6C14-26 4-30-8-30" stroke="${ink}" stroke-width="15"/><path d="M60-6C66-26 76-30 88-30" stroke="${ink}" stroke-width="15"/><path d="M20-2C14-26 4-30-8-30M60-2C66-26 76-30 88-30" stroke="#ff5a45" stroke-width="7"/><circle cx="-9" cy="-30" r="7" fill="#ff5a45" stroke="${ink}" stroke-width="4"/><circle cx="89" cy="-30" r="7" fill="#ff5a45" stroke="${ink}" stroke-width="4"/></g>`;
  const blade = (a: number): string => `<path transform="rotate(${a} 40 50)" d="M40 50 32 24Q44 18 48 28z" fill="#5fb4ff"/>`;
  const fan = `<rect x="22" y="23" width="36" height="54" fill="${ink}"/><g class="fan">${[0, 72, 144, 216, 288].map(blade).join('')}<circle cx="40" cy="50" r="5.5" fill="#f6efdf"/></g>`;
  const bugs = letters('Bugs', { fill: '#ff5a45', each: 'slam1', extra: { 1: feelers } });
  const box = letters('Box', { fill: '#5fb4ff', each: 'slam1', extra: { 1: fan } });
  return `<span class="l1">${bugs}</span><span class="l2">${letters('in the', { fill: '#ffb547', drop: 5, outline: 10 })}</span><span class="l3">${box}</span>`;
}

/**
 * The setup screen: the two teams face to face (the fighters are drawn by the render, `gpu/heroes.ts`), the devices and
 * the rules under them. It writes the player's choice into `choice` and tells the game through the hooks.
 */
export class SetupScreen {
  readonly root = make('div');
  private readonly cards: HTMLElement[] = [];
  private readonly devices: HTMLButtonElement[] = [];
  private readonly place = make('div', 'place');
  private readonly rules = make('div', 'rules');
  private readonly marchers = new Marchers();
  private readonly called = make('div', 'called');
  private readonly play = make('button', 'play', `<span>${letters('Play', { fill: '#1b1206', ink: 'none', shadow: 'none', outline: 0, drop: 0 })}</span>`);
  private open = false;
  /** The player chose whether the match is equal. */
  private equalPicked = false;

  constructor(
    readonly choice: SetupChoice,
    private readonly hooks: SetupHooks,
  ) {
    this.root.id = 'setup';
    const title = make('h1', 'logo', logo());
    title.setAttribute('aria-label', 'Bugs in the Box');
    this.root.append(title, make('div', 'versus', letters('VS', { fill: '#ffb547' })), this.called);
    for (const i of [0, 1]) this.root.append(this.zone(i), this.side(i));
    const bar = make('div', 'bar');
    const shelf = make('div', 'shelf');
    for (const s of SCENARIOS) {
      const b = make('button', 'device', `<svg viewBox="0 0 48 48" aria-hidden="true">${ICONS[s.id] ?? ''}</svg><span>${s.name}</span>`);
      b.style.setProperty('--d', PLACES[s.id]?.[1] ?? '#ffb547');
      b.addEventListener('click', () => this.pickMap(s.id));
      b.addEventListener('pointerenter', () => this.placeName(s.id));
      b.addEventListener('pointerleave', () => this.placeName(this.choice.scenario));
      this.devices.push(b);
      shelf.append(b);
    }
    this.play.setAttribute('aria-label', 'Play');
    this.play.addEventListener('click', () => this.start());
    for (const [on, type] of [[true, 'pointerenter'], [false, 'pointerleave']] as const)
      this.play.addEventListener(type, () => {
        this.marchers.hurry = on;
        hooks.onReady(on);
      });
    bar.append(this.marchers.canvas, shelf, this.place, this.rules, this.play);
    this.root.append(bar);
    this.root.hidden = true;
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('pointermove', (e) => {
      if (!this.open) return;
      // (the layers drift apart a little)
      this.root.style.setProperty('--px', ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
      this.root.style.setProperty('--py', ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
    });
    this.refresh();
  }

  show(): void {
    this.open = true;
    this.root.hidden = false;
    this.root.classList.remove('leave');
    this.refresh();
    this.marchers.start();
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
    this.marchers.hurry = false;
    this.marchers.stop();
  }

  /** A map's name, large, while it is made (it moves on while the page is busy)... */
  call(): void {
    const s = SCENARIOS.find((q) => q.id === this.choice.scenario);
    this.called.innerHTML = letters(s?.name ?? '', { fill: PLACES[this.choice.scenario]?.[1] });
    this.called.classList.remove('on', 'off');
    void this.called.offsetWidth;
    this.called.classList.add('on');
  }

  /** ...until the map is there. */
  uncall(): void {
    this.called.classList.add('off');
  }

  /** The choice changed from outside, or here: show it. */
  refresh(): void {
    const c = this.choice;
    SCENARIOS.forEach((s, i) => {
      this.devices[i].classList.toggle('on', s.id === c.scenario);
      this.devices[i].setAttribute('aria-pressed', String(s.id === c.scenario));
    });
    this.placeName(c.scenario);
    for (const i of [0, 1]) this.fill(i);
    this.rules.replaceChildren(
      this.stepper('Bugs each', String(c.size), (d) => (c.size = 1 + ((c.size - 1 + d + 5) % 5))),
      this.stepper('Turn', `${c.seconds} s`, (d) => (c.seconds = this.turn(SECONDS, c.seconds, d))),
      this.stepper('Wind', WINDS.find((w) => w[0] === c.wind)?.[1] ?? 'Windy', (d) => (c.wind = this.turn(WINDS.map((w) => w[0]), c.wind, d))),
      this.stepper('Levels', c.equal ? 'Equal' : 'On', () => {
        c.equal = !c.equal;
        this.equalPicked = true;
      }),
      this.seed(),
    );
  }

  private placeName(id: string): void {
    const s = SCENARIOS.find((q) => q.id === id) ?? SCENARIOS[0];
    this.place.innerHTML = `<b style="color:${PLACES[s.id]?.[1] ?? ''}">${s.name}</b><span>${PLACES[s.id]?.[0] ?? ''}</span>`;
  }

  private turn(list: number[], now: number, d: number): number {
    const i = Math.max(0, list.indexOf(now));
    return list[(i + d + list.length) % list.length];
  }

  private stepper(label: string, value: string, step: (d: number) => void): HTMLElement {
    const e = make('div', 'rule', `<em>${label}</em>`);
    const row = make('div', 'row2');
    for (const d of [-1, 1]) {
      const b = make('button', 'step', d < 0 ? '‹' : '›');
      b.setAttribute('aria-label', `${label}: ${d < 0 ? 'less' : 'more'}`);
      b.addEventListener('click', () => {
        step(d);
        this.hooks.onPick(false);
        this.refresh();
      });
      row.append(b);
      if (d < 0) row.append(make('strong', '', value));
    }
    e.append(row);
    return e;
  }

  private seed(): HTMLElement {
    const e = make('div', 'rule', '<em>Map seed</em>');
    const row = make('div', 'row2');
    const input = make('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 6;
    input.value = String(this.choice.seed);
    input.setAttribute('aria-label', 'map seed');
    const apply = (s: number): void => {
      this.choice.seed = s;
      this.hooks.onPick(false);
      this.hooks.onMap();
      this.refresh();
    };
    input.addEventListener('change', () => apply(Number(input.value.replace(/\D/g, '')) | 0));
    const dice = make('button', 'step dice', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3z"/><circle cx="8" cy="8" r="1.4"/><circle cx="16" cy="16" r="1.4"/><circle cx="16" cy="8" r="1.4"/><circle cx="8" cy="16" r="1.4"/></svg>');
    dice.setAttribute('aria-label', 'another map');
    dice.addEventListener('click', () => apply(this.hooks.random()));
    row.append(input, dice);
    e.append(row);
    return e;
  }

  /** Where a side's fighter is drawn: it shows off when the pointer comes, or at a click. */
  private zone(i: number): HTMLElement {
    const z = make('div', `zone side${i}`);
    z.addEventListener('pointerenter', () => this.hooks.onHover(i));
    z.addEventListener('click', () => this.hooks.onHover(i));
    return z;
  }

  private side(i: number): HTMLElement {
    const card = make('div', `team-card side${i}`);
    this.cards.push(card);
    return card;
  }

  private fill(i: number): void {
    const c = this.choice;
    const s = c.species[i];
    const card = this.cards[i];
    if (card.dataset.species !== s.id) {
      card.dataset.species = s.id;
      const special = WEAPONS.find((w) => w.sceneTicks > 0 && w.species === s.id);
      const [line, gift, what] = ABOUT[s.id] ?? ['', '', ''];
      const bars: [string, number, number][] = [['Health', s.health / 125, s.health], ['Speed', s.walkSpeed / 7, s.walkSpeed], ['Jump', s.jumpSpeed / 10.5, s.jumpSpeed]];
      card.innerHTML =
        `<div class="chips" role="group" aria-label="${SIDES[i]}: species">${SPECIES.map((q, k) => `<button data-k="${k}" class="${q === s ? 'on' : ''}" title="${PLURAL[q.id]}" aria-label="${PLURAL[q.id]}" aria-pressed="${q === s}"><svg viewBox="0 0 100 60" aria-hidden="true">${BUGS[q.id]}</svg></button>`).join('')}</div>` +
        `<div class="name">${letters(SHORT[s.id], { fill: i ? '#8ccaff' : '#ff8676', drop: 7, outline: 11 })}</div><p>${line}</p>` +
        `<div class="stats">${bars.map(([n, v, k]) => `<div><em>${n}</em><i><u style="--v:${Math.min(1, v).toFixed(2)}"></u></i><strong>${k}</strong></div>`).join('')}</div>` +
        `<div class="trait"><em>Trait</em><span>${gift}</span></div>` +
        (special ? `<div class="special"><span class="emblem" style="color:#${(special?.color ?? 0xffffff).toString(16).padStart(6, '0')}">${special ? art(special.id) : ''}</span><div><em>Special</em><b>${special?.name ?? ''}</b><span>${what}</span></div></div>` : `<div class="special"><div><em>Special</em><span>${what}</span></div></div>`) +
        `<button class="lv"></button>` +
        `<div class="who" role="group" aria-label="${SIDES[i]}: who plays"></div>`;
      for (const b of card.querySelectorAll<HTMLButtonElement>('.chips button')) b.addEventListener('click', () => this.pickSpecies(i, Number(b.dataset.k)));
      card.querySelector('.lv')?.addEventListener('click', () => this.hooks.onSpeciesPage(i));
      // (the bars grow again)
      card.classList.remove('fresh');
      void card.offsetWidth;
      card.classList.add('fresh');
    }
    const lv = card.querySelector('.lv') as HTMLButtonElement;
    const level = this.hooks.level(i);
    lv.innerHTML = c.equal ? '<b>Equal match</b><span>no levels</span>' : c.players[i] === 'human' ? `<b>Level ${level}</b><span>passives ›</span>` : `<b>Level ${level}</b><span>as yours</span>`;
    lv.disabled = c.players[i] !== 'human';
    const who = card.querySelector('.who') as HTMLElement;
    who.replaceChildren(
      ...PLAYERS.map(([id, label]) => {
        const b = make('button', c.players[i] === id ? 'on' : '', label);
        if (id !== 'human') b.title = `computer, ${label.toLowerCase()}`;
        b.setAttribute('aria-pressed', String(c.players[i] === id));
        b.addEventListener('click', () => {
          c.players[i] = id;
          // (two players at one PC: without levels, unless they want them)
          if (!this.equalPicked) c.equal = c.players[0] === 'human' && c.players[1] === 'human';
          this.hooks.onPick(false);
          this.refresh();
        });
        return b;
      }),
    );
  }

  private pickSpecies(i: number, k: number): void {
    const s = SPECIES[(k + SPECIES.length) % SPECIES.length];
    if (s === this.choice.species[i]) return;
    this.choice.species[i] = s;
    this.hooks.onPick(true);
    this.hooks.onSpecies(i);
    this.refresh();
  }

  private pickMap(id: string): void {
    if (id === this.choice.scenario) return;
    this.choice.scenario = id;
    this.hooks.onPick(true);
    this.refresh();
    this.hooks.onMap();
  }

  private start(): void {
    if (this.root.classList.contains('leave')) return;
    this.root.classList.add('leave');
    this.hooks.onPlay();
  }

  private key(e: KeyboardEvent): void {
    if (!this.open || e.target instanceof HTMLInputElement) return;
    const i = SCENARIOS.findIndex((s) => s.id === this.choice.scenario);
    const at = (side: number): number => SPECIES.indexOf(this.choice.species[side]);
    if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) this.start();
    else if (e.code === 'KeyM') this.hooks.onMute();
    else if (e.code === 'ArrowLeft') this.pickMap(SCENARIOS[(i + SCENARIOS.length - 1) % SCENARIOS.length].id);
    else if (e.code === 'ArrowRight') this.pickMap(SCENARIOS[(i + 1) % SCENARIOS.length].id);
    else if (e.code === 'KeyA' || e.code === 'KeyD') this.pickSpecies(0, at(0) + (e.code === 'KeyA' ? -1 : 1));
    else if (e.code === 'KeyJ' || e.code === 'KeyL') this.pickSpecies(1, at(1) + (e.code === 'KeyJ' ? -1 : 1));
    else return;
    e.preventDefault();
  }
}

export interface EndGain {
  side: number;
  species: string;
  xp: number;
  lines: Gain[];
  note: string;
  before: Level;
  after: Level;
}

/** The end of a match: who won, what came of it, and what now. */
export class EndScreen {
  readonly root = make('div');
  private readonly head = make('div', 'head');
  private readonly counts = make('div', 'counts');
  private readonly gains = make('div', 'gains');
  /** The next match is fought on the map as this one left it. */
  keeps = false;

  constructor(onAgain: () => void, onSetup: () => void) {
    this.root.id = 'ending';
    const row = make('div', 'row2');
    const again = make('button', 'play', `<span>${letters('Again', { fill: '#1b1206', ink: 'none', shadow: 'none', outline: 0, drop: 0 })}</span>`);
    again.setAttribute('aria-label', 'Play again');
    const back = make('button', 'ghost', 'Change setup');
    again.addEventListener('click', onAgain);
    back.addEventListener('click', onSetup);
    row.append(again, back);
    const maps = make('div', 'maps');
    const of = [make('button', '', 'Fresh map'), make('button', '', 'Keep the damage')];
    const pick = (keeps: boolean): void => {
      this.keeps = keeps;
      of.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === keeps)));
    };
    of.forEach((b, i) =>
      b.addEventListener('click', () => {
        pick(i === 1);
        b.blur();
      }),
    );
    pick(false);
    maps.append(...of);
    this.root.append(this.head, this.counts, this.gains, maps, row);
    this.root.hidden = true;
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || e.code !== 'Enter' || e.target instanceof HTMLButtonElement) return;
      onAgain();
    });
  }

  /** `numbers`: each with its label. */
  show(title: string, color: string, numbers: [number, string][], gains: EndGain[] = []): void {
    this.gains.innerHTML = gains
      .map((g) => {
        const up = g.after.level > g.before.level;
        const from = up ? 0 : (g.before.next ? g.before.into / g.before.next : 1) * 100;
        const to = (g.after.next ? g.after.into / g.after.next : 1) * 100;
        return `<div class="gain side${g.side}"><h3><svg viewBox="0 0 100 60">${BUGS[g.species]}</svg>+${g.xp} xp</h3>${g.lines.map((l, i) => `<p style="--i:${i}"><span>${l.label}</span><small>${l.detail}</small><b>+${l.xp}</b></p>`).join('')}${g.note ? `<p style="--i:${g.lines.length}"><span>${g.note}</span></p>` : ''}<div class="xpbar"><u style="--from:${from.toFixed(1)}%;--to:${to.toFixed(1)}%"></u></div><small>level ${g.after.level}${g.after.next ? ` · ${g.after.into} / ${g.after.next}` : ''}</small>${up ? `<div class="up">Level ${g.after.level}! ${brings(g.after.level).join(' · ')}</div>` : ''}</div>`;
      })
      .join('');
    this.head.innerHTML = letters(title, { fill: color, each: 'slam1' });
    this.counts.replaceChildren(
      ...numbers.map(([n, label]) => {
        const d = make('div', '', `<b>0</b><span>${label}</span>`);
        const b = d.firstElementChild as HTMLElement;
        const t0 = performance.now() + 500;
        const tick = (now: number): void => {
          const u = Math.min(1, Math.max(0, (now - t0) / 600));
          b.textContent = String(Math.round(n * u));
          if (u < 1 && !this.root.hidden) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return d;
      }),
    );
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
