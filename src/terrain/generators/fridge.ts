import { giveBodies } from './bodies';
import { createRng } from '../noise';
import { ALUMINIUM, BLACK_PLASTIC, COLLIDER, ENAMEL, FROST, LINER, PAINT, TILE } from '../materials';
import { add, addHidden, boxMinMax, capsule, cut, cylinder, paint, rotatedBox, sphere, type Shape } from '../sdf';
import { wire, wirePath } from './parts';
import { feature, resetLayout, type Feature, type PartShape, type TerrainGenerator } from './types';

/** Top of the kitchen floor the fridge stands on. */
export const FLOOR = 6;
/** The fridge's size at full scale (5×3×5 map): width (x), depth (z), height. */
const FW = 64;
const FD = 62;
const FH = 78;

/** Where the fridge and its levels are (world units), for tests and camera views. */
export interface FridgePlan {
  /** Outer body: x0, z0, x1, z1, top. */
  body: [number, number, number, number, number];
  /** Inside: x0, z0, x1, z1, floor, ceiling. */
  inside: [number, number, number, number, number, number];
  /** Tops of the walkable levels inside: the glass shelf, the wire rack, the ice box floor. */
  glassTop: number;
  rackTop: number;
  iceTop: number;
  /** The wire rack's right edge (it covers the left part of the width). */
  rackX1: number;
}

/** The plan for a map of this size (the generator and the tests share it). */
export function fridgePlan(W: number, H: number, D: number): FridgePlan {
  const s = Math.min(1, (H - 12) / FH, W / 160, D / 160);
  const x0 = Math.round(24 * s);
  const z0 = Math.round(27 * s); // (room behind for the coil and the compressor, and for bugs)
  const top = FLOOR + Math.round(FH * s);
  const x1 = x0 + Math.round(FW * s);
  const z1 = z0 + Math.round(FD * s);
  const h = (v: number): number => FLOOR + v * s;
  return {
    body: [x0, z0, x1, z1, top],
    inside: [x0 + 4, z0 + 5, x1 - 4, z1, h(10), top - 5],
    glassTop: h(26),
    rackTop: h(43),
    iceTop: h(57),
    rackX1: x0 + 38 * s,
  };
}

/**
 * Mini Fridge: a small bar fridge standing on a tiled kitchen floor against a wall, its door wide open.
 * The map looks into it from the front and above: the levels inside are the floors of the fight.
 *
 * Axes: the fridge stands at low x, its back to the wall (low z), its opening facing +z. The door is
 * hinged on the left (low x) and stands open along +z, its inside (bins with bottles, cans, eggs)
 * facing +x, towards the camera's side. The floor in front and to the right is open ground.
 *
 * Levels (and the ramps between them): the floor → a chopping board leaning on the glass shelf's
 * front edge → the glass shelf over the clear crisper drawer → a cucumber from the glass up to the
 * wire rack (the rack covers the left part, the right part stays open for tall bottles) → the ice
 * box's flap, opened down onto the rack → the frosted ice box under the ceiling. Outside: the fridge's
 * top (a roll of kitchen paper, a mug, a tea box), reached from the door's top over the hinge; the
 * door's bins; the compressor and the condenser coil behind, the cable to the wall socket.
 *
 * Drawn-only parts (glass, clear plastic, food, wire, the coil) have hidden collision bodies, so bugs
 * stand on them and cannot pass through them. Parts at least 2 cells thick, gaps at least 2 wide. The
 * layout follows the map size (5×3×5 and 3×2×3 both hold up); the seed varies the details.
 */
