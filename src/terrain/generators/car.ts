import { createRng } from '../noise';
import { COLLIDER, DASH, DASH_FOAM, DASH_TRIM } from '../materials';
import { add, addHidden, boxMinMax, capsule, cone, cut, cylinder, paint, rotatedBox, sphere, torus, type Shape } from '../sdf';
import type { Terrain } from '../Terrain';
import {
  carScale, DASH_X0, DASH_X1, dashFace, dashTop, GLASS, glassFoot, GLOVE, GLOVE_THINGS, HOLDER, leaning, DIAL_WELLS, GRILLE, grilleHalf, grilleMid, onLid, OPENING, openingNorm, PHONE, pillarA, pillarB, PLATE, SECTION_LEN, section, STACK, STACK_ITEMS, SWITCH, VENT_BACK,
  VENT_DEPTH, VENTS, WHEEL, type Leaning,
} from './carPlan';
import { wirePath } from './parts';
import { feature, resetLayout, type Feature, type PartShape, type TerrainGenerator } from './types';

/** How far the density follows a section's outline exactly (cells): the density's clamp. */
const BAND = 6;
/** The dark skin over the foam (cells). */
const SKIN = 2.2;

/**
 * Fill the dashboard, section by section (one slice of the grid each): the distance to the section's outline,
 * negative inside it. Outside the dashboard's ends it is the distance to the end.
 */
function fillDash(t: Terrain, s: number, ox: number, oz: number): void {
  const { sx, sy, sz, dens, material } = t;
  const dist = new Float32Array(sy * sz);
  const pts = new Float64Array(SECTION_LEN * 2);
  // (the outline, closed behind and below)
  const n = SECTION_LEN + 2;
  const pz = new Float64Array(n + 1);
  const py = new Float64Array(n + 1);
  const cross: number[] = [];
  const i0 = Math.max(2, Math.floor(DASH_X0 * s + ox) - BAND);
  const i1 = Math.min(sx - 3, Math.ceil(DASH_X1 * s + ox) + BAND);
  for (let i = i0; i <= i1; i++) {
    const x = Math.min(DASH_X1, Math.max(DASH_X0, (i - ox) / s));
    section(x, pts);
    for (let p = 0; p < SECTION_LEN; p++) {
      pz[p] = pts[2 * p] * s + oz;
      py[p] = pts[2 * p + 1] * s;
    }
    pz[SECTION_LEN] = (glassFoot(x) + 16) * s + oz;
    py[SECTION_LEN] = 13 * s;
    pz[SECTION_LEN + 1] = glassFoot(x) * s + oz;
    py[SECTION_LEN + 1] = 50 * s;
    pz[n] = pz[0];
    py[n] = py[0];
    dist.fill(BAND + 1);
    for (let p = 0; p < n; p++) {
      const ax = pz[p];
      const ay = py[p];
      const bx = pz[p + 1] - ax;
      const by = py[p + 1] - ay;
      const l2 = bx * bx + by * by;
      if (l2 < 1e-9) continue;
      const k0 = Math.max(0, Math.floor(Math.min(ax, ax + bx) - BAND));
      const k1 = Math.min(sz - 1, Math.ceil(Math.max(ax, ax + bx) + BAND));
      const j0 = Math.max(0, Math.floor(Math.min(ay, ay + by) - BAND));
      const j1 = Math.min(sy - 1, Math.ceil(Math.max(ay, ay + by) + BAND));
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const qx = k - ax;
          const qy = j - ay;
          let u = (qx * bx + qy * by) / l2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = qx - bx * u;
          const dy = qy - by * u;
          const d2 = dx * dx + dy * dy;
          const id = j * sz + k;
          // (squared distances until the slice is done: the square root once a sample)
          if (d2 < dist[id] * dist[id]) dist[id] = Math.sqrt(d2);
        }
    }
    // (a unit short of the drawn skin's ends, which the doors cover)
    const ends = Math.max((DASH_X0 + 1.2) * s + ox - i, i - ((DASH_X1 - 1.2) * s + ox));
    for (let j = 2; j < sy - 2; j++) {
      cross.length = 0;
      const y = j + 1e-4;
      for (let p = 0; p < n; p++) {
        const a = py[p];
        const b = py[p + 1];
        if (a > y !== b > y) cross.push(pz[p] + ((pz[p + 1] - pz[p]) * (y - a)) / (b - a));
      }
      cross.sort((a, b) => a - b);
      let c = 0;
      for (let k = 2; k < sz - 2; k++) {
        while (c < cross.length && cross[c] < k) c++;
        let d = dist[j * sz + k];
        if (c & 1) d = -d;
        if (ends > d) d = ends;
        if (d >= BAND) continue;
        if (d < 0.01 && d > -0.01) d = d < 0 ? -0.01 : 0.01;
        const id = i + sx * (j + sy * k);
        if (d >= dens[id]) continue;
        dens[id] = d < -BAND ? -BAND : d;
        if (d < 1.5) material[id] = d > -SKIN ? DASH : DASH_FOAM;
      }
    }
  }
}

