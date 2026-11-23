import { giveBodies } from './bodies';
import { createRng } from '../noise';
import { CHASSIS_RED, COLLIDER, ENAMEL, FERRITE, MARBLE, PCB, STEEL } from '../materials';
import { add, addHidden, boxMinMax, capsule, cut, cylinder, paint, rotatedBox, type Shape } from '../sdf';
import { wire, wirePath } from './parts';
import { feature, resetLayout, type Feature, type PartShape, type TerrainGenerator } from './types';

/** Top of the marble worktop the microwave stands on. */
export const WORKTOP = 8;

/** Where the microwave and its turntable are (world units), for the match, tests and camera views. */
export interface MicrowavePlan {
  /** The body's footprint and the fascia's top: x0, z0, x1, z1, top. */
  body: [number, number, number, number, number];
  /** Inside the cavity: x0, z0, x1, z1, floor, ceiling. */
  cavity: [number, number, number, number, number, number];
  /** The electronics bay beside the cavity (cover off): x0, x1. */
  bay: [number, number];
  /** The turntable: axis on a sample, the plate's radius and top, and the grid band that turns with it. */
  turntable: { x: number; z: number; plateRadius: number; radius: number; surface: number; j0: number; j1: number };
}

/** The plan for a map of this size (the generator, the match, the tests and the views share it). */
export function microwavePlan(W: number, H: number, D: number): MicrowavePlan {
  const s = Math.min(1, (H - 14) / 66, W / 160, D / 160);
  const L = (v: number): number => v * s;
  const Y = (v: number): number => WORKTOP + v * s;
  const x0 = Math.round(L(18));
  const z0 = Math.round(L(24)); // (room behind it for the mains cable, and to look at its back)
  const x1 = x0 + Math.round(L(104));
  const z1 = z0 + Math.round(L(70));
  const cx0 = x0 + 6;
  const cx1 = x0 + Math.round(L(68));
  const floor = Math.round(Y(7));
  const ceil = Math.round(Y(46));
  const tx = Math.round((cx0 + cx1) / 2);
  const tz = Math.round((z0 + 6 + z1) / 2);
  const plateRadius = Math.floor(Math.min(cx1 - cx0, z1 - z0 - 6) / 2) - 5;
  // (the plate's hidden disc starts 1.5 above the floor: between two rows of samples, so its underside is all
  // hidden; a gap a bug cannot crawl into)
  const surface = floor + 3.5;
  return {
    body: [x0, z0, x1, z1, Math.round(Y(58))],
    cavity: [cx0, z0 + 6, cx1, z1, floor, ceil],
    bay: [cx1 + 2, x1],
    turntable: { x: tx, z: tz, plateRadius, radius: plateRadius + 2, surface, j0: floor + 1, j1: Math.ceil(surface + 6) },
  };
}

/**
 * Microwave: a retro red countertop microwave with its outer cover off for repair, on a marble worktop
 * against a marble splashback. The map looks into the white cavity through the open front and down into
 * the electronics bay beside it.
 *
 * Axes: the microwave takes the middle of the map, its front facing +z. The cavity is on the left; the
 * bay on the right (the cover is off, so it is open from above and from the right) holds the magnetron
 * on its waveguide, the high-voltage transformer, the high-voltage capacitor, the cooling fan, the
 * control board behind the red control panel (two chrome dials), the door switches and the wiring.
 *
 * Levels: the worktop; the base plate (a step up); the cavity, entered up the door, which leans from the
 * worktop onto the cavity's sill; the glass turntable (it turns a quarter between turns, carrying the bugs
 * on it: see `Match`); the cavity's flat top; the parts in the bay. On the worktop: a multimeter with its
 * leads, screws, a screwdriver. Drawn-only parts have hidden collision bodies. No real brand appears.
 */
