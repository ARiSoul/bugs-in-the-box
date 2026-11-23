/**
 * The car dashboard's shape and where its parts are: pure data and arithmetic, shared by the generator (density,
 * collision) and the render (the drawn skin and parts). Everything is in base units: a 320 × 128 × 160 map, 2 units
 * a centimetre, x across the car (0 its left side, the driver's), y up, z from the windscreen's foot to the seats.
 * `carScale` places the base units on a map of another size.
 */
export const BASE_W = 320;
export const BASE_H = 128;
export const BASE_D = 160;

/** The scale and offsets that place the base units on a W × H × D map. */
export function carScale(W: number, H: number, D: number): { s: number; ox: number; oz: number } {
  const s = Math.min(W / BASE_W, H / BASE_H, D / BASE_D);
  return { s, ox: (W - BASE_W * s) / 2, oz: (D - BASE_D * s) / 2 };
}

/** The dashboard's ends. */
export const DASH_X0 = 23;
export const DASH_X1 = 297;
/** The instrument cluster's middle; half the width of its opening. */
export const CLUSTER_X = 88;
export const CLUSTER_HALF = 38;
/** A frame that leans back by (c, s): its top towards the windscreen. */
export interface Leaning {
  x: number;
  y: number;
  z: number;
  c: number;
  s: number;
}
/** The hood's opening, an oval tunnel along z from its face to the plate: its middle's height, its half height. */
export const OPENING = { x: CLUSTER_X, y: 70.6, a: 35.5, b: 13.4, back: 71.6 };
/** The dials on the instrument plate: their middles and radii (u, w on the plate). */
export const DIAL_WELLS: readonly { u: number; w: number; r: number }[] = [
  { u: -17.4, w: -0.8, r: 9.9 },
  { u: 17.4, w: -0.8, r: 9.9 },
  { u: -4.9, w: 7.6, r: 3.5 },
  { u: 4.9, w: 7.6, r: 3.5 },
];
/** Where (x, y) is against the opening's outline: 1 on it, less inside (an oval between an ellipse and a box). */
export function openingNorm(x: number, y: number): number {
  const u = (x - OPENING.x) / OPENING.a;
  const v = (y - OPENING.y) / OPENING.b;
  const u2 = u * u;
  const v2 = v * v;
  return 0.5 * (Math.sqrt(u2 + v2) + Math.sqrt(Math.sqrt(u2 * u2 + v2 * v2)));
}
/** The instrument plate: its middle, its lean, half sizes. */
export const PLATE: Leaning & { hw: number; hh: number } = { x: CLUSTER_X, y: 70.8, z: 73, c: 0.9925, s: 0.1219, hw: 36.4, hh: 14 };
/** The centre stack's frame: the middle of its top edge. Lengths run down its face. */
export const STACK: Leaning & { len: number; topHalf: number; bottomHalf: number; out: number } = {
  x: 160, y: 51, z: 95.6, c: 0.9545, s: 0.2983, len: 49, topHalf: 26, bottomHalf: 21.5, out: 1,
};
/** Steering wheel: the hub, its lean, the rim's radius and tube. */
export const WHEEL: Leaning & { R: number; r: number } = { x: 88, y: 54, z: 124, c: 0.8988, s: 0.4384, R: 36, r: 3.3 };
/** Round air vents: x, y, the plane the dashboard's skin swells out to round them (they face the seats), the bezel's radius. */
export const VENTS: readonly { x: number; y: number; z: number; R: number; silver: boolean }[] = [
  { x: 39.5, y: 60.5, z: 98.6, R: 10.2, silver: true },
  { x: 144, y: 66, z: 96, R: 10.4, silver: false },
  { x: 176, y: 66, z: 96, R: 10.4, silver: false },
  { x: 280.5, y: 60.5, z: 98.6, R: 10.2, silver: true },
];
/** How deep behind the skin's plane a vent's slats are (a bug can stand in it), and its back. */
export const VENT_DEPTH = 2.6;
export const VENT_BACK = 5;
/** How far round a vent's bezel the skin swells. */
const SWELL = 9;
/** The phone in its holder on the left centre vent: middle, half sizes. */
export const PHONE = { x: 144, y: 69.5, z: 104.6, hw: 7.6, hh: 15.6, hd: 0.9 };
export const HOLDER = { x: 144, y: 61, z: 100.4, hw: 8, hh: 5, hd: 2.4 };
/** The windscreen: its slope (cos, sin from the horizontal), its length up from its foot, its foot's height. */
export const GLASS = { c: 0.62, s: 0.7846, len: 62, y: 79 };
/** The windscreen's foot in z at x: bowed forward in the middle. */
export function glassFoot(x: number): number {
  const u = (x - 160) / 137;
  return 9 + 20 * u * u;
}

