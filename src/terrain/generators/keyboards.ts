import { COLLIDER } from '../materials';
import type { Terrain } from '../Terrain';
import type { Feature } from './types';

/**
 * Keyboards: where every key is (the render draws the caps from it) and the relief a bug walks on (`keyRelief`).
 */

/** How much of a cap's height (`radius` of a keyboard feature) stands out of the deck. */
export const CAP_OUT = 0.65;

/** [x, z, width, depth] in key units from the back left, and an optional height scale. */
export type KeySpec = [number, number, number, number, number?];
export interface KeyLayout {
  keys: KeySpec[];
  /** Each key's legend (the owner's boards are Portuguese; no brand marks). */
  labels: string[];
  uw: number;
  ud: number;
  grey: number[];
  /** An ISO Enter's back left corner (key units), if the board has one. */
  iso?: [number, number];
}

const F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
const NUMBER_ROW = ['|\n\\', '!\n1', '"\n2', '#\n3', '$\n4', '%\n5', '&\n6', '/\n7', '(\n8', ')\n9', '=\n0', "?\n'", '»\n«'];
const Q_ROW = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '+', '´'];
const A_ROW = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ç', 'º'];
const Z_ROW = ['<', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '-'];

/** A full-size keyboard: the main block (15 units), the navigation cluster, the numpad (23 units wide). */
export function fullLayout(fnGap: boolean): KeyLayout {
  const keys: KeySpec[] = [];
  const labels: string[] = [];
  const add = (label: string, x: number, z: number, w = 1, d = 1, ys = 1): number => {
    labels.push(label);
    return keys.push([x, z, w, d, ys]) - 1;
  };
  const g = fnGap ? 0.5 : 0.2;
  const row = (r: number): number => (r === 0 ? 0 : g + r);
  // the export function row: Esc, three groups of four, the three keys over the navigation cluster
  add('Esc', 0, 0);
  [2, 6.5, 11].forEach((start, grp) => {
    for (let k = 0; k < 4; k++) add(F_KEYS[grp * 4 + k], start + k, 0);
  });
  ['PrtSc', 'ScrLk', 'Pause'].forEach((l, k) => add(l, 15.5 + k, 0));
  if (!fnGap) ['▦', '◐', '≡', '⏻'].forEach((l, k) => add(l, 19 + k, 0));
  // the number row, then the letter rows (an ISO Enter two rows tall)
  NUMBER_ROW.forEach((l, k) => add(l, k, row(1)));
  add('←', 13, row(1), 2);
  add('Tab', 0, row(2), 1.5);
  const grey: number[] = [];
  Q_ROW.forEach((l, k) => {
    const i = add(l, 1.5 + k, row(2));
    if (k === 1) grey.push(i);
  });
  // (an ISO Enter: 1.5 keys wide on its upper row, 1.25 on its lower, one cap; its lower part a hair lower)
  // (its legend on an empty instance: the cap itself is one inverted-L piece, drawn apart)
  add('↵', 13.5, row(2), 1.5, 1, 0);
  add('Caps', 0, row(3), 1.75);
  [...A_ROW, '^\n~'].forEach((l, k) => {
    const i = add(l, 1.75 + k, row(3));
    if (k < 3) grey.push(i);
  });
  add('⇧', 0, row(4), 1.25);
  Z_ROW.forEach((l, k) => add(l, 1.25 + k, row(4)));
  add('⇧', 12.25, row(4), 2.75);
  // the bottom row: modifiers, a long space bar, modifiers
  let x = 0;
  ([['Ctrl', 1.25], ['⊞', 1.25], ['Alt', 1.25], ['', 6.25], ['AltGr', 1.25], ['Fn', 1.25], ['≡', 1.25], ['Ctrl', 1.25]] as const).forEach(([l, kw]) => {
    add(l, x, row(5), kw);
    x += kw;
  });
  // the navigation cluster and the arrows
  ['Ins', 'Home', 'PgUp'].forEach((l, k) => add(l, 15.5 + k, row(1)));
  ['Del', 'End', 'PgDn'].forEach((l, k) => add(l, 15.5 + k, row(2)));
  add('↑', 16.5, row(4));
  ['←', '↓', '→'].forEach((l, k) => add(l, 15.5 + k, row(5)));
  // the numpad: a tall + and a tall Enter, a wide 0
  ['Num', '/', '*', '-'].forEach((l, k) => add(l, 19 + k, row(1)));
  [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']].forEach((ls, r) => ls.forEach((l, k) => add(l, 19 + k, row(r + 2))));
  add('+', 22, row(2), 1, 2);
  add('↵', 22, row(4), 1, 2);
  add('0', 19, row(5), 2);
  add('.', 21, row(5));
  return { keys, labels, uw: 23, ud: row(5) + 1, grey: fnGap ? grey : [], iso: [13.5, row(2)] };
}

/** A laptop's keyboard: a low export function row, five rows, the arrows with half-height up and down (15 units). */
export function laptopLayout(): KeyLayout {
  const keys: KeySpec[] = [];
  const labels: string[] = [];
  const add = (label: string, x: number, z: number, w = 1, d = 1): void => {
    labels.push(label);
    keys.push([x, z, w, d]);
  };
  ['Esc', ...F_KEYS, 'Home', 'End'].forEach((l, k) => add(l, k, 0, 1, 0.6));
  const lineup = (z: number, row: [string, number][]): void => {
    let x = 0;
    for (const [l, kw] of row) {
      add(l, x, z, kw);
      x += kw;
    }
  };
  const ones = (ls: string[]): [string, number][] => ls.map((l) => [l, 1]);
  lineup(0.7, [...ones(NUMBER_ROW), ['←', 2]]);
  lineup(1.7, [['Tab', 1.5], ...ones(Q_ROW), ['↵', 1.5]]);
  lineup(2.7, [['Caps', 1.75], ...ones(A_ROW), ['↵', 2.25]]);
  lineup(3.7, [['⇧', 2.25], ...ones(Z_ROW.slice(1)), ['⇧', 2.75]]);
  lineup(4.7, [['Ctrl', 1], ['Fn', 1], ['⊞', 1], ['Alt', 1], ['', 5], ['AltGr', 1], ['≡', 1], ['Ctrl', 1]]);
  add('←', 12, 4.7);
  add('↑', 13, 4.7, 1, 0.48);
  add('↓', 13, 5.22, 1, 0.48);
  add('→', 14, 4.7);
  return { keys, labels, uw: 15, ud: 5.7, grey: [] };
}

/** How much lower the surface is between two keys than on their tops (fraction of the caps' height, at most). */
const GROOVE = 0.7;
const GROOVE_MAX = 0.45;
/** A key's top rises to its full height this far inside its edge; past the edge it falls to the deck this far out. */
const RISE = 0.9;
const FALL = 0.9;

const smooth = (v: number): number => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

/**
 * The relief of a keyboard's keys on its (already solid) deck, hidden under the drawn caps: each key a low mound,
 * a groove between two keys, the deck where there are no keys (beside the Enter, round the arrows). The grooves
 * are wider than the drawn ones, which are thinner than a cell. Written as a height over the deck, so a bug's
 * height follows it whatever its size.
 */
export function keyRelief(t: Terrain, f: Feature): void {
  const [x0, , z0, x1, deck, z1] = f.box;
  const { keys, uw, ud, iso } = f.look === 'laptop' ? laptopLayout() : fullLayout((f.glow ?? 0) > 0);
  const [c, s] = f.yaw ?? [1, 0];
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hw = (x1 - x0) / 2;
  const hd = (z1 - z0) / 2;
  const ux = (hw * 2) / uw;
  const uz = (hd * 2) / ud;
  const high = f.radius * CAP_OUT;
  const groove = Math.min(GROOVE_MAX, high * GROOVE);
  // (each key's rectangle about the middle; the ISO Enter's lower half is a key of its own)
  const rects: number[] = [];
  const all = iso ? [...keys, [iso[0] + 0.25, iso[1] + 1, 1.25, 1]] : keys;
  for (const [kx, kz, kw, kd] of all) rects.push(kx * ux - hw, kz * uz - hd, (kx + kw) * ux - hw, (kz + kd) * uz - hd);
  const { sx, sy, sz, dens, material } = t;
  const reach = Math.abs(hw * c) + Math.abs(hd * s);
  const reachZ = Math.abs(hw * s) + Math.abs(hd * c);
  const i0 = Math.max(2, Math.floor(cx - reach));
  const i1 = Math.min(sx - 3, Math.ceil(cx + reach));
  const k0 = Math.max(2, Math.floor(cz - reachZ));
  const k1 = Math.min(sz - 3, Math.ceil(cz + reachZ));
  const j0 = Math.max(2, Math.floor(deck) - 1);
  const j1 = Math.min(sy - 3, Math.ceil(deck + high) + 4);
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      const u = (i - cx) * c + (k - cz) * s;
      const v = (k - cz) * c - (i - cx) * s;
      // (how far inside the nearest key; negative: how far from it)
      let inside = -9;
      for (let n = 0; n < rects.length; n += 4) {
        const e = Math.min(u - rects[n], rects[n + 2] - u, v - rects[n + 1], rects[n + 3] - v);
        if (e > inside) inside = e;
      }
      const h = inside >= 0 ? high - groove * (1 - smooth(inside / RISE)) : (high - groove) * (1 - smooth(-inside / FALL));
      if (h <= 0.02) continue;
      for (let j = j0; j <= j1; j++) {
        const id = i + sx * (j + sy * k);
        let d = j - deck - h;
        if (d >= dens[id]) continue;
        if (d < 0.01 && d > -0.01) d = d < 0 ? -0.01 : 0.01;
        dens[id] = d;
        if (d < 1.5) material[id] = COLLIDER;
      }
    }
  }
}
