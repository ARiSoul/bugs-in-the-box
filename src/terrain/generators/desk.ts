import { createRng } from '../noise';
import { COLLIDER, DESK_BLACK, DESK_WHITE, SLEEVE } from '../materials';
import { keyRelief } from './keyboards';
import { add, addHidden, boxMinMax, capsule, cone, cylinder, paint, rotatedBox, sphere, type Shape } from '../sdf';
import { wirePath } from './parts';
import { feature, resetLayout, type Feature, type PartShape, type TerrainGenerator } from './types';

/** cos and sin of 45°: the left wing of the L-shaped desk is turned by 45° (no Math.sin/cos in generators). */
const C45 = 0.7071067811865476;

/** Where the desk and its main objects are (world units), for the tests and the camera views. */
export interface DeskPlan {
  /** The main top: x0, z0, x1, z1. */
  main: [number, number, number, number];
  /** The left wing's centre (x, z), half length (along its long side) and half depth. */
  wing: [number, number, number, number];
  /** Monitors: [x, z, screen bottom, width, height] for the wing's, the middle and the right one. */
  monitors: [number, number, number, number, number][];
  /** The speaker's shelf: x0, z0, x1, z1, top. */
  shelf: [number, number, number, number, number];
  /** Lengths at this map's scale: 2 on the desk's own 10×3×5 map (about 0.8 cm a unit), less on smaller maps. */
  scale: number;
  /** Height of the desk's top. Below it only the void, and the room's floor (drawn) far down. */
  top: number;
  /** Height of the room's floor (drawn only, under the grid). */
  floor: number;
}

export function deskPlan(W: number, H: number, D: number): DeskPlan {
  // (the desk spans 160 × 80 units at scale 1 and its monitors reach 42 above the grid's bottom)
  const s = Math.min(2, W / 160, D / 80, (H - 10) / 42);
  const L = (v: number): number => v * s;
  const T = L(5);
  const wcx = L(38);
  const wcz = L(42);
  // the wing's monitor stands at its back, 12 units behind its centre and 3 to its right
  const wm: [number, number] = [wcx - L(9) * C45, wcz - L(15) * C45];
  return {
    main: [L(58), L(10), L(146), L(54)],
    wing: [wcx, wcz, L(26), L(21)],
    monitors: [
      [wm[0], wm[1], T + L(8), L(29), L(17)],
      // (the middle one the largest; the right one smaller, clear of the speaker's shelf)
      [L(79), L(16), T + L(14), L(45), L(23)],
      [L(121), L(16), T + L(15), L(38), L(19.5)],
    ],
    shelf: [L(143), L(10), L(157.4), L(32), T + L(9)],
    scale: s,
    top: T,
    floor: T - L(45),
  };
}

/**
 * Desk: the owner's real desk, as it stands (from photos and a video), without brands, faces or text. An
 * L-shaped black desk: the main top at the back, the left wing turned 45° towards the viewer. On the wing, a
 * white monitor on its stand (showing this game), a mechanical keyboard with a wrist rest and its purple glow,
 * a beer bottle. On the main top, left to right: a phone charger stand, a red audio
 * interface, two docks, a curved monitor (a film playing) on one of a dual arm's two arms (a base with two posts) over a silver laptop (its desktop) on a riser and a slim keyboard;
 * a smaller curved monitor on the other arm over a black laptop (a desert lock screen), a desk mat, two vertical
 * mice, a glasses case, a wallet, an air-conditioner remote, a medicine box and a tobacco pouch; the desk's
 * height buttons on its front edge. Right of the desk, on a felt-covered shelf: a studio speaker. Cables
 * everywhere, dust and crumbs on the black laminate.
 *
 * Gameplay: the desk tops and the shelf are the ground; the keyboards, laptops, monitor bases, the interface,
 * the mice and the small things are hills and plateaus; the monitor arms and the cables are bridges; the
 * edges are cliffs into the room far below. Drawn parts have hidden collision bodies (lifted off the desk's
 * samples where they rest on it).
 */
