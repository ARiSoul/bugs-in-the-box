import { createRng } from '../noise';
import {
  ALUMINIUM,
  BLACK_PLASTIC,
  CABLE_YELLOW,
  CONE,
  DAMPER,
  FERRITE,
  FOAM,
  MDF,
  PCB,
  SLEEVE,
  STEEL,
  VINYL,
  WOOD,
} from '../materials';
import { add, box, boxMinMax, capsule, cone, cut, cylinder, paint, rotatedBox, sphere } from '../sdf';
import { createPlacement, detail, wire, wirePath } from './parts';
import { feature, resetLayout, type Feature, type TerrainGenerator } from './types';

/** Top of the desk the speaker lies on. */
export const DESK_TOP = 8;
/** The cabinet's low corner on the desk (x, z): the lit desk shows around it. */
export const CAB_X0 = 14;
export const CAB_Z0 = 12;
/** Thickness of the front baffle (the cabinet's floor, face down), of the walls, and of the wadding lining. */
const BAFFLE = 6;
const WALL = 5;
const LINING = 3.5;
/** Exact (cos, sin) of 45° and 22.5° (no Math.sin/cos in generators). */
const C45 = 0.7071067811865476;
const C22 = 0.9238795325112867;
const S22 = 0.3826834323650898;
/**
 * The woofer's basket frame (in units of the driver scale `k`, except the thickness): radius at the
 * ring and at the magnet, and the four windows (sill above the ring, head below the magnet, half width).
 * The renderer draws the ribs from the same numbers.
 */
export const BASKET_LOW = 31.5;
export const BASKET_HIGH = 22;
export const BASKET_THICK = 3;
export const WINDOW_SILL = 2;
export const WINDOW_HEAD = 1.6;
export const WINDOW_HALF = 14.5;
/** Colour of the speaker cable's foam sleeve (the renderer gives this colour a porous look). */
export const FOAM_SLEEVE_COLOR = 0x3a3b3e;

/**
 * Studio Monitor: an active studio speaker opened up for repair on a desk. The cabinet lies face down
 * with its back panel off, so the map looks into it from above; the amplifier plate that was the back
 * lies on the desk beside it, still wired to the drivers.
 *
 * Axes: the cabinet takes the low-x part of the map (x from 6 to ~0.62 W), the full depth in z; the
 * amp plate lies on the desk at high x. The desk ends before the far end of the cabinet (high z), so the
 * cabinet's port end hangs over the edge: the bass port is a slot down into the void.
 *
 * Set pieces: the woofer's back as the central hill (the cone, the basket arms, the golden spider and
 * the magnet tower on top, with a low gap under the magnet), the tweeter, the port duct, the wadding
 * on the walls and the rim to walk on; outside, the amp plate (heatsink, filter capacitors, the
 * transformer, the power board) and a screwdriver leaning on the cabinet, the ramp from the desk up to
 * the rim. Parts at least 2 cells thick, gaps at least 2 wide. The layout follows the map size
 * (5×3×5 and 3×2×3 both hold up); the seed varies the details.
 */
