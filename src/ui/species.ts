import { BRANCHES, brings, LEVELS, levelAt, passive, passivesOf, XP } from '../game/progress';
import { BUGS } from './emblems';
import { letters } from './lettering';
import type { Profile } from './profile';

const NAMES: Record<string, string> = { ant: 'Ant', spider: 'Spider', cockroach: 'Roach', bee: 'Bee' };
const COLORS: Record<string, string> = { ant: '#ff6a4a', spider: '#d9b7ff', cockroach: '#e0863c', bee: '#ffc83a' };
const BRANCH: Record<string, string> = { Attack: '#ff9a3c', Defence: '#5cc8ff', Body: '#8bd450' };
/** About what a match is worth, to say how many are missing. */
const USUAL = XP.played + 55;

/** A creature's page: its level and what each brings, its passives, those in use. */
export class SpeciesPage {
  readonly root = document.createElement('div');
  private species = 'ant';

  constructor(
    private readonly profile: Profile,
    private readonly onPick: (strong: boolean) => void,
    private readonly onClose: () => void,
  ) {
    this.root.className = 'species-page';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-p], [data-s], [data-close]');
      if (!t && e.target !== this.root) return;
      if (!t || t.dataset.close !== undefined) return this.close();
      if (t.dataset.s) this.species = t.dataset.s;
      else if (!this.profile.touch(this.species, t.dataset.p as string)) return;
      this.onPick(!!t.dataset.p);
      this.draw();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  open(species: string): void {
    this.species = species;
    this.root.hidden = false;
    this.draw();
  }

  close(): void {
    this.root.hidden = true;
    this.onClose();
  }

  private draw(): void {
    const s = this.species;
    const g = this.profile.of(s);
    const l = this.profile.level(s);
    const left = l.points - g.known.length;
    this.root.style.setProperty('--s', COLORS[s]);
    const inUse = [0, 1, 2].map((i) => {
      const id = g.active[i];
      if (i >= l.actives) return `<div class="lock">level ${[2, 5, 8][i]}</div>`;
      const p = id ? passive(id) : undefined;
      return p ? `<button data-p="${p.id}" style="--c:${BRANCH[p.branch]}">${p.name}</button>` : '<div>empty</div>';
    });
    const track = Array.from({ length: LEVELS }, (_, i) => `<div class="${i < l.level ? 'got' : ''} ${i + 1 === l.level ? 'now' : ''}"><b>${i + 1}</b>${brings(i + 1).join('<br>')}</div>`);
    const tree = BRANCHES.map((b) => {
      const list = passivesOf(s).filter((p) => p.branch === b);
      return `<div class="branch" style="--c:${BRANCH[b]}"><h3>${b}</h3>${list
        .map((p) => {
          const known = g.known.includes(p.id);
          const on = g.active.includes(p.id);
          return `<button data-p="${p.id}" class="${on ? 'on' : known ? 'known' : left > 0 ? '' : 'no'}"><i>${on ? 'in use' : known ? 'known' : left > 0 ? '1 point' : ''}</i><b>${p.name}</b><span>${p.text}</span>${p.tags.map((t) => `<em>${t}</em>`).join('')}</button>`;
        })
        .join('')}</div>`;
    });
    this.root.innerHTML = `<div class="sheet"><nav>${Object.keys(NAMES).map((k) => `<button data-s="${k}" class="${k === s ? 'on' : ''}" style="--s:${COLORS[k]}"><svg viewBox="0 0 100 60">${BUGS[k]}</svg>${this.profile.level(k).level}</button>`).join('')}<button class="shut" data-close aria-label="close">✕</button></nav>
      <section class="who-is"><svg viewBox="0 0 100 60">${BUGS[s]}</svg><div class="big">${letters(NAMES[s], { fill: COLORS[s], drop: 6, outline: 10 })}</div><strong>level ${l.level}</strong>
      <div class="xpbar"><u style="width:${l.next ? (l.into / l.next) * 100 : 100}%"></u></div><small><span>${l.next ? `${l.into} / ${l.next} xp` : 'every level'}</span><span>${l.next ? `about ${Math.max(1, Math.ceil((l.next - l.into) / USUAL))} more` : ''}</span></small>
      <h4>In use</h4><div class="in-use">${inUse.join('')}</div><p>${l.slots} quick slots · ${l.spaces} spaces for items. Click a passive you know to put it in use, or to take it out.</p></section>
      <section><h4>Levels <small>what comes by itself</small></h4><div class="track">${track.join('')}</div><h4>Passives <small><b>${left}</b> ${left === 1 ? 'point' : 'points'} to spend${levelAt(LEVELS).points === g.known.length ? ', all known' : ''}</small></h4><div class="tree">${tree.join('')}</div></section></div>`;
  }
}