/** Control points of a section: from the windscreen's foot over the top, down the face to the underside. */
export const SECTION_POINTS = 14;

const smooth = (v: number): number => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

/** z, y of each control point of the three kinds of section (the first two's z is from the windscreen's foot). */
const PAD = [0, 78.5, 22, 82, 60, 82, 78, 78.5, 88, 72.5, 93, 67, 95.5, 62.5, 97, 58, 97.8, 54.4, 95.4, 52.4, 96.6, 43, 100, 36, 100, 22, 88, 13];
const CENTRE = [0, 79, 24, 84, 60, 84.5, 77, 82, 86, 76.5, 89.6, 71.5, 91, 66, 92, 60.5, 93, 55, 94.6, 51, 97.7, 41, 102, 27, 107, 11, 108, 3.5];
const HOOD = [0, 79, 22, 85, 54, 90.4, 72, 93, 85.6, 91.4, 89.4, 86.6, 89, 77, 89, 65, 90, 56.6, 93, 52, 94, 43, 92, 34, 88, 22, 74, 13];

/** The section at x: its control points (z, y), SECTION_POINTS of them, into `out`. */
export function sectionControl(x: number, out: Float64Array): void {
  const foot = glassFoot(x);
  const wc = smooth((x - 125) / 10) * (1 - smooth((x - 186) / 11));
  // (the top eases from one kind to the other over a longer way: a smooth line along the windscreen)
  const wt = smooth((x - 104) / 56) * (1 - smooth((x - 176) / 50));
  const q = (x - CLUSTER_X) / CLUSTER_HALF;
  const aq = Math.abs(q);
  // (the hood's bulge over the top; its face, round the opening; the lower panels)
  const hq = (x - CLUSTER_X) / 60;
  const bulge = hq * hq < 1 ? (1 - hq * hq) * (1 - hq * hq) : 0;
  const face = 1 - smooth((aq - 0.8) / 0.6);
  const low = 1 - smooth((aq - 0.9) / 0.5);
  // (the ends round down to the doors' tops)
  const end = Math.max(0, 1 - (x - DASH_X0) / 20, 1 - (DASH_X1 - x) / 20);
  const drop = end * end * 13;
  for (let i = 0; i < SECTION_POINTS; i++) {
    const k = i <= 2 ? wt : i === 3 ? (wt + wc) / 2 : wc;
    let z = PAD[2 * i] + (CENTRE[2 * i] - PAD[2 * i]) * k;
    let y = PAD[2 * i + 1] + (CENTRE[2 * i + 1] - PAD[2 * i + 1]) * k;
    const w = i <= 3 ? bulge : i <= 5 ? bulge * 0.6 + face * 0.4 : i <= 8 ? face : low;
    z += (HOOD[2 * i] - z) * w;
    y += (HOOD[2 * i + 1] - y) * w;
    if (i <= 1) z += foot;
    if (i <= 4) y -= drop * (i === 4 ? 0.6 : 1);
    out[2 * i] = z;
    out[2 * i + 1] = y;
  }
}

/** Points a section is drawn with, between two control points. */
export const SECTION_SUB = 10;
export const SECTION_LEN = (SECTION_POINTS - 1) * SECTION_SUB + 1;
/** The spline's tension: a little tighter than Catmull-Rom, so it does not swing past the corners. */
const TENSION = 0.4;

const ctrl = new Float64Array(SECTION_POINTS * 2);