export const microwave: TerrainGenerator = (terrain, seed, layout) => {
  terrain.beginGeneration();
  if (layout) resetLayout(layout, terrain);
  const { W, H, D } = terrain;
  const rng = createRng(seed * 6007 + 3);
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const features: Feature[] | null = layout ? layout.features : null;
  /** Everything drawn (with or without a layout), for `giveBodies`. */
  const drawn: Feature[] = [];
  const put = (f: Feature): void => {
    drawn.push(f);
    features?.push(f);
  };
  const plan = microwavePlan(W, H, D);
  const s = Math.min(1, (H - 14) / 66, W / 160, D / 160);
  const L = (v: number): number => v * s;
  const Y = (v: number): number => WORKTOP + v * s;
  const hide = (sh: Shape): void => addHidden(terrain, sh, COLLIDER);
  const deco = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    shape: PartShape, color: number, metal: number, rough: number, opacity = 1, glow = 0,
  ): void => put(feature('part', (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { shape, box: [x0, y0, z0, x1, y1, z1], color, metal, rough, glow, opacity }));
  /** A drawn part with a hidden body a hair inside it (`lift`: the body starts that far above its foot). */
  const solid = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    shape: PartShape, color: number, metal: number, rough: number, lift = 0,
  ): void => {
    deco(x0, y0, z0, x1, y1, z1, shape, color, metal, rough);
    const e = 0.1;
    const b0 = y0 + lift;
    const cx = (x0 + x1) / 2;
    const cy = (b0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    if (shape === 'cylY') hide(cylinder(cx, cy, cz, Math.min(x1 - x0, z1 - z0) / 2 - e, (y1 - b0) / 2 - e, 1));
    else if (shape === 'cylX') hide(cylinder(cx, cy, cz, Math.min(y1 - b0, z1 - z0) / 2 - e, (x1 - x0) / 2 - e, 0));
    else if (shape === 'cylZ') hide(cylinder(cx, cy, cz, Math.min(x1 - x0, y1 - b0) / 2 - e, (z1 - z0) / 2 - e, 2));
    else {
      // (a rounded box's corners are cut back: its body must stay inside them, or they show through)
      const r = shape === 'soft' ? Math.min(x1 - x0, y1 - b0, z1 - z0) * 0.3 : shape === 'box' ? Math.min(0.35, Math.min(x1 - x0, y1 - b0, z1 - z0) * 0.3) : 0;
      const k = e + r * 0.62;
      hide(boxMinMax(x0 + k, b0 + k, z0 + k, x1 - k, y1 - k, z1 - k));
    }
  };
  /** A drawn plate turned about x (cos, sin) round its centre, over a hidden body of the same shape. */
  const tilted = (x: number, y: number, z: number, hx: number, hy: number, hz: number, c: number, sn: number, shape: PartShape, color: number, metal: number, rough: number, body = true): void => {
    put(feature('part', x, y, z, { shape, box: [x - hx, y - hy, z - hz, x + hx, y + hy, z + hz], path: [c, sn], color, metal, rough }));
    if (body) hide(rotatedBox(x, y, z, hx - 0.1, hy - 0.1, hz - 0.1, 0, c, sn));
  };
  const rod = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number, color: number, rough: number, metal = 0): void =>
    put(feature('rod', x0, y0, z0, { path: [x0, y0, z0, x1, y1, z1], radius, color, metal, rough, axis: 1 }));
  /** A wire along `ctrl`: drawn, with a hidden body unless it is thin or lies on a visible surface. */
  const cableAlong = (ctrl: number[], radius: number, color: number, body = false): void => {
    const pts = wirePath(ctrl, 8);
    if (body) wire(terrain, pts, Math.max(0.6, radius * 0.9), COLLIDER, true);
    put(feature('wire', ctrl[0], ctrl[1], ctrl[2], { path: [radius, ...pts], color }));
  };
  const perforated = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, axis: 0 | 1 | 2, pitch: number, color: number, path: number[] = []): void =>
    put(feature('perforated', (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { box: [x0, y0, z0, x1, y1, z1], axis, radius: pitch, color, path }));

  const [bx0, bz0, bx1, bz1, top] = plan.body;
  const [cx0, cz0, cx1, , floor, ceil] = plan.cavity;
  const [ex0] = plan.bay;
  const tt = plan.turntable;
  const front = bz1 + 2; // the fascia's front face
  if (layout) {
    layout.floorY = WORKTOP;
    layout.inner = [2, WORKTOP, 2, W - 2, H - 2, D - 2];
  }

  // ---- the kitchen: a marble worktop and splashback
  add(terrain, boxMinMax(2.5, 2.5, 2.5, W - 2.5, WORKTOP, D - 2.5, 0.8), MARBLE);
  add(terrain, boxMinMax(2.5, 2.5, 2.5, W - 2.5, H - 2.5, 6.5, 0.5), MARBLE);
  // (drawn polished sheets with fine veins over the worktop's top and the splashback's face)
  put(feature('marble', W / 2, WORKTOP, D / 2, { box: [2.6, WORKTOP - 0.3, 6.5, W - 2.6, WORKTOP + 0.03, D - 2.6], axis: 1 }));
  put(feature('marble', W / 2, H / 2, 6.5, { box: [2.6, WORKTOP, 6.45, W - 2.6, H - 2.6, 6.53], axis: 2 }));

  // ---- the base plate, the back panel, the red fascia with the cavity's opening and the control panel
  add(terrain, boxMinMax(bx0, WORKTOP - 0.5, bz0, bx1, Y(2), front, 0.4), STEEL);
  for (const fx of [bx0 + L(4), bx1 - L(4)]) for (const fz of [bz0 + L(4), bz1 - L(2)]) deco(fx - L(2), WORKTOP - 0.1, fz - L(2), fx + L(2), WORKTOP + 0.6, fz + L(2), 'cylY', 0x1b1b1c, 0, 0.8);
  add(terrain, boxMinMax(bx0, Y(2) - 0.5, bz0, bx1, top - L(4), bz0 + 2, 0.4), STEEL);
  deco(bx0 + 0.4, Y(2), bz0 - 0.08, bx1 - 0.4, top - L(4.2), bz0 + 0.1, 'plate', 0xbabec3, 0.2, 0.5);
  // (two rows of short vent slots, each with a lit lower lip)
  for (const yr of [Y(23), Y(34)]) {
    for (let x = ex0 + L(2); x < bx1 - L(3); x += L(4)) {
      deco(x, yr, bz0 - 0.14, x + L(1.6), yr + L(8), bz0, 'plate', 0x3a3c40, 0.2, 0.6);
      deco(x - 0.1, yr - L(0.35), bz0 - 0.3, x + L(1.6) + 0.1, yr, bz0, 'plate', 0xd7dadd, 0.4, 0.4);
    }
  }
  for (const [sxp, syp] of [[bx0 + L(4), Y(6)], [bx1 - L(4), Y(6)], [bx0 + L(4), top - L(8)], [bx1 - L(4), top - L(8)]]) deco(sxp - L(1.2), syp - L(1.2), bz0 - 0.45, sxp + L(1.2), syp + L(1.2), bz0 - 0.08, 'cylZ', 0xd5d8dc, 0.8, 0.3);
  put(feature('lamp', (bx0 + bx1) / 2, top - L(18), bz0 - L(9), { color: 0xfff4ea, glow: 40, radius: 70 * s }));
  add(terrain, boxMinMax(bx0, Y(2) - 0.5, bz1, bx1, top, front, 0.8), CHASSIS_RED);
  cut(terrain, boxMinMax(cx0 + 2, floor, bz1 - 1, cx1 - 2, ceil, front + 2, 0.6));

  // ---- the cavity: galvanised steel outside, white enamel inside
  add(terrain, boxMinMax(cx0, Y(2) - 0.5, cz0, cx1, ceil + 2, bz1 + 0.5, 0.4), STEEL);
  cut(terrain, boxMinMax(cx0 + 2, floor, cz0 + 2, cx1 - 2, ceil, front + 2, 0.6));
  paint(terrain, boxMinMax(cx0 + 1.1, floor - 0.9, cz0 + 1.1, cx1 - 1.1, ceil + 0.9, bz1 - 0.6), ENAMEL);
  // stamped ribs on the cavity's top, the vents on its left wall, the light's grille, the waveguide cover
  for (let x = cx0 + L(8); x < cx1 - L(6); x += L(9)) deco(x, ceil + 1.9, cz0 + L(4), x + L(3), ceil + 2.5, bz1 - L(4), 'box', 0x9a9ea3, 0.6, 0.45);
  perforated(cx0 + 1.95, Y(24), cz0 + L(14), cx0 + 2.05, Y(38), cz0 + L(40), 0, 0.9, 0xe9e9e4);
  perforated(cx1 - L(16), ceil - 0.05, cz0 + L(6), cx1 - L(6), ceil + 0.05, cz0 + L(16), 1, 0.8, 0xe9e9e4);
  put(feature('lamp', cx1 - L(11), ceil - L(2), cz0 + L(11), { color: 0xfff0d0, glow: 40, radius: 70 * s }));
  deco(cx1 - 2.08, Y(26), cz0 + L(26), cx1 - 1.95, Y(38), cz0 + L(40), 'plate', 0xc9b48a, 0, 0.7);
  // the turntable: its drive coupler and roller ring are drawn; the plate is a hidden disc that turns
  hide(cylinder(tt.x, tt.surface - 1, tt.z, tt.plateRadius - 0.3, 1, 1));
  put(feature('turntable', tt.x, tt.surface, tt.z, { radius: tt.plateRadius, path: [tt.plateRadius * 0.58, floor] }));

  // ---- the door, off its hinges, leaning from the worktop onto the cavity's sill: the way in
  const dw = (cx1 - cx0) / 2 - 0.5;
  const dh = L(23);
  const rise = floor + 0.4 - WORKTOP;
  const run = Math.sqrt(Math.max(1, dh * 2 * dh * 2 - rise * rise));
  const dc = run / (2 * dh);
  const ds = rise / (2 * dh);
  const dxc = (cx0 + cx1) / 2;
  const dyc = WORKTOP + rise / 2 + 1.4 * dc;
  const dzc = front + run / 2;
  tilted(dxc, dyc, dzc, dw, 1.4, dh, dc, ds, 'box', 0x8c0d0b, 0.15, 0.32);
  put(feature('part', dxc, dyc - 1.42 * dc, dzc - 1.42 * ds, { shape: 'plate', box: [dxc - dw + 0.6, dyc - 1.42 * dc - 0.05, dzc - 1.42 * ds - dh + 0.6, dxc + dw - 0.6, dyc - 1.42 * dc + 0.05, dzc - 1.42 * ds + dh - 0.6], path: [dc, ds], color: 0x8e9297, metal: 0.6, rough: 0.4 }));
  // (its face: a red frame round a dark window with the perforated screen behind the glass)
  const fy = dyc + 1.42 * dc;
  const fz = dzc + 1.42 * ds;
  put(feature('part', dxc, fy, fz, { shape: 'plate', box: [dxc - dw, fy - 0.05, fz - dh, dxc + dw, fy + 0.05, fz + dh], path: [dc, ds], color: 0x8c0d0b, metal: 0.15, rough: 0.3 }));
  for (const dz2 of [-0.6, 0.6]) {
    // (hinge pins at the left edge, latch hooks at the right, along the door's length)
    const along = dz2 * dh;
    const hy = dyc - along * ds;
    const hz = dzc + along * dc;
    deco(dxc - dw - L(1.6), hy - L(0.7), hz - L(0.7), dxc - dw + 0.2, hy + L(0.7), hz + L(0.7), 'cylX', 0xb9bdc2, 0.9, 0.3);
    deco(dxc + dw - 0.2, hy + 0.6 * dc - L(0.4), hz - L(0.5), dxc + dw + L(2.2), hy + 0.6 * dc + L(0.4), hz + L(0.5), 'box', 0xc9ccd0, 0.9, 0.25);
    deco(dxc + dw + L(1.4), hy + 0.6 * dc - L(0.4), hz - L(1.6), dxc + dw + L(2.2), hy + 0.6 * dc + L(0.4), hz + L(0.5), 'box', 0xc9ccd0, 0.9, 0.25);
  }
  perforated(dxc - dw + L(6), fy + 0.05, fz - dh + L(5), dxc + dw - L(6), fy + 0.12, fz + dh - L(5), 1, 0.7, 0x0d0e0f, [dc, ds]);
  put(feature('part', dxc, fy + 0.14 * dc, fz + 0.14 * ds, { shape: 'plate', box: [dxc - dw + L(5.5), fy + 0.1, fz - dh + L(4.5), dxc + dw - L(5.5), fy + 0.18, fz + dh - L(4.5)], path: [dc, ds], color: 0x202528, metal: 0, rough: 0.05, opacity: 0.35 }));

  // ---- the control panel: two chrome dials and a door-release button on the red fascia
  const px = (ex0 + bx1) / 2 + L(1);
  for (const [dy, r] of [[Y(38), L(4.6)], [Y(22), L(4.6)]]) {
    deco(px - r, dy - r, front - 0.1, px + r, dy + r, front + L(1.2), 'cylZ', 0xd4d7db, 0.95, 0.18);
    deco(px - r * 0.9, dy - r * 0.9, front + L(1.1), px + r * 0.9, dy + r * 0.9, front + L(3.4), 'cylZ', 0xa8170f, 0.2, 0.3);
    deco(px - L(0.7), dy - r * 0.85, front + L(3.3), px + L(0.7), dy + r * 0.85, front + L(4.4), 'box', 0xd4d7db, 0.9, 0.25);
    for (const [ox, oy] of [[1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827], [-1, 0]]) {
      deco(px + ox * r * 1.35 - 0.18, dy + oy * r * 1.35 - 0.18, front - 0.02, px + ox * r * 1.35 + 0.18, dy + oy * r * 1.35 + 0.18, front + 0.04, 'cylZ', 0xf2f2ee, 0, 0.5);
    }
  }
  deco(px - L(5), Y(7) - L(1.6), front - 0.1, px + L(5), Y(7) + L(1.6), front + L(2), 'box', 0xd4d7db, 0.95, 0.2);

  // ---- the electronics bay (the cover is off: open from above and from the right)
  // the waveguide on the cavity's right wall, and the magnetron on it, with its cooling fins
  add(terrain, boxMinMax(cx1 - 0.5, Y(22), cz0 + L(22), cx1 + L(4), Y(40), cz0 + L(42), 0.4), STEEL);
  const mx0 = cx1 + L(4);
  const my = Y(31);
  const mz = cz0 + L(32);
  hide(boxMinMax(mx0 - 0.5, my - L(7.5), mz - L(8), mx0 + L(11), my + L(7.5), mz + L(8)));
  deco(mx0 + L(0.6), my - L(6), mz - L(6), mx0 + L(10), my + L(6), mz + L(6), 'plate', 0x8d9197, 0.75, 0.4);
  for (let k = 0; k <= 9; k++) {
    const fy2 = my - L(7.3) + k * L(1.6);
    deco(mx0 + L(1.2), fy2, mz - L(8), mx0 + L(10.6), fy2 + L(0.3), mz + L(8), 'plate', 0xc9ccd0, 0.85, 0.35);
  }
  deco(mx0 - 0.2, my - L(8.5), mz - L(9), mx0 + L(0.8), my + L(8.5), mz + L(9), 'plate', 0xa9adb2, 0.8, 0.35);
  for (const [oy, oz] of [[-7.5, -8], [-7.5, 8], [7.5, -8], [7.5, 8]]) deco(mx0 + L(0.7), my + L(oy) - L(0.6), mz + L(oz) - L(0.6), mx0 + L(1.3), my + L(oy) + L(0.6), mz + L(oz) + L(0.6), 'cylX', 0xd0d3d7, 0.9, 0.3);
  deco(mx0 + L(11.8), my - L(3.5), mz - L(3.5), mx0 + L(15.2), my + L(3.5), mz + L(3.5), 'plate', 0x9a9ea3, 0.75, 0.4);
  deco(mx0 + L(10.4), my - L(4.2), mz - L(1), mx0 + L(12), my - L(3.4), mz + L(1), 'plate', 0x9a9ea3, 0.75, 0.4);
  for (const dz of [-1.2, 1.2]) deco(mx0 + L(15.1), my - L(0.4), mz + L(dz) - L(0.5), mx0 + L(16.4), my + L(0.4), mz + L(dz) + L(0.5), 'plate', 0xd8c36a, 0.9, 0.3);
  // the high-voltage transformer: laminated core, windings showing at both ends
  const tx0 = ex0 + L(2);
  const tx1 = tx0 + L(20);
  const tz0 = bz0 + L(5);
  const tz1 = tz0 + L(16);
  add(terrain, boxMinMax(tx0, Y(2) - 0.5, tz0, tx1, Y(22), tz1, 0.4), FERRITE);
  deco(tx0 - 0.02, Y(2), tz0 - 0.02, tx1 + 0.02, Y(22) + 0.02, tz1 + 0.02, 'plate', 0x5f6469, 0.55, 0.45);
  // a terminal block on the transformer's top: the primary and the filament wires end on its screws
  solid(tx1 - L(5), Y(22), tz0 + L(1), tx1 - L(0.5), Y(24), tz1 - L(1), 'box', 0x1c1d1f, 0, 0.5);
  for (let k = 0; k < 3; k++) deco(tx1 - L(3.4), Y(24), tz0 + L(3) + k * L(5), tx1 - L(2), Y(24.5), tz0 + L(4.4) + k * L(5), 'cylY', 0xc9a84a, 0.9, 0.3);
  // (two coils round the core's centre leg, their rounded ends standing out of the core at front and back)
  solid(tx0 + L(4), Y(3.6), tz0 - L(3.4), tx1 - L(4), Y(11), tz1 + L(3.4), 'soft', 0xb4622f, 0.6, 0.38);
  deco(tx0 + L(4), Y(12.6), tz0 - L(3.1), tx1 - L(4), Y(19.6), tz1 + L(3.1), 'soft', 0x7a2f1a, 0.4, 0.45);
  hide(boxMinMax(tx0 + L(5.5), Y(14.1), tz0 - L(1.8), tx1 - L(5.5), Y(18.1), tz1 + L(1.8)));
  // (the E-I seam: a darker line across the core near its top)
  deco(tx0 - 0.06, Y(18.6), tz0 - 0.06, tx1 + 0.06, Y(18.9), tz1 + 0.06, 'plate', 0x2a2c2f, 0.4, 0.6);
  // (the core's laminations: fine lines on its sides and top, lighter than the core)
  for (let z = tz0 + L(1.1); z < tz1 - L(0.5); z += L(1.1)) {
    deco(tx0 - 0.05, Y(2) + 0.4, z, tx1 + 0.05, Y(22) + 0.05, z + 0.09, 'plate', 0x8d9298, 0.5, 0.5);
  }
  for (let k = 0; k < 3; k++) deco(tx1 - L(1), Y(22) - 0.05, tz0 + L(4) + k * L(4), tx1 + 0.2, Y(23), tz0 + L(5) + k * L(4), 'plate', 0xd8c36a, 0.9, 0.3);
  // the high-voltage capacitor lying in its clip, terminals to the front
  const capX = bx1 - L(7);
  const capY = Y(2) + L(4.6);
  const capZ0 = tz1 + L(8);
  const capZ1 = capZ0 + L(17);
  solid(capX - L(4.5), capY - L(4.5), capZ0, capX + L(4.5), capY + L(4.5), capZ1, 'cylZ', 0xc6cacf, 0.85, 0.3, 1.25);
  deco(capX - L(4.75), capY - L(4.75), capZ0 + L(7.5), capX + L(4.75), capY + L(4.75), capZ0 + L(9.5), 'cylZ', 0x9a9ea3, 0.8, 0.4);
  for (const dx of [-6.2, 6.2]) {
    deco(capX + L(dx) - L(1.6), Y(2) - 0.05, capZ0 + L(7.5), capX + L(dx) + L(1.6), Y(2) + L(0.35), capZ0 + L(9.5), 'plate', 0x9a9ea3, 0.8, 0.4);
    deco(capX + L(dx) - L(0.6), Y(2) + L(0.3), capZ0 + L(8), capX + L(dx) + L(0.6), Y(2) + L(0.8), capZ0 + L(9), 'cylY', 0xc9ccd0, 0.9, 0.3);
  }
  for (const dx of [-1.6, 1.6]) deco(capX + L(dx) - L(0.5), capY - L(0.6), capZ1 - 0.1, capX + L(dx) + L(0.5), capY + L(0.6), capZ1 + L(1.4), 'plate', 0xd8c36a, 0.9, 0.3);
  // the cooling fan at the back, behind the magnetron: a black shroud with the blades and motor in it
  const fanX = ex0 + L(19);
  const fanY = Y(41); // (above the transformer)
  const fanZ = bz0 + L(6);
  solid(fanX - L(10), Y(30), bz0 + 1.5, fanX + L(10), Y(52), fanZ + L(1), 'box', 0x1d1e20, 0, 0.6);
  deco(fanX - L(9.6), fanY - L(9.6), fanZ + L(0.9), fanX + L(9.6), fanY + L(9.6), fanZ + L(1.3), 'cylZ', 0x2a2b2e, 0, 0.55);
  deco(fanX - L(8.8), fanY - L(8.8), fanZ + L(1.2), fanX + L(8.8), fanY + L(8.8), fanZ + L(1.35), 'cylZ', 0x0c0c0d, 0, 0.9);
  put(feature('blower', fanX, fanY, fanZ + L(2.2), { radius: L(8.2), axis: 2, color: 0x3a3c40 }));
  hide(boxMinMax(fanX - L(8.5), fanY - L(8.5), fanZ + L(1), fanX + L(8.5), fanY + L(8.5), fanZ + L(3.4)));
  // the control board behind the fascia: relays, a small transformer, capacitors
  const pbX0 = ex0 + L(4);
  const pbX1 = bx1 - L(2);
  add(terrain, boxMinMax(pbX0, Y(4), bz1 - L(4), pbX1, Y(44), bz1 - L(2), 0.3), PCB);
  for (const [cxp, cyp, w, h, col] of [[0.25, 30, 6, 5, 0x2a62b8], [0.6, 30, 6, 5, 0x2a62b8], [0.4, 18, 7, 6, 0x1c1d1f], [0.75, 14, 3.4, 5, 0x1c1d1f], [0.2, 10, 3, 4.6, 0x2d3b8f]] as const) {
    const x = pbX0 + (pbX1 - pbX0) * cxp;
    solid(x - L(w / 2), Y(cyp) - L(h / 2), bz1 - L(4) - L(4), x + L(w / 2), Y(cyp) + L(h / 2), bz1 - L(4), 'box', col, 0.1, 0.5);
  }
  // the door switches, one above the other beside the opening
  for (const sy of [Y(12), Y(36)]) {
    solid(cx1 + 0.2, sy - L(1.6), bz1 - L(6), cx1 + L(3.2), sy + L(1.6), bz1 - L(1), 'box', 0x1c1d1f, 0, 0.5);
    deco(cx1 + L(1), sy - L(0.5), bz1 - L(1.1), cx1 + L(2.4), sy + L(0.5), bz1 - L(0.2), 'box', 0xeceae2, 0, 0.5);
  }

  // ---- the wiring: mains in through a grommet, a fuse, the door switches, the transformer, the high voltage
  const wy = Y(2) + 0.6;
  const fuseX = bx1 - L(6);
  const fuseZ = bz0 + L(8);
  // (the fuse: a clear glass tube with metal caps and a thin wire inside, in two spring clips on a black holder)
  solid(fuseX - L(1.5), Y(2), fuseZ - L(4.4), fuseX + L(1.5), Y(3.4), fuseZ + L(4.4), 'box', 0x1c1d1f, 0, 0.5);
  deco(fuseX - L(0.9), Y(3.5), fuseZ - L(2.6), fuseX + L(0.9), Y(5.3), fuseZ + L(2.6), 'cylZ', 0xf4f8f9, 0, 0.03, 0.28);
  deco(fuseX - 0.06, Y(4.35), fuseZ - L(2.5), fuseX + 0.06, Y(4.45), fuseZ + L(2.5), 'plate', 0x8a8a8a, 0.9, 0.4);
  for (const dz of [-3.3, 2.4]) {
    deco(fuseX - L(0.95), Y(3.45), fuseZ + L(dz), fuseX + L(0.95), Y(5.35), fuseZ + L(dz) + L(0.9), 'cylZ', 0xc9ccd0, 0.9, 0.3);
    deco(fuseX - L(1.2), Y(3.3), fuseZ + L(dz) + L(0.1), fuseX + L(1.2), Y(4.9), fuseZ + L(dz) + L(0.7), 'box', 0xb8bcc0, 0.85, 0.35);
  }
  /** A spade terminal where a wire meets a part. */
  const spade = (x: number, y: number, z: number): void => deco(x - L(0.5), y - L(0.5), z - L(0.5), x + L(0.5), y + L(0.5), z + L(0.5), 'box', 0xd8c36a, 0.9, 0.3);
  /** A cable tie: a thin band round a pair running along z, centred at (x, y, z). */
  const tie = (x: number, y: number, z: number): void => {
    deco(x - L(1.3), y - L(0.75), z - L(0.3), x + L(1.3), y + L(0.75), z + L(0.3), 'cylZ', 0xece9e0, 0, 0.6);
    deco(x + L(1), y - L(0.4), z - L(0.4), x + L(1.8), y + L(0.4), z + L(0.4), 'box', 0xece9e0, 0, 0.6);
  };
  // (inside, the white mains cable comes through the grommet and down to the base, where it splits: the brown
  // live through the fuse, the blue neutral beside it)
  const gx = bx1 - L(8);
  const gy = Y(9);
  const sX = gx - L(1);
  const sZ = bz0 + L(7.5);
  deco(gx - L(2.2), gy - L(2.2), bz0 + 1.95, gx + L(2.2), gy + L(2.2), bz0 + 2.35, 'cylZ', 0x161617, 0, 0.6);
  cableAlong([gx, gy, bz0 + 0.5, gx, gy, bz0 + 2.6, gx, gy - L(0.6), bz0 + L(4), gx - L(0.5), wy + L(1.2), bz0 + L(5.8), sX, wy + L(0.6), sZ - L(0.4), sX, wy + L(0.6), sZ], 1.05, 0xeeede8);
  deco(sX - L(1.2), wy + L(0.6) - L(1.2), sZ - L(0.2), sX + L(1.2), wy + L(0.6) + L(1.2), sZ + L(0.8), 'cylZ', 0x1c1d1f, 0, 0.55);
  cableAlong([sX + L(0.45), wy + L(0.6), sZ + L(0.6), fuseX - L(0.5), Y(3.8), fuseZ - L(6.4), fuseX, Y(4.4), fuseZ - L(5), fuseX, Y(4.4), fuseZ - L(4.4)], 0.4, 0x8a5a2a);
  spade(fuseX, Y(4.4), fuseZ - L(4.4));
  // (the pair: the fused live from the fuse's front clip and the neutral beside the fuse; between the
  // transformer and the capacitor, in the open in front of the magnetron, to the door switches; tied twice)
  const pairX = cx1 + L(4);
  const passX = tx1 - L(3); // (well clear of the capacitor and its strap)
  const cornerX = tx1 + L(2.6);
  const cornerZ = tz1 + L(2.4);
  for (const [dx, col, sy, from] of [
    [-0.45, 0x2a5cb8, Y(12), [sX - L(0.45), wy + L(0.6), sZ + L(0.6), sX - L(0.9), wy + L(0.2), sZ + L(3), sX - L(1.2), wy, sZ + L(7)]],
    [0.45, 0x8a5a2a, Y(36), [fuseX, Y(4.4), fuseZ + L(4.4), fuseX - L(0.4), wy + L(0.4), fuseZ + L(6), fuseX - L(1.4), wy, fuseZ + L(8.5)]],
  ] as const) {
    cableAlong([...from, cornerX + L(dx), wy, cornerZ, passX + L(dx), wy, tz1 + L(5.5), passX + L(dx), wy, mz + L(10), pairX + L(dx), wy, mz + L(12.5), pairX + L(dx), wy, bz1 - L(10), pairX + L(dx), wy + L(1), bz1 - L(7), cx1 + L(3.2), sy - L(1.2), bz1 - L(5), cx1 + L(3.2), sy, bz1 - L(3.5)], 0.4, col);
    spade(cx1 + L(3.2), sy, bz1 - L(3.5));
  }
  spade(fuseX, Y(4.4), fuseZ + L(4.4));
  tie(passX, wy, mz + L(4));
  tie(pairX, wy, bz1 - L(13));
  // (the switched live, from the upper switch: up the cavity's wall in a clip, over the magnetron, down to
  // the transformer's terminal block)
  {
    // (points on the surfaces it lies on, offset by its radius: the cavity's side and top, its top edge, the
    // waveguide's top, the fins' top edge; clips wrap it where it lies on the cavity's top and the waveguide)
    const r = 0.34;
    const topY = ceil + 2 + r + 0.1;
    const wgY = Y(40) + r + 0.1;
    const finY = my + L(7.4) + r + 0.2;
    cableAlong([
      cx1 + L(3.2), Y(36) - L(1), bz1 - L(4.5),
      cx1 + r + 0.1, Y(38), bz1 - L(6),
      cx1 + r + 0.1, topY, bz1 - L(8),
      cx1 - L(1.5), topY, bz1 - L(12),
      cx1 - L(1.5), topY, cz0 + L(50),
      cx1 + r + 0.1, topY, cz0 + L(46),
      cx1 + r + 0.3, wgY + L(2), cz0 + L(42),
      cx1 + L(1.8), wgY, cz0 + L(39),
      mx0 + L(1.4), finY + L(0.8), mz + L(4),
      mx0 + L(5), finY, mz + L(2),
      mx0 + L(11), finY, mz - L(2),
      tx1 + L(0.5), Y(34), tz0 + L(16),
      tx1 - L(2.7), Y(25.4), tz0 + L(14.3),
      tx1 - L(2.7), Y(24.6), tz0 + L(13.7),
    ], r, 0xe4e1d6);
    for (const [cx, cy, cz] of [[cx1 - L(1.5), topY, (bz1 - L(12) + cz0 + L(50)) / 2], [cx1 + L(1.8), wgY, cz0 + L(39)]]) {
      deco(cx - L(1), cy - r - 0.1, cz - L(0.5), cx + L(1), cy + r + 0.15, cz + L(0.5), 'box', 0xece9e0, 0, 0.6);
    }
  }
  // (the neutral back from the lower switch to the transformer's primary)
  cableAlong([cx1 + L(3.2), Y(12) - L(1), bz1 - L(4.5), pairX - L(1.4), wy + L(1), bz1 - L(7), pairX - L(1.4), wy, bz1 - L(10), pairX - L(1.4), wy, mz + L(12.5), passX - L(1.4), wy, mz + L(10), passX - L(1.4), wy, tz1 + L(5.5), tx1 - L(5), Y(5), tz1 + L(4.2), tx1 - L(5), Y(7), tz1 + L(3.6)], 0.4, 0x2a5cb8);
  spade(tx1 - L(5), Y(7), tz1 + L(3.6));
  // (the high-voltage side: the transformer's terminal round the capacitor's left side to its left terminal)
  cableAlong([tx1 - L(2.7), Y(24.6), tz0 + L(3.7), tx1 + L(1), Y(25), tz0 + L(4.5), tx1 + L(2.5), Y(12), tz0 + L(10), tx1 + L(2.5), Y(9), capZ0, capX - L(6), Y(9), capZ0 + L(4), capX - L(6), Y(9), capZ1, capX - L(4), capY + L(1), capZ1 + L(2), capX - L(1.6), capY + L(1), capZ1 + L(1.4)], 0.45, 0xb0231a);
  // (from the capacitor's right terminal up to the magnetron's filter box)
  cableAlong([capX + L(1.6), capY + L(1), capZ1 + L(1.4), capX + L(3), capY + L(4), capZ1 + L(2), capX + L(1), Y(27), mz + L(8), mx0 + L(18), my, mz + L(1.2), mx0 + L(16.4), my, mz + L(1.2)], 0.45, 0xb0231a);
  // (the filament, from the filter box back to the transformer's terminal block)
  cableAlong([mx0 + L(16.4), my, mz - L(1.2), mx0 + L(18), my - L(2), mz - L(4), tx1 - L(1), Y(28), tz0 + L(11), tx1 - L(2.7), Y(25.4), tz0 + L(9.3), tx1 - L(2.7), Y(24.6), tz0 + L(8.7)], 0.4, 0xd8c33a);
  spade(capX - L(1.6), capY + L(1), capZ1 + L(1.4));
  spade(capX + L(1.6), capY + L(1), capZ1 + L(1.4));
  // (the fan motor's supply: clipped down the back panel, along the base by the right edge, to the board)
  cableAlong([fanX + L(6), fanY - L(9.4), fanZ + L(0.5), bx1 - L(2), Y(26), bz0 + L(3), bx1 - L(1.4), Y(8), bz0 + L(3.2), bx1 - L(1.4), wy, bz0 + L(7), bx1 - L(1.4), wy, bz1 - L(10), pbX1 - L(3), Y(6), bz1 - L(5)], 0.32, 0x1b1b1b);
  deco(bx1 - L(2.6), Y(16) - L(0.6), bz0 + 1.9, bx1 - L(0.4), Y(16) + L(0.6), bz0 + L(4.2), 'box', 0xece9e0, 0, 0.6);
  // the mains cable from the back to the socket on the splashback
  const sx = bx0 + L(30);
  const sy2 = WORKTOP + L(14);
  deco(sx - L(14), sy2 - L(7), 6.4, sx + L(14), sy2 + L(7), 7.3, 'box', 0xf3f2ee, 0, 0.35);
  for (const ox of [-7, 7]) deco(sx + L(ox) - L(4.5), sy2 - L(4.5), 7.28, sx + L(ox) + L(4.5), sy2 + L(4.5), 7.34, 'cylZ', 0xdcdad3, 0, 0.45);
  for (const hx of [-1.6, 1.6]) deco(sx + L(7) + L(hx) - L(0.65), sy2 - L(0.65), 7.33, sx + L(7) + L(hx) + L(0.65), sy2 + L(0.65), 7.38, 'cylZ', 0x2a2a2a, 0, 0.6);
  solid(sx - L(7) - L(4), sy2 - L(4), 7.3, sx - L(7) + L(4), sy2 + L(4), 7.3 + L(3.5), 'box', 0xf1f0ea, 0, 0.5);
  deco(sx - L(7) - L(1.4), sy2 - L(5.6), 7.3 + L(1), sx - L(7) + L(1.4), sy2 - L(3.8), 7.3 + L(3.2), 'box', 0xe6e4dc, 0, 0.5);
  cableAlong([sx - L(7), sy2 - L(5.6), 7.3 + L(2.1), sx - L(7), WORKTOP + 4, 9.5, sx - L(4), WORKTOP + 1.05, 11, sx + L(20), WORKTOP + 1.05, 12, gx - L(6), WORKTOP + 1.05, bz0 - L(7), gx, gy - L(4), bz0 - L(6), gx, gy, bz0 - L(4.5), gx, gy, bz0 + 1], 1.05, 0xeeede8);
  // (where it goes in: a black grommet in the panel and a strain-relief sleeve round the cable)
  deco(gx - L(1.9), gy - L(1.9), bz0 - 0.35, gx + L(1.9), gy + L(1.9), bz0 + 0.05, 'cylZ', 0x161617, 0, 0.6);
  deco(gx - L(1.5), gy - L(1.5), bz0 - L(4), gx + L(1.5), gy + L(1.5), bz0 - 0.3, 'cylZ', 0x1c1d1f, 0, 0.55);

  // ---- on the worktop: a multimeter with its leads, a screwdriver, the cover's screws
  const mmX = bx1 + L(14);
  const mmZ = bz1 + L(10);
  solid(mmX - L(8), WORKTOP, mmZ - L(13), mmX + L(8), WORKTOP + L(4), mmZ + L(13), 'box', 0x3a3c3e, 0, 0.7, 1.25);
  deco(mmX - L(7.2), WORKTOP + L(0.6), mmZ - L(12.2), mmX + L(7.2), WORKTOP + L(4.15), mmZ + L(12.2), 'box', 0xe8b512, 0, 0.5);
  for (const bx of [-4.2, 4.2]) deco(mmX + L(bx) - L(1.2), WORKTOP + L(4.1), mmZ - L(1.8), mmX + L(bx) + L(1.2), WORKTOP + L(4.5), mmZ - L(0.9), 'box', 0x2a2b2d, 0, 0.5);
  for (const [ox, oz] of [[1, 0], [0.7071, -0.7071], [0, -1], [-0.7071, -0.7071], [-1, 0], [-0.7071, 0.7071], [0.7071, 0.7071]]) {
    deco(mmX + L(4.4) * ox - 0.15, WORKTOP + L(4.15), mmZ + L(2.4) + L(4.4) * oz - 0.15, mmX + L(4.4) * ox + 0.15, WORKTOP + L(4.2), mmZ + L(2.4) + L(4.4) * oz + 0.15, 'plate', 0x1c1d1f, 0, 0.5);
  }
  deco(mmX - L(6.2), WORKTOP + L(4.12), mmZ - L(11.2), mmX + L(6.2), WORKTOP + L(4.2), mmZ - L(2.8), 'plate', 0x1c1d1f, 0, 0.5);
  deco(mmX - L(5.6), WORKTOP + L(4.2), mmZ - L(10.6), mmX + L(5.6), WORKTOP + L(4.26), mmZ - L(3.4), 'plate', 0x9fb39a, 0, 0.25);
  {
    // "0.25": seven-segment digits, dark on the light window
    const segY0 = WORKTOP + L(4.26);
    const segY1 = segY0 + 0.04;
    const dW = L(2);
    const dH = L(4.2);
    const t = L(0.32);
    const digit = (x: number, z: number, segs: string): void => {
      const xl = x - dW / 2;
      const xr = x + dW / 2;
      const zt = z - dH / 2;
      const zm = z;
      const zb = z + dH / 2;
      const hseg = (zz: number): void => deco(xl + t, segY0, zz - t / 2, xr - t, segY1, zz + t / 2, 'plate', 0x1b241e, 0, 0.4);
      const vseg = (xx: number, za: number, zb2: number): void => deco(xx - t / 2, segY0, za + t / 2, xx + t / 2, segY1, zb2 - t / 2, 'plate', 0x1b241e, 0, 0.4);
      if (segs.includes('a')) hseg(zt);
      if (segs.includes('g')) hseg(zm);
      if (segs.includes('d')) hseg(zb);
      if (segs.includes('f')) vseg(xl, zt, zm);
      if (segs.includes('b')) vseg(xr, zt, zm);
      if (segs.includes('e')) vseg(xl, zm, zb);
      if (segs.includes('c')) vseg(xr, zm, zb);
    };
    const dz = mmZ - L(7);
    digit(mmX - L(3), dz, 'abcdef');
    deco(mmX - L(1.6) - t / 2, segY0, dz + dH / 2 - t, mmX - L(1.6) + t / 2, segY1, dz + dH / 2, 'plate', 0x1b241e, 0, 0.4);
    digit(mmX, dz, 'abged');
    digit(mmX + L(3), dz, 'afgcd');
  }
  deco(mmX - L(3.6), WORKTOP + L(4), mmZ + L(2.4) - L(3.6), mmX + L(3.6), WORKTOP + L(5.2), mmZ + L(2.4) + L(3.6), 'cylY', 0x1c1d1f, 0, 0.4);
  deco(mmX - L(0.5), WORKTOP + L(5.25), mmZ + L(2.4) - L(3.2), mmX + L(0.5), WORKTOP + L(5.6), mmZ + L(2.4), 'box', 0xe8e6de, 0, 0.5);
  deco(mmX - L(1) - L(0.8), WORKTOP + L(4), mmZ + L(9) - L(0.8), mmX - L(1) + L(0.8), WORKTOP + L(4.6), mmZ + L(9) + L(0.8), 'cylY', 0x1c1d1f, 0, 0.4);
  for (const [dx, col] of [[-3, 0x1c1d1f], [3, 0xb0231a]] as const) {
    deco(mmX + L(dx) - L(0.8), WORKTOP + L(4), mmZ + L(9) - L(0.8), mmX + L(dx) + L(0.8), WORKTOP + L(5.4), mmZ + L(9) + L(0.8), 'cylY', col, 0, 0.4);
    deco(mmX + L(dx) - L(1.1), WORKTOP + L(4.1), mmZ + L(9) - L(1.1), mmX + L(dx) + L(1.1), WORKTOP + L(4.3), mmZ + L(9) + L(1.1), 'cylY', 0x9a9ea2, 0.8, 0.4);
    const ex = mmX + L(dx) * 4 + L(rand(-2, 2));
    const ez = mmZ + L(26) + L(rand(-2, 2));
    cableAlong([mmX + L(dx), WORKTOP + L(5.6), mmZ + L(9), mmX + L(dx) * 1.5, WORKTOP + L(3), mmZ + L(15), ex, WORKTOP + 0.5, ez - L(4), ex, WORKTOP + 0.6, ez], 0.4, col);
    rod(ex, WORKTOP + 0.9, ez, ex + L(dx) * 0.3, WORKTOP + 0.9, ez + L(6), 0.75, col, 0.4);
    rod(ex + L(dx) * 0.3, WORKTOP + 0.9, ez + L(6), ex + L(dx) * 0.4, WORKTOP + 0.9, ez + L(9), 0.2, 0xc6cacf, 0.3, 0.9);
  }
  const sdX = bx1 + L(6);
  const sdZ = bz0 + L(14);
  // (lying along z: a fluted red handle, a ferrule, the shaft, a cross tip)
  const hy = WORKTOP + L(1.4);
  rod(sdX, hy, sdZ, sdX, hy, sdZ + L(12), L(1.4), 0xb0231a, 0.4);
  for (const [ox, oy] of [[1, 0], [0.5, 0.866], [-0.5, 0.866], [-1, 0]]) rod(sdX + ox * L(1.38), hy + oy * L(1.38), sdZ + L(1.5), sdX + ox * L(1.38), hy + oy * L(1.38), sdZ + L(10.5), 0.14, 0x7e1912, 0.5);
  deco(sdX - L(0.9), hy - L(0.9), sdZ + L(12), sdX + L(0.9), hy + L(0.9), sdZ + L(13), 'cylZ', 0xc6cacf, 0.9, 0.3);
  const ty = WORKTOP + 0.45;
  rod(sdX, hy, sdZ + L(13), sdX, ty, sdZ + L(20.5), 0.4, 0xc6cacf, 0.3, 0.9);
  deco(sdX - 0.42, ty - 0.08, sdZ + L(20.3), sdX + 0.42, ty + 0.08, sdZ + L(21.2), 'plate', 0xa9adb1, 0.9, 0.35);
  deco(sdX - 0.08, ty - 0.42, sdZ + L(20.3), sdX + 0.08, ty + 0.42, sdZ + L(21.2), 'plate', 0xa9adb1, 0.9, 0.35);
  hide(capsule(sdX, WORKTOP + L(2), sdZ, sdX, WORKTOP + L(2), sdZ + L(12), 0.7));
  for (let i = 0; i < 4; i++) {
    const x = bx1 + L(8) + i * L(3.4) + L(rand(-1, 1));
    const z = bz0 + L(36) + L(rand(-3, 3));
    rod(x, WORKTOP + 0.45, z - L(1.6), x, WORKTOP + 0.45, z + L(1.2), 0.38, 0xb5b9bd, 0.35, 0.9);
    for (let k = 0; k < 4; k++) deco(x - 0.46, WORKTOP + 0.45 - 0.46, z - L(1.3) + k * L(0.6), x + 0.46, WORKTOP + 0.45 + 0.46, z - L(1.3) + k * L(0.6) + 0.12, 'cylZ', 0x9fa3a7, 0.9, 0.4);
    deco(x - L(0.8), WORKTOP + 0.45 - L(0.8), z + L(1.2), x + L(0.8), WORKTOP + 0.45 + L(0.8), z + L(1.7), 'cylZ', 0xb5b9bd, 0.9, 0.3);
    deco(x - L(0.55), WORKTOP + 0.45 - 0.08, z + L(1.66), x + L(0.55), WORKTOP + 0.45 + 0.08, z + L(1.74), 'plate', 0x3a3c3e, 0.5, 0.5);
    deco(x - 0.08, WORKTOP + 0.45 - L(0.55), z + L(1.66), x + 0.08, WORKTOP + 0.45 + L(0.55), z + L(1.74), 'plate', 0x3a3c3e, 0.5, 0.5);
  }

  giveBodies(terrain, drawn);
  terrain.commitGeneration();
};