export const fridge: TerrainGenerator = (terrain, seed, layout) => {
  terrain.beginGeneration();
  if (layout) resetLayout(layout, terrain);
  const { W, H, D } = terrain;
  const rng = createRng(seed * 7919 + 17);
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const features: Feature[] | null = layout ? layout.features : null;
  /** Everything drawn (with or without a layout), for `giveBodies`. */
  const drawn: Feature[] = [];
  const put = (f: Feature): void => {
    drawn.push(f);
    features?.push(f);
  };
  const plan = fridgePlan(W, H, D);
  const s = Math.min(1, (H - 12) / FH, W / 160, D / 160);
  /** A length at the map's scale, and a height above the floor. */
  const L = (v: number): number => v * s;
  const Y = (v: number): number => FLOOR + v * s;
  const hide = (sh: Shape): void => addHidden(terrain, sh, COLLIDER);
  /** A render-only part. */
  const deco = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    shape: PartShape, color: number, metal: number, rough: number, opacity = 1, glow = 0,
  ): void =>
    put(feature('part', (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { shape, box: [x0, y0, z0, x1, y1, z1], color, metal, rough, glow, opacity }));
  /** A drawn part that bugs collide with: the stand-in, and a hidden body a hair inside it. */
  const solid = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    shape: PartShape, color: number, metal: number, rough: number, opacity = 1, lift = 0,
  ): void => {
    deco(x0, y0, z0, x1, y1, z1, shape, color, metal, rough, opacity);
    const e = 0.1;
    // (`lift`: the hidden body starts that far above the part's foot. On a visible surface, the samples
    // within HIDDEN_CLEAR of it keep that surface's material: a body touching it would show there,
    // through a clear part or as teeth beside a thin one. A gap under 1.25 still stops every bug.)
    y0 += lift;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const cz = (z0 + z1) / 2;
    if (shape === 'ball') hide(sphere(cx, cy, cz, Math.min(x1 - x0, y1 - y0, z1 - z0) / 2 - e));
    else if (shape === 'cylY') hide(cylinder(cx, cy, cz, Math.min(x1 - x0, z1 - z0) / 2 - e, (y1 - y0) / 2 - e, 1));
    else if (shape === 'cylX') hide(cylinder(cx, cy, cz, Math.min(y1 - y0, z1 - z0) / 2 - e, (x1 - x0) / 2 - e, 0));
    else if (shape === 'cylZ') hide(cylinder(cx, cy, cz, Math.min(x1 - x0, y1 - y0) / 2 - e, (z1 - z0) / 2 - e, 2));
    else hide(boxMinMax(x0 + e, y0 + e, z0 + e, x1 - e, y1 - e, z1 - e, shape === 'box' ? 0.3 : 0));
  };
  /** A drawn plate turned about x (cos, sin), centred at (x, y, z) with half sizes, over a hidden body of the same shape. */
  const tilted = (x: number, y: number, z: number, hx: number, hy: number, hz: number, c: number, sn: number, shape: PartShape, color: number, metal: number, rough: number): void => {
    put(feature('part', x, y, z, { shape, box: [x - hx, y - hy, z - hz, x + hx, y + hy, z + hz], path: [c, sn], color, metal, rough }));
    hide(rotatedBox(x, y, z, hx - 0.1, hy - 0.1, hz - 0.1, 0, c, sn));
  };
  /** A round rod from a to b (drawn), with a hidden body when `body`. */
  const rod = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, radius: number, color: number, rough: number, body: boolean): void => {
    put(feature('rod', x0, y0, z0, { path: [x0, y0, z0, x1, y1, z1], radius, color, metal: 0, rough, axis: 1 }));
    if (body) hide(capsule(x0, y0, z0, x1, y1, z1, Math.max(0.6, radius - 0.1)));
  };
  /**
   * A soft cable along `ctrl` (drawn) with a body: hidden, or (`core` >= 0, for a cable lying on a visible
   * floor) a real core of that material inside the drawn tube; `core` -2: no body at all (a thin pipe).
   */
  const cableAlong = (ctrl: number[], radius: number, color: number, core = -1): void => {
    const pts = wirePath(ctrl, 8);
    // (a visible core stays well inside the tube: the grid's steps on so thin a core reach ~0.3 out)
    if (core >= 0) wire(terrain, pts, Math.max(0.6, radius - 0.4), core);
    else if (core === -1) wire(terrain, pts, Math.max(0.6, radius * 0.9), COLLIDER, true);
    put(feature('wire', ctrl[0], ctrl[1], ctrl[2], { path: [radius, ...pts], color }));
  };
  /** Clear plastic (the crisper, the door bins) and glass. */
  const CLEAR = 0xe4f1f2;
  const WHITE_TRIM = 0xf3f3f0;

  const [bx0, bz0, bx1, bz1, top] = plan.body;
  const [ix0, iz0, ix1, , iy0, iy1] = plan.inside;

  if (layout) {
    layout.floorY = FLOOR;
    layout.inner = [2, FLOOR, 2, W - 2, H - 2, D - 2];
  }

  // ---- the kitchen: a tiled floor and the wall behind the fridge, with a skirting board and a socket
  add(terrain, boxMinMax(2.5, 2.5, 2.5, W - 2.5, FLOOR, D - 2.5, 1), TILE);
  const TILE_SIZE = 12 * Math.max(0.75, s);
  // grout lines a hair above the tiles (the floor's own edges show the tiles' thickness)
  for (let x = 2.5 + TILE_SIZE; x < W - 4; x += TILE_SIZE) deco(x - 0.18, FLOOR - 0.3, 7, x + 0.18, FLOOR + 0.04, D - 2.6, 'plate', 0x8b867e, 0, 0.9);
  for (let z = 7 + TILE_SIZE; z < D - 4; z += TILE_SIZE) deco(2.6, FLOOR - 0.3, z - 0.18, W - 2.6, FLOOR + 0.04, z + 0.18, 'plate', 0x8b867e, 0, 0.9);
  add(terrain, boxMinMax(2.5, 2.5, 2.5, W - 2.5, H - 2.5, 7, 0.5), PAINT);
  deco(2.6, FLOOR - 0.2, 7, W - 2.6, FLOOR + L(5), 7.9, 'box', 0xeeede6, 0, 0.5);
  // the side wall on the left: the fridge stands in the kitchen's corner
  add(terrain, boxMinMax(2.5, 2.5, 2.5, 7, H - 2.5, D - 2.5, 0.5), PAINT);
  deco(7, FLOOR - 0.2, 7.9, 7.9, FLOOR + L(5), D - 2.6, 'box', 0xeeede6, 0, 0.5);
  const sx = bx1 + L(32);
  const sy = FLOOR + L(12);
  deco(sx - L(4), sy - L(4), 7, sx + L(4), sy + L(4), 7.7, 'box', 0xf1f0ea, 0, 0.35);
  solid(sx - L(2), sy - L(2.2), 7.7, sx + L(2), sy + L(1.8), 7.7 + L(3), 'box', 0x1a1a1b, 0, 0.5);
  // (the plug's strain-relief boot, and two grip ridges)
  const boot = 7.7 + L(3);
  deco(sx - L(0.8), sy - L(1.3), boot - 0.1, sx + L(0.8), sy + L(0.3), boot + L(1.6), 'cylZ', 0x1a1a1b, 0, 0.55);
  for (const dx of [-1, 1]) deco(sx + dx * L(2) - 0.1, sy - L(1.6), 7.8, sx + dx * L(2) + 0.1, sy + L(1.2), 7.7 + L(2.6), 'plate', 0x2a2a2b, 0, 0.5);
  // the fridge's power cable: out of the boot, down the wall, along its foot, behind the fridge into the
  // compressor's terminal box (a thin cord: drawn only)
  const termX = ix1 - L(14) - L(5.5) - L(1.3);
  cableAlong([
    sx, sy - L(0.5), boot + L(1.5),
    sx, sy - L(3), boot + L(2.2),
    sx - L(1), FLOOR + 0.55, 9.6,
    bx1 + L(2), FLOOR + 0.55, 9.4,
    termX - L(6), FLOOR + 0.55, 10.5,
    termX - L(3), FLOOR + 0.6, bz0 - L(2),
    termX - L(1.2), Y(3.2), bz0 + L(0.5),
  ], 0.5, 0x161616, -2);
  // ---- the body: white enamel outside, the white liner inside
  add(terrain, boxMinMax(bx0, FLOOR - 0.5, bz0, bx1, top, bz1, 1.2), ENAMEL);
  cut(terrain, boxMinMax(ix0, iy0, iz0, ix1, iy1, bz1 + 4, 1));
  // the liner: more than 2 cells in from the enamel (the front frame stays white enamel)
  paint(terrain, boxMinMax(ix0 - 1.6, iy0 - 1.6, iz0 - 1.6, ix1 + 1.6, iy1 + 1.6, bz1 - 1.2), LINER);
  // the hump over the compressor at the back of the floor, and the compressor's bay under it (open at the back)
  const humpZ = iz0 + L(12);
  add(terrain, boxMinMax(ix0 - 1, iy0 - 1, iz0 - 1, ix1 + 1, Y(18), humpZ, 1), LINER);
  cut(terrain, boxMinMax(ix0, FLOOR - 1, bz0 - 2, ix1, Y(14), humpZ - L(3), 0.8));
  paint(terrain, boxMinMax(ix0 - 0.8, FLOOR + 0.6, bz0 - 2, ix1 + 0.8, Y(14) + 0.8, humpZ - L(3) + 0.8), BLACK_PLASTIC);
  // shelf rails moulded in the side walls: under the glass and under the rack, both sides
  for (const y of [plan.glassTop - 2, plan.rackTop - 2]) {
    add(terrain, boxMinMax(ix0 - 1, y - 2, iz0, ix0 + 2, y, bz1 - L(6), 0.9), LINER);
    add(terrain, boxMinMax(ix1 - 2, y - 2, iz0, ix1 + 1, y, bz1 - L(6), 0.9), LINER);
  }
  // the kick plate under the front: a dark grille
  deco(ix0, FLOOR + 0.6, bz1 - 0.3, ix1, Y(8.5), bz1 + 0.4, 'plate', 0x2b2c2e, 0, 0.6);
  for (let x = ix0 + 3; x < ix1 - 2; x += 3) deco(x - 0.5, Y(2.5), bz1 + 0.35, x + 0.5, Y(6.5), bz1 + 0.5, 'plate', 0x121213, 0, 0.8);
  // a back-wall centre rail (the rack's right side is held there)
  deco(plan.rackX1 - 1.2, iy0 + L(8), iz0 - 0.1, plan.rackX1 + 1.2, plan.iceTop - L(4), iz0 + 0.6, 'plate', 0xd9dcdc, 0, 0.5);
  for (let y = iy0 + L(11); y < plan.iceTop - L(5); y += L(3.5)) deco(plan.rackX1 - 0.5, y, iz0 + 0.5, plan.rackX1 + 0.5, y + L(1.6), iz0 + 0.65, 'plate', 0x8d9191, 0, 0.6);

  // ---- the crisper: a clear drawer on the floor, its contents seen through it, under the glass shelf
  const cx0 = ix0 + 2;
  const cx1 = ix1 - 2;
  const cz0 = humpZ + 1;
  const cz1 = bz1 - 1;
  const cy0 = iy0 + 0.5;
  const cy1 = plan.glassTop - 2.6;
  hide(boxMinMax(cx0, cy0, cz0, cx1, cy1, cz1));
  cut(terrain, boxMinMax(cx0 + 2, cy0 + 2, cz0 + 2, cx1 - 2, cy1 + 0.3, cz1 - 2));
  deco(cx0, cy0, cz1 - 1.6, cx1, cy1, cz1, 'plate', 0xf2f7f7, 0, 0.05, 0.08);
  deco(cx0, cy0, cz0, cx1, cy1, cz0 + 1.6, 'plate', CLEAR, 0, 0.08, 0.1);
  deco(cx0, cy0, cz0 + 1.6, cx0 + 1.6, cy1, cz1 - 1.6, 'plate', CLEAR, 0, 0.08, 0.1);
  deco(cx1 - 1.6, cy0, cz0 + 1.6, cx1, cy1, cz1 - 1.6, 'plate', CLEAR, 0, 0.08, 0.1);
  deco(cx0 + 1.6, cy0, cz0 + 1.6, cx1 - 1.6, cy0 + 1.6, cz1 - 1.6, 'plate', CLEAR, 0, 0.08, 0.2);
  // the handle along the front's top
  deco(cx0 + L(10), cy1 - 2, cz1 - 0.2, cx1 - L(10), cy1, cz1 + 0.9, 'box', WHITE_TRIM, 0, 0.35);
  // vegetables in the drawer: a lettuce, tomatoes, a pepper, lemons, carrots (bright: seen through plastic and glass)
  const vegY = cy0 + 2;
  // a head of broccoli: a pale stalk under a dome of dark florets
  const lx = cx0 + L(11);
  const lz = (cz0 + cz1) / 2 + rand(-3, 3) * s;
  solid(lx - L(1.6), vegY, lz - L(1.6), lx + L(1.6), vegY + L(5), lz + L(1.6), 'cylY', 0x9cbf5e, 0, 0.6);
  solid(lx - L(4.6), vegY + L(3.6), lz - L(4.6), lx + L(4.6), vegY + L(9.6), lz + L(4.6), 'ball', 0x2d5e25, 0, 0.85);
  for (let i = 0; i < 9; i++) {
    const a = [[0, 0], [1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87], [0.7, 0.4], [-0.7, -0.4]][i];
    const r = L(rand(1.7, 2.3));
    const ox = lx + a[0] * L(3.1);
    const oz = lz + a[1] * L(3.1);
    const oy = vegY + L(i === 0 ? 8.4 : 7.2);
    deco(ox - r, oy - r, oz - r, ox + r, oy + r, oz + r, 'ball', i % 3 ? 0x2f6a27 : 0x3c7d2f, 0, 0.9);
  }
  for (let i = 0; i < 3; i++) {
    const tr = L(2.7);
    const tx = cx0 + L(25) + i * L(6.2);
    const tz = cz1 - L(8) - rand(0, 3) * s;
    solid(tx - tr, vegY, tz - tr, tx + tr, vegY + tr * 1.75, tz + tr, 'ball', 0xd0220f, 0, 0.3);
    for (const [sx5, sz5] of [[1, 0], [0.309, 0.951], [-0.809, 0.588], [-0.809, -0.588], [0.309, -0.951]]) {
      rod(tx, vegY + tr * 1.74, tz, tx + sx5 * L(1.3), vegY + tr * 1.7, tz + sz5 * L(1.3), 0.16, 0x3d7a22, 0.7, false);
    }
    rod(tx, vegY + tr * 1.74, tz, tx, vegY + tr * 1.74 + L(0.8), tz, 0.18, 0x3d7a22, 0.7, false);
  }
  const px = cx1 - L(10);
  const pz = cz0 + L(10);
  hide(sphere(px, vegY + L(3.1), pz, L(3.1)));
  for (const [ox, oz] of [[-1.3, -0.9], [1.3, -0.9], [0, 1.4]]) {
    deco(px + L(ox) - L(2.5), vegY, pz + L(oz) - L(2.5), px + L(ox) + L(2.5), vegY + L(6.2), pz + L(oz) + L(2.5), 'ball', 0xe9ae0c, 0, 0.25);
  }
  deco(px - L(0.8), vegY + L(5.6), pz - L(0.8), px + L(0.8), vegY + L(7.4), pz + L(0.8), 'cylY', 0x356d1f, 0, 0.6);
  // lemons: ellipsoids with a small tip at each end
  for (let i = 0; i < 2; i++) {
    const ex = cx1 - L(9) - i * L(6.5);
    const ez = cz1 - L(7);
    solid(ex - L(2.9), vegY, ez - L(1.9), ex + L(2.9), vegY + L(3.7), ez + L(1.9), 'ball', 0xf2d21b, 0, 0.45);
    for (const d of [-1, 1]) deco(ex + d * L(2.75) - 0.45, vegY + L(1.85) - 0.4, ez - 0.4, ex + d * L(2.75) + 0.45, vegY + L(1.85) + 0.4, ez + 0.4, 'ball', 0xe2c117, 0, 0.5);
  }
  // carrots: tapering to a point, apart, a tuft of leaves at the thick end
  for (let i = 0; i < 3; i++) {
    const cz = cz0 + L(5) + i * L(4.4);
    const y = vegY + 1.15 + i * 0.3;
    const x0 = cx0 + L(21) + i * L(1.2);
    const len = L(15);
    hide(capsule(x0 + 0.6, y, cz, x0 + len * 0.6, y - 0.1, cz + L(0.6), 0.75));
    for (let k = 0; k < 10; k++) {
      const u0 = k / 10;
      const u1 = (k + 1) / 10;
      const r = 0.12 + 1.1 * (1 - (u0 + u1) / 2);
      rod(x0 + len * u0, y - 0.35 * u0, cz + L(1.3) * u0, x0 + len * u1, y - 0.35 * u1, cz + L(1.3) * u1, r, 0xff6400, 0.55, false);
    }
    rod(x0 - 0.4, y + 0.2, cz, x0 - L(4), y + L(1.2), cz - L(0.8), 0.3, 0x3f8f25, 0.7, false);
    rod(x0 - 0.4, y + 0.2, cz, x0 - L(3.6), y + L(2), cz + L(0.6), 0.28, 0x52a532, 0.7, false);
  }

  // ---- the glass shelf over the crisper: see-through, a green-blue edge where the glass is thick
  const gy = plan.glassTop;
  hide(boxMinMax(ix0, gy - 2, iz0, ix1, gy, bz1 - 0.5));
  // (as thick as its hidden body, so no part of the body shows under it)
  deco(ix0 + 0.05, gy - 2.05, iz0 + 0.05, ix1 - 0.05, gy, bz1 - 0.5, 'plate', 0xe6f2f1, 0, 0.04, 0.12);
  deco(ix0 + 0.05, gy - 2.05, bz1 - 0.8, ix1 - 0.05, gy, bz1 - 0.35, 'plate', 0x58c2b6, 0, 0.1, 0.85);
  // a white plastic trim along the glass' front edge underneath
  deco(ix0 + 0.2, gy - 2.6, bz1 - 1.8, ix1 - 0.2, gy - 1.7, bz1 - 0.4, 'plate', WHITE_TRIM, 0, 0.4);

  // ---- the wire rack: white coated wire over the left part (the right stays open for tall things)
  const ry = plan.rackTop;
  const rx1 = plan.rackX1;
  const rz1 = bz1 - L(4);
  hide(boxMinMax(ix0, ry - 2, iz0, rx1, ry, rz1));
  const WIRE = 0xe9ecec;
  for (let x = ix0 + 1.6; x <= rx1 - 1.4; x += 1.6) rod(x, ry - 0.32, iz0 + 0.8, x, ry - 0.32, rz1 - 0.8, 0.27, WIRE, 0.45, false);
  rod(ix0 + 0.6, ry - 0.55, rz1 - 0.65, rx1 - 0.6, ry - 0.55, rz1 - 0.65, 0.62, WIRE, 0.45, false);
  rod(ix0 + 0.6, ry - 0.5, iz0 + 0.6, rx1 - 0.6, ry - 0.5, iz0 + 0.6, 0.55, WIRE, 0.45, false);
  rod(ix0 + 0.6, ry - 0.5, iz0 + 0.6, ix0 + 0.6, ry - 0.5, rz1 - 0.6, 0.55, WIRE, 0.45, false);
  rod(rx1 - 0.6, ry - 0.5, iz0 + 0.6, rx1 - 0.6, ry - 0.5, rz1 - 0.6, 0.55, WIRE, 0.45, false);
  for (let i = 1; i <= 3; i++) {
    const z = iz0 + ((rz1 - iz0) * i) / 4;
    rod(ix0 + 1.4, ry - 0.95, z, rx1 - 1.4, ry - 0.95, z, 0.4, WIRE, 0.45, false);
  }
  // on the rack: a jar of jam and a butter dish
  const jx = ix0 + L(8);
  const jz = iz0 + L(12);
  solid(jx - L(3.2), ry, jz - L(3.2), jx + L(3.2), ry + L(4.6), jz + L(3.2), 'cylY', 0x8e1f2e, 0, 0.12, 0.92);
  solid(jx - L(3.4), ry + L(4.6), jz - L(3.4), jx + L(3.4), ry + L(5.8), jz + L(3.4), 'cylY', 0xc8c9cb, 0.8, 0.35);
  solid(ix0 + L(16), ry, iz0 + L(6), ix0 + L(30), ry + L(4.5), iz0 + L(14), 'box', 0xf1e9cf, 0, 0.4);

  // ---- the cucumber: from the glass, by the right wall, up onto the rack's right edge
  const cr = L(2.2);
  const cuz = iz0 + L(26);
  {
    const ax = ix1 - cr - 0.3;
    const ay = gy + cr * 0.62;
    const bx = rx1 - L(0.6);
    // (the top end, thinner, rests on the rack's last wires)
    const by = ry + cr * 0.66;
    const bz = cuz + L(2);
    const at = (u: number): [number, number, number] => [ax + (bx - ax) * u, ay + (by - ay) * u, cuz + (bz - cuz) * u];
    // (bodies inside the drawn taper: the full width in the middle, thinner towards the ends)
    const [hx1, hy1, hz1] = at(0.22);
    const [hx2, hy2, hz2] = at(0.78);
    hide(capsule(hx1, hy1, hz1, hx2, hy2, hz2, cr * 0.86));
    hide(capsule(ax + (hx1 - ax) * 0.3, ay + (hy1 - ay) * 0.3, cuz + (hz1 - cuz) * 0.3, hx1, hy1, hz1, cr * 0.55));
    hide(capsule(hx2, hy2, hz2, bx + (hx2 - bx) * 0.3, by + (hy2 - by) * 0.3, bz + (hz2 - bz) * 0.3, cr * 0.55));
    // (one smooth capsule: a taper built from pieces shows rings where the pieces meet)
    rod(ax, ay, cuz, bx, by, bz, cr * 0.92, 0x24481c, 0.5, false);
    // a few low bumps along the top, in the middle where the skin is round, and a short stem at the top end
    for (const [u, a, b] of [[0.33, 0.35, 0.92], [0.41, -0.55, 0.8], [0.52, 0.1, 0.98], [0.6, 0.6, 0.78], [0.69, -0.25, 0.95]]) {
      const [qx, qy, qz] = at(u);
      deco(qx - 0.22, qy + cr * b - 0.16, qz + a * cr - 0.22, qx + 0.22, qy + cr * b + 0.16, qz + a * cr + 0.22, 'ball', 0x1f3d18, 0, 0.6);
    }
    rod(bx, by, bz, bx + (bx - ax) * 0.03, by + (by - ay) * 0.03, bz + (bz - cuz) * 0.03, 0.4, 0x6b7f3a, 0.7, false);
  }

  // ---- the ice box: an aluminium box under the ceiling, frosted inside, its flap opened down to the rack
  const ibx0 = ix0 + 2;
  const ibx1 = ix1 - 2;
  const iby0 = plan.iceTop - 2;
  // the flap covers the opening; opened down, its edge rests on the rack's front: that sets the box's depth
  const fl = iy1 - iby0;
  const drop = iby0 - ry - 1;
  const run = Math.sqrt(Math.max(1, fl * fl - drop * drop));
  const fc = run / fl;
  const fs = drop / fl;
  const ibz1 = rz1 - run - 0.5;
  add(terrain, boxMinMax(ibx0, iby0, iz0 - 1, ibx1, iy1 + 1, ibz1, 0.6), ALUMINIUM);
  cut(terrain, boxMinMax(ibx0 + 2, iby0 + 2, iz0 + 0.5, ibx1 - 2, iy1 - 2, ibz1 + 2, 0.5));
  // frost: thick and lumpy on the inside top and walls, a little over the front lip
  paint(terrain, boxMinMax(ibx0 + 1.1, iby0 + 1.1, iz0 - 1, ibx1 - 1.1, iy1 - 1.1, ibz1 + 1), FROST);
  // (a rime: an even layer a little under a cell thick, with low, broad swells, never lumps)
  add(terrain, boxMinMax(ibx0 + 1.4, iy1 - 2.8, iz0, ibx1 - 1.4, iy1 - 1, ibz1 - 0.6, 0.6), FROST);
  for (let n = Math.round(40 * s * s) + 8; n > 0; n--) {
    add(terrain, sphere(rand(ibx0 + 3, ibx1 - 3), iy1 - 0.1, rand(iz0 + 1, ibz1 - 2), rand(2, 3)), FROST, 2.2);
  }
  // the box's underside: clean brushed aluminium (the terrain's own metal reads dark and blotchy there)
  deco(ibx0 + 0.2, iby0 - 0.08, iz0 + 0.2, ibx1 - 0.2, iby0 + 0.05, ibz1 - 0.2, 'plate', 0xd4d8dd, 0.25, 0.5, 1, 0.08);
  // the flap: hinged at the front of the box's floor, opened down until it rests on the rack
  tilted((ibx0 + ibx1) / 2, iby0 - drop / 2, ibz1 + run / 2, (ibx1 - ibx0) / 2 - 0.5, 1, fl / 2, fc, fs, 'box', 0xaeb3b9, 0.7, 0.45);
  for (const x of [ibx0 + 3, ibx1 - 3]) deco(x - 1.6, iby0 - 1.2, ibz1 - 1.2, x + 1.6, iby0 + 1.2, ibz1 + 1.2, 'cylX', 0xb9bdc2, 0.9, 0.3);
  // inside: an ice cube tray and a bag of frozen peas
  const fy = plan.iceTop;
  const tx0 = ibx0 + L(5);
  const tz0 = iz0 + L(4);
  const TRAY = 0x5d9ad0;
  deco(tx0, fy, tz0, tx0 + L(20), fy + L(0.9), tz0 + L(12), 'box', TRAY, 0, 0.3, 0.9);
  hide(boxMinMax(tx0 + 0.3, fy + 1.25, tz0 + 0.3, tx0 + L(20) - 0.3, fy + L(2.4), tz0 + L(12) - 0.3));
  for (const z of [tz0, tz0 + L(5.8), tz0 + L(11.6)]) deco(tx0, fy, z, tx0 + L(20), fy + L(2.6), z + L(0.45), 'plate', TRAY, 0, 0.3, 0.9);
  for (let i = 0; i <= 4; i++) deco(tx0 + i * L(4.9), fy, tz0, tx0 + i * L(4.9) + L(0.45), fy + L(2.6), tz0 + L(12), 'plate', TRAY, 0, 0.3, 0.9);
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 2; k++) {
      const x = tx0 + L(2.65) + i * L(4.9);
      const z = tz0 + L(3.1) + k * L(5.8);
      deco(x - L(1.7), fy + L(0.9), z - L(1.7), x + L(1.7), fy + L(3.6), z + L(1.7), 'soft', 0xe8f5ff, 0, 0.05, 0.7);
    }
  // (beside the tray, never over it, whatever the map size)
  const peasX0 = tx0 + L(23);
  const peasX1 = Math.min(ibx1 - L(3), peasX0 + L(17));
  // (well inside the pillow, which is thin at its ends: a body poking out would leave a dark slit)
  hide(boxMinMax(peasX0 + L(2.5), fy + 1.25, iz0 + L(10.5), peasX1 - L(2.5), fy + L(2.6), iz0 + L(19.5)));
  deco(peasX0 - L(0.4), fy - 0.4, iz0 + L(6.6), peasX1 + L(0.4), fy + L(3.2), iz0 + L(23.4), 'ball', 0x2f6db5, 0, 0.55);
  // (a printed green patch on the top)
  deco((peasX0 + peasX1) / 2 - L(4), fy + L(3.02), iz0 + L(11.5), (peasX0 + peasX1) / 2 + L(4), fy + L(3.32), iz0 + L(18.5), 'ball', 0x6cae3c, 0, 0.6);

  // ---- the light and the thermostat dial: a white housing on the ceiling in front of the ice box
  const hx = (ix0 + ix1) / 2;
  const hz0 = ibz1 + L(4);
  const hz1 = bz1 - L(5);
  add(terrain, boxMinMax(hx - L(11), iy1 - L(6), hz0, hx + L(11), iy1 + 1, hz1, 1), LINER);
  deco(hx - L(8), iy1 - L(6.4), hz0 + L(2), hx + L(8), iy1 - L(5.9), hz1 - L(2), 'plate', 0xfff6dc, 0, 0.3, 1, 1.4);
  deco(hx + L(4), iy1 - L(5.5), hz1 - 0.2, hx + L(9), iy1 - L(0.5), hz1 + L(1.4), 'cylZ', 0xf6f6f3, 0, 0.35);
  // (a grip ridge across the dial's face, and its pointer)
  deco(hx + L(6.3), iy1 - L(5.2), hz1 + L(1.3), hx + L(6.7), iy1 - L(0.8), hz1 + L(2), 'box', 0xe9e9e6, 0, 0.4);
  deco(hx + L(6.35), iy1 - L(4.9), hz1 + L(1.95), hx + L(6.65), iy1 - L(4.1), hz1 + L(2.05), 'plate', 0x2a6fb5, 0, 0.4);
  put(feature('lamp', hx, iy1 - L(9), (hz0 + hz1) / 2, { color: 0xfff1d8, glow: 70, radius: 90 * s }));

  // ---- the door: hinged on the left, wide open along +z; its inside faces +x
  const dx1 = bx0;
  const dx0 = bx0 - Math.max(4, L(5));
  const dz0 = bz1;
  const dz1 = bz1 + Math.round(FW * s);
  add(terrain, boxMinMax(dx0, FLOOR + 1, dz0, dx1, top, dz1, 1), ENAMEL);
  paint(terrain, boxMinMax(dx1 - 1.2, FLOOR + 3, dz0 + 3, dx1 + 1, top - 2, dz1 - 3), LINER);
  // the gasket: a grey rubber frame round the inside, and the liner's moulded rails that hold the bins
  const gk = L(2.8);
  const GASKET = 0x5f6464;
  deco(dx1 - 0.1, FLOOR + 1.4, dz0 + 0.5, dx1 + 2, FLOOR + 1.4 + gk, dz1 - 0.5, 'box', GASKET, 0, 0.8);
  deco(dx1 - 0.1, top - 0.5 - gk, dz0 + 0.5, dx1 + 2, top - 0.5, dz1 - 0.5, 'box', GASKET, 0, 0.8);
  deco(dx1 - 0.1, FLOOR + 1.4, dz0 + 0.5, dx1 + 2, top - 0.5, dz0 + 0.5 + gk, 'box', GASKET, 0, 0.8);
  deco(dx1 - 0.1, FLOOR + 1.4, dz1 - 0.5 - gk, dx1 + 2, top - 0.5, dz1 - 0.5, 'box', GASKET, 0, 0.8);
  for (const z of [dz0 + L(4), dz1 - L(4)]) deco(dx1 + 1.2, FLOOR + L(3), z - L(1.4), dx1 + L(2.6), top - L(5), z + L(1.4), 'box', 0xe9ebea, 0, 0.4);
  // hinges: low plastic-capped plates; the top one is a bridge from the fridge's top to the door's top
  solid(dx0 - 0.2, top - 0.6, dz0 - L(3), bx0 + L(3), top + 1.4, dz0 + L(3), 'box', 0xd5d7d7, 0, 0.45);
  solid(dx0 - 0.2, FLOOR, dz0 - L(2.5), bx0 + L(2.5), FLOOR + 2.2, dz0 + L(2.5), 'box', 0xd5d7d7, 0, 0.45);
  // the handle: a bar on the outside, by the free edge
  deco(dx0 - L(2.2), Y(36), dz1 - L(6), dx0 + 0.2, Y(58), dz1 - L(3), 'box', 0xc4c7cb, 0.85, 0.3);
  // the bins: clear plastic with a white trim, from the bottom up: bottles, cans and a jar, eggs and butter
  const binX1 = dx1 + L(10);
  const bin = (y0: number, y1: number): void => {
    const z0 = dz0 + L(4);
    const z1 = dz1 - L(4);
    hide(boxMinMax(dx1, y0, z0, binX1, y0 + 2, z1));
    hide(boxMinMax(binX1 - 2, y0, z0, binX1, y1, z1));
    hide(boxMinMax(dx1, y0, z0, binX1, y1, z0 + 2));
    hide(boxMinMax(dx1, y0, z1 - 2, binX1, y1, z1));
    deco(dx1 + 1.6, y0, z0, binX1, y0 + 1.6, z1, 'plate', CLEAR, 0, 0.1, 0.3);
    deco(binX1 - 1.6, y0, z0, binX1, y1 - 1.4, z1, 'plate', CLEAR, 0, 0.1, 0.22);
    deco(dx1 + 1.6, y0, z0, binX1, y1 - 1.4, z0 + 1.6, 'plate', CLEAR, 0, 0.1, 0.22);
    deco(dx1 + 1.6, y0, z1 - 1.6, binX1, y1 - 1.4, z1, 'plate', CLEAR, 0, 0.1, 0.22);
    deco(binX1 - 1.8, y1 - 1.4, z0, binX1 + 0.1, y1, z1, 'box', WHITE_TRIM, 0, 0.35);
  };
  const b1 = Y(4);
  bin(b1, Y(16));
  const bxm = (dx1 + binX1) / 2 + 0.3;
  /** A bottle: body, shoulder, neck, cap, and a blank label band. */
  const bottle = (z: number, r: number, h: number, color: number, opacity: number, cap: number, label: number, y0 = b1 + 2): void => {
    const body = h * 0.72;
    solid(bxm - r, y0, z - r, bxm + r, y0 + body, z + r, 'cylY', color, 0, 0.1, opacity);
    deco(bxm - r, y0 + body - 0.05, z - r, bxm + r, y0 + body + r * 0.8, z + r, 'dome', color, 0, 0.1, opacity);
    const nr = Math.max(0.8, r * 0.36);
    solid(bxm - nr, y0 + body + r * 0.5, z - nr, bxm + nr, y0 + h, z + nr, 'cylY', color, 0, 0.1, opacity);
    solid(bxm - nr - 0.15, y0 + h, z - nr - 0.15, bxm + nr + 0.15, y0 + h + L(1.8), z + nr + 0.15, 'cylY', cap, 0, 0.45);
    deco(bxm - r - 0.06, y0 + body * 0.3, z - r - 0.06, bxm + r + 0.06, y0 + body * 0.72, z + r + 0.06, 'cylY', label, 0, 0.55);
  };
  bottle(dz0 + L(10), L(3.5), L(24), 0xcfe6f0, 0.45, 0x2a63b8, 0x3f8fd0);
  bottle(dz0 + L(19), L(3.3), L(21), 0xe57a16, 0.88, 0xf2f2ee, 0xf4e8c8);
  // a milk carton with a gable top
  const mz = dz0 + L(29.5);
  solid(bxm - L(3.2), b1 + 2, mz - L(4), bxm + L(3.2), b1 + 2 + L(18), mz + L(4), 'plate', 0xf3f3ef, 0, 0.5);
  deco(bxm - L(3.2), b1 + 2 + L(5), mz - L(4.05), bxm + L(3.2), b1 + 2 + L(11), mz + L(4.05), 'plate', 0x3e7fc4, 0, 0.5);
  tilted(bxm, b1 + 2 + L(19.4), mz - L(2), L(3.15), 0.25, L(2.4), 0.8, -0.6, 'plate', 0xf3f3ef, 0, 0.5);
  tilted(bxm, b1 + 2 + L(19.4), mz + L(2), L(3.15), 0.25, L(2.4), 0.8, 0.6, 'plate', 0xf3f3ef, 0, 0.5);
  deco(bxm - L(3.2), b1 + 2 + L(20.6), mz - 0.35, bxm + L(3.2), b1 + 2 + L(22), mz + 0.35, 'plate', 0xf3f3ef, 0, 0.5);
  bottle(dz0 + L(41), L(2.5), L(16), 0xa82219, 0.95, 0xf2f2ee, 0xf2f2ee);
  bottle(dz0 + L(50), L(3), L(20), 0x2f7d33, 0.55, 0xe9c53a, 0xe9d8a8);
  const b2 = Y(34);
  bin(b2, Y(41));
  const CANS = [0xb3292b, 0x2c7a3c, 0xc9ccd1, 0xe0b42c, 0x2b5aa8];
  /** A drinks can: the coloured body, silver rims, a lid with a ring pull. */
  const can = (x: number, y: number, z: number, color: number): void => {
    const r = L(2.6);
    const h = L(9.4);
    solid(x - r, y, z - r, x + r, y + h, z + r, 'cylY', color, 0.6, 0.32);
    deco(x - r * 0.9, y - 0.05, z - r * 0.9, x + r * 0.9, y + L(0.7), z + r * 0.9, 'cylY', 0xc9ccd1, 0.9, 0.3);
    deco(x - r * 0.92, y + h - 0.05, z - r * 0.92, x + r * 0.92, y + h + L(0.3), z + r * 0.92, 'cylY', 0xc9ccd1, 0.9, 0.3);
    deco(x - r * 0.76, y + h + L(0.3) - 0.02, z - r * 0.76, x + r * 0.76, y + h + L(0.3) + 0.02, z + r * 0.76, 'cylY', 0xa3a7ac, 0.85, 0.4);
    deco(x - r * 0.42, y + h + L(0.3), z - r * 0.3, x + r * 0.42, y + h + L(0.3) + 0.12, z + r * 0.3, 'cylY', 0xd5d8db, 0.9, 0.3);
    deco(x - r * 0.24, y + h + L(0.3) + 0.1, z - r * 0.16, x + r * 0.24, y + h + L(0.3) + 0.14, z + r * 0.16, 'cylY', 0x4c4f52, 0.5, 0.5);
  };
  for (let i = 0; i < 4; i++) can(bxm, b2 + 2, dz0 + L(8.5) + i * L(6), CANS[(i + seed) % CANS.length]);
  const jz2 = dz0 + L(40);
  solid(bxm - L(3.4), b2 + 2, jz2 - L(3.4), bxm + L(3.4), b2 + 2 + L(8), jz2 + L(3.4), 'cylY', 0xd7a521, 0, 0.1, 0.9);
  solid(bxm - L(3.6), b2 + 2 + L(8), jz2 - L(3.6), bxm + L(3.6), b2 + 2 + L(9.4), jz2 + L(3.6), 'cylY', 0xc8c9cb, 0.45, 0.6);
  for (const f of [0.3, 0.65]) deco(bxm - L(3.66), b2 + 2 + L(8 + 1.4 * f) - 0.08, jz2 - L(3.66), bxm + L(3.66), b2 + 2 + L(8 + 1.4 * f) + 0.08, jz2 + L(3.66), 'cylY', 0x9fa1a4, 0.8, 0.4);
  bottle(dz0 + L(51.5), L(2.4), L(13), 0x8c3a1c, 0.92, 0x1d1d1d, 0xe6d7b0, b2 + 2);
  const b3 = Y(64);
  bin(b3, Y(69));
  // eggs in a white rail, and a small butter dish
  const ez0 = dz0 + L(6);
  deco(dx1 + 1.7, b3 + 2, ez0 - L(1), binX1 - 1.7, b3 + 2 + L(1.6), ez0 + L(27), 'box', 0xf1f1ee, 0, 0.45);
  for (let i = 0; i < 6; i++) {
    const z = ez0 + L(1.5) + i * L(4.4);
    deco(bxm - L(2), b3 + 2 + L(1.4), z - L(2), bxm + L(2), b3 + 2 + L(2.1), z + L(2), 'cylY', 0xf6f6f3, 0, 0.45);
    solid(bxm - L(1.7), b3 + 2 + L(0.8), z - L(1.6), bxm + L(1.7), b3 + 2 + L(5.4), z + L(1.6), 'ball', 0xead9bb, 0, 0.55);
  }
  solid(bxm - L(3), b3 + 2, dz0 + L(40), bxm + L(3), b3 + 2 + L(1.4), dz0 + L(52), 'box', 0xf4f4f1, 0, 0.35);
  solid(bxm - L(2.4), b3 + 2 + L(1.4), dz0 + L(41.5), bxm + L(2.4), b3 + 2 + L(3.6), dz0 + L(50.5), 'box', 0xf2e49a, 0, 0.45);

  // ---- the chopping board: from the floor up to the glass shelf's front edge (the way in)
  const rise = gy + 1.2 - FLOOR;
  const reach = rise / 0.68;
  const bl = Math.sqrt(rise * rise + reach * reach);
  const bc = reach / bl;
  const bs = rise / bl;
  const bxc = ix1 - L(14);
  const byc = FLOOR + rise / 2 - 0.2;
  const bzc = bz1 - 0.8 + reach / 2;
  tilted(bxc, byc, bzc, L(8), 1.3, bl / 2, bc, bs, 'box', 0xc28c55, 0, 0.6);
  // (edges a shade darker, and a few fine grain lines along the top: a slab reads as a wooden board)
  for (const ex of [bxc - L(8) + 0.25, bxc + L(8) - 0.25]) {
    put(feature('part', ex, byc, bzc, { shape: 'plate', box: [ex - 0.3, byc - 1.32, bzc - bl / 2 + 0.3, ex + 0.3, byc + 1.32, bzc + bl / 2 - 0.3], path: [bc, bs], color: 0x9a6a3c, metal: 0, rough: 0.6 }));
  }
  for (let gx = bxc - L(7.4); gx < bxc + L(7.4); gx += L(rand(0.7, 1.6))) {
    // (on the top face: the centre moved out along the board's normal, (0, cos, sin))
    const gyc = byc + 1.33 * bc;
    const gzc = bzc + 1.33 * bs;
    const w = rand(0.025, 0.08);
    put(feature('part', gx, gyc, gzc, { shape: 'plate', box: [gx - w, gyc - 0.02, gzc - bl / 2 + 1.5, gx + w, gyc + 0.02, gzc + bl / 2 - 1.5], path: [bc, bs], color: rng() < 0.5 ? 0xb27d4a : 0xb98652, metal: 0, rough: 0.6 }));
  }

  for (const gx of [bxc - L(3.1), bxc + L(4.3)]) {
    const gyc = byc + 1.325 * bc;
    const gzc = bzc + 1.325 * bs;
    put(feature('part', gx, gyc, gzc, { shape: 'plate', box: [gx - L(0.35), gyc - 0.015, gzc - bl / 2 + 1, gx + L(0.35), gyc + 0.015, gzc + bl / 2 - 1], path: [bc, bs], color: 0xb98553, metal: 0, rough: 0.6 }));
  }

  // ---- on top of the fridge: a roll of kitchen paper, a mug, a box of tea
  const ry0 = bz0 + L(12);
  const rr = Math.min(L(4.6), (H - 3 - top) / 2);
  const kr0 = bx0 + L(6);
  const kr1 = kr0 + L(17);
  solid(kr0, top, ry0 - rr, kr1, top + 2 * rr, ry0 + rr, 'cylX', 0xf4f2ea, 0, 0.85, 1, 1.25);
  for (const x of [kr0 - 0.05, kr1 - L(0.45)]) {
    deco(x, top + rr - L(1.7), ry0 - L(1.7), x + L(0.5), top + rr + L(1.7), ry0 + L(1.7), 'cylX', 0x9a7650, 0, 0.8);
    deco(x - 0.02, top + rr - L(1.3), ry0 - L(1.3), x + L(0.54), top + rr + L(1.3), ry0 + L(1.3), 'cylX', 0x2a1e14, 0, 0.9);
  }
  // (the loose end of the paper, hanging down the front)
  deco(kr0 + L(0.3), top + L(0.4), ry0 + rr - 0.02, kr1 - L(0.3), top + rr, ry0 + rr + 0.1, 'plate', 0xf1efe7, 0, 0.9);
  const mx = bx1 - L(10);
  const mzz = bz0 + L(40);
  solid(mx - L(3.5), top, mzz - L(3.5), mx + L(3.5), top + L(8), mzz + L(3.5), 'cylY', 0x2f6ea6, 0, 0.3, 1, 1.25);
  deco(mx - L(3.1), top + L(7.6), mzz - L(3.1), mx + L(3.1), top + L(8.05), mzz + L(3.1), 'cylY', 0x3a2416, 0, 0.2);
  deco(mx + L(3.2), top + L(5.2), mzz - L(0.6), mx + L(5.6), top + L(6.2), mzz + L(0.6), 'box', 0x2f6ea6, 0, 0.3);
  deco(mx + L(3.2), top + L(1.8), mzz - L(0.6), mx + L(5.6), top + L(2.8), mzz + L(0.6), 'box', 0x2f6ea6, 0, 0.3);
  deco(mx + L(4.6), top + L(1.8), mzz - L(0.6), mx + L(5.6), top + L(6.2), mzz + L(0.6), 'box', 0x2f6ea6, 0, 0.3);
  solid(bx0 + L(32), top, bz0 + L(14), bx0 + L(46), top + L(7), bz0 + L(24), 'plate', 0xc59a5a, 0, 0.7, 1, 1.25);
  deco(bx0 + L(32) - 0.05, top + L(2.4), bz0 + L(14) - 0.05, bx0 + L(46) + 0.05, top + L(4.4), bz0 + L(24) + 0.05, 'plate', 0x2e7d5b, 0, 0.6);

  // ---- behind: the compressor in its bay, the condenser coil on the back
  const kx = ix1 - L(14);
  const kz = bz0 + L(0.5); // (half out of its bay, at the back: seen from behind)
  // (drawn: a smooth painted shell with a soft highlight; a lifted hidden body)
  const kr = L(5.5);
  solid(kx - kr, FLOOR, kz - kr, kx + kr, Y(8), kz + kr, 'cylY', 0x2c302e, 0.3, 0.38, 1, 1.25);
  deco(kx - kr, Y(8) - 0.05, kz - kr, kx + kr, Y(8) + L(4), kz + kr, 'dome', 0x2c302e, 0.3, 0.38);
  // (the dome's body stays inside the drawn dome, which is lower than a half ball)
  hide(sphere(kx, Y(8), kz, Math.min(kr, L(4)) - 0.5));
  deco(kx - kr - 0.4, FLOOR, kz - kr - 0.4, kx + kr + 0.4, FLOOR + L(1.2), kz + kr + 0.4, 'cylY', 0x1b1c1c, 0, 0.7);
  // the terminal box on its side (the power cable goes in there)
  solid(kx - kr - L(2.4), Y(1.8), kz - L(2.2), kx - kr + 0.6, Y(6.4), kz + L(2.2), 'box', 0x161717, 0, 0.6, 1, 1.25);
  /** A copper line through `pts` (x, y, z): straight runs, corners rounded tight; drawn only. */
  const copper = (pts: number[], r: number): void => {
    const out: number[] = [];
    const n = pts.length / 3;
    const P = (i: number, k: number): number => pts[i * 3 + k];
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1) {
        out.push(P(i, 0), P(i, 1), P(i, 2));
        continue;
      }
      // a fillet: from 0.8 before the corner to 0.8 after it, through a point pulled into the corner
      const la = Math.sqrt((P(i, 0) - P(i - 1, 0)) ** 2 + (P(i, 1) - P(i - 1, 1)) ** 2 + (P(i, 2) - P(i - 1, 2)) ** 2);
      const lb = Math.sqrt((P(i + 1, 0) - P(i, 0)) ** 2 + (P(i + 1, 1) - P(i, 1)) ** 2 + (P(i + 1, 2) - P(i, 2)) ** 2);
      const da = Math.min(0.8, la / 2) / la;
      const db = Math.min(0.8, lb / 2) / lb;
      const a = [P(i, 0) + (P(i - 1, 0) - P(i, 0)) * da, P(i, 1) + (P(i - 1, 1) - P(i, 1)) * da, P(i, 2) + (P(i - 1, 2) - P(i, 2)) * da];
      const b = [P(i, 0) + (P(i + 1, 0) - P(i, 0)) * db, P(i, 1) + (P(i + 1, 1) - P(i, 1)) * db, P(i, 2) + (P(i + 1, 2) - P(i, 2)) * db];
      out.push(...a, (a[0] + b[0]) / 4 + P(i, 0) / 2, (a[1] + b[1]) / 4 + P(i, 1) / 2, (a[2] + b[2]) / 4 + P(i, 2) / 2, ...b);
    }
    // (straight runs split every ~1.5 units, so the drawn curve stays on them)
    const dense: number[] = [out[0], out[1], out[2]];
    for (let i = 3; i < out.length; i += 3) {
      const l = Math.sqrt((out[i] - out[i - 3]) ** 2 + (out[i + 1] - out[i - 2]) ** 2 + (out[i + 2] - out[i - 1]) ** 2);
      const k = Math.max(1, Math.round(l / 1.5));
      for (let j = 1; j <= k; j++) dense.push(out[i - 3] + ((out[i] - out[i - 3]) * j) / k, out[i - 2] + ((out[i + 1] - out[i - 2]) * j) / k, out[i - 1] + ((out[i + 2] - out[i - 1]) * j) / k);
    }
    put(feature('wire', pts[0], pts[1], pts[2], { path: [r, ...dense], color: 0xc77b3f }));
  };
  const collar = (x: number, y: number, z: number): void => deco(x - 0.6, y - 0.45, z - 0.6, x + 0.6, y + 0.45, z + 0.6, 'cylY', 0xa8622c, 0.8, 0.35);
  // the coil: a black tube in a serpentine over the back (round bends, clear of the sides), on a hidden
  // slab, with thin steel wires across it
  hide(boxMinMax(bx0 + L(4), Y(15), bz0 - 3.6, bx1 - L(4), top - L(6), bz0));
  const coil: number[] = [];
  const rows = Math.max(6, Math.round(11 * s));
  const cy0c = Y(16);
  const pitch = (top - L(8) - cy0c) / rows;
  const cxl = bx0 + L(9);
  const cxr = bx1 - L(9);
  const cz = bz0 - 2.2;
  /** (cos, sin) of 0°, 22.5°, ... 180°: exact values (no Math.sin/cos in generators). */
  const HALF: readonly (readonly [number, number])[] = [
    [1, 0], [0.9238795325112867, 0.3826834323650898], [0.7071067811865476, 0.7071067811865476], [0.3826834323650898, 0.9238795325112867],
    [0, 1], [-0.3826834323650898, 0.9238795325112867], [-0.7071067811865476, 0.7071067811865476], [-0.9238795325112867, 0.3826834323650898], [-1, 0],
  ];
  for (let i = 0; i <= rows; i++) {
    const y = cy0c + pitch * i;
    // (row 0 starts on the right, over the compressor: its discharge line stays short)
    const toRight = i % 2 === 1;
    const xa = toRight ? cxl : cxr;
    const xb = toRight ? cxr : cxl;
    const n = Math.max(2, Math.round(Math.abs(xb - xa) / 2));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) coil.push(xa + ((xb - xa) * k) / n, y, cz);
    if (i < rows) {
      // a half-round bend up to the next row
      const d = toRight ? 1 : -1;
      const r = pitch / 2;
      for (let k = 1; k < HALF.length - 1; k++) coil.push(xb + d * r * HALF[k][1], y + r - r * HALF[k][0], cz);
    }
  }
  put(feature('wire', coil[0], coil[1], coil[2], { path: [0.55, ...coil], color: 0x161616 }));
  // the copper lines: the discharge line from the dome's top up into the coil's start just above it (on
  // the right), and the suction line from the dome's other side into the back panel
  const domeTop = Y(8) + L(4);
  copper([
    kx + L(2), domeTop - L(0.5), kz - L(1),
    kx + L(2), Y(14), kz - L(1),
    kx + L(2), Y(14), bz0 - L(3.4),
    cxr + L(2), Y(14), bz0 - L(3.4),
    cxr + L(2), cy0c, cz,
    cxr, cy0c, cz,
  ], 0.4);
  collar(kx + L(2), domeTop - L(0.3), kz - L(1));
  copper([
    kx - L(2.5), domeTop - L(0.6), kz - L(2),
    kx - L(2.5), Y(12.6), kz - L(2),
    kx - L(8), Y(12.6), kz - L(2),
    kx - L(8), Y(14.8), kz - L(2),
    kx - L(8), Y(14.8), bz0 + 0.3,
  ], 0.45);
  collar(kx - L(2.5), domeTop - L(0.4), kz - L(2));
  // the coil's other end bends into the back panel (the line to the evaporator inside)
  {
    const ty = cy0c + pitch * rows;
    const ex = rows % 2 === 0 ? cxl : cxr;
    const d = rows % 2 === 0 ? -1 : 1;
    put(feature('wire', ex, ty, cz, { path: [0.55, ex, ty, cz, ex + d * 0.9, ty, cz, ex + d * 1.6, ty, cz + 0.6, ex + d * 1.8, ty, cz + 1.4, ex + d * 1.8, ty, bz0 + 0.3], color: 0x161616 }));
  }
  for (let x = cxl + L(1); x < cxr; x += L(2.2)) rod(x, cy0c - L(1), bz0 - 1.3, x, top - L(7.5), bz0 - 1.3, 0.2, 0x2a2a2a, 0.45, false);
  // (high and back, white: close to the coil it lit the black tube orange, like copper)
  put(feature('lamp', kx - L(4), Y(34), bz0 - L(16), { color: 0xfff6ee, glow: 14, radius: 60 * s }));
  put(feature('heat', kx, Y(14), kz, { box: [kx - L(8), Y(10), kz - L(6), kx + L(8), Y(30), kz + L(6)] }));

  // ---- on the floor: an apple, a can on its side, an ice cube melting into a puddle
  const ax = bx1 + L(22) + rand(-4, 4) * s;
  const az = bz1 + L(24) + rand(-4, 4) * s;
  solid(ax - L(3.6), FLOOR, az - L(3.6), ax + L(3.6), FLOOR + L(6.8), az + L(3.6), 'ball', 0xb8302a, 0, 0.4, 1, 1.25);
  deco(ax - L(1.1), FLOOR + L(6.3), az - L(1.1), ax + L(1.1), FLOOR + L(6.95), az + L(1.1), 'ball', 0x6e1a12, 0, 0.5);
  deco(ax - 0.25, FLOOR + L(6.2), az - 0.25, ax + 0.25, FLOOR + L(8), az + 0.25, 'cylY', 0x4a3220, 0, 0.8);
  const kx2 = bx1 + L(42);
  const kz2 = bz1 + L(48);
  solid(kx2 - L(4.7), FLOOR, kz2 - L(2.6), kx2 + L(4.7), FLOOR + L(5.2), kz2 + L(2.6), 'cylX', CANS[(seed + 2) % CANS.length], 0.6, 0.32, 1, 1.25);
  for (const x of [kx2 - L(4.95), kx2 + L(4.5)]) deco(x, FLOOR + L(0.25), kz2 - L(2.35), x + L(0.45), FLOOR + L(4.95), kz2 + L(2.35), 'cylX', 0xc9ccd1, 0.9, 0.3);
  deco(kx2 - L(2.2), FLOOR - L(0.06), kz2 - L(2.66), kx2 + L(1.6), FLOOR + L(5.26), kz2 + L(2.66), 'cylX', 0xf2f2ee, 0, 0.5);
  const ux = bx1 + L(14);
  const uz = bz1 + L(52);
  // (the puddle: one thin clear film; the cube clear, faintly blue)
  put(feature('part', ux + L(0.6), FLOOR, uz + L(0.8), { shape: 'ball', box: [ux - L(5.6), FLOOR + 0.05, uz - L(3.4), ux + L(6.8), FLOOR + 0.14, uz + L(5)], color: 0xd8e8f0, metal: 0, rough: 0.02, opacity: 0.09 }));
  deco(ux - L(1.8), FLOOR, uz - L(1.8), ux + L(1.8), FLOOR + L(2.6), uz + L(1.8), 'soft', 0xe6f2ff, 0, 0.04, 0.3);

  giveBodies(terrain, drawn);
  terrain.commitGeneration();
};