/** The section at x as a smooth polyline (z, y) of SECTION_LEN points, into `out`. */
export function section(x: number, out: Float64Array): void {
  sectionControl(x, ctrl);
  const last = SECTION_POINTS - 1;
  for (let i = 0; i < last; i++) {
    for (let a = 0; a < 2; a++) {
      const p0 = ctrl[2 * Math.max(0, i - 1) + a];
      const p1 = ctrl[2 * i + a];
      const p2 = ctrl[2 * (i + 1) + a];
      const p3 = ctrl[2 * Math.min(last, i + 2) + a];
      const m1 = (p2 - p0) * TENSION;
      const m2 = (p3 - p1) * TENSION;
      for (let k = 0; k < SECTION_SUB; k++) {
        const t = k / SECTION_SUB;
        const t2 = t * t;
        const t3 = t2 * t;
        out[2 * (i * SECTION_SUB + k) + a] = (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (3 * t2 - 2 * t3) * p2 + (t3 - t2) * m2;
      }
    }
  }
  out[2 * last * SECTION_SUB] = ctrl[2 * last];
  out[2 * last * SECTION_SUB + 1] = ctrl[2 * last + 1];
  // the soft swelling round each vent: the face eases out to the vent's plane, flat where the bezel lies on it
  for (const v of VENTS) {
    const dx = x - v.x;
    const reach = v.R + SWELL;
    if (dx > reach || dx < -reach) continue;
    for (let p = 3 * SECTION_SUB; p < SECTION_LEN; p++) {
      const z = out[2 * p];
      const dy = out[2 * p + 1] - v.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= reach) continue;
      // (and back to nothing at the dashboard's ends, against the doors)
      const w = smooth((reach - r) / (SWELL - 1.4)) * smooth((z - 74) / 12) * smooth((x - DASH_X0) / 8) * smooth((DASH_X1 - x) / 8);
      if (z < v.z) out[2 * p] = z + (v.z - z) * w;
    }
  }
}

const topBuf = new Float64Array(SECTION_LEN * 2);

/** The height of the dashboard's top at (x, z): the first crossing from the windscreen. */
export function dashTop(x: number, z: number): number {
  section(x, topBuf);
  for (let i = 0; i + 1 < SECTION_LEN; i++) {
    const z0 = topBuf[2 * i];
    const z1 = topBuf[2 * i + 2];
    if (z >= z0 && z <= z1 && z1 > z0) return topBuf[2 * i + 1] + ((topBuf[2 * i + 3] - topBuf[2 * i + 1]) * (z - z0)) / (z1 - z0);
  }
  return topBuf[1];
}

/** How far towards the seats the dashboard's face reaches at (x, y). */
export function dashFace(x: number, y: number): number {
  section(x, topBuf);
  let best = -1;
  for (let i = 0; i + 1 < SECTION_LEN; i++) {
    const y0 = topBuf[2 * i + 1];
    const y1 = topBuf[2 * i + 3];
    if (y0 > y === y1 > y) continue;
    const z = topBuf[2 * i] + ((topBuf[2 * i + 2] - topBuf[2 * i]) * (y - y0)) / (y1 - y0);
    if (z > best) best = z;
  }
  return best;
}

/** The open glove box: the cave behind its opening, the lid hanging from its foot (its hinge, its lean, its length). */
export const GLOVE = { x0: 211, x1: 268, y0: 24, y1: 41, z0: 62, z1: 101, hingeY: 22.6, hingeZ: 99.4, c: 0.9744, s: 0.225, len: 20, thick: 2.4 };
/** A point on the glove box's lid: u from its middle, n over its upper face, d out from its hinge. */
export function onLid(u: number, n: number, d: number): [number, number, number] {
  return [(GLOVE.x0 + GLOVE.x1) / 2 + u, GLOVE.hingeY + n * GLOVE.c - d * GLOVE.s, GLOVE.hingeZ + n * GLOVE.s + d * GLOVE.c];
}

/** What lies in the glove box: boxes [x, y, z middle, w, h, d, turn] on its floor, a torch. */
export const GLOVE_THINGS = {
  folder: { x: 232, z: 84, w: 32, h: 2.6, d: 24 },
  papers: { x: 232, z: 85.4, w: 30, h: 1.5, d: 22 },
  map: { x: 256, z: 86, w: 14, h: 2.4, d: 22 },
  tissues: { x: 256, z: 70, w: 15, h: 6, d: 10 },
  torch: { x0: 216, x1: 236, z: 68, r: 2.3 },
};