export const desk: TerrainGenerator = (terrain, seed, layout) => {
  terrain.beginGeneration();
  if (layout) resetLayout(layout, terrain);
  const { W, H, D } = terrain;
  const rng = createRng(seed * 4099 + 11);
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const features: Feature[] | null = layout ? layout.features : null;
  const put = (f: Feature): void => {
    features?.push(f);
  };
  const plan = deskPlan(W, H, D);
  const s = plan.scale;
  const L = (v: number): number => v * s;
  const T = plan.top;
  const F = plan.floor;
  const hide = (sh: Shape): void => addHidden(terrain, sh, COLLIDER);
  /**
   * A hidden body right on a top: unlike `hide`, it also takes over the samples of the surface it lies on. That
   * cuts a hole in the terrain's drawn surface round it, so only where a drawn sheet covers the top (`covered`).
   * `skirt`: a wider shape round it, hidden too (or the edges of the hole would show as slivers).
   */
  const hideOnSheet = (sh: () => Shape, skirt: () => Shape): void => {
    add(terrain, sh(), COLLIDER);
    paint(terrain, skirt(), COLLIDER);
  };
  /** A keyboard's keys: drawn, and the relief a bug walks on. Its deck must be there already. */
  const keyboard = (f: Feature): void => {
    put(f);
    keyRelief(terrain, f);
  };
  /** Is (x, z) over one of the desk's tops (or the shelf), at least `margin` inside the sheet drawn on it? */
  const covered = (x: number, z: number, margin: number): boolean => {
    const [x0, z0, x1, z1] = plan.main;
    if (x > x0 + margin && x < x1 - margin && z > z0 + margin && z < z1 - margin) return true;
    const [sx0, sz0, sx1, sz1] = plan.shelf;
    if (x > sx0 + margin && x < sx1 - margin && z > sz0 + margin && z < sz1 - margin) return true;
    const [wx, wz, ha, hb] = plan.wing;
    const a = (wz - wx - (z - x)) * -C45;
    const b = (x - wx + z - wz) * C45;
    return Math.abs(a) < ha - margin && Math.abs(b) < hb - margin;
  };
  /** Is a box's footprint (half sizes, turned by (c, sn)) over a drawn sheet, its hidden skirt too? */
  const footCovered = (x: number, z: number, hw: number, hd: number, c: number, sn: number): boolean => {
    for (const u of [-1, 1])
      for (const v of [-1, 1]) if (!covered(x + u * hw * c - v * hd * sn, z + u * hw * sn + v * hd * c, 1.9)) return false;
    return true;
  };
  /** A drawn box-like part centred at (x, z), from y0 up h, w × d, turned about the vertical by (c, sn). */
  const part = (
    x: number, y0: number, z: number, w: number, h: number, d: number, c: number, sn: number,
    shape: PartShape, color: number, metal: number, rough: number, opts: { body?: boolean; lift?: number; opacity?: number; glow?: number } = {},
  ): void => {
    const yaw: [number, number] | undefined = c === 1 && sn === 0 ? undefined : [c, sn];
    put(feature('part', x, y0 + h / 2, z, { shape, box: [x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2], yaw, color, metal, rough, opacity: opts.opacity ?? 1, glow: opts.glow ?? 0 }));
    if (opts.body === false) return;
    // (its hidden body: inside the drawn shape (inset by its rounding; a ball's an inscribed box), from its top
    // down; by default rooted 1.5 into the surface it rests on, so even a low part (a keyboard, a laptop, a
    // monitor's base) has a body thick enough to mesh, its foot hidden in the drawn part; with `lift`, standing
    // that far off its foot instead)
    const r = shape === 'soft' || shape === 'ball' ? Math.min(w, h, d) * 0.3 : 0.2;
    const k = 0.1 + r * 0.62;
    const ball = shape === 'ball';
    // (a part at least two high: its body's top is its drawn top, so feet stand on it, not in it; a lower one's
    // top would show the desk's colour there, so it stays just inside)
    const top = ball ? y0 + h / 2 + (h / 2) * 0.62 : y0 + h - (h >= 2 ? 0 : 0.1);
    const bottom = opts.lift === undefined ? y0 - 1.5 : y0 + opts.lift + k;
    const hy = (top - bottom) / 2;
    // (a body thinner than two cells meshes with folded faces: a part thin in two ways has none, a bug steps
    // over it; a panel thin in one way (a screen) gets a body two cells thick)
    let hx = ball ? (w / 2) * 0.62 : w / 2 - k;
    let hz = ball ? (d / 2) * 0.62 : d / 2 - k;
    if (hy < 0.95 || (hx < 0.95 && hz < 0.95)) return;
    hx = Math.max(1, hx);
    hz = Math.max(1, hz);
    const cy = (top + bottom) / 2;
    // (standing on a top, away from its edges: the body takes over the top's surface, hidden under its sheet, so
    // no sliver of it shows round the part's foot)
    if (opts.lift === undefined && Math.abs(y0 - T) < 0.5 && !ball && footCovered(x, z, w / 2, d / 2, c, sn)) {
      const fx = w / 2 - 0.02;
      const fz = d / 2 - 0.02;
      hideOnSheet(
        () => (shape === 'cylY' ? cylinder(x, cy, z, Math.max(1, Math.min(fx, fz)), hy, 1) : rotatedBox(x, cy, z, Math.max(1, shape === 'soft' ? hx + r * 0.3 : fx), hy, Math.max(1, shape === 'soft' ? hz + r * 0.3 : fz), 1, c, sn)),
        () => rotatedBox(x, T + 0.4, z, w / 2 + 1.1, 1.2, d / 2 + 1.1, 1, c, sn),
      );
    } else if (shape === 'cylY') hide(cylinder(x, cy, z, Math.max(1, Math.min(w, d) / 2 - 0.15), hy, 1));
    else {
      hide(rotatedBox(x, cy, z, hx, hy, hz, 1, c, sn));
      // (clear of the surface it stands on, a boxy part's body is as wide as the part)
      if ((shape === 'box' || shape === 'plate') && h > 3) {
        const ty = y0 + 1.4;
        hide(rotatedBox(x, (ty + top) / 2, z, Math.max(1, w / 2), (top - ty) / 2, Math.max(1, d / 2), 1, c, sn));
      }
    }
  };
  /**
   * A cable along `ctrl`, drawn, with a hidden body so a bug walks over it, never through it: a chain of capsules
   * two cells thick whose tops are the cable's top (sunk in the top it lies on, hanging under it in the air).
   * Over a sheet it takes the top's own surface, so nothing of it shows. Below the tops (hanging down behind the
   * desk) a cable has none: whoever is there is falling.
   */
  const cable = (ctrl: number[], radius: number, color: number): void => {
    const pts = wirePath(ctrl, 8);
    put(feature('wire', ctrl[0], ctrl[1], ctrl[2], { path: [radius, ...pts], color }));
    const drop = 1.05 - radius;
    for (let i = 0; i + 5 < pts.length; i += 3) {
      const [ax, ay, az, bx, by, bz] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]];
      if (Math.min(ay, by) < T) continue;
      const body = (): Shape => capsule(ax, ay - drop, az, bx, by - drop, bz, 1.05);
      if (covered(ax, az, 3) && covered(bx, bz, 3)) hideOnSheet(body, () => capsule(ax, ay + 0.7, az, bx, by + 0.7, bz, 2.1));
      else if (Math.min(ay, by) > T + 3) hide(body());
    }
  };

  /** A plug where a cable ends on a part: a small dark body (x, y, z), along x or z. */
  const plug = (x: number, y: number, z: number, alongX: boolean): void => {
    part(x, y - L(0.45), z, alongX ? L(1.6) : L(0.9), L(0.9), alongX ? L(0.9) : L(1.6), 1, 0, 'box', 0x161617, 0.2, 0.5, { body: false });
    const top = y + L(0.45);
    const hx = Math.max(1, alongX ? L(0.8) : L(0.45));
    const hz = Math.max(1, alongX ? L(0.45) : L(0.8));
    if (covered(x, z, 4)) hideOnSheet(() => boxMinMax(x - hx, top - 2.4, z - hz, x + hx, top, z + hz), () => boxMinMax(x - hx - 1.4, top - 2.4, z - hz - 1.4, x + hx + 1.4, top + 1, z + hz + 1.4));
  };
  /**
   * A studio speaker standing on `bottom` at (x, z), its front turned by (c, sn) (local +z to (-sn, c)): a black
   * box with a rounded front baffle; its drivers, port and badge plate drawn by the render (`speakerFront`).
   */
  const speaker = (x: number, z: number, bottom: number, c: number, sn: number): void => {
    const at = (f: number): [number, number] => [x - sn * f, z + c * f];
    const [bx, bz] = at(-L(0.6));
    part(bx, bottom, bz, L(9.4), L(14), L(10.3), c, sn, 'box', 0x141414, 0.1, 0.55);
    // (the baffle set back by the front skin's depth: the skin (drawn with the front) is the speaker's face)
    const [fx, fz] = at(L(3.85));
    part(fx, bottom, fz, L(9.4), L(14), L(2), c, sn, 'soft', 0x151515, 0.1, 0.5, { body: false });
    // (the body behind the drawn front, up to the front skin's face)
    const [bfx, bfz] = at(L(4.35));
    hide(rotatedBox(bfx, bottom + L(7) - 0.75, bfz, L(4.5), L(7) + 0.75, L(1.35), 1, c, sn));
    // (the front, drawn by the render from the owner's photo: the woofer 55% of the width at 38% of the height,
    // its concave woven cone, rubber roll, dust cap; the tweeter's horn 33% at 80%; both set in grooves; a deep
    // rounded slot port with its lip; a plain badge plate; `radius` carries the map's scale)
    const [ffx, ffz] = at(L(4.85));
    put(feature('speakerFront', ffx, bottom + L(7), ffz, { box: [ffx - L(4.7), bottom, ffz - 0.01, ffx + L(4.7), bottom + L(14), ffz + 0.01], yaw: c === 1 && sn === 0 ? undefined : [c, sn], radius: s }));
  };
  const [mx0, mz0, mx1, mz1] = plan.main;
  /** Where the owner sits, in front of the main top's middle: the speakers turn towards it. */
  const seat: [number, number] = [L(100), mz1 + L(40)];
  /** The turn (cos, sin) that points a part's front (local +z, i.e. (-sin, cos)) from (x, z) at the seat. */
  const towardSeat = (x: number, z: number, aside = 0): [number, number] => {
    const dx = seat[0] + aside - x;
    const dz = seat[1] - z;
    const n = Math.sqrt(dx * dx + dz * dz);
    return [dz / n, -dx / n];
  };
  const [wcx, wcz, wa, wb] = plan.wing;
  /** A point on the wing: `a` along its long side (towards the front left), `b` across it (towards the user). */
  const wing = (a: number, b: number): [number, number] => [wcx - a * C45 + b * C45, wcz + a * C45 + b * C45];
  /** The wing's turn for parts: local +x towards its back right, local +z (the fronts) towards the user. */
  const WC = C45;
  const WS = -C45;
  if (layout) {
    layout.floorY = T;
    layout.inner = [2, T, 2, W - 2, H - 2, D - 2];
  }

  // ---- the desk: two black laminate tops (the wing turned 45°), dusty; its legs down to the room's floor
  // (3 thick: a thinner slab, turned 45°, would mesh with faces folding inwards between the samples)
  add(terrain, boxMinMax(mx0, T - 3, mz0, mx1, T, mz1, 0.4), DESK_BLACK);
  add(terrain, rotatedBox(wcx, T - 1.5, wcz, wa, 1.5, wb, 1, WC, WS, 0.4), DESK_WHITE);
  // (the main top's sheet a little over the wing's, where the wing's corner runs under it: no flicker)
  put(feature('dusty', (mx0 + mx1) / 2, T, (mz0 + mz1) / 2, { box: [mx0 + 0.05, T - 0.4, mz0 + 0.05, mx1 - 0.05, T + 0.07, mz1 - 0.05] }));
  put(feature('dusty', wcx, T, wcz, { box: [wcx - wa + 0.05, T - 0.4, wcz - wb + 0.05, wcx + wa - 0.05, T + 0.02, wcz + wb - 0.05], yaw: [WC, WS], color: 0xd9d9d5, look: 'pale' }));
  put(feature('room', W / 2, F, D / 2, { color: 0x5b5d60 }));
  // (a standing desk: two telescoping columns under the main top, one under the wing, long feet, a beam)
  const midZ = (mz0 + mz1) / 2;
  for (const lx of [mx0 + L(14), mx1 - L(12)]) {
    part(lx, F, midZ, L(5.4), T - 3 - F, L(4), 1, 0, 'box', 0x141415, 0.3, 0.5, { body: false });
    part(lx, F + L(18), midZ, L(6.2), L(8), L(4.8), 1, 0, 'box', 0x111112, 0.3, 0.5, { body: false });
    part(lx, F, midZ, L(6), L(2.4), mz1 - mz0 - L(4), 1, 0, 'box', 0x141415, 0.3, 0.5, { body: false });
  }
  part((mx0 + mx1) / 2 + L(1), T - L(5), midZ, mx1 - mx0 - L(26), L(2), L(3), 1, 0, 'box', 0x141415, 0.3, 0.5, { body: false });
  {
    const [lx, lz] = wing(wa - L(10), 0);
    part(lx, F, lz, L(5.4), T - 3 - F, L(4), WC, WS, 'box', 0x141415, 0.3, 0.5, { body: false });
    part(lx, F, lz, L(6), L(2.4), 2 * wb - L(4), WC, WS, 'box', 0x141415, 0.3, 0.5, { body: false });
  }
  // the height buttons on the front edge, under the top
  const hbx = mx1 - L(10);
  part(hbx, T - L(2.8), mz1 + L(0.6), L(9), L(2.6), L(1.4), 1, 0, 'box', 0x1a1a1b, 0, 0.5, { body: false });
  for (let k = 0; k < 5; k++) {
    part(hbx - L(3.2) + k * L(1.6), T - L(1.9), mz1 + L(1.35), L(1.1), L(0.9), L(0.14), 1, 0, 'box', 0x2a2a2c, 0, 0.5, { body: false });
    part(hbx - L(3.2) + k * L(1.6), T - L(1.5), mz1 + L(1.44), L(0.45), L(0.08), L(0.03), 1, 0, 'plate', 0x8d8d8a, 0, 0.5, { body: false });
  }

  // ---- the monitors: the wing's (white, on its stand, showing this game), and two on a dual arm (one arm each, from one base with two posts)
  const monitor = (x: number, z: number, bottom: number, w: number, h: number, c: number, sn: number, bezel: number, look: 'game' | 'editor' | 'desert' | 'movie' | 'desktop' | 'off', chin = 0, trim = 0): void => {
    // (curved: the render draws the panel bent round a radius of 1.7 widths, concave towards the user; its hidden
    // body: slabs two cells thick along the same curve, right behind the panel, and the housing on its back)
    const yaw: [number, number] | undefined = c === 1 && sn === 0 ? undefined : [c, sn];
    put(feature('screen', x, bottom + h / 2, z, { box: [x - w / 2 + 0.7, bottom + 0.7, z - 0.02, x + w / 2 - 0.7, bottom + h - 0.7, z + 0.02], radius: w * 1.7, color: bezel, yaw, look, chin, trim }));
    const R = w * 1.7;
    const SLABS = 9;
    const half = w / 2 / R;
    for (let k = 0; k < SLABS; k++) {
      // (the slab's angle on the arc; its sine and cosine from their series: at most 0.3)
      const a = half * ((2 * k + 1) / SLABS - 1);
      const sa = a - (a * a * a) / 6 + (a * a * a * a * a) / 120;
      const ca = 1 - (a * a) / 2 + (a * a * a * a) / 24;
      const lx = R * sa + sa * 1.05;
      const lz = R - R * ca - ca * 1.05;
      hide(rotatedBox(x + lx * c - lz * sn, bottom + h / 2, z + lx * sn + lz * c, w / SLABS / 2 + 0.4, h / 2, 1, 1, c * ca - sn * sa, sn * ca + c * sa));
    }
    hide(rotatedBox(x + sn * L(1.2), bottom + h * 0.5, z - c * L(1.2), w * 0.275, h * 0.28, Math.max(1, L(1.2)), 1, c, sn));
    part(x + sn * L(1.8), bottom + h * 0.22, z - c * L(1.8), w * 0.55, h * 0.56, L(1.2), c, sn, 'box', 0x1b1b1d, 0.1, 0.5, { body: false });
  };
  const [am, mm, rm] = plan.monitors;
  // (the wing's monitor: white bezel and stand; its yaw puts the front towards the user)
  monitor(am[0], am[1], am[2] + L(0.8), am[3], am[4] - L(0.8), WC, WS, 0xe6e4dc, 'game', L(0.8));
  {
    // (behind the screen, along local -z = (sin, -cos): the neck; under it, the base, reaching forward)
    const back = (dist: number): [number, number] => [am[0] + WS * dist, am[1] - WC * dist];
    const [nx, nz] = back(L(2.6));
    part(nx, T, nz, L(3), am[2] - T + am[4] * 0.4, L(1.6), WC, WS, 'box', 0xe6e4dc, 0.1, 0.4);
    const [fbx, fbz] = back(L(0.4));
    part(fbx, T, fbz, L(13), L(0.8), L(8), WC, WS, 'box', 0xe6e4dc, 0.1, 0.4);
  }
  monitor(mm[0], mm[1], mm[2], mm[3], mm[4], 1, 0, 0x151517, 'movie', 0, 0xa11d18);
  monitor(rm[0], rm[1], rm[2], rm[3], rm[4], 1, 0, 0x101012, 'editor');
  // the monitor arm, as in the owner's photo: a glossy black base standing on the desk behind the laptops, two
  // short posts side by side on it, each with a collar; from each post's top a wide flat gas-spring arm rises
  // straight to a tilt hub on a plate at its monitor's back
  const px = mm[0] + (rm[0] - mm[0]) * 0.3;
  const pz = mz0 + L(4);
  part(px, T, pz, L(13), L(1.8), L(7), 1, 0, 'soft', 0x0e0e10, 0.35, 0.18);
  [mm, rm].forEach((m, i) => {
    const qx = px + L(i === 0 ? -3.6 : 3.6);
    const qy = T + L(8.5);
    part(qx, T + L(1.6), pz, L(3), qy - T - L(1.6), L(3), 1, 0, 'cylY', 0x0e0e10, 0.35, 0.15);
    part(qx, T + L(5.7), pz, L(3.25), L(0.2), L(3.25), 1, 0, 'cylY', 0x2c2c30, 0.4, 0.3, { body: false });
    part(qx, T + L(1.75), pz, L(4.2), L(0.3), L(4.2), 1, 0, 'cylY', 0x0a0a0b, 0.2, 0.15, { body: false });
    part(qx, T + L(2.05), pz, L(3.5), L(0.3), L(3.5), 1, 0, 'cylY', 0x8f9399, 1, 0.2, { body: false });
    part(qx, qy - L(0.5), pz, L(3.4), L(1.1), L(3.4), 1, 0, 'cylY', 0x101012, 0.35, 0.2, { body: false });
    // (the arm: a flat box from the post's top to the hub; turned about the vertical towards it, tilted up)
    const ax = m[0];
    const ay = m[2] + m[4] * 0.42;
    const tz = m[1] - L(4.3);
    const dx = ax - qx;
    const dy = ay - qy;
    const dz = tz - pz;
    const hl = Math.sqrt(dx * dx + dz * dz);
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cx = (qx + ax) / 2;
    const cy = (qy + ay) / 2;
    const cz = (pz + tz) / 2;
    put(feature('part', cx, cy, cz, { shape: 'soft', box: [cx - L(0.8), cy - L(1.5), cz - len / 2, cx + L(0.8), cy + L(1.5), cz + len / 2], yaw: [dz / hl, -dx / hl], path: [hl / len, -dy / len], color: 0x0e0e10, metal: 0.35, rough: 0.15 }));
    // (its body: three capsules over the beam's height, and the hub up to the monitor's housing)
    for (const o of [-0.8, 0, 0.8]) {
      const ox = L(o) * ((-dx * dy) / (hl * len));
      const oy = L(o) * (hl / len);
      const oz = L(o) * ((-dz * dy) / (hl * len));
      hide(capsule(qx + ox, qy + oy, pz + oz, ax + ox, ay + oy, tz + oz, Math.max(1.05, L(0.75))));
    }
    hide(boxMinMax(ax - L(1.4), ay - L(1.4), tz - L(1.2), ax + L(1.4), ay + L(1.4), m[1] - L(1.8)));
    hide(boxMinMax(ax - L(3), m[2] + m[4] * 0.5 - L(3), m[1] - L(3.2), ax + L(3), m[2] + m[4] * 0.5 + L(3), m[1] - L(1.8)));
    part(ax, ay - L(1.5), tz, L(3), L(3), L(2.4), 1, 0, 'cylZ', 0x141416, 0.4, 0.3, { body: false });
    part(ax, m[2] + m[4] * 0.5 - L(3), m[1] - L(2.8), L(6), L(6), L(0.8), 1, 0, 'plate', 0x3a3a3e, 0.6, 0.4, { body: false });
    // (its cable from the monitor's back, slack beside the arm, onto the desk behind the base, over the edge)
    const sx = qx + L(i === 0 ? -3 : 3);
    cable([ax + L(i === 0 ? -1.5 : 1.5), ay - L(2), tz - L(0.8), (sx + ax) / 2, (qy + ay) / 2 - L(3), (pz + tz) / 2 - L(1.5), sx, T + 0.3, pz - L(4), sx, T + 0.25, mz0 + 0.15, sx, T - L(1.2), mz0 - L(0.45), sx, T - L(4), mz0 - L(0.65), sx, T - L(8), mz0 - L(0.75), sx, T - L(12), mz0 - L(0.8), sx, T - L(16), mz0 - L(0.8)], 0.32, 0x121212);
  });

  // ---- the wing: a mechanical keyboard with its wrist rest, a beer bottle
  const [kx, kz] = wing(L(-1), L(3));
  const [mtx, mtz] = wing(L(-1), L(5.5));
  part(mtx, T, mtz, L(34), L(0.15), L(18), WC, WS, 'plate', 0x0e0e0f, 0, 0.95, { body: false });
  part(kx, T, kz, L(27.6), L(1.6), L(8.4), WC, WS, 'box', 0x141416, 0.1, 0.55);
  plug(kx + L(13.2) * C45, T + L(0.9), kz - L(13.2) * C45 + L(0.2), true);
  keyboard(feature('keyboard', kx, T + L(1.6), kz, { box: [kx - L(13.5), T, kz - L(3.9), kx + L(13.5), T + L(1.6), kz + L(3.9)], color: 0x1b1c20, yaw: [WC, WS], radius: L(0.8), glow: 0.6, look: 'full' }));
  const [rx, rz] = wing(L(-1), L(10));
  part(rx, T, rz, L(27.6), L(1.4), L(4.6), WC, WS, 'soft', 0x0f0f10, 0, 0.7);
  cable([kx + L(8) * C45, T + L(0.8), kz - L(8) * C45, kx + L(14) * C45, T + 0.3, kz - L(14) * C45, mx0 + L(4), T + 0.3, mz0 + L(10), mx0 + L(10), T + 0.3, mz0 + L(4)], 0.3, 0x131313);
  // the beer bottle on a plain coaster: brown glass, a tall body, a sloping shoulder, a long neck, an open ringed lip
  const [bx, bz] = wing(L(21.5), L(-3));
  part(bx, T, bz, L(6), L(0.3), L(6), WC, WS, 'soft', 0x4f6478, 0, 0.8, { body: false });
  const by = T + L(0.3);
  put(feature('bottle', bx, by, bz, { box: [bx - L(1.95), by, bz - L(1.95), bx + L(1.95), by + L(12.55), bz + L(1.95)], color: 0x4a2608 }));
  // (its body: the lathed profile in three: body, shoulder, neck)
  const bh = L(12.55);
  hideOnSheet(() => rotatedBox(bx, T - 0.6, bz, L(3), 0.6 + L(0.3), L(3), 1, WC, WS), () => rotatedBox(bx, T, bz, L(3) + 1.4, 1, L(3) + 1.4, 1, WC, WS));
  hide(cylinder(bx, by + bh * 0.26 - 0.75, bz, Math.max(1, L(1.9)), bh * 0.26 + 0.75, 1));
  hide(cone(bx, by + bh * 0.5, bz, Math.max(1, L(1.9)), by + bh * 0.73, Math.max(1, L(0.84))));
  hide(cylinder(bx, by + bh * 0.83, bz, Math.max(1, L(0.84)), bh * 0.17, 1));

  // the left speaker on its riser at the wing's back left: a whitewashed wooden stand, open in front, a dark
  // speckled felt pad on it, the speaker turned towards the seat (a little to the right of it)
  {
    const ra = L(17);
    const rb = L(-13.5);
    const rw = L(15);
    const rd = L(13);
    const rh = L(5.4);
    const [rx, rz] = wing(ra, rb);
    const wood = (x: number, y0: number, z: number, w: number, h: number, d: number, color: number): void => {
      put(feature('dusty', x, y0 + h / 2, z, { box: [x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2], yaw: [WC, WS], color, look: 'wood' }));
    };
    wood(rx, T + rh, rz, rw, L(1.4), rd, 0xd8d6d0);
    hide(rotatedBox(rx, T + rh + L(0.7), rz, rw / 2 - 0.3, Math.max(1, L(0.7)), rd / 2 - 0.3, 1, WC, WS));
    for (const side of [-1, 1]) {
      // (the sides along the wing's depth, at the stand's two ends along its length)
      const [sx, sz] = wing(ra + side * (rw / 2 - L(0.8)), rb);
      wood(sx, T, sz, L(1.6), rh, rd, 0xd2d0ca);
      const side0 = (): Shape => rotatedBox(sx, T + (rh - 1.5) / 2, sz, Math.max(1, L(0.8) - 0.02), (rh + 1.5) / 2, rd / 2 - 0.02, 1, WC, WS);
      if (footCovered(sx, sz, L(0.8), rd / 2, WC, WS)) hideOnSheet(side0, () => rotatedBox(sx, T + 0.4, sz, L(0.8) + 1.1, 1.2, rd / 2 + 1.1, 1, WC, WS));
      else hide(side0());
    }
    put(feature('dusty', rx, T + rh + L(1.4), rz, { box: [rx - rw / 2 + L(0.2), T + rh + L(1.4) - 0.05, rz - rd / 2 + L(0.2), rx + rw / 2 - L(0.2), T + rh + L(1.4) + L(0.7), rz + rd / 2 - L(0.2)], yaw: [WC, WS], color: 0x3b3b3c, look: 'felt' }));
    const [kx2, kz2] = wing(ra + L(2), rb);
    const [lc, ls] = towardSeat(kx2, kz2, L(12));
    speaker(kx2, kz2, T + rh + L(2.1), lc, ls);
    // (its cable from the back, down behind the stand and off the wing's back edge)
    const [c0x, c0z] = [kx2 + ls * L(5.8), kz2 - lc * L(5.8)];
    const [c1x, c1z] = wing(ra - L(2), rb - L(6.6));
    const [c2x, c2z] = wing(ra - L(3.5), -wb + 0.15);
    const [c3x, c3z] = wing(ra - L(3.5), -wb - L(0.45));
    const [c4x, c4z] = wing(ra - L(3.5), -wb - L(0.8));
    // (even steps down: a long last step would make the curve bulge up over the edge)
    cable([c0x, T + rh + L(5), c0z, c1x, T + 0.3, c1z, c2x, T + 0.25, c2z, c3x, T - L(1.2), c3z, c4x, T - L(4), c4z, c4x, T - L(8), c4z, c4x, T - L(12), c4z, c4x, T - L(16), c4z], 0.32, 0x131313);
  }

  // the red audio interface on the white table, back under the white monitor's right part, beside its stand,
  // turned with the table: an anodised red body, a black front panel; input 1 and 2 each a chrome combo jack and a
  // gain knob (a pointer, a skirt, a green halo on the panel) with a small toggle lever; the big brushed monitor
  // knob in a dark ring; a green light; a headphone jack. (local x: along its width; local z: out of its front)
  {
    const [icx, icz] = wing(L(-15), L(-10));
    const at = (ox: number, oz: number): [number, number] => [icx + ox * WC - oz * WS, icz + ox * WS + oz * WC];
    const fp = (ox: number, y0: number, oz: number, w: number, h: number, d: number, shape: PartShape, color: number, metal: number, rough: number, glow = 0): void => {
      const [px2, pz2] = at(L(ox), oz);
      part(px2, y0, pz2, w, h, d, WC, WS, shape, color, metal, rough, { body: false, glow });
    };
    part(icx, T, icz, L(11), L(2.6), L(5.4), WC, WS, 'box', 0xa3262a, 0.25, 0.5);
    const fy = T + L(0.2);
    const fz = L(2.7);
    fp(0, fy, fz + 0.05, L(10.4), L(2.2), 0.12, 'plate', 0x0c0c0d, 0.2, 0.5);
    for (const [jx, kx] of [[-4.35, -2.65], [-0.95, 0.75]] as const) {
      fp(jx, fy + L(0.4), fz + 0.1, L(1.4), L(1.4), 0.3, 'cylZ', 0xd3d6da, 1, 0.2);
      fp(jx, fy + L(0.5), fz + 0.2, L(1.2), L(1.2), 0.2, 'cylZ', 0x0a0a0b, 0.1, 0.7);
      fp(jx, fy + L(0.87), fz + 0.25, L(0.46), L(0.46), 0.2, 'cylZ', 0x7c8085, 0.9, 0.3);
      fp(jx, fy + L(0.94), fz + 0.3, L(0.32), L(0.32), 0.2, 'cylZ', 0x010101, 0, 1);
      for (const [px2, py2] of [[-0.36, 0.95], [0.36, 0.95], [0, 0.58]] as const) fp(jx + px2, fy + L(py2), fz + 0.25, L(0.15), L(0.15), 0.2, 'cylZ', 0x020202, 0, 1);
      fp(kx, fy + L(0.82), fz + 0.1, L(1.35), L(1.35), 0.12, 'cylZ', 0x39d36a, 0, 0.4, 0.8);
      fp(kx, fy + L(0.87), fz + 0.14, L(1.25), L(1.25), L(0.16), 'cylZ', 0x111113, 0.2, 0.5);
      fp(kx, fy + L(0.97), fz + 0.12, L(1.05), L(1.05), L(0.8), 'cylZ', 0x1a1a1c, 0.2, 0.55);
      fp(kx, fy + L(1.34), fz + L(0.82), L(0.08), L(0.38), 0.03, 'plate', 0xe8e6e0, 0, 0.6);
      fp(kx, fy + L(0.02), fz + 0.1, L(0.6), L(0.6), 0.15, 'cylZ', 0xc9ccd0, 0.95, 0.3);
      fp(kx, fy + L(0.22), fz + 0.1, L(0.2), L(0.2), L(0.8), 'cylZ', 0xc9ccd0, 0.95, 0.25);
    }
    fp(2.75, fy + L(0.12), fz + 0.1, L(1.95), L(1.95), 0.3, 'cylZ', 0x050506, 0.2, 0.6);
    fp(2.75, fy + L(0.27), fz + 0.2, L(1.65), L(1.65), L(0.9), 'cylZ', 0xc5c8cc, 0.9, 0.3);
    fp(2.75, fy + L(0.545), fz + 0.2 + L(0.45) + 0.01, L(1.1), L(1.1), 0.02, 'cylZ', 0xb3b7bb, 0.9, 0.4);
    fp(4.5, fy + L(1.55), fz + 0.1, L(0.25), L(0.25), 0.15, 'ball', 0x39e36a, 0, 0.3, 2);
    fp(4.5, fy + L(0.2), fz + 0.1, L(1.2), L(1.2), 0.35, 'cylZ', 0xc0c3c7, 1, 0.3);
    fp(4.5, fy + L(0.35), fz + 0.2, L(0.9), L(0.9), 0.3, 'cylZ', 0xa7abb0, 1, 0.35);
    fp(4.5, fy + L(0.45), fz + 0.3, L(0.7), L(0.7), 0.2, 'cylZ', 0x020202, 0, 1);
    // (its cable from the back, straight back and off the table's back edge)
    const [b0x, b0z] = at(L(4), -L(3.2));
    const [b1x, b1z] = wing(L(-19), L(-16));
    const [b2x, b2z] = wing(L(-19), -wb + 0.15);
    const [b3x, b3z] = wing(L(-19), -wb - L(0.45));
    const [b4x, b4z] = wing(L(-19), -wb - L(0.8));
    plug(b0x, T + L(1.2), b0z, false);
    cable([b0x, T + L(1), b0z, b1x, T + 0.3, b1z, b2x, T + 0.25, b2z, b3x, T - L(1.2), b3z, b4x, T - L(4), b4z, b4x, T - L(8), b4z, b4x, T - L(12), b4z, b4x, T - L(16), b4z], 0.3, 0x131313);
  }

  // ---- the main top, left to right
  // a phone charger stand: a base and a leaning back with a charging pad
  const cx = mx0 + L(9);
  const cz = mz0 + L(22);
  part(cx, T, cz, L(4.4), L(0.8), L(4), 1, 0, 'box', 0x1a1a1c, 0.1, 0.5);
  put(feature('part', cx, T + L(3.8), cz - L(0.9), { shape: 'box', box: [cx - L(2.1), T + L(0.6), cz - L(1.3), cx + L(2.1), T + L(7), cz - L(0.5)], path: [0.9659, -0.2588], color: 0x1d1d20, metal: 0.1, rough: 0.5 }));
  hideOnSheet(() => rotatedBox(cx, T + L(3.8), cz - L(1.2), L(2), L(3.1), 1, 0, 0.9659, -0.2588), () => boxMinMax(cx - L(2.1) - 1.2, T - 0.8, cz - L(6), cx + L(2.1) + 1.2, T + 1.6, cz + 1));
  put(feature('part', cx, T + L(4.4), cz - L(0.64), { shape: 'cylZ', box: [cx - L(1.3), T + L(3.1), cz - L(0.67), cx + L(1.3), T + L(5.7), cz - L(0.61)], path: [0.9659, -0.2588], color: 0x2c2c2c, metal: 0.2, rough: 0.6 }));
  cable([cx, T + L(1), cz - L(2), cx + L(2), T + 0.3, mz0 + L(6), cx + L(6), T + 0.3, mz0 + L(1)], 0.28, 0xe6e4dc);
  // two docks behind the laptops
  part(mx0 + L(18.5), T, mz0 + L(3), L(8), L(1.6), L(5), 1, 0, 'box', 0x161618, 0.2, 0.5);
  part(mx0 + L(50), T, mz0 + L(8), L(6), L(1.3), L(4), 1, 0, 'box', 0x1b1b1d, 0.2, 0.5);
  // the laptops: a silver one on a riser under the middle monitor, a black one under the right
  const laptop = (x: number, z: number, y0: number, color: number, keys: number, look: 'desert' | 'desktop' | 'off', trackpoint: boolean): void => {
    const w = L(17);
    const d = L(11.6);
    part(x, y0, z, w, L(1.1), d, 1, 0, 'box', color, color === 0xb5b9bd ? 0.78 : 0.3, 0.36);
    keyboard(feature('keyboard', x, y0 + L(1.1), z - L(1.4), { box: [x - L(7.4), y0, z - L(4.6), x + L(7.4), y0 + L(1.1), z + L(1.6)], color: keys, radius: L(0.15), look: 'laptop' }));
    part(x, y0 + L(1.08), z + L(3.8), L(6), L(0.06), L(3), 1, 0, 'plate', color === 0x1a1b1d ? 0x202124 : 0xb9bcc0, 0.4, 0.4, { body: false });
    if (trackpoint) {
      part(x - L(0.74), y0 + L(1.05), z - L(0.58), L(0.45), L(0.18), L(0.45), 1, 0, 'cylY', 0xb81d17, 0, 0.95, { body: false });
      part(x - L(0.74), y0 + L(1.23), z - L(0.58), L(0.45), L(0.1), L(0.45), 1, 0, 'dome', 0xb81d17, 0, 0.95, { body: false });
      for (const [dx, bw] of [[-2.35, 2], [0, 1.25], [2.35, 2]] as const) part(x + L(dx), y0 + L(1.08), z + L(2.2), L(bw), L(0.06), L(0.6), 1, 0, 'plate', 0x18191b, 0, 0.6, { body: false });
      for (const dx of [-0.6, 0.6]) part(x + L(dx), y0 + L(1.12), z + L(2.2), L(0.075), L(0.04), L(0.6), 1, 0, 'plate', 0xc8201a, 0, 0.5, { body: false });
    }
    // the lid, open about 110°: leaning back by 20° from upright, hinged at the deck's back
    const lc = 0.9397;
    const ls = -0.342;
    const len = L(11);
    const hy = y0 + L(1.1);
    const hz = z - d / 2 + L(0.4);
    const lyc = hy + (len / 2) * lc;
    const lzc = hz + (len / 2) * ls;
    put(feature('part', x, lyc, lzc, { shape: 'box', box: [x - w / 2, lyc - len / 2, lzc - L(0.35), x + w / 2, lyc + len / 2, lzc + L(0.35)], path: [lc, ls], color, metal: color === 0xb5b9bd ? 0.78 : 0.3, rough: 0.36 }));
    // (the lid's body is two cells thick, set back behind its screen)
    hide(rotatedBox(x, lyc + 0.28 * ls, lzc - 0.28 * lc, w / 2 - 0.2, len / 2 - 0.2, 1, 0, lc, ls));
    const fy = lyc - L(0.37) * ls;
    const fz = lzc + L(0.37) * lc;
    const by0 = lyc - (L(0.35) + 0.05) * ls;
    const bz0 = lzc + (L(0.35) + 0.05) * lc;
    put(feature('part', x, by0, bz0, { shape: 'plate', box: [x - w / 2 + L(0.08), by0 - len / 2 + L(0.08), bz0 - 0.01, x + w / 2 - L(0.08), by0 + len / 2 - L(0.08), bz0 + 0.01], path: [lc, ls], color: 0x070707, metal: 0, rough: 0.9 }));
    put(feature('screen', x, fy, fz, { box: [x - w / 2 + L(0.8), fy - len / 2 + L(1.2), fz - L(0.02), x + w / 2 - L(0.8), fy + len / 2 - L(0.6), fz + L(0.02)], path: [lc, ls], look }));
  };
  part(mm[0], T, mz0 + L(19), L(17), L(1.6), L(10), 1, 0, 'box', 0x141416, 0.2, 0.5);
  laptop(mm[0], mz0 + L(19), T + L(1.6), 0xb5b9bd, 0x2a2b2e, 'desktop', false);
  laptop(rm[0], mz0 + L(19), T, 0x1a1b1d, 0x18191b, 'desert', true);
  plug(mm[0] - L(8.9), T + L(2.2), mz0 + L(17), true);
  plug(rm[0] - L(8.9), T + L(0.6), mz0 + L(17), true);
  cable([mx0 + L(17.5), T + L(0.8), mz0 + L(1.2), mx0 + L(17.1), T + 0.3, mz0 + L(0.4), mx0 + L(16.7), T + 0.25, mz0 + 0.15, mx0 + L(16.7), T - L(1.2), mz0 - L(0.45), mx0 + L(16.7), T - L(4), mz0 - L(0.65), mx0 + L(16.7), T - L(8), mz0 - L(0.75), mx0 + L(16.7), T - L(12), mz0 - L(0.8), mx0 + L(16.7), T - L(16), mz0 - L(0.8)], 0.3, 0x131313);
  plug(mx0 + L(50.6), T + L(0.45), mz0 + L(5.1), false);
  cable([mx0 + L(50.6), T + L(0.3), mz0 + L(4.2), mx0 + L(50.9), T + 0.3, mz0 + L(3), mx0 + L(51.2), T + 0.3, mz0 + L(0.8), mx0 + L(51.4), T + 0.25, mz0 + 0.15, mx0 + L(51.4), T - L(1.2), mz0 - L(0.45), mx0 + L(51.4), T - L(4), mz0 - L(0.65), mx0 + L(51.4), T - L(8), mz0 - L(0.75), mx0 + L(51.4), T - L(12), mz0 - L(0.8), mx0 + L(51.4), T - L(16), mz0 - L(0.8)], 0.28, 0x2a2b2e);
  cable([mx0 + L(22.5), T + L(0.8), mz0 + L(3), mx0 + L(24), T + 0.3, mz0 + L(9.5), mx0 + L(42), T + 0.3, mz0 + L(10), mx0 + L(46), T + 0.3, mz0 + L(8)], 0.3, 0x131313);
  cable([mx0 + L(14.5), T + L(0.8), mz0 + L(2.5), mx0 + L(13), T + 0.3, mz0 + L(1.6), mx0 + L(12.5), T + 0.25, mz0 + 0.15, mx0 + L(12.5), T - L(1.2), mz0 - L(0.45), mx0 + L(12.5), T - L(4), mz0 - L(0.65), mx0 + L(12.5), T - L(8), mz0 - L(0.75), mx0 + L(12.5), T - L(12), mz0 - L(0.8), mx0 + L(12.5), T - L(16), mz0 - L(0.8)], 0.3, 0x131313);
  cable([mm[0] - L(8.5), T + L(2.2), mz0 + L(17), mm[0] - L(12), T + 0.3, mz0 + L(12), mx0 + L(18.5), T + 0.3, mz0 + L(5.8)], 0.3, 0x131313);
  cable([rm[0] - L(8.5), T + L(0.6), mz0 + L(17), rm[0] - L(14), T + 0.3, mz0 + L(10), mx0 + L(50), T + 0.3, mz0 + L(10)], 0.3, 0x131313);
  // the slim keyboard in front of the middle laptop
  const sk = mz0 + L(37);
  part(mm[0], T, sk, L(29.4), L(1), L(6.8), 1, 0, 'box', 0x3c3d40, 0.2, 0.5);
  keyboard(feature('keyboard', mm[0], T + L(1), sk, { box: [mm[0] - L(14.2), T, sk - L(3.1), mm[0] + L(14.2), T + L(1), sk + L(3.1)], color: 0x26272a, radius: L(0.45), look: 'full' }));
  // the desk mat, the vertical mice (one with its RGB ring), and the small things
  const matX0 = rm[0] - L(16);
  part((matX0 + mx1 - L(2)) / 2, T, mz0 + L(34), mx1 - L(2) - matX0, L(0.15), L(18), 1, 0, 'plate', 0x0f0f10, 0, 0.95, { body: false });
  const mouse = (x: number, z: number, k: number, ring: boolean): void => {
    // (one hull, a fin: drawn by the render from its box, with its wheel, and the RGB one's strip)
    const len = L(7 * k);
    const wide = L((ring ? 4.2 : 4.6) * k);
    const tall = L(4.6 * k);
    put(feature('mouse', x, T, z, { box: [x - wide / 2, T, z - len / 2, x + wide / 2, T + tall, z + len / 2], color: ring ? 0x161618 : 0x1c1c1e, glow: ring ? 1.4 : 0 }));
    // (its body: balls along the hull, slice by slice, three high: the render's hull, narrowing to its ridge and
    // leaning right)
    for (const vz of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]) {
      const u = (1 - vz) / 2;
      const slice = Math.sqrt(1 - vz * vz);
      const ridge = tall * Math.min(1, 0.55 + 0.75 * u) * Math.min(1, slice * 1.2);
      for (const t of [0.12, 0.42, 0.72]) {
        const half = (wide / 2) * (1 - (ring ? 0.62 : 0.5) * t) * (1 - (ring ? 0.3 : 0.18) * u) * slice;
        const r = Math.max(1, Math.min(half, ridge * 0.42));
        for (const o of [-1, 1]) {
          const ball = (): Shape => sphere(x + ridge * t * 0.32 + o * Math.max(0, half - r), T + Math.min(ridge * t, ridge - r), z + vz * (len / 2), r);
          if (footCovered(x, z, wide / 2, len / 2, 1, 0)) add(terrain, ball(), COLLIDER);
          else hide(ball());
        }
      }
    }
    if (footCovered(x, z, wide / 2, len / 2, 1, 0)) paint(terrain, boxMinMax(x - wide / 2 - 1.2, T - 0.8, z - len / 2 - 1.2, x + wide / 2 + 1.2, T + 1.6, z + len / 2 + 1.2), COLLIDER);
    if (ring) {
      // (its braided cable: a strain relief out of the front top, then over the mat to the back edge)
      const cx0 = x + L(1.3 * k);
      const cy0 = T + L(3.9 * k);
      const cz0 = z - L(2.6 * k);
      cable([cx0, cy0, cz0, cx0, cy0 - L(0.5), cz0 - L(1.1), cx0, cy0 - L(1), cz0 - L(1.8)], 0.42, 0x141416);
      cable([cx0, cy0 - L(1), cz0 - L(1.8), cx0, cy0 - L(2), cz0 - L(3), cx0 - L(1), T + 0.3, cz0 - L(6), x - L(5), T + 0.3, mz0 + L(12), x - L(6), T + 0.3, mz0 + L(4), x - L(6.2), T + 0.25, mz0 + 0.15, x - L(6.2), T - L(1.2), mz0 - L(0.45), x - L(6.2), T - L(4), mz0 - L(0.65), x - L(6.2), T - L(8), mz0 - L(0.75), x - L(6.2), T - L(12), mz0 - L(0.8), x - L(6.2), T - L(16), mz0 - L(0.8)], 0.25, 0x1a1a1c);
    }
  };
  // (the RGB one at the mat's front left, the other in front of the black laptop)
  mouse(rm[0] - L(8 + rand(-0.6, 0.6)), mz0 + L(38 + rand(-0.6, 0.6)), 1, true);
  mouse(rm[0] + L(2 + rand(-0.6, 0.6)), mz0 + L(31 + rand(-0.6, 0.6)), 0.85, false);
  // (a thick clamshell, about 0.7 as tall as wide: its widest at mid-height, where the seam runs, rounded down to
  // the desk)
  part(mx1 - L(6.4), T - L(0.9), mz0 + L(21.5), L(10.5), L(3.6), L(3.5), 1, 0, 'ball', 0x1a1a1c, 0.05, 0.85, { body: false });
  for (let k = -5; k <= 5; k++) {
    const u = k * 0.16;
    add(terrain, sphere(mx1 - L(6.4) + u * L(5.25), T + L(0.9), mz0 + L(21.5), Math.max(1, L(1.72) * Math.sqrt(1 - u * u))), COLLIDER);
  }
  // (it lies near the top's right end: its skirt stops short of the edge)
  paint(terrain, boxMinMax(mx1 - L(6.4) - L(5.25), T - 0.8, mz0 + L(21.5) - L(1.75) - 1, Math.min(mx1 - 1.2, mx1 - L(6.4) + L(5.25)), T + 1.6, mz0 + L(21.5) + L(1.75) + 1), COLLIDER);
  part(mx1 - L(6.4), T + L(0.86), mz0 + L(21.5), L(10.54), L(0.08), L(3.54), 1, 0, 'ball', 0x3a3a3c, 0, 0.7, { body: false });
  part(rm[0] + L(16), T, mz0 + L(10), L(5.8), L(1.2), L(4.7), 1, 0, 'box', 0x1c1c1e, 0.1, 0.75);
  part(rm[0] + L(16), T + L(0.6), mz0 + L(10), L(5.85), L(0.08), L(4.75), 1, 0, 'plate', 0x2b2b2d, 0.1, 0.8, { body: false });
  const remX = rm[0] + L(16);
  const remZ = mz0 + L(29);
  part(remX, T + L(0.15), remZ, L(9), L(1.1), L(2.7), 1, 0, 'box', 0xf0efea, 0, 0.5);
  part(remX - L(2.6), T + L(1.25), remZ, L(2.8), L(0.03), L(2.15), 1, 0, 'plate', 0x3a3c3a, 0, 0.6, { body: false });
  part(remX - L(2.6), T + L(1.26), remZ, L(2.3), L(0.03), L(1.7), 1, 0, 'plate', 0x9aa79a, 0, 0.3, { body: false });
  part(remX + L(3.8), T + L(1.25), remZ - L(0.6), L(0.75), L(0.22), L(0.75), 1, 0, 'dome', 0xe0582c, 0, 0.6, { body: false });
  for (const [ox, oz] of [[-0.6, -0.55], [-0.6, 0.55], [3.8, 0.55]] as const) part(remX + L(ox), T + L(1.25), remZ + L(oz), L(0.85), L(0.14), L(0.4), 1, 0, 'soft', 0xb4b6b4, 0, 0.6, { body: false });
  for (let k = 0; k < 6; k++) part(remX + L(0.4) + (k % 3) * L(1.2), T + L(1.25), remZ - L(0.6) + Math.floor(k / 3) * L(1.2), L(0.7), L(0.2), L(0.7), 1, 0, 'dome', k === 1 ? 0x4cae4c : k === 4 ? 0xe0b22c : 0xdedcd4, 0, 0.5, { body: false });
  // a medicine box and a tobacco pouch: plain, no text
  const bxx = rm[0] + L(13.5);
  const bzz = mz0 + L(15);
  part(bxx, T, bzz, L(7), L(2.2), L(3.2), 1, 0, 'plate', 0xf3f2ee, 0, 0.6);
  for (const e of [-1, 1]) part(bxx + e * (L(3.5) + 0.01), T + L(1.85), bzz, 0.03, L(0.05), L(3), 1, 0, 'plate', 0xbdbab2, 0, 0.8, { body: false });
  part(bxx + L(2.8), T + L(1.2), bzz + L(1.62), L(0.9), L(0.5), L(0.04), 1, 0, 'plate', 0xc8261e, 0, 0.5, { body: false });
  // (the pouch: crumpled khaki foil, drawn by the render, flat across the box's right half, a short tight twist
  // at its end)
  const pcx = bxx + L(1.4);
  const pcz = bzz + L(0.2);
  const ptop = T + L(2.2);
  put(feature('foil', pcx, ptop + L(0.35), pcz, { box: [pcx - L(2.4), ptop, pcz - L(1.65), pcx + L(2.4), ptop + L(0.7), pcz + L(1.65)], color: 0xb9a46c, radius: L(1) }));
  hide(boxMinMax(pcx - L(2.2), ptop - 1.5, pcz - L(1.45), pcx + L(2.2), ptop + L(0.3), pcz + L(1.45)));
  hide(boxMinMax(pcx - L(1.5), ptop - 1.5, pcz - L(0.8), pcx + L(1.5), ptop + L(0.62), pcz + L(0.8)));

  // a loose cable lying across the middle, and the mat's front
  plug(mm[0] + L(13.2), T + 0.75, mz0 + L(30.3), true);
  plug(rm[0] - L(9.2), T + 0.75, mz0 + L(28.8), true);
  // (its middle lies a little differently on every seed)
  cable([mm[0] + L(14), T + 0.3, mz0 + L(30), mm[0] + L(20), T + 0.3, mz0 + L(27 + rand(-1.5, 1.5)), rm[0] - L(16), T + 0.3, mz0 + L(31 + rand(-1.5, 1.5)), rm[0] - L(10), T + 0.3, mz0 + L(29)], 0.28, 0x2a2b2e);

  // ---- the speaker on its felt shelf, right of the desk: a black box, a yellow woofer, a tweeter
  const [sx0, sz0, sx1, sz1, sTop] = plan.shelf;
  add(terrain, boxMinMax(sx0, sTop - 3, sz0, sx1, sTop, sz1, 0.4), SLEEVE);
  // (as in the owner's photo: whitewashed wood under a dark grey foam pad)
  put(feature('dusty', (sx0 + sx1) / 2, sTop - 1.9, (sz0 + sz1) / 2, { box: [sx0 - 0.1, sTop - 3.1, sz0 - 0.1, sx1 + 0.1, sTop - 0.7, sz1 + 0.1], color: 0xd8d6d0, look: 'wood' }));
  put(feature('dusty', (sx0 + sx1) / 2, sTop, (sz0 + sz1) / 2, { box: [sx0 - 0.1, sTop - 0.75, sz0 - 0.1, sx1 + 0.1, sTop + 0.05, sz1 + 0.1], color: 0x4a4a4b, look: 'felt' }));
  for (const [lx, lz] of [[sx1 - L(1.5), sz0 + L(2)], [sx1 - L(1.5), sz1 - L(2)]]) part(lx, F, lz, L(1.4), sTop - 3.1 - F, L(1.4), 1, 0, 'box', 0x8e9195, 0.6, 0.45);
  const spx = (sx0 + sx1) / 2;
  const spz = (sz0 + sz1) / 2;
  const [rc, rs] = towardSeat(spx, spz);
  speaker(spx, spz, sTop, rc, rs);
  cable([spx + rs * L(5.8), sTop + L(3), spz - rc * L(5.8), spx - L(1), sTop + 0.3, sz0 + L(1), sx0 + L(2), sTop + 0.3, sz0 + L(0.3), sx0 + L(1.6), sTop - L(2), sz0 - 0.5, L(144.5), T + 0.3, mz0 + L(1.5), L(144.2), T + 0.25, mz0 + 0.15, L(144.2), T - L(1.2), mz0 - L(0.45), L(144.2), T - L(4), mz0 - L(0.65), L(144.2), T - L(8), mz0 - L(0.75), L(144.2), T - L(12), mz0 - L(0.8), L(144.2), T - L(16), mz0 - L(0.8)], 0.32, 0x131313);

  terrain.commitGeneration();
};
