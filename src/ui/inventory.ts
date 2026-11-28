import { ACTIONS, firstSlots, QUICK_SLOTS, type Action, type Category } from '../game/actions';
import { levelAt, levelOf } from '../game/progress';
import { SKILL_FULL, type Match, type Unit } from '../game/match';
import { WEAPONS, WORKS } from '../game/weapons';
import { ITEM_LOOKS } from '../render/gpu/itemLooks';
import { ARMS, BUGS } from './emblems';
import { art } from './skillCard';

const TABS: readonly (readonly [Category, string, string, string])[] = [
  ['special', 'Special', '#d9b7ff', 'M24 4l6 14 15 1-11.500 10 4 15L24 36 10.500 44l4-15L3 19l15-1z'],
  ['skill', 'Skills', '#ff9a3c', 'M5 38 3 14l11 9L24 7l10 16 11-9-2 24zM6 41h36v4H6z'],
  ['defence', 'Defence', '#5cc8ff', 'M24 3 42 9v14c0 11-8 18-18 22C14 41 6 34 6 23V9z'],
  ['item', 'Items', '#8bd450', 'M16 13v-2a8 8 0 0 1 16 0v2h7l4 31H5l4-31zm4 0h8v-2a4 4 0 0 0-8 0z'],
];
const COLORS: Record<string, string> = Object.fromEntries(TABS.map(([c, , k]) => [c, k]));
const BAG = `<svg viewBox="0 0 48 48"><path fill="currentColor" d="${TABS[3][3]}"/><path fill="var(--b)" d="M15 21h18v4H15z"/></svg>`;
/** A press that moves this far is a drag. */
const DRAG = 7;

const div = (cls: string): HTMLElement => {
  const e = document.createElement('div');
  e.className = cls;
  return e;
};
const byId = (id: string): Action | undefined => ACTIONS.find((a) => a.id === id);
const picture = (a: Action): string =>
  a.item ? `<svg viewBox="0 0 48 48"><path fill="currentColor" fill-rule="evenodd" d="${ITEM_LOOKS[a.item].path}"/></svg>` : a.weapon >= 0 && WEAPONS[a.weapon].sceneTicks > 0 ? art(a.id) : `<svg viewBox="0 0 48 48">${ARMS[a.id] ?? ''}</svg>`;
const colorOf = (a: Action): string => (a.item ? ITEM_LOOKS[a.item].color : COLORS[a.category]);

export interface InventoryUse {
  weapon(index: number): void;
  item(a: Action): void;
  /** Nothing of the slots any more: back to what it had. */
  drop(): void;
  /** The slot of what is in hand, picked again: true if that acts at once (a special in its stance fires), else it is dropped. */
  again?(index: number): boolean;
}

/**
 * The quick slots beside the hand (their keys stay with their places), and the inventory behind them: a tab per kind of
 * action. Drag between them. What is in the slots is kept per creature on this device.
 */
import type { DataCache } from '../data';

export class Inventory {
  readonly dock = div('dock');
  private readonly quick = div('quick');
  private readonly bag = document.createElement('button');
  private readonly panel = div('inv');
  private readonly ghost = div('drag');
  /** The quick slots set for each species: `loadout` records in the client's data. */
  private readonly loadouts: DataCache;
  private slots: string[] = [];
  /** How many there are now. */
  private count = QUICK_SLOTS;
  /** The player's experience with a species (null: no levels in this match). */
  experience: (team: number) => number | null = () => null;
  private species = '';
  /** The special attack its team took (weapon index). */
  private took = -1;
  private tab: Category = 'defence';
  private chosen = '';
  private open = false;
  private last = '';
  private match: Match | null = null;
  private unit: Unit | null = null;
  private press: { id: string; from: number; x: number; y: number; on: boolean } | null = null;

  /** The slots kept for a species (none: empty). */
  private savedOf(species: string): string[] {
    return this.loadouts.get('loadout', species)?.slots ?? [];
  }