/** Cut the hood's opening: the oval tunnel down to the instruments' plate (a little wider than the drawn one). */
function cutOpening(t: Terrain, s: number, ox: number, oz: number): void {
  const { sx, sy, sz, dens } = t;
  const i0 = Math.max(2, Math.floor((OPENING.x - OPENING.a - 8) * s + ox));
  const i1 = Math.min(sx - 3, Math.ceil((OPENING.x + OPENING.a + 8) * s + ox));
  const j0 = Math.max(2, Math.floor((OPENING.y - OPENING.b - 8) * s));
  const j1 = Math.min(sy - 3, Math.ceil((OPENING.y + OPENING.b + 8) * s));
  const k0 = Math.max(2, Math.floor((OPENING.back - 7) * s + oz));
  const k1 = Math.min(sz - 3, Math.ceil(100 * s + oz));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const x = (i - ox) / s;
      const y = j / s;
      const r = openingNorm(x, y);
      const gx = (openingNorm(x + 0.5, y) - openingNorm(x - 0.5, y));
      const gy = (openingNorm(x, y + 0.5) - openingNorm(x, y - 0.5));
      const g = Math.max(0.004, Math.sqrt(gx * gx + gy * gy));
      // (the distance to the outline, positive inside the hole)
      const hole = Math.min(8, (1 - r) / g + 0.6) * s;
      if (hole < -BAND) continue;
      for (let k = k0; k <= k1; k++) {
        // (down to the plate's face, which leans)
        const cut = Math.min(hole, k - ((PLATE.z + 0.7 - ((y - PLATE.y) * PLATE.s) / PLATE.c) * s + oz));
        const id = i + sx * (j + sy * k);
        if (cut <= dens[id]) continue;
        let w = cut > BAND ? BAND : cut;
        if (w < 0.01 && w > -0.01) w = w < 0 ? -0.01 : 0.01;
        dens[id] = w;
      }
    }
}

/**
 * The windscreen and everything beyond it: solid and never drawn, so nobody walks or shoots out through the glass
 * (nor starts the match on the bonnet). The pane itself is drawn.
 */
function fillOutside(t: Terrain, s: number, ox: number, oz: number): void {
  const { sx, sy, sz, dens, material } = t;
  const low = GLASS.y - 26;
  for (let k = 0; k < sz; k++)
    for (let j = Math.max(2, Math.floor(low * s) - BAND); j < sy; j++)
      for (let i = 0; i < sx; i++) {
        const x = (i - ox) / s;
        // (the pane's plane at x: through its foot, up and back)
        const d = ((k - oz) / s - glassFoot(x) - 1) * GLASS.s - (j / s - GLASS.y) * GLASS.c;
        const id = i + sx * (j + sy * k);
        let w = Math.max(d, low - j / s) * s;
        // (the dashboard's surface where it meets the glass, under the drawn rubber: never drawn)
        // (the grid's outer layers, still air, too: the faces against them belong to this solid)
        if (w < 2.2) material[id] = COLLIDER;
        if (w >= dens[id] || i < 2 || j < 2 || k < 2 || i > sx - 3 || j > sy - 3 || k > sz - 3) continue;
        if (w < 0.01 && w > -0.01) w = w < 0 ? -0.01 : 0.01;
        dens[id] = w < -BAND ? -BAND : w;
        if (w < 1.5) material[id] = COLLIDER;
      }
}

