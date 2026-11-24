/**
 * The game's own lettering: heavy, cut like circuit traces, every letter a few thick strokes on an 80 by 100 grid
 * (drawn as SVG, so it needs no font). Each stroke is points joined by straight lines.
 */
const GLYPHS: Record<string, [width: number, ...strokes: string[]]> = {
  A: [80, '13 100 13 30 30 13 50 13 67 30 67 100', '13 62 67 62'],
  B: [78, '13 50 52 50 65 62 65 76 53 87 13 87 13 13 50 13 62 24 62 38 52 50'],
  C: [76, '70 13 30 13 13 30 13 70 30 87 70 87'],
  D: [80, '13 13 48 13 67 32 67 68 48 87 13 87 13 0'],
  E: [70, '66 13 13 13 13 87 66 87', '13 50 56 50'],
  F: [68, '66 13 13 13 13 100', '13 52 56 52'],
  G: [80, '72 13 30 13 13 30 13 70 30 87 67 87 67 52 42 52'],
  H: [80, '13 0 13 100', '67 0 67 100', '13 50 67 50'],
  I: [26, '13 0 13 100'],
  J: [66, '53 0 53 72 38 87 6 87'],
  K: [78, '13 0 13 100', '74 2 38 50 74 98', '13 50 40 50'],
  L: [66, '13 0 13 87 64 87'],
  M: [98, '13 100 13 13 25 13 49 58 73 13 85 13 85 100'],
  N: [82, '13 100 13 13 22 13 60 87 69 87 69 0'],
  O: [80, '30 13 50 13 67 30 67 70 50 87 30 87 13 70 13 30 30 13 50 13'],
  P: [76, '13 100 13 13 48 13 63 28 63 44 48 59 13 59'],
  Q: [80, '30 13 50 13 67 30 67 70 50 87 30 87 13 70 13 30 30 13 50 13', '46 64 76 100'],
  R: [78, '13 100 13 13 48 13 63 28 63 42 50 56 13 56', '40 56 66 100'],
  S: [76, '70 13 26 13 13 26 13 38 25 50 51 50 63 62 63 74 50 87 6 87'],
  T: [76, '2 13 74 13', '38 13 38 100'],
  U: [80, '13 0 13 70 30 87 50 87 67 70 67 0'],
  V: [80, '10 0 34 87 46 87 70 0'],
  W: [108, '10 0 26 87 34 87 54 34 74 87 82 87 98 0'],
  X: [80, '10 0 70 100', '70 0 10 100'],
  Y: [78, '10 0 39 52 68 0', '39 52 39 100'],
  Z: [74, '4 13 66 13 10 87 72 87'],
  '!': [26, '13 0 13 62', '13 78 13 100'],
  ' ': [34],
};
const GAP = 9;
const THICK = 26;

const path = (s: string, dx: number): string => {
  const n = s.split(' ').map(Number);
  let d = '';
  for (let i = 0; i < n.length; i += 2) d += `${i ? 'L' : 'M'}${n[i] + dx} ${n[i + 1]}`;
  return d;
};

/** A colour towards white (or, below 0, black). */
function lighter(hex: string, by = 0.32): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(by > 0 ? v + (255 - v) * by : v * (1 + by)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export interface Lettering {
  fill?: string;
  ink?: string;
  /** The hard shadow's colour, and how far it falls. */
  shadow?: string;
  drop?: number;
  /** Letters come in one by one (a CSS class on each). */
  each?: string;
  /** Extra marks for a letter, by its place: drawn over it, in its own grid. */
  extra?: Record<number, string>;
  /** Width of the ink round the letters. */
  outline?: number;
}

/** Gradients made so far (each SVG's own has its own name). */
let made = 0;

/** `text` as one SVG: hard shadow, ink, fill; slanted. It scales to the height its box gives it. */
export function letters(text: string, o: Lettering = {}): string {
  const { fill = '#f6efdf', ink = '#130f0c', shadow = '#000', drop = 9, outline = 13, each = '', extra = {} } = o;
  let x = 0;
  let body = '';
  // (the top of each letter catches the light)
  const id = `lit${made++}`;
  const lit = fill.length === 7 && fill !== '#1b1206' ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0.4" stop-color="${lighter(fill)}"/><stop offset="0.4" stop-color="${fill}"/><stop offset="0.86" stop-color="${fill}"/><stop offset="0.86" stop-color="${lighter(fill, -0.18)}"/></linearGradient>` : '';
  const paint = lit ? `url(#${id})` : fill;
  [...text.toUpperCase()].forEach((c, i) => {
    const g = GLYPHS[c] ?? GLYPHS[' '];
    const strokes = g.slice(1).map((s) => path(s as string, 0)).join('');
    const line = (color: string, w: number, at = ''): string => `<path d="${strokes}" stroke="${color}" stroke-width="${w}"${at}/>`;
    if (strokes)
      body +=
        `<g transform="translate(${x} 0)"><g class="${each}" style="--i:${i}">` +
        line(shadow, THICK + outline * 2, ` transform="translate(${drop} ${drop})"`) + line(ink, THICK + outline * 2) + line(paint, THICK) + (extra[i] ?? '') + '</g></g>';
    x += g[0] + GAP;
  });
  const w = x - GAP;
  // (slanted: the top leans right)
  return `<svg class="letters" viewBox="${-outline - 8} ${-outline - 4} ${w + outline * 2 + 34 + drop} ${100 + outline * 2 + 8 + drop}" role="img" aria-label="${text}"><g transform="matrix(1 0 -0.14 1 14 0)" fill="none" stroke-linejoin="miter" stroke-miterlimit="3">${lit}${body}</g></svg>`;
}