export const speaker: TerrainGenerator = (terrain, seed, layout) => {
  terrain.beginGeneration();
  if (layout) resetLayout(layout, terrain);
  const { W, H, D } = terrain;
  const rng = createRng(seed * 104729 + 31);
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const features: Feature[] | null = layout ? layout.features : null;
  const put = (f: Feature): void => {
    features?.push(f);
  };
  const part = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    material: number, shape: 'box' | 'cylX' | 'cylY' | 'cylZ', color: number, metal: number, rough: number,
  ): void => detail(terrain, features, x0, y0, z0, x1, y1, z1, material, shape, color, metal, rough);
  /** A render-only detail (too small or thin for the terrain). */
  const deco = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, shape: 'box' | 'cylX' | 'cylY' | 'cylZ', color: number, metal: number, rough: number, glow = 0): void =>
    put(feature('part', (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { shape, box: [x0, y0, z0, x1, y1, z1], color, metal, rough, glow }));
  /** A soft cable along `ctrl` (x, y, z control points); with a `material`, also in the terrain (thinner). */
  const cableAlong = (ctrl: number[], radius: number, color: number, material = -1, trim = 0): void => {
    const pts = wirePath(ctrl, 8);
    if (material >= 0) wire(terrain, trim > 0 ? pts.slice(trim * 3, -trim * 3) : pts, radius - 0.3, material);
    put(feature('wire', ctrl[0], ctrl[1], ctrl[2], { path: [radius, ...pts], color }));
  };

  const FLOOR = DESK_TOP + BAFFLE;
  const rim = DESK_TOP + Math.round((H - DESK_TOP) * 0.5);
  // the cabinet, and inside its lining
  const cx0 = CAB_X0;
  const cx1 = Math.round(W * 0.625);
  const cz0 = CAB_Z0;
  const cz1 = D - 6;
  const ix0 = cx0 + WALL + LINING;
  const ix1 = cx1 - WALL - LINING;
  const iz0 = cz0 + WALL + LINING;
  const iz1 = cz1 - WALL - LINING;
  const wx = (cx0 + cx1) / 2;
  /** Driver scale: the woofer fills the width between the linings. */
  const k = Math.min(1, (ix1 - ix0 - 8) / 70);
  const R = 33 * k; // woofer basket
  const wz = Math.round(cz0 + (cz1 - cz0) * 0.56);
  const tz = Math.round(cz0 + (cz1 - cz0) * 0.2);
  const pw = Math.min(31, (ix1 - ix0) / 2 - 5); // port half width
  const pz = iz1 - 2.5 - 6.4;
  const portH = Math.max(8, 20 * k);
  // the desk stops short of the port: the slot drops into the void
  const deskZ1 = Math.min(Math.round(D * 0.79), Math.floor(pz - 9));

  // the room's floor, far below the desk: a fall off the desk reads as a long drop (render only)
  put(feature('room', W / 2, -45, D / 2, { color: 0x6b4e35 }));
  if (layout) {
    layout.floorY = DESK_TOP;
    layout.inner = [2, DESK_TOP, 2, W - 2, rim, D - 2];
  }

  // ---- the cabinet: black vinyl outside, raw MDF inside and on the cut edge, a rebate where the back sat
  add(terrain, boxMinMax(cx0, DESK_TOP - 0.5, cz0, cx1, rim, cz1, 2), VINYL);
  cut(terrain, boxMinMax(cx0 + WALL, FLOOR, cz0 + WALL, cx1 - WALL, rim + 6, cz1 - WALL, 1));
  cut(terrain, boxMinMax(cx0 + 3, rim - 3, cz0 + 3, cx1 - 3, rim + 6, cz1 - 3, 0.5));
  // raw fibreboard inside (more than 2 cells in from the vinyl) and on the cut edge at the top
  paint(terrain, boxMinMax(cx0 + 2.2, DESK_TOP + 1, cz0 + 2.2, cx1 - 2.2, rim + 2, cz1 - 2.2), MDF);
  // the back panel's screw holes along the rebate
  for (let i = 0; i < 4; i++) {
    const z = cz0 + 12 + ((cz1 - cz0 - 24) * i) / 3;
    for (const x of [cx0 + 4, cx1 - 4]) deco(x - 0.8, rim - 3.05, z - 0.8, x + 0.8, rim - 2.9, z + 0.8, 'cylY', 0x060505, 0, 0.9);
  }

  // ---- wadding lining the walls: slabs with soft lumps on the inside
  const liningTop = rim - 7;
  add(terrain, boxMinMax(cx0 + WALL - 0.5, FLOOR - 0.5, cz0 + WALL - 0.5, ix0, liningTop, cz1 - WALL + 0.5, 1.2), FOAM);
  add(terrain, boxMinMax(ix1, FLOOR - 0.5, cz0 + WALL - 0.5, cx1 - WALL + 0.5, liningTop, cz1 - WALL + 0.5, 1.2), FOAM);
  add(terrain, boxMinMax(cx0 + WALL - 0.5, FLOOR - 0.5, cz0 + WALL - 0.5, cx1 - WALL + 0.5, liningTop, iz0, 1.2), FOAM);
  add(terrain, boxMinMax(cx0 + WALL - 0.5, FLOOR - 0.5, iz1, cx1 - WALL + 0.5, liningTop, cz1 - WALL + 0.5, 1.2), FOAM);
  // soft, broad billows: scattered at random (no grid), few and large, sunk deep into the slab (their
  // backs come out through the walls: trimmed below) (x, z on the slab face, `dir` into the cabinet)
  const billow = (x: number, y: number, z: number, axis: 0 | 2, dir: number): void => {
    const r = rand(4.5, 7);
    const sink = r - rand(1, 2.2);
    add(terrain, sphere(axis === 0 ? x - dir * sink : x, y, axis === 2 ? z - dir * sink : z, r), FOAM, 3.5);
  };
  const billows = (along: number, height: number): number => Math.round((along * height) / 90);
  for (let n = billows(iz1 - iz0, liningTop - FLOOR); n > 0; n--) {
    billow(ix0, rand(FLOOR + 4, liningTop - 4), rand(iz0 + 5, iz1 - 5), 0, 1);
    billow(ix1, rand(FLOOR + 4, liningTop - 4), rand(iz0 + 5, iz1 - 5), 0, -1);
  }
  for (let n = billows(ix1 - ix0, liningTop - FLOOR); n > 0; n--) {
    billow(rand(ix0 + 5, ix1 - 5), rand(FLOOR + 4, liningTop - 4), iz0, 2, 1);
    billow(rand(ix0 + 5, ix1 - 5), rand(FLOOR + 4, liningTop - 4), iz1, 2, -1);
  }
  // an uneven top edge: the wadding sags and bunches along the walls' tops (no straight piped bead)
  for (let z = iz0 + 4; z < iz1 - 4; z += rand(5, 9)) {
    add(terrain, sphere(ix0 - 1.5, liningTop - rand(0.5, 2.5), z, rand(2.2, 3.2)), FOAM, 1.8);
    add(terrain, sphere(ix1 + 1.5, liningTop - rand(0.5, 2.5), z + rand(-2, 2), rand(2.2, 3.2)), FOAM, 1.8);
  }
  for (let x = ix0 + 4; x < ix1 - 4; x += rand(5, 9)) {
    add(terrain, sphere(x, liningTop - rand(0.5, 2.5), iz0 - 1.5, rand(2.2, 3.2)), FOAM, 1.8);
    add(terrain, sphere(x + rand(-2, 2), liningTop - rand(0.5, 2.5), iz1 + 1.5, rand(2.2, 3.2)), FOAM, 1.8);
  }
  // the billows' soft fillets reach samples that kept the cabinet's material: all of it is wadding
  // (a band along the walls, above the floor, before anything else stands there)
  const band = 4.5;
  paint(terrain, boxMinMax(cx0 + WALL - 0.2, FLOOR + 0.7, cz0 + WALL - 0.2, ix0 + band, liningTop + 1.5, cz1 - WALL + 0.2), FOAM);
  paint(terrain, boxMinMax(ix1 - band, FLOOR + 0.7, cz0 + WALL - 0.2, cx1 - WALL + 0.2, liningTop + 1.5, cz1 - WALL + 0.2), FOAM);
  paint(terrain, boxMinMax(cx0 + WALL - 0.2, FLOOR + 0.7, cz0 + WALL - 0.2, cx1 - WALL + 0.2, liningTop + 1.5, iz0 + band), FOAM);
  paint(terrain, boxMinMax(cx0 + WALL - 0.2, FLOOR + 0.7, iz1 - band, cx1 - WALL + 0.2, liningTop + 1.5, cz1 - WALL + 0.2), FOAM);

  // trim the billows' backs that came out through the walls, give the outside its vinyl back, and the
  // cut top edge its raw fibreboard
  const top = rim + 4;
  cut(terrain, boxMinMax(cx0 - 8, DESK_TOP + 0.5, cz0 - 8, cx0, top, cz1 + 8));
  cut(terrain, boxMinMax(cx1, DESK_TOP + 0.5, cz0 - 8, cx1 + 8, top, cz1 + 8));
  cut(terrain, boxMinMax(cx0 - 8, DESK_TOP + 0.5, cz0 - 8, cx1 + 8, top, cz0));
  cut(terrain, boxMinMax(cx0 - 8, DESK_TOP + 0.5, cz1, cx1 + 8, top, cz1 + 8));
  paint(terrain, boxMinMax(cx0 - 0.5, DESK_TOP - 1, cz0, cx0 + 1.4, rim, cz1), VINYL);
  paint(terrain, boxMinMax(cx1 - 1.4, DESK_TOP - 1, cz0, cx1 + 0.5, rim, cz1), VINYL);
  paint(terrain, boxMinMax(cx0, DESK_TOP - 1, cz0 - 0.5, cx1, rim, cz0 + 1.4), VINYL);
  paint(terrain, boxMinMax(cx0, DESK_TOP - 1, cz1 - 1.4, cx1, rim, cz1 + 0.5), VINYL);
  paint(terrain, boxMinMax(cx0 + 1.2, rim - 0.6, cz0 + 1.2, cx1 - 1.2, rim + 2, cz1 - 1.2), MDF);

  // ---- the desk
  add(terrain, boxMinMax(2.5, 2.5, 2.5, W - 2.5, DESK_TOP, deskZ1, 1), WOOD);
  // a pale edge band along the desk's sides: where the desk ends (and the drop begins) reads from afar
  deco(2.35, 2.8, deskZ1 - 0.6, W - 2.35, DESK_TOP - 0.4, deskZ1 + 0.15, 'box', 0xc08a52, 0, 0.45);
  deco(W - 2.6, 2.8, 2.35, W - 2.35 + 0.2, DESK_TOP - 0.4, deskZ1 + 0.15, 'box', 0xc08a52, 0, 0.45);
  deco(2.15, 2.8, 2.35, 2.6, DESK_TOP - 0.4, deskZ1 + 0.15, 'box', 0xc08a52, 0, 0.45);
  deco(2.35, 2.8, 2.15, W - 2.35, DESK_TOP - 0.4, 2.6, 'box', 0xc08a52, 0, 0.45);

  // ---- the woofer, from behind: basket ring with screw ears, the basket frame, the cone, the spider,
  // the magnet tower. (The smooth stand-ins are drawn at these sizes; the terrain under the round parts
  // is a little smaller, so its steps stay hidden inside them.)
  const coneTop = FLOOR + 12 * k;
  const plateY = FLOOR + 20 * k;
  const ringTop = FLOOR + 2.4;
  add(terrain, cylinder(wx, FLOOR + 1.2, wz, R - 0.4, 1.2, 1, 0.6), BLACK_PLASTIC);
  for (const [ex, ez] of [[C45, C45], [-C45, C45], [-C45, -C45], [C45, -C45]]) {
    const x = wx + ex * (R - 1);
    const z = wz + ez * (R - 1);
    add(terrain, box(x, FLOOR + 1.2, z, 3.4 * k + 0.4, 1.2, 3.4 * k + 0.4, 1), BLACK_PLASTIC);
    deco(x - 1.3, ringTop + 0.3, z - 1.3, x + 1.3, ringTop + 1, z + 1.3, 'cylY', 0x1d1e21, 0.8, 0.4);
  }
  // the basket frame: a conical stamped shell from the ring up to the magnet, with four wide windows
  // (on the diagonals) between four flat ribs (on the axes); the cone shows through the windows
  // (the terrain shell a little inside the drawn one, both faces; it stops under the drawn collar)
  add(terrain, cone(wx, ringTop - 0.5, wz, BASKET_LOW * k - 0.3, plateY, BASKET_HIGH * k - 0.3), BLACK_PLASTIC);
  cut(terrain, cone(wx, ringTop, wz, BASKET_LOW * k - BASKET_THICK + 0.3, plateY + 0.01, BASKET_HIGH * k - BASKET_THICK + 0.3));
  for (const [ex, ez] of [[C45, C45], [-C45, C45], [-C45, -C45], [C45, -C45]]) {
    const y0 = ringTop + WINDOW_SILL;
    const y1 = plateY - WINDOW_HEAD;
    cut(terrain, rotatedBox(wx + ex * 27 * k, (y0 + y1) / 2, wz + ez * 27 * k, 9 * k, (y1 - y0) / 2, WINDOW_HALF * k, 1, ex, ez, 0.8));
  }
  add(terrain, cone(wx, FLOOR, wz, 29 * k, coneTop, 9 * k), CONE);
  cut(terrain, cone(wx, FLOOR - 2.6, wz, 29 * k, coneTop - 2.6, 9 * k));
  // the spider: a corrugated golden disc on the cone's neck, a low gap under the magnet's bottom plate
  // (and a wedge of air between it and the cone, open all round)
  const spiderTop = FLOOR + 14 * k;
  // (the terrain disc stops short of the drawn rim, which tapers over it: thin cloth from the side)
  add(terrain, cylinder(wx, spiderTop - 1.1, wz, 17 * k, 1.1, 1, 0.8), DAMPER);
  add(terrain, cylinder(wx, (spiderTop + plateY) / 2, wz, 7 * k - 0.4, (plateY - spiderTop) / 2 + 0.5, 1, 0.5), BLACK_PLASTIC);
  add(terrain, cylinder(wx, plateY + 1.25 * k, wz, 22.5 * k - 0.6, 1.25 * k, 1, 0.8), STEEL);
  add(terrain, cylinder(wx, plateY + 6.5 * k, wz, 21 * k - 0.6, 4 * k, 1, 1), FERRITE);
  const magnetTop = plateY + 13 * k;
  add(terrain, cylinder(wx, magnetTop - 1.25 * k, wz, 19.5 * k - 0.6, 1.25 * k, 1, 1.2), STEEL);
  add(terrain, cylinder(wx, magnetTop + 0.4, wz, 4.5 * k - 0.4, 0.4, 1, 0.4), STEEL);
  put(feature('driver', wx, FLOOR, wz, { radius: R, box: [wx - R, FLOOR, wz - R, wx + R, magnetTop + 1, wz + R], path: [coneTop, spiderTop, plateY, magnetTop] }));
  // the terminals on the basket ring (by the +x rib), and the wires into them
  const termX = wx + C22 * (R + 0.5);
  const termZ = wz - S22 * (R + 0.5);
  part(termX - 2.2, FLOOR + 2.4, termZ - 3, termX + 2.2, FLOOR + 5.2, termZ + 3, BLACK_PLASTIC, 'box', 0x141416, 0, 0.6);
  deco(termX - 0.6, FLOOR + 5.2, termZ - 2.4, termX + 0.6, FLOOR + 6.8, termZ - 1, 'box', 0xb8221c, 0.2, 0.5);
  deco(termX - 0.6, FLOOR + 5.2, termZ + 1, termX + 0.6, FLOOR + 6.8, termZ + 2.4, 'box', 0x18181a, 0.2, 0.5);

  // ---- the tweeter: face plate, housing and the steel cup of its magnet
  const tk = Math.max(0.45, k);
  add(terrain, box(wx, FLOOR + 1.1, tz, 12 * tk - 0.3, 1.1, 12 * tk - 0.3, 1.5), BLACK_PLASTIC);
  add(terrain, cylinder(wx, FLOOR + 2.2 + 3.5 * tk, tz, 9.5 * tk - 0.5, 3.5 * tk, 1, 1.2), BLACK_PLASTIC);
  add(terrain, cylinder(wx, FLOOR + 2.2 + 7 * tk + 2 * tk, tz, 7 * tk - 0.5, 2 * tk, 1, 1.4), STEEL);
  put(feature('driver', wx, FLOOR, tz, { radius: 12 * tk, axis: 1, facing: -1, box: [wx - 12 * tk, FLOOR, tz - 12 * tk, wx + 12 * tk, FLOOR + 2.2 + 11 * tk, tz + 12 * tk] }));
  for (const [ex, ez] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    deco(wx + ex * 9.5 * tk - 0.9, FLOOR + 2.15, tz + ez * 9.5 * tk - 0.9, wx + ex * 9.5 * tk + 0.9, FLOOR + 2.8, tz + ez * 9.5 * tk + 0.9, 'cylY', 0x1d1e21, 0.8, 0.4);
  }
  // the tweeter's two solder tabs, where its wires end
  for (const off of [-0.6, 0.6]) deco(wx + 9 * tk - 0.2, FLOOR + 2.4, tz + 3 + off - 0.35, wx + 9 * tk + 1.2, FLOOR + 4.2, tz + 3 + off + 0.35, 'box', 0xc9cdd2, 1, 0.3);
  // crossover wires from the tweeter along the lining to the woofer's terminals (render only, thin)
  for (const [off, color] of [[-0.6, 0xb8221c], [0.6, 0x18181a]] as const) {
    cableAlong([
      wx + 9 * tk, FLOOR + 3.2, tz + 3 + off,
      wx + 13 * tk + 2, FLOOR + 0.6, tz + 6 + off,
      ix1 - 3.5 + off, FLOOR + 0.6, tz + 14,
      ix1 - 3.5 + off, FLOOR + 0.6, termZ - 14,
      termX + 3, FLOOR + 3, termZ - 6,
      termX + off, FLOOR + 6.2, termZ + (off < 0 ? -1.7 : 1.7),
    ], 0.45, color);
  }

  // ---- the bass port: a slot duct with flared lips, open through the baffle (over the desk's edge)
  add(terrain, boxMinMax(wx - pw, FLOOR - 1, pz - 5, wx + pw, FLOOR + portH, pz + 5, 1.2), BLACK_PLASTIC);
  add(terrain, boxMinMax(wx - pw - 1.4, FLOOR + portH - 2.2, pz - 6.4, wx + pw + 1.4, FLOOR + portH, pz + 6.4, 1), BLACK_PLASTIC);
  cut(terrain, boxMinMax(wx - pw + 2.6, 0, pz - 2.5, wx + pw - 2.6, FLOOR + portH + 5, pz + 2.5, 0.8));
  put(feature('port', wx, FLOOR + portH, pz, { radius: pw, box: [wx - pw - 1.4, FLOOR - 1, pz - 6.4, wx + pw + 1.4, FLOOR + portH, pz + 6.4], path: [wx - pw + 2.6, pz - 2.5, wx + pw - 2.6, pz + 2.5, DESK_TOP - 1] }));

  // ---- wadding clumps on the floor, where nothing stands
  const clear = (x: number, z: number, r: number): boolean => {
    if (x - r < ix0 + 1 || x + r > ix1 - 1 || z - r < iz0 + 1 || z + r > iz1 - 1) return false;
    if ((x - wx) * (x - wx) + (z - wz) * (z - wz) < (R + r + 3) * (R + r + 3)) return false;
    if (Math.abs(x - wx) < 12 * tk + r + 3 && Math.abs(z - tz) < 12 * tk + r + 3) return false;
    if (z + r > pz - 6.4 - 3 && Math.abs(x - wx) < pw + 1.4 + r + 3) return false;
    return true;
  };
  const spots = [
    [ix0 + 7, iz0 + 7],
    [ix1 - 7, iz0 + 7],
    [ix0 + 7, (tz + wz) / 2],
    [ix1 - 7, (tz + wz) / 2 + 6],
    [ix0 + 7, wz + R],
    [ix1 - 7, wz + R + 4],
  ];
  for (let n = 0, i = Math.floor(rng() * spots.length); n < spots.length; n++, i = (i + 1) % spots.length) {
    const [x, z] = spots[i];
    if (!clear(x, z, 6)) continue;
    // a loose, low clump torn off the lining: several soft billows, none round enough to read as a stone
    for (let j = 0; j < 7; j++) add(terrain, sphere(x + rand(-4.5, 4.5), FLOOR + rand(-0.5, 1.5), z + rand(-4.5, 4.5), rand(2.2, 3.4)), FOAM, 2);
    if (rng() < 0.4) break;
  }

  // ---- the amp plate on the desk (the cabinet's back): painted black, the boards facing up
  const ax0 = cx1 + 9;
  const ax1 = W - 11;
  const az0 = 16;
  const az1 = deskZ1 - 13;
  const ka = Math.min(1, (ax1 - ax0) / 48);
  const PT = DESK_TOP + 2;
  add(terrain, boxMinMax(ax0, DESK_TOP - 0.6, az0, ax1, PT, az1, 0.6), VINYL);
  for (let i = 0; i <= 4; i++) {
    const z = az0 + 3 + ((az1 - az0 - 6) * i) / 4;
    for (const x of [ax0 + 2.6, ax1 - 2.6]) deco(x - 0.8, PT - 0.05, z - 0.8, x + 0.8, PT + 0.1, z + 0.8, 'cylY', 0x020202, 0, 0.9);
  }
  const { free, claim } = createPlacement(W, D, 2);
  claim(0, 0, ax0, D); // only the plate is placed on
  claim(0, az1, W, D);
  const PB = PT + 2;
  // the amplifier board
  const bz1 = az0 + Math.round(64 * ka);
  add(terrain, boxMinMax(ax0 + 4, PT - 0.4, az0 + 4, ax1 - 4, PB, bz1, 0.5), PCB);
  // traces: thin flat lines under the solder mask (a lighter green), tinned pads at their ends
  // (render only: flush with the board, nothing to walk over)
  for (let n = Math.round(((ax1 - ax0) * (bz1 - az0)) / 110); n > 0; n--) {
    let x = rand(ax0 + 7, ax1 - 7);
    let z = rand(az0 + 7, bz1 - 4);
    for (let leg = 0; leg < 2; leg++) {
      const alongX = (leg + n) % 2 === 0;
      const len = rand(5, 16) * (rng() < 0.5 ? -1 : 1);
      const x2 = alongX ? Math.min(ax1 - 6, Math.max(ax0 + 6, x + len)) : x;
      const z2 = alongX ? z : Math.min(bz1 - 3, Math.max(az0 + 6, z + len));
      deco(Math.min(x, x2) - 0.35, PB - 0.02, Math.min(z, z2) - 0.35, Math.max(x, x2) + 0.35, PB + 0.12, Math.max(z, z2) + 0.35, 'box', 0x2f7a45, 0, 0.45);
      x = x2;
      z = z2;
    }
    deco(x - 0.8, PB - 0.02, z - 0.8, x + 0.8, PB + 0.2, z + 0.8, 'cylY', 0xc9c6bc, 0.9, 0.35);
  }
  // heatsink along the board's far edge: a finned aluminium block, the amp chips on its inner face
  const hx0 = ax0 + 7;
  const hx1 = ax1 - 7;
  const hz0 = az0 + 6;
  const hz1 = az0 + 6 + Math.max(6, 9 * ka);
  const hTop = PB + Math.max(10, 20 * ka);
  add(terrain, boxMinMax(hx0, PB - 0.5, hz0, hx1, hTop, hz1, 0.5), ALUMINIUM);
  // deep fins over most of the height, on a thin base
  // (open at both ends, so the fins show from the board side too)
  for (let x = hx0 + 2; x + 2 <= hx1 - 2; x += 4) cut(terrain, boxMinMax(x, PB + 2, hz0 - 1, x + 2, hTop + 1, hz1 + 1, 0.3));
  claim(hx0 - 1, hz0 - 1, hx1 + 1, hz1 + 2.5);
  for (let i = 0; i < 3; i++) {
    const x = hx0 + ((hx1 - hx0) * (i + 1)) / 4;
    part(x - 2.2, PB + 0.5, hz1, x + 2.2, PB + 7.5, hz1 + 1.4, BLACK_PLASTIC, 'box', 0x111113, 0, 0.45);
    deco(x - 0.9, PB + 5, hz1 + 1.4, x + 0.9, PB + 6.8, hz1 + 2, 'cylZ', 0xb4b9c0, 1, 0.3);
  }
  put(feature('heat', (hx0 + hx1) / 2, hTop, (hz0 + hz1) / 2, { box: [hx0, hTop + 1, hz0, hx1, hTop + 16, hz1] }));
  // filter capacitors: two big, one smaller
  const capRow = hz1 + 7 * ka + 4;
  for (const [dx, r, h] of [[8, 4.2, 13], [18, 4.2, 13], [28, 3.4, 10]] as const) {
    const x = ax0 + 4 + dx * ka;
    const rr = Math.max(2.2, r * ka);
    const hh = Math.max(6, h * ka);
    if (!free(x - rr - 0.8, capRow - rr - 0.8, x + rr + 0.8, capRow + rr + 0.8)) continue;
    claim(x - rr - 0.8, capRow - rr - 0.8, x + rr + 0.8, capRow + rr + 0.8);
    add(terrain, cylinder(x, PB + hh / 2, capRow, rr, hh / 2, 1, 1), BLACK_PLASTIC);
    add(terrain, cylinder(x, PB + hh + 0.1, capRow, rr - 0.7, 0.6, 1, 0.5), STEEL);
    put(feature('capacitor', x, PB, capRow, { radius: rr, box: [x - rr, PB, capRow - rr, x + rr, PB + hh + 0.7, capRow + rr] }));
  }
  // small parts: film capacitors (yellow), op-amps, small electrolytics, cable sockets, the volume pot
  const scatter = (count: number, w: number, d: number, place: (x: number, z: number) => void): void => {
    for (let placed = 0, tries = 0; placed < count && tries < 80; tries++) {
      const x = rand(ax0 + 6, ax1 - 6 - w);
      const z = rand(az0 + 6, bz1 - 2 - d);
      if (!free(x - 1, z - 1, x + w + 1, z + d + 1)) continue;
      claim(x - 1, z - 1, x + w + 1, z + d + 1);
      place(x, z);
      placed++;
    }
  };
  scatter(5, 4, 4, (x, z) => {
    const r = rand(1.5, 2);
    const h = rand(4, 6);
    add(terrain, cylinder(x + 2, PB + h / 2, z + 2, r, h / 2, 1, 0.8), BLACK_PLASTIC);
    put(feature('capacitor', x + 2, PB, z + 2, { radius: r, box: [x + 2 - r, PB, z + 2 - r, x + 2 + r, PB + h + 0.3, z + 2 + r] }));
  });
  scatter(2, 2.6, 5, (x, z) => part(x, PB, z, x + 2.6, PB + 4.5, z + 5, CABLE_YELLOW, 'box', 0xd8b21c, 0, 0.45));
  scatter(2, 4, 5, (x, z) => part(x, PB, z, x + 4, PB + 1, z + 5, BLACK_PLASTIC, 'box', 0x111113, 0, 0.4));
  scatter(2, 6, 3.5, (x, z) => part(x, PB, z, x + 6, PB + 3.2, z + 3.5, BLACK_PLASTIC, 'box', 0xe8e4da, 0, 0.55));
  const potX = ax1 - 11;
  const potZ = bz1 - 6;
  if (free(potX - 4, potZ - 4, potX + 4, potZ + 4)) {
    claim(potX - 4, potZ - 4, potX + 4, potZ + 4);
    part(potX - 3, PB, potZ - 3, potX + 3, PB + 4.5, potZ + 3, STEEL, 'cylY', 0x9aa0a8, 0.9, 0.35);
    deco(potX - 1.2, PB + 4.5, potZ - 1.2, potX + 1.2, PB + 7.5, potZ + 1.2, 'cylY', 0xc9cdd2, 1, 0.3);
  }
  put(feature('led', ax1 - 6, PB + 1.6, az0 + 8 + 30 * ka, { color: 0x3dff6a }));
  deco(ax1 - 7, PB, az0 + 7 + 30 * ka, ax1 - 5, PB + 1.2, az0 + 9 + 30 * ka, 'box', 0x202022, 0, 0.5);

  // the power section: the transformer, the power board, the mains inlet and switch
  const pz0 = bz1 + 6;
  const tx0 = ax0 + 6;
  const tx1 = ax0 + 6 + Math.max(10, 18 * ka);
  const tz0 = pz0 + 3;
  const tz1 = pz0 + 3 + Math.max(9, 15 * ka);
  if (tz1 + 3 < az1) {
    add(terrain, boxMinMax(tx0, PT - 0.4, tz0, tx1, PT + Math.max(9, 15 * ka), tz1, 0.6), STEEL);
    add(terrain, boxMinMax(tx0 + 3, PT + 2, tz0 - 2.5, tx1 - 3, PT + Math.max(7, 13 * ka), tz1 + 2.5, 1.5), CABLE_YELLOW);
    const th = Math.max(9, 15 * ka);
    // the laminated core (dark steel), its clamp frame, the label on the winding, the mounting feet
    put(feature('part', (tx0 + tx1) / 2, PT, (tz0 + tz1) / 2, { shape: 'box', box: [tx0 + 0.15, PT, tz0 + 0.15, tx1 - 0.15, PT + th - 0.15, tz1 - 0.15], color: 0x2c2e32, metal: 0.55, rough: 0.6 }));
    // the stacked sheets show as fine lines on the core's top and its two open sides
    for (let x = tx0 + 1.2; x < tx1 - 0.8; x += 1.4) deco(x, PT + th - 0.2, tz0 + 0.4, x + 0.12, PT + th - 0.05, tz1 - 0.4, 'box', 0x15161a, 0.4, 0.7);
    for (let y = PT + 1; y < PT + th - 1; y += 1.1) {
      deco(tx0 - 0.02, y, tz0 + 0.5, tx0 + 0.12, y + 0.12, tz1 - 0.5, 'box', 0x15161a, 0.4, 0.7);
      deco(tx1 - 0.12, y, tz0 + 0.5, tx1 + 0.02, y + 0.12, tz1 - 0.5, 'box', 0x15161a, 0.4, 0.7);
    }
    deco(tx0 - 0.3, PT + th - 1.6, tz0 + 0.8, tx1 + 0.3, PT + th + 0.15, tz0 + 2.6, 'box', 0x8a8f96, 0.9, 0.4);
    deco(tx0 - 0.3, PT + th - 1.6, tz1 - 2.6, tx1 + 0.3, PT + th + 0.15, tz1 - 0.8, 'box', 0x8a8f96, 0.9, 0.4);
    deco(tx0 + 4.5, PT + 4, tz0 - 2.75, tx1 - 4.5, PT + th - 6, tz0 - 2.6, 'box', 0xe9e6de, 0, 0.7);
    for (const z of [tz0 - 1.5, tz1 + 0.5]) deco(tx0 - 2, PT, z, tx1 + 2, PT + 0.6, z + 1, 'box', 0x7d838c, 0.9, 0.45);
    claim(tx0 - 1, tz0 - 3.5, tx1 + 1, tz1 + 3.5);
  }
  const sx0 = tx1 + 4;
  if (sx0 + 12 < ax1 - 4 && pz0 + 22 * ka + 4 < az1) {
    const sz1 = pz0 + Math.max(14, 22 * ka);
    add(terrain, boxMinMax(sx0, PT - 0.4, pz0, ax1 - 5, PB, sz1, 0.5), PCB);
    claim(sx0, pz0, ax1 - 5, sz1);
    part(sx0 + 3, PB, pz0 + 3, sx0 + 10, PB + 6.5, pz0 + 10, CABLE_YELLOW, 'box', 0xd8b21c, 0, 0.5);
    for (const [dx, dz] of [[14, 5], [14, 13]]) {
      const x = sx0 + dx;
      const z = pz0 + dz;
      if (x + 3 > ax1 - 6 || z + 3 > sz1) continue;
      add(terrain, cylinder(x, PB + 3.5, z, 2.4, 3.5, 1, 0.8), BLACK_PLASTIC);
      put(feature('capacitor', x, PB, z, { radius: 2.4, box: [x - 2.4, PB, z - 2.4, x + 2.4, PB + 7.3, z + 2.4] }));
    }
    part(sx0 + 3, PB, sz1 - 6, sx0 + 11, PB + 7, sz1 - 4, ALUMINIUM, 'box', 0xa8adb4, 0.85, 0.4);
  }
  if (az1 - 15 > pz0 + 20 * ka) {
    // the mains inlet's body with its fuse drawer and three spade terminals, and the power switch
    part(ax0 + 6, PT, az1 - 14, ax0 + 20, PT + 7, az1 - 4, BLACK_PLASTIC, 'box', 0x121214, 0, 0.6);
    deco(ax0 + 8, PT + 7, az1 - 12.5, ax0 + 13, PT + 7.6, az1 - 10, 'box', 0x1c1c1f, 0, 0.5);
    for (const dx of [8, 12.5, 17]) deco(ax0 + dx - 0.9, PT + 7, az1 - 7.4, ax0 + dx + 0.9, PT + 9.2, az1 - 7, 'box', 0xc9b98a, 1, 0.35);
    part(ax0 + 25, PT, az1 - 12, ax0 + 32, PT + 6, az1 - 5, BLACK_PLASTIC, 'box', 0x121214, 0, 0.5);
    deco(ax0 + 26.5, PT + 6, az1 - 10, ax0 + 30.5, PT + 7.2, az1 - 7, 'box', 0x8a1a16, 0, 0.5);
    for (const dz of [-10.5, -6.5]) deco(ax0 + 32, PT + 2, az1 + dz - 0.4, ax0 + 33.6, PT + 4.4, az1 + dz + 0.4, 'box', 0xc9b98a, 1, 0.35);
    cableAlong([ax0 + 12.5, PT + 9, az1 - 7.2, ax0 + 14, PT + 12, az1 - 2, ax0 + 30, PT + 9, az1 - 1, ax0 + 33.8, PT + 3.2, az1 - 6.5], 0.5, 0x18181a);
  }
  // wires between the boards (render only)
  cableAlong([tx1 - 2, PT + 10, tz1 + 2, (tx1 + sx0) / 2, PT + 7, tz1 + 4, sx0 + 4, PB + 3, pz0 + 6], 0.5, 0xb8221c);
  cableAlong([tx1 - 4, PT + 10, tz0 - 2, (tx1 + sx0) / 2, PT + 9, pz0 - 4, ax1 - 14, PB + 3, bz1 - 3], 0.5, 0xe8e4da);
  cableAlong([ax0 + 14, PT + 7, az1 - 9, ax0 + 14, PT + 6, tz1 + 6, tx0 + 4, PT + 10, tz1 + 2], 0.5, 0x18181a);

  // ---- the speaker cables in a foam sleeve: from the woofer's terminals over the rim to the amp board
  const overZ = wz - 24 * k - 6;
  cableAlong([
    termX + 1, FLOOR + 5.6, termZ - 4,
    ix1 - 3, FLOOR + 9, termZ - 10,
    ix1 - 2, liningTop + 2, overZ + 4,
    cx1 - 2.5, rim + 1.6, overZ,
    cx1 + 2.2, rim - 6, overZ - 2,
    cx1 + 3.5, PT + 10, overZ - 6,
    ax0 + 10, PB + 2.5, Math.min(bz1 - 4, overZ - 14),
  ], 1.9, FOAM_SLEEVE_COLOR, SLEEVE, 2);

  // ---- the screwdriver, its tip on the desk and its handle on the rim: the ramp into the cabinet
  // (a bug climbs onto the thin tip from the desk, walks up the shaft and over the handle)
  const sz = deskZ1 - 6;
  const p0x = W - 8;
  const p0y = DESK_TOP + 1.1; // the tip rests on the desk: a low step up from it
  const p1x = cx1 - 1.5;
  const p1y = rim + 3.2;
  const len = Math.sqrt((p1x - p0x) * (p1x - p0x) + (p1y - p0y) * (p1y - p0y));
  const ux = (p1x - p0x) / len;
  const uy = (p1y - p0y) / len;
  const seg = (t0: number, t1: number, r: number, material: number, color: number, metal: number, rough: number, more: Partial<Feature> = {}): void => {
    const x0 = p0x + ux * t0;
    const y0 = p0y + uy * t0;
    const x1 = p0x + ux * t1;
    const y1 = p0y + uy * t1;
    add(terrain, capsule(x0, y0, sz, x1, y1, sz, r - 0.2), material);
    put(feature('rod', x0, y0, sz, { radius: r, path: [x0, y0, sz, x1, y1, sz], color, metal, rough, ...more }));
  };
  const handle = len - Math.min(24, len * 0.34);
  // the tip: a thinner rod under the drawn flat blade (the blade covers it), then the shaft
  const tipLen = 3;
  add(terrain, capsule(p0x + ux * 0.6, p0y - 0.4 + uy * 0.6, sz, p0x + ux * tipLen, p0y + uy * tipLen, sz, 0.95), STEEL);
  seg(tipLen, handle - 3, 1.5, STEEL, 0xc4c8ce, 1, 0.25, { facing: -1 }); // (a blade before its start)
  seg(handle - 3, handle, 2.2, STEEL, 0xb4b9c0, 1, 0.3);
  seg(handle, len, 3.2, CABLE_YELLOW, 0xd98e1a, 0, 0.25, { axis: 0 }); // (a fluted grip)

  terrain.commitGeneration();
};