/**
 * Car Dashboard: the owner's car, from photos and a video, without brands or faces: the dashboard from door to
 * door with the ignition on. The driver's side on the left: the hood over the instruments (lit, their needles up),
 * the steering wheel on its column with its stalks, the light switch. In the middle, two round vents (a phone with a
 * map in its holder on the left one), the hazard button (flashing), the radio with its cracked screen, the climate
 * panel, the gear lever on its tunnel. On the right, the passenger's pad, the glove box. At the back the defroster's
 * grille along the foot of the windscreen, and the garage beyond it (drawn). At both ends a vent, the pillars, the
 * doors.
 *
 * Gameplay: the dashboard's top is the ground: hills (the hood), a long slope towards the seats; the wheel's rim,
 * spokes and column are bridges, the door tops and the tunnel ledges far below; past them, the car's floor is too
 * far down to live. Everything drawn over the terrain has a hidden body.
 */
export const car: TerrainGenerator = (terrain, seed, layout) => {
  terrain.beginGeneration();
  if (layout) resetLayout(layout, terrain);
  const { W, H, D } = terrain;
  const { s, ox, oz } = carScale(W, H, D);
  const rng = createRng(seed * 7919 + 5);
  const features: Feature[] | null = layout ? layout.features : null;
  const put = (f: Feature): void => {
    features?.push(f);
  };
  // (from base units to the map's)
  const X = (v: number): number => v * s + ox;
  const Y = (v: number): number => v * s;
  const Z = (v: number): number => v * s + oz;
  const L = (v: number): number => v * s;
  const hide = (sh: Shape): void => addHidden(terrain, sh, COLLIDER);
  const solid = (sh: Shape): void => add(terrain, sh, COLLIDER);
  /** The dashboard's surface round a part, under the drawn skin: never drawn either (its edge there would be ragged). */
  const skirt = (sh: Shape): void => paint(terrain, sh, COLLIDER);
  const thick = (v: number): number => Math.max(1.05, v * s);
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, round = 0): Shape =>
    boxMinMax(X(x0), Y(y0), Z(z0), X(x1), Y(y1), Z(z1), L(round));
  const tube = (a: readonly number[], b: readonly number[], r: number): Shape => capsule(X(a[0]), Y(a[1]), Z(a[2]), X(b[0]), Y(b[1]), Z(b[2]), thick(r));
  /** A box in a leaning frame: its middle (u, w, n) and half sizes. */
  const tilted = (f: Leaning, u: number, w: number, n: number, hu: number, hw: number, hn: number): Shape => {
    const [x, y, z] = leaning(f, u, w, n);
    return rotatedBox(X(x), Y(y), Z(z), thick(hu), thick(hw), thick(hn), 0, f.c, -f.s);
  };
  const scaled = (p: readonly number[]): [number, number, number] => [X(p[0]), Y(p[1]), Z(p[2])];
  const part = (x: number, y: number, z: number, w: number, h: number, d: number, shape: PartShape, color: number, metal: number, rough: number): void =>
    put(feature('part', X(x), Y(y), Z(z), { shape, box: [X(x - w / 2), Y(y - h / 2), Z(z - d / 2), X(x + w / 2), Y(y + h / 2), Z(z + d / 2)], color, metal, rough }));
  if (layout) {
    layout.floorY = Y(60);
    layout.inner = [2, 2, 2, W - 2, H - 2, D - 2];
  }

  // ---- the dashboard, the world beyond the windscreen, the doors
  fillDash(terrain, s, ox, oz);
  cutOpening(terrain, s, ox, oz);
  fillOutside(terrain, s, ox, oz);
  for (const m of [0, 1]) {
    const mx = (v: number): number => (m ? BASE_X - v : v);
    const span = (a: number, b: number): [number, number] => (m ? [BASE_X - b, BASE_X - a] : [a, b]);
    const [dx0, dx1] = span(3, DASH_X0 + 0.6);
    add(terrain, box(dx0, 8, 34, dx1, 65.5, 157, 3), DASH_TRIM);
    const [ax0, ax1] = span(22, 31);
    add(terrain, box(ax0, 27, 108, ax1, 33.5, 157, 2), DASH_TRIM);
    // the pillar up along the windscreen's edge, the panel of the door's corner behind it (a triangle, in strips)
    for (let k = 0; k < 9; k++) {
      const [t0, t1] = [k / 24, (k + 1) / 24];
      const along = (a: (t: number) => readonly number[], b: (t: number) => readonly number[], v: number, t: number, o: readonly number[]): number[] => {
        const [p, q] = [a(t), b(t)];
        return [mx(p[0] + (q[0] - p[0]) * v + o[0]), p[1] + (q[1] - p[1]) * v + o[1], p[2] + (q[2] - p[2]) * v + o[2]];
      };
      const frameB = (t: number): number[] => {
        const [x, y, z] = pillarB(Math.max(0.06, t));
        return [x - 5.8, y - 1.5, z + 10.8];
      };
      for (const v of [0.15, 0.5, 0.85]) solid(tube(along(pillarA, pillarB, v, t0, [0.6, 0, 0]), along(pillarA, pillarB, v, t1, [0.6, 0, 0]), 2.9));
      for (const v of [0.25, 0.8]) solid(tube(along(pillarB, frameB, v, t0, [-0.8, 0, 0.6]), along(pillarB, frameB, v, t1, [-0.8, 0, 0.6]), 2.2));
    }
    skirt(tube([mx(24), 62, 34], [mx(32), 96, 58], 14));
    // the window's front post, the mirror's arm, the door's opener in its bowl
    const [px0, px1] = span(17.4, 21.6);
    solid(box(px0, 62, 91.9, px1, 126, 97.1, 0.8));
    solid(tube([mx(3), 78, 69], [mx(14), 78, 63.5], 4.2));
    const [ox0, ox1] = span(22, 26.9);
    solid(box(ox0, 45.7, 133, ox1, 50.1, 145, 0.6));
    const [bx0, bx1] = span(21, 25.5);
    solid(box(bx0, 39, 124, bx1, 56.2, 152, 1));
    // (its cloth panel; the corner panel's rear part up to the post; the pillar's foot; the little box's cable)
    const [cx0, cx1] = span(21, 24.8);
    solid(box(cx0, 35.8, 114, cx1, 58.2, 157.4));
    const [rx0, rx1] = span(17.2, 22.1);
    solid(box(rx0, 62, 85, rx1, 125, 92.4));
    solid(tube([mx(25.4), 66, 30], [mx(28), 84, 34], 3));
    if (m === 0) for (const [a, b] of [[[34, 80, 42], [31, 78.2, 46]], [[31, 78.2, 46], [27.6, 73, 50]], [[27.6, 73, 50], [25, 66.6, 56]]]) solid(tube(a, b, 1.05));
    for (let k = 0; k < 11; k++) {
      const z = 44 + k * 4;
      const [tx0, tx1] = span(17.2, 22.1);
      solid(box(tx0, 62, z - 2.4, tx1, 66 + ((k + 0.5) / 11) * 58, z + 2.4));
    }
  }

  // ---- the bulkhead under the dashboard, behind it
  solid(box(24.5, 2.2, 27, 295.5, 15, 34, 0.4));

  // ---- the tunnel between the seats: a tray (drawn smooth over it) and the gear lever
  add(terrain, box(134.5, 2.6, 92, 185.5, 7, 154, 1.2), DASH_TRIM);
  for (const wx of [133, 183.5]) solid(box(wx, 4, 93, wx + 3.5, 13, 153, 1.4));
  solid(box(136, 4, 152.6, 184, 13, 156, 1.4));
  for (const cx of [135.9, 184.1]) {
    solid(tube([cx, 6, 153.5], [cx, 10.2, 153.5], 2.8));
    solid(tube([cx, 11.6, 152], [cx, 11.6, 154.4], 1.6));
  }
  skirt(box(131, 1, 92, 189, 14, 158));
  hide(cone(X(160), Y(6), Z(140), L(9), Y(17), L(3)));
  hide(tube([160, 14, 140], [160, 25, 139], 1.5));
  hide(sphere(X(160), Y(28.8), Z(138.5), L(4.6)));
  hide(cylinder(X(160), Y(31.4), Z(139), L(2.8), L(1.6), 1));

  // ---- the vents: a round hole down to the slats, the bezel round it, the tab
  for (const v of VENTS) {
    cut(terrain, cylinder(X(v.x), Y(v.y), Z(v.z), L(v.R - 0.1), L(VENT_BACK + 0.4), 2));
    solid(cylinder(X(v.x), Y(v.y), Z(v.z - VENT_DEPTH - 2), L(v.R + 0.6), L(2), 2));
    solid(torus(X(v.x), Y(v.y), Z(v.z - 0.5), L(v.R - 0.2), thick(1.1), 2));
    skirt(cylinder(X(v.x), Y(v.y), Z(v.z - 1), L(v.R + 2), L(VENT_BACK + 1.5), 2));
    solid(capsule(X(v.x - 3.6), Y(v.y - 0.4), Z(v.z - VENT_DEPTH + 0.6), X(v.x + 3.6), Y(v.y - 0.4), Z(v.z - VENT_DEPTH + 0.6), thick(1.3)));
  }

  // ---- the glove box: the cave in the dashboard, its lid, the things in it
  {
    const { x0, x1, y0, y1, z0, z1 } = GLOVE;
    cut(terrain, box(x0, y0, z0, x1, y1, z1 + 4, 1));
    const mid = (x0 + x1) / 2;
    const lid = (u: number, n: number, d: number, hu: number, hn: number, hd: number): Shape => {
      const [x, y, z] = onLid(u, n, d);
      return rotatedBox(X(x), Y(y), Z(z), thick(hu), thick(hn), thick(hd), 0, GLOVE.c, GLOVE.s);
    };
    skirt(box(x0 - 2, y0 - 4, 92, x1 + 2, y1 + 1.5, z1 + 3));
    solid(lid(0, -GLOVE.thick / 2, GLOVE.len / 2, (x1 - x0) / 2 + 1, GLOVE.thick / 2, GLOVE.len / 2));
    solid(lid(0, 0.6, GLOVE.len - 1.1, (x1 - x0) / 2 + 1, 1.8, 1.1));
    for (const e of [-1, 1]) solid(lid(e * ((x1 - x0) / 2 - 0.1), 0.6, GLOVE.len / 2 + 2, 1.1, 1.8, GLOVE.len / 2 - 2));
    const { folder, papers, map, tissues, torch } = GLOVE_THINGS;
    const thing = (t: { x: number; z: number; w: number; h: number; d: number }, y: number): void =>
      solid(box(t.x - t.w / 2, y - 1.5, t.z - t.d / 2, t.x + t.w / 2, y + t.h, t.z + t.d / 2));
    thing(folder, y0);
    thing(papers, y0 + folder.h);
    thing(map, y0);
    thing(tissues, y0);
    solid(tube([torch.x0, y0 + torch.r, torch.z], [torch.x1 + 2, y0 + torch.r, torch.z], torch.r));
    solid(cone(X(tissues.x), Y(y0 + tissues.h - 1), Z(tissues.z), L(2.8), Y(y0 + tissues.h + 3.8), L(0.5)));
    skirt(box(x1 - 14, y1 - 3, 88, x1 - 2, y1 + 2, 96));
    solid(box(x1 - 12, y1 - 1.3, 90.2, x1 - 4, y1 + 1, 93.8));
    // (on the lid: the pen, the receipt, the coins)
    solid(tube(onLid(-9.4, -0.05, 15.4), onLid(2.4, -0.05, 13.3), 1.05));
    solid(lid(4, -0.6, 9, 4.2, 1, 2.6));
    solid(lid(0, 2.2, GLOVE.len - 1.2, 2.6, 1.6, 1.1));
    // (the frame's bar round the mouth)
    const bar = (ax: number, ay: number, bx: number, by: number): void => {
      const n = 8;
      for (let k = 0; k < n; k++) {
        const p = (t: number): number[] => {
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          return [x, y, dashFace(x, y) - 0.1];
        };
        solid(tube(p(k / n), p((k + 1) / n), 1.1));
      }
    };
    bar(x0, y1 + 0.2, x1, y1 + 0.2);
    bar(x0, y0 - 0.6, x1, y0 - 0.6);
    bar(x0 - 0.4, y0, x0 - 0.4, y1);
    bar(x1 + 0.4, y0, x1 + 0.4, y1);
    for (const [u, d] of [[10.6, 14.6], [12.6, 13.2], [-11, 5.4]]) solid(lid(u, -0.62, d, 1.1, 1, 1.1));
    void mid;
  }

  // ---- the phone in its holder
  solid(box(HOLDER.x - HOLDER.hw, HOLDER.y - HOLDER.hh, VENTS[1].z + 1.4, HOLDER.x + HOLDER.hw, HOLDER.y + HOLDER.hh, HOLDER.z + HOLDER.hd));
  solid(tube([HOLDER.x, HOLDER.y + 1, HOLDER.z - 6], [HOLDER.x, HOLDER.y + 1, HOLDER.z - 2], 2.2));
  for (const e of [-1, 1]) solid(box(HOLDER.x + e * 10 - 1.9, HOLDER.y - 6.4, HOLDER.z - 2, HOLDER.x + e * 10 + 1.9, HOLDER.y + 6, HOLDER.z + 7));
  solid(box(PHONE.x - 3.2, PHONE.y - PHONE.hh - 2.2, PHONE.z - 1, PHONE.x - 0.8, PHONE.y - PHONE.hh + 1, PHONE.z + 1));
  solid(box(PHONE.x - PHONE.hw, PHONE.y - PHONE.hh, PHONE.z - 1.5, PHONE.x + PHONE.hw, PHONE.y + PHONE.hh, PHONE.z + PHONE.hd));

  // ---- the centre stack: its panel, and what stands out of it
  // (its face stands a unit out of `out`, by the panel's bevel; it narrows downwards)
  solid(tilted(STACK, 0, -14, STACK.out - 1, STACK.topHalf - 0.8, 13.6, 2));
  solid(tilted(STACK, 0, -STACK.len / 2, STACK.out - 1, STACK.bottomHalf + 1.4, STACK.len / 2, 2));
  skirt(tilted(STACK, 0, -STACK.len / 2, 0, STACK.topHalf + 1.5, STACK.len / 2 + 2, 4.5));
  for (const it of STACK_ITEMS) {
    const n = STACK.out + it.out;
    if (it.kind === 'knob' || it.kind === 'round') {
      const [x, y, z] = leaning(STACK, it.u, -it.v, n - it.w * 0.42);
      solid(sphere(X(x), Y(y), Z(z), thick(it.w * 0.46)));
      solid(tilted(STACK, it.u, -it.v, n / 2, it.w * 0.4, it.w * 0.4, n / 2));
    } else solid(tilted(STACK, it.u, -it.v, n - 1.2, it.w / 2, it.h / 2, 1.2));
  }

  // ---- the dials' wells on the instrument plate, the middle screen's frame
  for (const d of DIAL_WELLS) {
    const [x, y, z] = leaning(PLATE, d.u, d.w, d.r > 5 ? 1.6 : 0.4);
    // (a ring of capsules on the leaning plate: its cos and sin stepped by a 24th of a turn)
    let cu = 1;
    let su = 0;
    for (let k = 0; k < 24; k++) {
      const nu = cu * 0.9659258262890683 - su * 0.25881904510252074;
      const nv = su * 0.9659258262890683 + cu * 0.25881904510252074;
      const at = (a: number, b: number): [number, number, number] => leaning(PLATE, d.u + (d.r + 0.6) * a, d.w + (d.r + 0.6) * b, d.r > 5 ? 1.5 : 0.4);
      solid(tube(at(cu, su), at(nu, nv), 1.1));
      cu = nu;
      su = nv;
    }
    solid(sphere(X(x), Y(y), Z(z - (d.r > 5 ? 1 : 0.4)), thick(d.r > 5 ? 1.7 : 1.05)));
  }
  for (const w of [3.2, -8.8]) solid(tilted(PLATE, 0, w, 0.2, 5.8, 1.05, 1.1));
  for (const u of [-5.6, 5.6]) solid(tilted(PLATE, u, -2.8, 0.2, 1.05, 6.2, 1.1));
  // (the drawn plate stands in for all of it)
  skirt(tilted(PLATE, 0, 0, 0.5, 38.5, 15.5, 3.4));
  skirt(tilted(PLATE, 0, 0, 8, 39.5, 17, 13));

  // ---- the steering wheel: the rim (a chain of capsules), the hub, the spokes, the column and its stalks
  {
    // (a 48th of a turn: its cos and sin, stepped by turning)
    const c48 = 0.9914448613738104;
    const s48 = 0.13052619222005157;
    let cu = 1;
    let su = 0;
    for (let k = 0; k < 48; k++) {
      const nu = cu * c48 - su * s48;
      const nv = su * c48 + cu * s48;
      solid(tube(leaning(WHEEL, WHEEL.R * cu, WHEEL.R * su, 0), leaning(WHEEL, WHEEL.R * nu, WHEEL.R * nv, 0), WHEEL.r));
      cu = nu;
      su = nv;
    }
    hide(tilted(WHEEL, 0, -5.6, 0.8, 12, 14.6, 4.4));
    hide(tilted(WHEEL, 0, -3, 0.8, 19, 6.6, 4.4));
    hide(sphere(...scaled(leaning(WHEEL, 0, -8, 3)), L(3)));
    for (const e of [-1, 1]) hide(tilted(WHEEL, e * 26, -2.6, 0.4, 9.5, 7, 2.4));
    hide(tilted(WHEEL, 0, -28, 0.2, 7.6, 8, 2.2));
    // (the emblem's disc with its tongue, the button pods, the stalks' broad tips)
    hide(tilted(WHEEL, 0, -18, 0.2, 13, 6, 2.2));
    for (const e of [-1, 1]) hide(tilted(WHEEL, e * 16, -12.4, 0.6, 6.4, 5.4, 2.6));
    hide(tilted(WHEEL, 0, -9, 1.6, 15.5, 11, 3.2));
    hide(tilted(WHEEL, 0, -25, 0.2, 11, 9, 2.2));
    hide(tilted(WHEEL, 0, -8, 4, 8.6, 10.6, 3.1));
    hide(tilted(WHEEL, 0, -8, 4, 10.6, 8.6, 3.1));
    hide(tilted(WHEEL, 0, -18, 4, 6.4, 3, 3));
    for (const e of [-1, 1]) {
      hide(tilted(WHEEL, e * 24.6, -3, 1.4, 4.8, 6.6, 2.5));
      solid(tube(leaning(WHEEL, e * 22, 5.2, -11.8), leaning(WHEEL, e * 31.6, 6.4, -11.8), 2.6));
    }
    solid(tilted(WHEEL, 0, -2.5, -20, 12, 8.5, 17));
    skirt(tilted(WHEEL, 0, -2.5, -32, 14.5, 11, 9));
    for (const e of [-1, 1]) solid(tube(leaning(WHEEL, e * 10, 4, -12), leaning(WHEEL, e * 32, 6, -11), 2.6));
  }
  // ---- the light switch, under the left vent; the sensor on the grille; the box on the left pillar's foot
  solid(tilted(SWITCH, 0, 0, -2.6, 15.8, 5.2, 3.5));
  solid(tilted(SWITCH, -4, 0, 1.6, 4, 4, 1.2));
  solid(tilted(SWITCH, -4, 0, 2.6, 2.6, 2.6, 2.3));
  solid(tilted(SWITCH, 8.3, -0.8, 0.6, 3.2, 3, 1.1));
  skirt(tilted(SWITCH, 0, 0, -3, 18, 7.4, 5));
  {
    const z = glassFoot(160) + 13;
    skirt(box(154, dashTop(160, z) - 4, z - 4, 166, dashTop(160, z) + 4, z + 4));
    solid(box(156, dashTop(160, z) - 2, z - 2.8, 164, dashTop(160, z) + 0.9, z + 2.8, 0.4));
    solid(box(157.2, dashTop(160, z) - 2, z - 1.8, 162.8, dashTop(160, z) + 2.5, z + 1.8, 0.8));
    // the small outlets by the pillars, a low disc each
    for (const [x, dz] of [[50, 66], [270, 62]]) {
      const y = dashTop(x, dz);
      skirt(box(x - 9, y - 4, dz - 8, x + 9, y + 3, dz + 8));
      solid(cylinder(X(x), Y(y - 0.35), Z(dz), L(6), thick(1.3), 1));
    }
    // the grille's two rails
    for (let x = GRILLE.x0 + 4; x < GRILLE.x1 - 6; x += 4)
      for (const a of [-0.83, 0.8]) {
        const at = (qx: number): number[] => {
          const qz = grilleMid(qx) + grilleHalf(qx) * a;
          return [qx, dashTop(qx, qz) + 0.75 - 1.15, qz];
        };
        skirt(tube(at(x), at(x + 4), 3));
        solid(tube(at(x), at(x + 4), 1.15));
      }
  }
  solid(box(34, 76, 38, 46, 83.5, 44, 1));
  skirt(box(32, 72, 36, 48, 86, 46));

  // ---- drawn by the render: the skin, the instruments, the wheel, the stack, the garage beyond the glass
  put(feature('car', W / 2, 0, D / 2, { path: [W, H, D], box: [0, 0, 0, W, H, D] }));
  put(feature('room', W / 2, Y(-70), D / 2, { color: 0x1c1c1d }));
  // (a charging cable from the phone to the socket by the gear lever: its slack a little different on every seed)
  const slack = 1.5 + rng() * 3;
  const ctrl = [142, 52.4, 104.6, 138, 50.4, 106, 131 - slack, 44, 107 + slack, 127 - slack, 29, 112 + slack, 128.6, 20.6, 115.6, 133.6, 16.8, 118.6, 139.2, 16, 120.6, 142, 13.6, 121, 142, 10, 121];
  const pts = wirePath(ctrl.map((v, i) => (i % 3 === 0 ? X(v) : i % 3 === 1 ? Y(v) : Z(v))), 8);
  put(feature('wire', pts[0], pts[1], pts[2], { path: [L(0.35), ...pts], color: 0x1a1a1a }));
  for (let i = 0; i + 5 < pts.length; i += 3) hide(capsule(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5], 1.05));
  // (the socket it ends in, its plug; the ring round the gear lever's boot)
  solid(cylinder(X(142), Y(8), Z(121), L(2.8), L(1.2), 1));
  solid(cylinder(X(142), Y(8.8), Z(121), L(2), L(1.7), 1));
  solid(cylinder(X(142), Y(11.2), Z(121), L(1.1), L(1.6), 1));
  solid(cylinder(X(160), Y(6.6), Z(140), L(10.3), L(1.4), 1));
  // (the key in its lock, right of the column, a plain fob hanging from it)
  {
    const [kx, ky, kz] = leaning(WHEEL, 12.6, -7, -14);
    part(kx + 0.6, ky, kz, 3.6, 5, 5, 'cylX', 0x1c1c1e, 0.2, 0.45);
    part(kx + 2.5, ky, kz, 0.5, 3.6, 3.6, 'cylX', 0x8a8d92, 0.8, 0.35);
    part(kx + 5.4, ky, kz, 6, 4.6, 1.5, 'soft', 0x131314, 0.1, 0.5);
    solid(tube([kx - 1, ky, kz], [kx + 2.6, ky, kz], 2.5));
    solid(box(kx + 2, ky - 2.2, kz - 1.05, kx + 8.4, ky + 2.2, kz + 1.05));
  }
  terrain.commitGeneration();
};

/** The base map's width, for the right side's mirror. */
const BASE_X = 320;