/** One control on the centre stack: u from its middle, v down from its top, sizes, how far it stands out. */
export interface StackItem {
  kind: 'button' | 'round' | 'knob' | 'radioButton' | 'plate';
  id: string;
  u: number;
  v: number;
  w: number;
  h: number;
  out: number;
}

/** The centre stack's controls, from the photos: the row under the vents, the radio, the climate panel. */
export const STACK_ITEMS: readonly StackItem[] = [
  { kind: 'round', id: 'hazard', u: -18.6, v: 6.9, w: 7, h: 7, out: 2.6 },
  { kind: 'button', id: 'defrost', u: -9.4, v: 6.9, w: 9.4, h: 5.8, out: 1.1 },
  { kind: 'button', id: 'blank', u: 0.3, v: 6.9, w: 9.4, h: 5.8, out: 1.1 },
  { kind: 'button', id: 'cup', u: 14.3, v: 6.9, w: 18, h: 5.8, out: 1.1 },
  { kind: 'plate', id: 'radio', u: 0, v: 23.6, w: 40, h: 22, out: 1.4 },
  { kind: 'knob', id: 'volume', u: -16.9, v: 20.4, w: 4.6, h: 4.6, out: 3.8 },
  { kind: 'knob', id: 'tune', u: 17, v: 17.2, w: 4.6, h: 4.6, out: 3.8 },
  { kind: 'radioButton', id: 'MEN', u: -17.4, v: 25.2, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'FM', u: -17.2, v: 27.5, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'DIS', u: -17, v: 29.8, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'DIM', u: -16.8, v: 32.1, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'NAV', u: 17.4, v: 22, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'PLAY', u: 17.2, v: 24.3, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'EQ', u: 17, v: 26.6, w: 4, h: 1.9, out: 1.9 },
  { kind: 'radioButton', id: 'MOD', u: 16.8, v: 28.9, w: 4, h: 1.9, out: 1.9 },
  { kind: 'plate', id: 'climate', u: 0, v: 41.6, w: 39, h: 12.4, out: 1.2 },
  { kind: 'knob', id: 'fan', u: -14, v: 40.2, w: 5.6, h: 5.6, out: 4 },
  { kind: 'knob', id: 'temp', u: 14, v: 40.2, w: 5.6, h: 5.6, out: 4 },
];

/** The light switch's plate, under the left vent. */
export const SWITCH: Leaning = { x: 44, y: 39.6, z: 98.8, c: 0.93, s: 0.367 };

/** The defroster's grille along the windscreen: its ends, and at x its middle (z) and half depth. */
export const GRILLE = { x0: 60, x1: 260 };
export function grilleHalf(x: number): number {
  const e = Math.min(1, Math.max(0, Math.min(x - GRILLE.x0, GRILLE.x1 - x) / 36));
  // (0.72 of a power of e, near enough, without Math.pow)
  return 6.6 * Math.max(0.06, 0.56 * Math.sqrt(e) + 0.44 * e);
}
export function grilleMid(x: number): number {
  return glassFoot(x) + 13.8 - 2 * (1 - smooth(Math.min(x - GRILLE.x0, GRILLE.x1 - x) / 60));
}

/** The pillar's lines up the windscreen's side: along the glass (A) and its other edge (B), t 0 at its foot. */
export function pillarA(t: number): [number, number, number] {
  const q = Math.max(0, 1 - t / 0.08);
  return [26 + 24 * t, 77 + 143 * t - 10 * q * q, 28 + 113 * t];
}
export function pillarB(t: number): [number, number, number] {
  const [x, y, z] = pillarA(t);
  const q = Math.max(0, 1 - t / 0.13);
  const f = q * q;
  return [x - 4 - 1.5 * f, y - 4 - 9 * f, z + 17 + 20 * f];
}

/** A point of a leaning frame: u right, w up along its face, n out of it. */
export function leaning(f: Leaning, u: number, w: number, n: number): [number, number, number] {
  return [f.x + u, f.y + w * f.c + n * f.s, f.z - w * f.s + n * f.c];
}
