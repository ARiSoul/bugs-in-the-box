import * as THREE from 'three/webgpu';
import { DASH_X0, DASH_X1, PLATE, SECTION_POINTS } from '../../terrain/generators/carPlan';

/**
 * The car dashboard's pictures, drawn on canvases at load: the skin's colours and seams, the instruments, the radio,
 * the climate panel, the phone's map, the garage beyond the windscreen. Generic signs and words only, no brands.
 */
type Ctx = CanvasRenderingContext2D;

const FONT = '"Segoe UI", Arial, sans-serif';

/** A small seeded generator (render only): the same picture every time. */
export function rnd(seed: number): () => number {
  let v = seed;
  return () => {
    v = (v * 16807) % 2147483647;
    return v / 2147483647;
  };
}

export function canvasTexture(w: number, h: number, draw: (g: Ctx, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d') as Ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The seam between the grained pad and the smooth panel (which control point, 0..13, at x), outside it null. */
export const SEAM: readonly [number, number][] = [
  [56.4, 5.6], [60.4, 4.1], [70, 2.9], [86, 2.4], [110, 2.5], [140, 2.85], [166, 3.25], [184, 3.8], [195, 4.7], [201, 6.1], [204.2, 7.7],
  [205, 9],
];

/** The dashboard's skin: albedo, and (second canvas) roughness in green, the grain's amount in red. */
export function skinTextures(): { color: THREE.CanvasTexture; finish: THREE.CanvasTexture } {
  const W = 4096;
  const H = 2048;
  const px = (x: number): number => ((x - DASH_X0) / (DASH_X1 - DASH_X0)) * W;
  // (the uv's v runs up: a canvas's y down; flipY turns it, so control point 0 is at the canvas's bottom)
  const py = (t: number): number => H - (t / (SECTION_POINTS - 1)) * H;
  const seam = new THREE.CatmullRomCurve3(SEAM.map(([x, t]) => new THREE.Vector3(x, t, 0)), false, 'centripetal').getPoints(200);
  const region = (g: Ctx): void => {
    g.beginPath();
    seam.forEach((p, i) => (i ? g.lineTo(px(p.x), py(p.y)) : g.moveTo(px(p.x), py(p.y))));
    g.lineTo(px(205), py(13.1));
    g.lineTo(px(55.4), py(13.1));
    g.lineTo(px(55.4), py(7.4));
    g.closePath();
  };
  const rect = (g: Ctx, x0: number, t0: number, x1: number, t1: number): void => g.fillRect(px(x0), py(t1), px(x1) - px(x0), py(t0) - py(t1));
  /** The trim strip, narrowing up under the end vent. */
  const band = (g: Ctx): void => {
    g.beginPath();
    g.moveTo(px(205), py(9.02));
    g.lineTo(px(DASH_X1), py(9.02));
    g.lineTo(px(DASH_X1), py(9.76));
    g.lineTo(px(284), py(9.82));
    g.lineTo(px(268), py(9.82));
    g.lineTo(px(246), py(9.74));
    g.lineTo(px(222), py(9.6));
    g.lineTo(px(205), py(9.55));
    g.fill();
  };
  /** Smooth value noise on a torn scale, for the worn paint's outline. */
  const r0 = rnd(77);
  const lattice = Array.from({ length: 64 * 64 }, () => r0());
  const value = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const q = (a: number, b: number): number => lattice[(((a % 64) + 64) % 64) + 64 * (((b % 64) + 64) % 64)];
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (q(ix, iy) * (1 - u) + q(ix + 1, iy) * u) * (1 - v) + (q(ix, iy + 1) * (1 - u) + q(ix + 1, iy + 1) * u) * v;
  };
  const torn = (x: number, y: number): number => value(x * 0.9, y * 0.9) * 0.5 + value(x * 2.3, y * 2.3) * 0.3 + value(x * 6, y * 6) * 0.2;
  /** How worn the soft paint is at (x, t): the patch between the centre vents, down the left one's right side, the rim's arc. */
  const worn = (x: number, t: number): number => {
    const e = (cx: number, ct: number, rx: number, rt: number): number => 1 - Math.hypot((x - cx) / rx, (t - ct) / rt);
    return Math.max(e(158.2, 7.2, 4.2, 1.1), e(157, 8.2, 6.5, 0.75), e(156.4, 6.2, 1.8, 1.3), e(131, 6.2, 1.5, 1.2), e(133.4, 5.2, 2.2, 0.6));
  };
  /** Paint the worn patches: where the noise eats into them. */
  const wear = (g: Ctx, scale: number, inside: [number, number, number], rim: [number, number, number]): void => {
    const X0 = Math.floor(px(127) * scale);
    const X1 = Math.ceil(px(167) * scale);
    const Y0 = Math.floor(py(9.2) * scale);
    const Y1 = Math.ceil(py(4.2) * scale);
    const img = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0);
    for (let j = 0; j < img.height; j++)
      for (let i = 0; i < img.width; i++) {
        const x = DASH_X0 + ((i + X0) / scale / W) * (DASH_X1 - DASH_X0);
        const t = ((H - (j + Y0) / scale) / H) * (SECTION_POINTS - 1);
        const w = worn(x, t) - (torn(x * 1.1, t * 8) - 0.42) * 1.7;
        if (w < 0.02) continue;
        const c = w < 0.06 ? rim : inside;
        const o = (j * img.width + i) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
      }
    g.putImageData(img, X0, Y0);
  };
  const color = canvasTexture(W, H, (g) => {
    g.fillStyle = '#252526';
    g.fillRect(0, 0, W, H);
    // the passenger's and the driver's lower panels, the satin trim strip along them
    g.fillStyle = '#38393b';
    rect(g, 205, 9, DASH_X1, 13);
    g.fillStyle = '#434548';
    band(g);
    g.fillStyle = '#434548';
    rect(g, DASH_X0, 9.02, 56, 10.02);
    g.fillStyle = '#262627';
    rect(g, DASH_X0, 10.02, 56, 13);
    g.fillStyle = '#2d2d2e';
    region(g);
    g.fill();
    g.fillStyle = '#414346';
    rect(g, 45, 9.06, 132, 10.02);
    g.fillStyle = '#262627';
    rect(g, 45, 10.02, 132, 13);
    g.fillStyle = '#2e2e30';
    rect(g, 132, 9.06, 205, 13);
    wear(g, 1, [26, 26, 27], [62, 61, 59]);
    // light dust: fine specks on the top
    const r = rnd(7);
    for (let k = 0; k < 380; k++) {
      const x = r() * W;
      const t = 0.2 + r() * 4.2;
      const a = 0.08 + r() * r() * 0.35;
      g.fillStyle = `rgba(206,200,188,${a})`;
      const size = 0.6 + r() * r() * 1.5;
      g.beginPath();
      // (a unit across the canvas and a unit down it are not the same length on the skin)
      g.ellipse(x, py(t), size, size * 0.62, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  const finish = canvasTexture(
    2048,
    1024,
    (g) => {
      // red: the grain's amount; green: roughness
      const f = (grain: number, rough: number): string => `rgb(${Math.round(grain * 255)},${Math.round(rough * 255)},0)`;
      g.save();
      g.scale(0.5, 0.5);
      g.fillStyle = f(1, 0.84);
      g.fillRect(0, 0, W, H);
      g.fillStyle = f(0.25, 0.6);
      rect(g, 205, 9, DASH_X1, 13);
      rect(g, DASH_X0, 9, 45, 13);
      g.fillStyle = f(0.3, 0.76);
      region(g);
      g.fill();
      g.fillStyle = f(0.06, 0.48);
      band(g);
      rect(g, DASH_X0, 9.02, 132, 10.02);
      g.restore();
      wear(g, 0.5, [0, 135, 0], [30, 190, 0]);
    },
    false,
  );
  return { color, finish };
}

/** Where the needles and lamps are on the instrument plate (its own units, middle 0, w up). */
export const DIALS = {
  tacho: { u: -17.4, w: -0.8, r: 9.9 },
  speed: { u: 17.4, w: -0.8, r: 9.9 },
  water: { u: -4.9, w: 7.6, r: 3.5 },
  fuel: { u: 4.9, w: 7.6, r: 3.5 },
  arrows: [[-10.6, 9.4], [10.6, 9.4]],
};
/** A needle's turn from straight up (radians, clockwise) for a share 0..1 of a big dial's scale. */
export const dialAngle = (f: number): number => (-135 + 270 * f) * (Math.PI / 180);

/** The instrument plate: what reflects (`color`) and what is lit with the ignition on (`light`). */
export function clusterTextures(): { color: THREE.CanvasTexture; light: THREE.CanvasTexture } {
  const K = 32;
  const W = Math.round(PLATE.hw * 2 * K);
  const H = Math.round(PLATE.hh * 2 * K);
  const X = (u: number): number => (u + PLATE.hw) * K;
  const Yp = (w: number): number => (PLATE.hh - w) * K;
  const disc = (g: Ctx, u: number, w: number, r: number, fill: string | CanvasGradient): void => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(X(u), Yp(w), r * K, 0, Math.PI * 2);
    g.fill();
  };
  const tick = (g: Ctx, u: number, w: number, a: number, r0: number, r1: number, lw: number, style: string): void => {
    g.strokeStyle = style;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(X(u + Math.sin(a) * r0), Yp(w + Math.cos(a) * r0));
    g.lineTo(X(u + Math.sin(a) * r1), Yp(w + Math.cos(a) * r1));
    g.stroke();
  };
  const word = (g: Ctx, s: string, u: number, w: number, size: number, style: string, weight = 600): void => {
    g.fillStyle = style;
    g.font = `${weight} ${size * K}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, X(u), Yp(w));
  };
  const ink = (g: Ctx, lit: boolean): void => {
    const white = lit ? '#ffe9dc' : '#d6dbe0';
    const red = lit ? '#ff2a18' : '#c8332a';
    const { tacho, speed, water, fuel } = DIALS;
    for (let k = 0; k <= 60; k++) {
      const a = dialAngle(k / 60);
      const major = k % 10 === 0;
      const hot = k >= 45;
      if (k % 2 === 0 || major) tick(g, tacho.u, tacho.w, a, tacho.r * (major ? 0.8 : 0.87), tacho.r * 0.94, major ? (hot ? 12 : 9) : 4, hot ? red : white);
      if (major) word(g, String(k), tacho.u + Math.sin(a) * tacho.r * 0.62, tacho.w + Math.cos(a) * tacho.r * 0.62, 1.7, white);
    }
    word(g, 'rpm x100', tacho.u, tacho.w + 3.6, 0.8, white, 500);
    for (let k = 0; k <= 44; k++) {
      const v = k * 5;
      const a = dialAngle(v / 220);
      const major = v % 20 === 0;
      tick(g, speed.u, speed.w, a, speed.r * (major ? 0.82 : 0.87), speed.r * 0.94, major ? 9 : 5, v === 30 || v === 50 || v === 130 ? red : white);
      if (major) word(g, String(v), speed.u + Math.sin(a) * speed.r * 0.655, speed.w + Math.cos(a) * speed.r * 0.655, 1.4, white);
    }
    word(g, 'km/h', speed.u, speed.w + 3.4, 0.85, white, 500);
    // the two small dials: an upper arc each
    const small = (d: { u: number; w: number; r: number }, labels: [string, number][], redFrom: number): void => {
      for (let k = 0; k <= 8; k++) {
        const f = k / 8;
        const a = (-62 + 124 * f) * (Math.PI / 180);
        tick(g, d.u, d.w, a, d.r * 0.68, d.r * 0.88, k % 2 ? 3.5 : 6, f >= redFrom ? red : white);
      }
      for (const [s, f] of labels) {
        const a = (-62 + 124 * f) * (Math.PI / 180);
        word(g, s, d.u + Math.sin(a) * d.r * 0.5, d.w + Math.cos(a) * d.r * 0.5 - 0.1, 0.8, white, 700);
      }
    };
    small(water, [['50', 0], ['90', 0.5], ['130', 1]], 0.87);
    small(fuel, [['1/1', 0.04], ['1/2', 0.5], ['0', 1]], 0.87);
    // (a thermometer, a pump)
    g.fillStyle = white;
    g.fillRect(X(water.u) - 3, Yp(water.w - 1.2), 6, 24);
    g.fillRect(X(water.u) + 3, Yp(water.w - 1.2) + 4, 9, 4);
    g.fillRect(X(water.u) + 3, Yp(water.w - 1.2) + 13, 9, 4);
    g.beginPath();
    g.arc(X(water.u), Yp(water.w - 1.2) + 29, 8, 0, Math.PI * 2);
    g.fill();
    // (the pump: its body with a window, its hose)
    const fx = X(fuel.u) - 14;
    const fy = Yp(fuel.w - 1.1);
    g.fillRect(fx, fy, 18, 34);
    g.fillRect(fx - 3, fy + 32, 24, 4);
    g.save();
    g.globalCompositeOperation = lit ? 'source-over' : 'source-over';
    g.fillStyle = lit ? '#000000' : '#0f1113';
    g.fillRect(fx + 4, fy + 4, 10, 10);
    g.restore();
    g.lineWidth = 4;
    g.strokeStyle = white;
    g.beginPath();
    g.moveTo(fx + 18, fy + 16);
    g.lineTo(fx + 26, fy + 16);
    g.lineTo(fx + 26, fy + 28);
    g.moveTo(fx + 26, fy + 16);
    g.lineTo(fx + 22, fy + 4);
    g.stroke();
  };
  const lcd = (g: Ctx, u: number, w: number, lw: number, lh: number, lines: string[], size: number, lit: boolean): void => {
    g.fillStyle = lit ? '#b8d34a' : '#7c8468';
    g.fillRect(X(u - lw / 2), Yp(w + lh / 2), lw * K, lh * K);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((s, i) => {
      g.fillStyle = '#1a2010';
      g.font = `700 ${size * K}px "Consolas", "Courier New", monospace`;
      g.fillText(s, X(u), Yp(w + lh / 2 - ((i + 0.5) * lh) / lines.length) + 2);
    });
  };
  const centre = (g: Ctx, lit: boolean): void => {
    // the middle screen: a door-open picture, two lines of trip data
    g.fillStyle = lit ? '#120302' : '#1b1b1c';
    g.fillRect(X(-5.3), Yp(3), 10.6 * K, 11.6 * K);
    if (!lit) return;
    word(g, '5.8', 0, 0.6, 2.5, '#ff5a3c', 600);
    word(g, 'l/100 km', 0, -1.5, 0.95, '#ff5a3c', 500);
    g.strokeStyle = '#ff5a3c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(-4.4), Yp(-2.7));
    g.lineTo(X(4.4), Yp(-2.7));
    g.stroke();
    word(g, '21.5 °C', 0, -4.3, 1.5, '#ff5a3c', 600);
    word(g, '480 km', 0, -6.9, 1.5, '#ff5a3c', 600);
  };
  const color = canvasTexture(W, H, (g) => {
    const plate = g.createLinearGradient(0, 0, 0, H);
    plate.addColorStop(0, '#5d6268');
    plate.addColorStop(0.5, '#73787f');
    plate.addColorStop(1, '#5a5e65');
    g.fillStyle = plate;
    g.fillRect(0, 0, W, H);
    // (fine speckle of the metallic paint)
    const r = rnd(5);
    for (let k = 0; k < 9000; k++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      g.fillRect(r() * W, r() * H, 2, 2);
    }
    for (const d of [DIALS.tacho, DIALS.speed]) {
      disc(g, d.u, d.w, d.r + 0.55, '#17181a');
      const face = g.createRadialGradient(X(d.u), Yp(d.w), d.r * K * 0.2, X(d.u), Yp(d.w), d.r * K);
      face.addColorStop(0, '#262a2f');
      face.addColorStop(0.5, '#2d3238');
      face.addColorStop(0.53, '#12161a');
      face.addColorStop(1, '#0d0f11');
      disc(g, d.u, d.w, d.r, face);
    }
    for (const d of [DIALS.water, DIALS.fuel]) {
      disc(g, d.u, d.w, d.r + 0.4, '#17181a');
      disc(g, d.u, d.w, d.r, '#0f1113');
    }
    ink(g, false);
    lcd(g, DIALS.tacho.u, DIALS.tacho.w - 6.4, 5, 2.2, ['12:47'], 1.7, false);
    lcd(g, DIALS.speed.u, DIALS.speed.w - 6.4, 6, 3, ['186420', '73.5'], 1.35, false);
    centre(g, false);
    // the lamps' places: the two arrows, the triangle between the small dials
    g.fillStyle = '#26382a';
    for (const [u, w] of DIALS.arrows) arrow(g, X(u), Yp(w), Math.sign(u) * K * 1.5);
  });
  const light = canvasTexture(W, H, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, H);
    ink(g, true);
    lcd(g, DIALS.tacho.u, DIALS.tacho.w - 6.4, 5, 2.2, ['12:47'], 1.7, true);
    lcd(g, DIALS.speed.u, DIALS.speed.w - 6.4, 6, 3, ['186420', '73.5'], 1.35, true);
    centre(g, true);
  });
  return { color, light };
}

/** A block arrow pointing left (size < 0) or right. */
export function arrow(g: Ctx, x: number, y: number, size: number): void {
  g.beginPath();
  g.moveTo(x + size, y);
  g.lineTo(x, y - Math.abs(size));
  g.lineTo(x, y - Math.abs(size) * 0.4);
  g.lineTo(x - size * 0.8, y - Math.abs(size) * 0.4);
  g.lineTo(x - size * 0.8, y + Math.abs(size) * 0.4);
  g.lineTo(x, y + Math.abs(size) * 0.4);
  g.lineTo(x, y + Math.abs(size));
  g.closePath();
  g.fill();
}

/** The cracks across the radio's glass, from the photo (picture units 0..1). */
const CRACKS: readonly (readonly [number, number, number])[][] = [
  [[0, 0.14, 1.5], [0.12, 0.22, 2], [0.28, 0.32, 2.5], [0.42, 0.45, 3.5], [0.52, 0.55, 5], [0.6, 0.595, 6], [0.72, 0.592, 6], [0.86, 0.575, 5], [1, 0.58, 3]],
  [[1, 0.6, 2], [0.94, 0.645, 3], [0.87, 0.72, 4], [0.81, 0.79, 4], [0.76, 0.87, 2]],
];

/** The radio's screen, lit: a tuner page, and the cracks over it. */
export function radioScreen(): THREE.CanvasTexture {
  return canvasTexture(1200, 660, (g, W, H) => {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1730');
    bg.addColorStop(1, '#03060f');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 0, W, 64);
    g.textBaseline = 'middle';
    g.fillStyle = '#dce8ff';
    g.font = `600 36px ${FONT}`;
    g.textAlign = 'left';
    g.fillText('RADIO', 34, 34);
    g.textAlign = 'right';
    g.fillText('12:47', W - 34, 34);
    g.textAlign = 'center';
    g.font = `300 190px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText('101.3', W / 2 + 130, 190);
    g.font = `500 42px ${FONT}`;
    g.fillStyle = '#7fb2ff';
    g.fillText('FM 1   STEREO', 290, 330);
    // the tuner's scale, its pointer
    g.strokeStyle = '#5f7fb5';
    for (let k = 0; k <= 82; k++) {
      g.lineWidth = k % 10 === 0 ? 4 : 2;
      g.beginPath();
      g.moveTo(80 + (k * (W - 160)) / 82, 386);
      g.lineTo(80 + (k * (W - 160)) / 82, 386 + (k % 10 === 0 ? 46 : 26));
      g.stroke();
    }
    g.fillStyle = '#ff5136';
    g.fillRect(80 + 0.66 * (W - 160) - 3, 376, 6, 66);
    // the presets
    for (let k = 0; k < 6; k++) {
      const x = 40 + k * 188;
      g.fillStyle = k === 2 ? '#2d62c4' : '#17233f';
      g.beginPath();
      g.roundRect(x, 476, 172, 78, 14);
      g.fill();
      g.fillStyle = '#dce8ff';
      g.font = `600 38px ${FONT}`;
      g.fillText(['88.2', '94.6', '101.3', '103.0', '105.4', '107.7'][k], x + 86, 517);
    }
    g.fillStyle = '#8fa7d4';
    g.font = `500 32px ${FONT}`;
    ['LIST', 'BAND', 'EQ', 'SETUP'].forEach((s, k) => g.fillText(s, 180 + k * 280, 612));
    // the cracks: smooth, thicker where the glass lifts: a dark gap between a bright and a bluish edge
    for (const pts of CRACKS) {
      const c = new THREE.CatmullRomCurve3(pts.map(([x, y, w]) => new THREE.Vector3(x * W, y * H, w)), false, 'centripetal').getPoints(220);
      for (const [off, width, style] of [[0, 2.2, 'rgba(2,4,8,0.9)'], [-0.9, 0.7, 'rgba(240,246,255,0.95)'], [1, 0.55, 'rgba(150,185,255,0.6)']] as const) {
        g.strokeStyle = style;
        g.lineCap = 'round';
        for (let k = 1; k < c.length; k++) {
          g.lineWidth = c[k].z * width;
          g.beginPath();
          g.moveTo(c[k - 1].x, c[k - 1].y + off * c[k - 1].z);
          g.lineTo(c[k].x, c[k].y + off * c[k].z);
          g.stroke();
        }
      }
    }
  });
}

/** The radio's front (39 × 21 units), without its screen: words, arrows, small slots and holes. */
export function radioFront(): THREE.CanvasTexture {
  return canvasTexture(1560, 840, (g, W, H) => {
    const K = 40;
    g.fillStyle = '#19191b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d0d0ce';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const word = (s: string, u: number, v: number, size: number): void => {
      g.font = `600 ${size * K}px ${FONT}`;
      g.fillText(s, (u + 19.5) * K, v * K);
    };
    word('MIC', -16, 3.7, 0.8);
    word('RES', 16.2, 1.4, 0.66);
    word('TUNE', 16.8, 7.5, 0.56);
    word('ON', -16.9, 10.5, 0.56);

    word('SD', -0.6, 20.3, 0.52);
    word('GPS', 4.2, 20.3, 0.52);
    word('IR', 16.6, 17.6, 0.56);
    // holes and slots, with a faint lit lower edge
    for (const [u, v] of [[-17.6, 3.7], [18, 1.4], [16.6, 18.4]]) {
      g.fillStyle = '#020202';
      g.beginPath();
      g.arc((u + 19.5) * K, v * K, 9, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(120,120,122,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc((u + 19.5) * K, v * K, 10, 0.2, Math.PI - 0.2);
      g.stroke();
    }
    const slot = (u: number, v: number, w: number): void => {
      g.fillStyle = '#020202';
      g.beginPath();
      g.roundRect((u + 19.5) * K, v * K, w * K, 9, 4);
      g.fill();
      g.fillStyle = 'rgba(130,130,132,0.6)';
      g.fillRect((u + 19.5) * K + 4, v * K + 10, w * K - 8, 2);
    };
    slot(-18.6, 1.3, 2.4);
    slot(15.4, 0.4, 2.4);
    slot(-1.6, 20.7, 2.2);
    slot(3, 20.7, 2.6);
    const r = rnd(3);
    for (let k = 0; k < 160; k++) {
      g.fillStyle = `rgba(190,180,160,${r() * 0.25})`;
      g.fillRect((1 + r() * 37) * K, (0.1 + (r() < 0.6 ? r() * 0.5 : 20.4 + r() * 0.5)) * K, 2, 2);
    }
  });
}

/** Brushed metal turned on a lathe: concentric rings, a bow-tie of light. */
export function brushedTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    const cone = g.createConicGradient(0.5, 128, 128);
    for (let k = 0; k <= 8; k++) cone.addColorStop(k / 8, k % 2 ? '#8b8e92' : '#4c4e52');
    g.fillStyle = cone;
    g.fillRect(0, 0, 256, 256);
    for (let r = 4; r < 182; r += 2.2) {
      g.strokeStyle = r % 4.4 < 2.2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.2)';
      g.lineWidth = 1.1;
      g.beginPath();
      g.arc(128, 128, r, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

/** The climate panel (38 × 12 units): its display lit, words and marks. */
export function climateFront(): { color: THREE.CanvasTexture; light: THREE.CanvasTexture } {
  const K = 44;
  const draw = (g: Ctx, lit: boolean): void => {
    g.fillStyle = lit ? '#000000' : '#161618';
    g.fillRect(0, 0, 38 * K, 12 * K);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const word = (s: string, u: number, v: number, size: number, style: string): void => {
      g.fillStyle = style;
      g.font = `600 ${size * K}px ${FONT}`;
      g.fillText(s, (u + 19) * K, v * K);
    };
    if (!lit) {
      g.fillStyle = '#4a4d48';
      g.fillRect(9.9 * K, 1 * K, 18.2 * K, 4.2 * K);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = '#101011';
        g.beginPath();
        g.roundRect((7.4 + k * 3.4) * K, 8.2 * K, 2.9 * K, 1.8 * K, 8);
        g.fill();
      }
    } else {
      g.fillStyle = '#3a0c05';
      g.fillRect(9.9 * K, 1 * K, 18.2 * K, 4.2 * K);
    }
    const on = lit ? '#ff5a3c' : '#22231f';
    word('21.0°', 0, 3.1, 2.6, on);
    word('AUTO', -7, 2.1, 1, on);
    word('▮▮▮▯▯', -6.8, 4, 0.9, on);
    word('A/C', 7, 2.1, 1, on);
    word('◂ ▸', 7, 4, 1, on);
    const mark = lit ? '#ff6a4a' : '#8d8d8b';
    ['AUTO', '❄', '▲', '▶', '▼', '⟳', 'OFF'].forEach((s, k) => word(s, -10.2 + k * 3.4, 9.1, s.length > 1 ? 0.72 : 1.05, mark));
    // round the knobs: an arc that widens, a fan over the left one, an E over the right
    for (const u of [-14, 14]) {
      for (let k = 0; k < 40; k++) {
        const a0 = ((-130 + k * 6.5) * Math.PI) / 180;
        g.strokeStyle = lit ? (u > 0 ? (k < 20 ? '#2f6bff' : '#ff3a20') : '#ff6a4a') : '#8d8d8b';
        g.lineWidth = 3 + (u > 0 ? Math.abs(k - 20) * 0.35 : k * 0.28);
        g.beginPath();
        g.arc((u + 19) * K, 4.6 * K, 3.75 * K, a0 - Math.PI / 2, a0 - Math.PI / 2 + 0.12);
        g.stroke();
      }
    }
  };
  return { color: canvasTexture(38 * K, 12 * K, (g) => draw(g, false)), light: canvasTexture(38 * K, 12 * K, (g) => draw(g, true)) };
}

/** A map on the phone: streets, a park, a river, the route and the arrow on it (no names). */
export function phoneMap(): THREE.CanvasTexture {
  return canvasTexture(720, 1500, (g, W, H) => {
    g.fillStyle = '#e9e6df';
    g.fillRect(0, 0, W, H);
    const r = rnd(19);
    // blocks of buildings between the streets
    g.save();
    g.translate(W / 2, H * 0.62);
    g.rotate(-0.22);
    g.fillStyle = '#dcd8cf';
    for (let y = -1200; y < 1200; y += 150) for (let x = -900; x < 900; x += 190) if (r() > 0.18) g.fillRect(x + 16, y + 16, 150 - r() * 40, 112 - r() * 30);
    g.fillStyle = '#c4e3b4';
    g.fillRect(-520, -520, 330, 280);
    g.fillStyle = '#a9d3f0';
    g.beginPath();
    g.moveTo(230, -1300);
    g.bezierCurveTo(330, -600, 260, 0, 430, 1300);
    g.lineTo(560, 1300);
    g.bezierCurveTo(380, 0, 450, -600, 350, -1300);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 22;
    for (let y = -1200; y < 1200; y += 150) {
      g.beginPath();
      g.moveTo(-900, y);
      g.lineTo(900, y);
      g.stroke();
    }
    for (let x = -900; x < 900; x += 190) {
      g.beginPath();
      g.moveTo(x, -1200);
      g.lineTo(x, 1200);
      g.stroke();
    }
    g.strokeStyle = '#f5cf72';
    g.lineWidth = 44;
    g.beginPath();
    g.moveTo(-900, -600);
    g.lineTo(900, -600);
    g.stroke();
    // the route
    g.lineJoin = 'round';
    for (const [lw, style] of [[46, '#1b56b8'], [32, '#3f86f5']] as const) {
      g.strokeStyle = style;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(50, 420);
      g.lineTo(50, -150);
      g.lineTo(-140, -150);
      g.lineTo(-140, -600);
      g.lineTo(500, -600);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(50, 250, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2f74ea';
    g.beginPath();
    g.moveTo(50, 196);
    g.lineTo(92, 296);
    g.lineTo(50, 272);
    g.lineTo(8, 296);
    g.fill();
    g.restore();
    // the instruction over it, the trip under it
    g.fillStyle = '#0f7a4f';
    g.beginPath();
    g.roundRect(24, 76, W - 48, 230, 36);
    g.fill();
    g.fillStyle = '#ffffff';
    arrow(g, 130, 190, -70);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `600 96px ${FONT}`;
    g.fillText('250 m', 250, 196);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(0, H - 250, W, 280, 44);
    g.fill();
    g.fillStyle = '#1f7a43';
    g.font = `600 84px ${FONT}`;
    g.fillText('12 min', 54, H - 160);
    g.fillStyle = '#6a6f78';
    g.font = `500 50px ${FONT}`;
    g.fillText('7.4 km · 12:59', 54, H - 76);
    g.fillStyle = '#d64a3c';
    g.beginPath();
    g.arc(W - 110, H - 126, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `600 70px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('✕', W - 110, H - 122);
    g.fillStyle = '#20242a';
    g.font = `600 36px ${FONT}`;
    g.textAlign = 'left';
    g.fillText('12:47', 44, 40);
  });
}

/** A label: a word or a sign, white on clear. */
export function labelTexture(text: string, aspect: number, size = 0.62): THREE.CanvasTexture {
  const h = 128;
  return canvasTexture(Math.round(h * aspect), h, (g, w) => {
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${h * size}px ${FONT}`;
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

export type Sign =
  | 'hazard' | 'defrost' | 'cup' | 'PLAY' | 'eject' | 'lamp' | 'beam' | 'horn' | 'up2' | 'down2' | 'mute' | 'cycle' | 'next' | 'prev' | 'volup' | 'voldown';

/** A drawn sign on clear, white (256 × 256). */
export function signTexture(sign: Sign): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = (pts: number[], close = false): void => {
      g.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        if (k) g.lineTo(pts[k], pts[k + 1]);
        else g.moveTo(pts[k], pts[k + 1]);
      }
      if (close) g.closePath();
    };
    const tri = (r: number): void => {
      const p: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
        p.push(128 + Math.cos(a) * r, 142 + Math.sin(a) * r);
      }
      path(p, true);
      g.stroke();
    };
    /** A loudspeaker's wedge. */
    const wedge = (x: number): void => {
      path([x, 100, x + 34, 100, x + 84, 60, x + 84, 196, x + 34, 156, x, 156], true);
      g.fill();
    };
    if (sign === 'hazard') {
      g.lineWidth = 11;
      tri(104);
      tri(58);
    } else if (sign === 'defrost') {
      g.lineWidth = 9;
      g.beginPath();
      g.roundRect(34, 56, 188, 116, 22);
      g.stroke();
      for (const x of [82, 128, 174]) {
        g.beginPath();
        g.moveTo(x, 214);
        g.bezierCurveTo(x - 26, 180, x + 26, 150, x, 112);
        g.stroke();
        path([x - 14, 122, x, 98, x + 14, 122]);
        g.stroke();
      }
    } else if (sign === 'cup') {
      g.lineWidth = 9;
      path([76, 90, 92, 226, 164, 226, 180, 90], true);
      g.stroke();
      path([86, 150, 170, 150]);
      g.stroke();
      path([126, 150, 142, 46, 172, 30]);
      g.stroke();
    } else if (sign === 'PLAY') {
      path([60, 70, 140, 128, 60, 186], true);
      g.fill();
      g.fillRect(156, 70, 18, 116);
      g.fillRect(190, 70, 18, 116);
    } else if (sign === 'eject') {
      path([40, 150, 128, 50, 216, 150], true);
      g.fill();
      g.fillRect(40, 172, 176, 30);
    } else if (sign === 'lamp') {
      g.lineWidth = 16;
      g.beginPath();
      g.arc(128, 128, 46, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        path([128 + Math.cos(a) * 74, 128 + Math.sin(a) * 74, 128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108]);
        g.stroke();
      }
    } else if (sign === 'beam') {
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(130, 56);
      g.bezierCurveTo(230, 56, 230, 200, 130, 200);
      g.closePath();
      g.stroke();
      for (const y of [72, 108, 146, 184]) {
        path([100, y, 24, y + 18]);
        g.stroke();
      }
    } else if (sign === 'horn') {
      g.lineWidth = 12;
      path([34, 108, 130, 108, 214, 62, 214, 194, 130, 148, 34, 148], true);
      g.stroke();
    } else if (sign === 'up2' || sign === 'down2') {
      g.save();
      if (sign === 'down2') {
        g.translate(0, 256);
        g.scale(1, -1);
      }
      path([58, 122, 128, 34, 198, 122], true);
      g.fill();
      path([58, 218, 128, 130, 198, 218], true);
      g.fill();
      g.restore();
    } else if (sign === 'mute') {
      wedge(62);
      g.lineWidth = 18;
      path([40, 56, 216, 206]);
      g.stroke();
      path([216, 56, 40, 206]);
      g.stroke();
    } else if (sign === 'cycle') {
      g.lineWidth = 20;
      for (const a of [0.3, 0.3 + Math.PI]) {
        g.beginPath();
        g.arc(128, 128, 74, a, a + 2.3);
        g.stroke();
        const e = a + 2.45;
        const x = 128 + Math.cos(e) * 74;
        const y = 128 + Math.sin(e) * 74;
        path([x + Math.cos(e) * 40, y + Math.sin(e) * 40, x - Math.cos(e) * 40, y - Math.sin(e) * 40, x + Math.cos(e + 1.57) * 46, y + Math.sin(e + 1.57) * 46], true);
        g.fill();
      }
    } else if (sign === 'next' || sign === 'prev') {
      path(sign === 'next' ? [60, 60, 196, 128, 60, 196] : [196, 60, 60, 128, 196, 196], true);
      g.fill();
    } else {
      wedge(116);
      g.lineWidth = 18;
      path([30, 70, 90, 70]);
      g.stroke();
      if (sign === 'volup') {
        path([60, 40, 60, 100]);
        g.stroke();
      }
    }
  });
}

/** The signs on a stalk's leaf (680 × 184): the left one's lights, the right one's wipers. */
export function stalkTexture(left: boolean): THREE.CanvasTexture {
  return canvasTexture(680, 184, (g) => {
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const word = (s: string, x: number, y: number, size: number): void => {
      g.font = `600 ${size}px ${FONT}`;
      g.fillText(s, x, y);
    };
    const path = (pts: number[], close = false): void => {
      g.beginPath();
      for (let k = 0; k < pts.length; k += 2) {
        if (k) g.lineTo(pts[k], pts[k + 1]);
        else g.moveTo(pts[k], pts[k + 1]);
      }
      if (close) g.closePath();
      g.stroke();
    };
    if (left) {
      word('S+', 60, 60, 34);
      word('ON', 250, 44, 34);
      word('OFF', 380, 44, 34);
      for (const d of [-1, 1]) path([150 + d * 54, 120, 150 + d * 30, 98, 150 + d * 30, 112, 150 + d * 6, 112, 150 + d * 6, 128, 150 + d * 30, 128, 150 + d * 30, 142], true);
      word('P', 262, 122, 46);
      for (const a of [-0.5, 0, 0.5]) path([288, 122 + a * 20, 314, 122 + a * 52]);
      for (const x of [400, 500]) {
        g.beginPath();
        g.moveTo(x + 30, 94);
        g.bezierCurveTo(x + 66, 94, x + 66, 150, x + 30, 150);
        g.closePath();
        g.stroke();
        for (const y of [100, 122, 144]) path([x + 18, y, x - 16, y + (x === 400 ? 8 : 0)]);
      }
    } else {
      word('RESET', 170, 96, 44);
      // (the windscreen's wiper, the rear one's)
      path([470, 70, 590, 70]);
      g.beginPath();
      g.moveTo(462, 74);
      g.quadraticCurveTo(530, 8, 598, 74);
      g.lineTo(570, 92);
      g.quadraticCurveTo(530, 66, 490, 92);
      g.closePath();
      g.stroke();
      path([530, 90, 560, 36]);
      g.beginPath();
      g.roundRect(486, 118, 88, 54, 8);
      g.stroke();
      path([530, 172, 556, 132]);
      g.beginPath();
      g.arc(530, 176, 36, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    }
  });
}

/** Papers for the glove box: a ruled form, a page of lines, a stamped one, a receipt, a folded road map (no names). */
export function paperTexture(look: 'form' | 'lines' | 'stamp' | 'receipt' | 'map'): THREE.CanvasTexture {
  const tall = look === 'receipt';
  return canvasTexture(tall ? 512 : 700, tall ? 284 : 500, (g, W, H) => {
    const r = rnd(look.length * 17 + 3);
    if (look === 'map') {
      g.fillStyle = '#e7e2cf';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#c5d9ae';
      for (let k = 0; k < 9; k++) {
        g.beginPath();
        g.ellipse(r() * W, r() * H, 30 + r() * 90, 20 + r() * 60, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#a9cbe3';
      g.fillRect(0, H * 0.78, W, H * 0.22);
      for (const [n, lw, c] of [[14, 3, '#b9b29b'], [7, 6, '#e2a33c'], [3, 9, '#c8473a']] as const) {
        g.strokeStyle = c;
        g.lineWidth = lw;
        for (let k = 0; k < n; k++) {
          g.beginPath();
          g.moveTo(r() * W, 0);
          g.bezierCurveTo(r() * W, H * 0.3, r() * W, H * 0.6, r() * W, H);
          g.stroke();
        }
      }
      g.strokeStyle = 'rgba(80,70,50,0.35)';
      g.lineWidth = 3;
      for (let k = 1; k < 4; k++) {
        g.beginPath();
        g.moveTo((k * W) / 4, 0);
        g.lineTo((k * W) / 4, H);
        g.stroke();
      }
      return;
    }
    g.fillStyle = look === 'form' ? '#efe9d2' : tall ? '#f4f3ee' : '#f1f0ec';
    g.fillRect(0, 0, W, H);
    const lines = (x: number, y: number, n: number, w: number, step: number, c: string): void => {
      g.fillStyle = c;
      for (let k = 0; k < n; k++) g.fillRect(x, y + k * step, w * (0.5 + r() * 0.5), 4);
    };
    if (look === 'form') {
      g.fillStyle = '#4f7a5c';
      g.fillRect(30, 26, 300, 26);
      g.strokeStyle = '#7f9f88';
      g.lineWidth = 3;
      for (let row = 0; row < 6; row++) for (let c = 0; c < 2; c++) {
        g.strokeRect(30 + c * 325, 74 + row * 66, 310, 56);
        lines(44 + c * 325, 92 + row * 66, 2, 250, 18, '#5c5c58');
      }
    } else if (tall) {
      lines(40, 26, 2, 180, 14, '#4a4a4a');
      lines(40, 80, 9, 250, 18, '#6b6b6b');
      lines(390, 80, 9, 80, 18, '#6b6b6b');
    } else {
      lines(44, 40, 1, 420, 10, '#2e2e2e');
      lines(44, 86, 20, 600, 19, '#77777a');
      if (look === 'stamp') {
        g.strokeStyle = 'rgba(40,70,160,0.75)';
        g.lineWidth = 7;
        g.beginPath();
        g.arc(560, 390, 60, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(560, 390, 44, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = '#1d2f7a';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(90, 440);
        g.bezierCurveTo(140, 380, 160, 480, 210, 420);
        g.bezierCurveTo(240, 390, 260, 450, 320, 416);
        g.stroke();
      }
    }
  });
}

/** The windscreen's faint reflections and smears (alpha): a few soft slanted streaks, clear at the top and sides. */
export function glassStreaks(): THREE.CanvasTexture {
  return canvasTexture(
    1024,
    512,
    (g, W, H) => {
      g.fillStyle = '#101010';
      g.fillRect(0, 0, W, H);
      g.filter = 'blur(14px)';
      const r = rnd(29);
      for (let k = 0; k < 9; k++) {
        const x = r() * W;
        const w = 20 + r() * 90;
        g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.09})`;
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x + w, H);
        g.lineTo(x + w + 220, 0);
        g.lineTo(x + 220, 0);
        g.fill();
      }
      g.filter = 'none';
      // (the canvas's top is the pane's: fade out there)
      const fade = g.createLinearGradient(0, 0, 0, H);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.6, 'rgba(0,0,0,0)');
      g.fillStyle = fade;
      g.fillRect(0, 0, W, H);
    },
    false,
  );
}

/** The wheel's emblem: our own, a beetle in red and chrome on black. */
export function emblem(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g) => {
    const bg = g.createRadialGradient(200, 180, 20, 256, 256, 260);
    bg.addColorStop(0, '#222327');
    bg.addColorStop(1, '#0c0c0e');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 512);
    const chrome = g.createLinearGradient(0, 90, 0, 430);
    chrome.addColorStop(0, '#f2f4f7');
    chrome.addColorStop(0.5, '#9aa0a8');
    chrome.addColorStop(0.52, '#5f656d');
    chrome.addColorStop(1, '#cfd4da');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // legs, three a side
    for (const [lw, style] of [[20, '#b3261c'], [10, '#d9dde2']] as const) {
      g.strokeStyle = style;
      g.lineWidth = lw;
      for (const m of [-1, 1])
        for (const [y0, x1, y1, x2, y2] of [[196, 108, 170, 132, 118], [258, 138, 258, 172, 290], [316, 112, 352, 132, 410]]) {
          g.beginPath();
          g.moveTo(256 + m * 60, y0);
          g.lineTo(256 + m * x1, y1);
          g.lineTo(256 + m * x2, y2);
          g.stroke();
        }
    }
    // the wing cases, the neck, the head with its horn
    g.strokeStyle = '#b3261c';
    g.lineWidth = 14;
    g.fillStyle = chrome;
    g.beginPath();
    g.ellipse(256, 290, 88, 118, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(256, 166, 62, 40, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(228, 132);
    g.quadraticCurveTo(256, 112, 250, 66);
    g.quadraticCurveTo(282, 96, 284, 132);
    g.closePath();
    g.fill();
    g.stroke();
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(256, 206);
    g.lineTo(256, 404);
    g.stroke();
    g.lineWidth = 5;
    for (const m of [-1, 1])
      for (const q of [0.36, 0.7]) {
        g.beginPath();
        g.moveTo(256 + m * 88 * q, 214);
        g.quadraticCurveTo(256 + m * 88 * q * 1.2, 300, 256 + m * 88 * q * 0.8, 376);
        g.stroke();
      }
  });
}

/** The garage beyond the windscreen, out of focus: a white wall with bands of sun, boxes, a bike, buckets. */
export function garage(): THREE.CanvasTexture {
  return canvasTexture(2048, 900, (g, W, H) => {
    paintWall(g, W, H);
    paintGarage(g, W, H);
  });
}

/** All round the front of the car: the open door with the daylight on the left, the garage, the shelves on the right. */
export function surround(): THREE.CanvasTexture {
  return canvasTexture(4096, 1140, (g, W, H) => {
    paintWall(g, W, H);
    g.save();
    g.translate(760, 0);
    g.scale(1.266, 1.266);
    paintGarage(g, 2048, 900);
    g.restore();
    g.save();
    g.translate(-120, 150);
    g.scale(1.1, 1.25);
    paintSide(g, 1024, 700, true);
    g.restore();
    g.save();
    g.translate(3270, 130);
    g.scale(1.1, 1.25);
    paintSide(g, 1024, 700, false);
    g.restore();
  });
}

function paintWall(g: Ctx, W: number, H: number): void {
  const wall = g.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#85847f');
  wall.addColorStop(0.45, '#a3a19b');
  wall.addColorStop(0.7, '#c4c1ba');
  wall.addColorStop(1, '#5e5c58');
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
}

function paintGarage(g: Ctx, W: number, H: number): void {
  {
    g.filter = 'blur(14px)';
    // bands of sun on the wall
    g.fillStyle = '#f7f3e8';
    g.beginPath();
    g.moveTo(0, 470);
    g.lineTo(W * 0.7, 520);
    g.lineTo(W * 0.7, 640);
    g.lineTo(0, 610);
    g.fill();
    g.fillStyle = 'rgba(250,246,236,0.75)';
    g.beginPath();
    g.moveTo(W * 0.55, 470);
    g.lineTo(W, 360);
    g.lineTo(W, 410);
    g.lineTo(W * 0.55, 530);
    g.fill();
    g.filter = 'blur(9px)';
    // the cardboard boxes on the left, a grey slab
    g.fillStyle = '#8d8a82';
    g.fillRect(170, 520, 150, 260);
    g.fillRect(360, 480, 140, 300);
    const board = g.createLinearGradient(470, 0, 900, 0);
    board.addColorStop(0, '#c99a66');
    board.addColorStop(0.6, '#b3855a');
    board.addColorStop(1, '#8f6a47');
    g.fillStyle = 'rgba(40,36,32,0.5)';
    g.fillRect(480, 730, 480, 60);
    g.fillStyle = board;
    g.fillRect(470, 420, 420, 190);
    g.fillRect(520, 615, 380, 130);
    g.fillStyle = 'rgba(120,88,58,0.6)';
    g.fillRect(560, 452, 130, 16);
    g.fillRect(560, 480, 90, 8);
    g.strokeStyle = 'rgba(120,88,58,0.6)';
    g.lineWidth = 5;
    g.strokeRect(640, 500, 200, 70);
    g.fillStyle = 'rgba(70,52,34,0.5)';
    g.fillRect(470, 606, 430, 12);
    g.fillStyle = '#d0a572';
    g.beginPath();
    g.moveTo(440, 330);
    g.lineTo(880, 350);
    g.lineTo(890, 425);
    g.lineTo(470, 425);
    g.fill();
    g.fillStyle = '#37a3b8';
    g.fillRect(470, 420, 66, 190);
    g.fillRect(520, 615, 60, 90);
    g.fillStyle = '#6b4d31';
    g.fillRect(888, 430, 46, 300);
    g.fillStyle = '#e8e8e4';
    g.fillRect(650, 600, 220, 34);
    // the mower's yellow handle, the bike
    g.lineCap = 'round';
    g.strokeStyle = '#e8a21c';
    g.lineWidth = 17;
    for (const dx of [0, 62]) {
      g.beginPath();
      g.moveTo(1120 + dx, 380);
      g.lineTo(1128 + dx, 450);
      g.lineTo(1280 + dx, 690);
      g.stroke();
    }
    g.strokeStyle = '#2c2b2b';
    g.lineWidth = 15;
    g.beginPath();
    g.moveTo(1120, 380);
    g.lineTo(1160, 312);
    g.lineTo(1216, 312);
    g.lineTo(1182, 380);
    g.stroke();
    g.lineWidth = 8;
    g.strokeStyle = '#30343a';
    for (const [x, rr] of [[1330, 100], [1560, 104]]) {
      g.beginPath();
      g.arc(x, 700, rr, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = '#7d97ad';
    g.lineWidth = 13;
    g.beginPath();
    g.moveTo(1330, 700);
    g.lineTo(1400, 540);
    g.lineTo(1520, 520);
    g.lineTo(1560, 700);
    g.moveTo(1400, 540);
    g.lineTo(1450, 700);
    g.lineTo(1520, 540);
    g.stroke();
    g.strokeStyle = '#222326';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(1500, 440);
    g.lineTo(1560, 420);
    g.moveTo(1520, 520);
    g.lineTo(1530, 430);
    g.stroke();
    // a tarpaulin, poles, buckets
    g.fillStyle = '#6f7a80';
    g.beginPath();
    g.moveTo(1590, 690);
    g.quadraticCurveTo(1600, 520, 1690, 500);
    g.quadraticCurveTo(1800, 500, 1820, 690);
    g.fill();
    for (const [x, c, w] of [[1770, '#9c7550', 20], [1800, '#4a4948', 16], [1826, '#c2bfb8', 14], [1852, '#a2805a', 18]] as const) {
      g.fillStyle = c;
      g.fillRect(x, 130, w, 480);
    }
    g.fillStyle = '#e8d534';
    g.beginPath();
    g.arc(1720, 720, 66, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a6fd0';
    g.beginPath();
    g.arc(1700, 660, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e02f48';
    g.fillRect(1900, 560, 110, 190);
    g.fillStyle = '#3aa552';
    g.beginPath();
    g.moveTo(1980, 540);
    g.lineTo(2048, 590);
    g.lineTo(2000, 660);
    g.fill();
    // the floor's clutter: a dark band
    g.filter = 'blur(20px)';
    g.fillStyle = 'rgba(60,58,56,0.8)';
    g.fillRect(0, 780, W, 160);
    g.filter = 'none';
  }
}

/** A side of the garage, out of focus: the open door with the daylight, or the wall's shelves. */
function paintSide(g: Ctx, W: number, H: number, door: boolean): void {
  {
    g.filter = 'blur(12px)';
    const r = rnd(door ? 41 : 53);
    if (door) {
      const sky = g.createLinearGradient(0, 90, 0, 600);
      sky.addColorStop(0, '#f4f6f8');
      sky.addColorStop(0.6, '#e9ece9');
      sky.addColorStop(1, '#c9c2b2');
      g.fillStyle = sky;
      g.fillRect(90, 90, W - 320, 520);
      for (let k = 0; k < 26; k++) {
        const h = 60 + r() * 130;
        g.fillStyle = ['#71805f', '#8b9778', '#5f6d50'][Math.floor(r() * 3)];
        g.beginPath();
        g.ellipse(110 + r() * (W - 360), 470 - h / 2, 20 + r() * 30, h / 2, 0, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      for (let row = 0; row < 3; row++) {
        g.fillStyle = '#6b4f35';
        g.fillRect(140, 190 + row * 150, 700, 18);
        for (let x = 150; x < 820; x += 30 + r() * 60) {
          const h = 40 + r() * 80;
          g.fillStyle = ['#9a7b55', '#4d6a86', '#7a3a34', '#5c6a4c', '#c9c4b8', '#3d3f44'][Math.floor(r() * 6)];
          g.fillRect(x, 190 + row * 150 - h, 24 + r() * 40, h);
        }
      }
    }
    g.filter = 'none';
  }
  void H;
}

/** Trees and a bright sky, out of focus (what a door mirror shows). */
export function mirrorView(): THREE.CanvasTexture {
  return canvasTexture(512, 320, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#eef2f6');
    sky.addColorStop(0.7, '#dfe8ee');
    sky.addColorStop(1, '#a9aeac');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.filter = 'blur(5px)';
    const r = rnd(23);
    for (let k = 0; k < 46; k++) {
      const h = 60 + r() * 110;
      g.fillStyle = ['#4c5a3e', '#5d6b48', '#3f4c36', '#74805e'][Math.floor(r() * 4)];
      g.beginPath();
      g.ellipse(r() * W, 236 - h / 2, 16 + r() * 22, h / 2, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#c9c4b8';
    g.fillRect(0, 236, W, 90);
    g.filter = 'none';
  });
}