  constructor(
    private readonly use: InventoryUse,
    /** The number of the first slot's key, from 0. */
    private readonly firstKey: number,
    data: DataCache,
  ) {
    this.loadouts = data;
    this.bag.className = 'bag';
    this.bag.setAttribute('aria-label', 'Inventory');
    this.dock.append(this.quick, this.bag, this.panel);
    document.body.append(this.ghost);
    this.ghost.id = 'inv-drag';
    this.bag.addEventListener('click', () => {
      this.toggle();
      this.bag.blur();
    });
    this.panel.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!t) return;
      this.tab = t.dataset.tab as Category;
      this.chosen = '';
    });
    this.panel.addEventListener('dblclick', (e) => {
      const a = byId((e.target as HTMLElement).closest<HTMLElement>('.cell')?.dataset.id ?? '');
      if (a) this.act(a);
    });
    this.dock.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!c) return;
      e.preventDefault();
      this.press = { id: c.dataset.id as string, from: c.dataset.slot === undefined ? -1 : Number(c.dataset.slot), x: e.clientX, y: e.clientY, on: false };
    });
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
  }

  toggle(on = !this.open): void {
    this.open = on;
    this.dock.classList.toggle('open', on);
  }

  /** Number key `n` (from 0), if it is a slot's. */
  key(n: number): boolean {
    const i = n - this.firstKey;
    if (i < 0 || i >= this.count) return false;
    this.pick(i);
    return true;
  }

  private pick(i: number): void {
    const a = byId(this.slots[i] ?? '');
    if (a) this.act(a);
  }

  /** Time stands still: one may look, and arrange the slots, but not use anything. */
  locked = false;

  get isOpen(): boolean {
    return this.open;
  }

  private act(a: Action): void {
    if (!this.match || !this.unit || this.locked) return;
    if (a.item) this.use.item(a);
    else if (this.match.weapon === a.weapon) {
      if (!this.use.again?.(a.weapon)) this.use.drop();
    }
    else this.use.weapon(a.weapon);
  }

  // ---------------------------------------------------------------- dragging

  private move(e: PointerEvent): void {
    const p = this.press;
    if (!p) return;
    if (!p.on) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG) return;
      const a = byId(p.id);
      if (!a) return;
      p.on = true;
      this.ghost.innerHTML = picture(a);
      this.ghost.style.setProperty('--g', colorOf(a));
      this.ghost.style.display = 'block';
      this.dock.classList.add('dragging');
    }
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
    const o = this.over(e);
    for (const s of this.quick.children) s.classList.toggle('over', s === o);
  }

  private over(e: PointerEvent): HTMLElement | null {
    return (document.elementFromPoint(e.clientX, e.clientY)?.closest('.quick [data-slot]') as HTMLElement | null) ?? null;
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    if (!p) return;
    this.press = null;
    this.ghost.style.display = 'none';
    this.dock.classList.remove('dragging');
    for (const s of this.quick.children) s.classList.remove('over');
    if (!p.on) {
      if (p.from >= 0) this.pick(p.from);
      else this.chosen = p.id;
      return;
    }
    const o = this.over(e);
    if (o) {
      const i = Number(o.dataset.slot);
      const was = p.from >= 0 ? p.from : this.slots.indexOf(p.id);
      if (was >= 0) this.slots[was] = this.slots[i];
      this.slots[i] = p.id;
    } else if (p.from >= 0) this.slots[p.from] = '';
    // (slots a higher level opened keep what they had, in a match without levels)
    this.loadouts.put('loadout', this.species, { slots: [...this.slots, ...this.savedOf(this.species).slice(this.slots.length)] });
  }

  // ---------------------------------------------------------------- what it shows

  /** How many uses are left; null: as many as one likes. */
  private left(a: Action): number | null {
    const m = this.match as Match;
    const u = this.unit as Unit;
    if (a.item) return m.bag[u.team][a.item] ?? 0;
    return m.stock[u.team][a.weapon] > 0 || WEAPONS[a.weapon].found ? m.usesLeft(u.team, a.weapon) : null;
  }

  private has(a: Action): boolean {
    const m = this.match as Match;
    const u = this.unit as Unit;
    if (a.category === 'defence') return a.species === u.bug.species.id;
    return a.item ? (this.left(a) ?? 0) > 0 : m.has(u, a.weapon);
  }

  update(match: Match, u: Unit, away: boolean): void {
    this.match = match;
    this.unit = u;
    this.dock.classList.toggle('away', away);
    if (away && this.open) this.toggle(false);
    const id = u.bug.species.id;
    const level = match.teams[u.team].growth?.level ?? 1;
    const count = levelAt(level).slots;
    const took = match.special(u.team);
    if (id !== this.species || count !== this.count || took !== this.took) {
      this.species = id;
      this.took = took;
      this.count = count;
      const was = this.loadouts.get('loadout', id)?.slots;
      const special = WEAPONS[match.special(u.team)]?.id;
      const first = firstSlots(id, special);
      // (a special attack in the slots is the one its team took)
      const isSpecial = (s: string): boolean => {
        const a = byId(s);
        return a !== undefined && a.weapon >= 0 && WEAPONS[a.weapon].sceneTicks > 0;
      };
      const theirs = (s: string): string => (special && isSpecial(s) ? special : s);
      this.slots = Array.from({ length: count }, (_, i) => theirs(Array.isArray(was) ? (typeof was[i] === 'string' ? was[i] : '') : (first[i] ?? '')));
      this.chosen = '';
    }
    const load = Math.floor((match.skill[u.team] / SKILL_FULL) * 50) / 50;
    const key = `${id}|${u.team}|${match.weapon}|${match.stock[u.team].join()}|${match.works[u.team]}|${JSON.stringify(match.bag[u.team])}|${load}|${this.slots.join()}|${this.tab}|${this.chosen}|${this.open}|${match.built}|${match.usedItem}`;
    if (key === this.last) return;
    this.last = key;
    this.quick.innerHTML = this.slots.map((s, i) => this.slot(s, i, load)).join('');
    this.bag.innerHTML = `<em>I</em>${BAG}<u>${this.kept()}/${match.spaces(u.team)}</u>`;
    if (this.open) this.drawPanel();
  }

  private slot(s: string, i: number, load: number): string {
    const m = this.match as Match;
    const a = byId(s);
    const key = (this.firstKey + i + 1) % 10;
    if (!a) return `<button class="q empty" data-slot="${i}"><i></i><b>${key}</b></button>`;
    const n = this.left(a);
    const has = this.has(a);
    const off = !has || n === 0 || (a.item !== null && m.usedItem) || (m.built && a.weapon >= 0 && (WEAPONS[a.weapon].kind === 'wall' || WEAPONS[a.weapon].kind === 'bridge'));
    const skill = a.weapon >= 0 && WEAPONS[a.weapon].sceneTicks > 0;
    return `<button class="q ${a.weapon === m.weapon && a.weapon >= 0 ? 'on' : ''} ${off ? 'off' : ''} ${skill && load >= 1 ? 'ready' : ''}" data-slot="${i}" data-id="${a.id}" style="--g:${colorOf(a)};--load:${skill ? load : 1}" title="${a.name}"><i></i>${picture(a)}${skill && load < 1 ? '<s></s>' : ''}<b>${key}</b>${n !== null ? `<u>${n}</u>` : ''}</button>`;
  }

  private kept(): number {
    return ACTIONS.filter((a) => a.category === 'item' && (this.left(a) ?? 0) > 0).length;
  }

  private levelLine(team: number): string {
    const xp = this.experience(team);
    const l = levelOf(xp ?? 0);
    return xp === null ? '' : ` <small>level ${l.level}</small><i class="xpbar"><u style="width:${l.next ? (l.into / l.next) * 100 : 100}%"></u></i>`;
  }

  private drawPanel(): void {
    const m = this.match as Match;
    const u = this.unit as Unit;
    const tabOf = (c: Category): Action[] => ACTIONS.filter((a) => a.category === c && this.has(a));
    const list = tabOf(this.tab);
    const about = list.find((a) => a.id === this.chosen);
    const note = { special: 'only this creature has them', skill: 'they load, then play their scene', defence: `${m.works[u.team]} of ${WORKS} uses left in this match`, item: `${this.kept()} of ${m.spaces(u.team)} spaces · one a turn`, common: '' }[this.tab];
    const cells = list.map((a) => {
      const k = this.slots.indexOf(a.id);
      const n = this.left(a);
      return `<button class="cell ${a.id === this.chosen ? 'on' : ''}" data-id="${a.id}" style="--g:${colorOf(a)}">${picture(a)}${k >= 0 ? `<b>${(this.firstKey + k + 1) % 10}</b>` : ''}${n !== null ? `<u>×${n}</u>` : ''}<span>${a.name}</span></button>`;
    });
    const spaces = this.tab === 'item' ? Math.max(0, m.spaces(u.team) - list.length) : 0;
    this.panel.innerHTML =
      `<div class="inv-head"><svg viewBox="0 0 100 60">${BUGS[u.bug.species.id]}</svg><b>${u.bug.species.id}${this.levelLine(u.team)}</b><small>${note}</small></div>` +
      `<div class="inv-tabs">${TABS.map(([c, n, k, d]) => `<button data-tab="${c}" class="${c === this.tab ? 'on' : ''}" style="--t:${k}"><svg viewBox="0 0 48 48"><path fill="currentColor" d="${d}"/></svg>${n}<sup>${tabOf(c).length}</sup></button>`).join('')}</div>` +
      `<div class="inv-grid">${cells.join('')}${'<div class="cell none"></div>'.repeat(spaces)}${cells.length + spaces === 0 ? `<p>${this.tab === 'special' ? 'nothing yet' : 'empty'}</p>` : ''}</div>` +
      (about
        ? `<div class="inv-about" style="--g:${colorOf(about)}">${picture(about)}<div><b>${about.name}</b><p>${about.text}</p>${about.tags.map((t) => `<span>${t}</span>`).join('')}</div></div>`
        : '<div class="inv-about"><p>Drag anything to a slot. Click it to read what it does, twice to use it.</p></div>');
  }
}
