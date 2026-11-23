import { giveBodies } from './bodies';
import { createRng } from '../noise';
import {
  ALUMINIUM,
  BLACK_PLASTIC,
  CABLE_BLUE,
  CABLE_RED,
  COLLIDER,
  COPPER,
  GOLD,
  PCB,
  RGB_LIGHT,
  SHROUD,
  SILICON,
  STEEL,
} from '../materials';
import { add, box, boxMinMax, cut, cylinder, torus } from '../sdf';
import type { Terrain } from '../Terrain';
import { cable, createPlacement, detail, fan, ribbon, wire, wirePath, type Vec3 } from './parts';
import { feature, resetLayout, type TerrainGenerator } from './types';

/** Height of the top of the motherboard. */
export const BOARD_TOP = 16;
/** Top of the steel tray the board lies on. */
const TRAY_TOP = 13;
/** Case walls: 3 cells thick, inside the two outer layers that always stay air. */
const WALL0 = 2;
const WALL1 = 5;
/** Width of the cable cutouts: a bug that falls in drops out of the map. */
const CUTOUT = 6;

/**
 * Tower Case: a gaming tower lying on its side, seen through a glass side panel (render-only, at
 * `layout.glassY`). Steel walls close the box; the motherboard lies on the steel tray.
 *
 * Axes: the front wall is at low z (liquid-cooler radiator), the rear wall at high z (vents, I/O
 * shield, the vertical graphics card); the PSU shroud runs along the low-x edge ("bottom" of the
 * tower), and cable cutouts run beside the board on both long edges.
 *
 * Set pieces: the AIO wall (radiator, two fans and the tube bridges to the pump), the vertical GPU on
 * its riser with a ribbon cable as a low bridge, the PSU shroud plateau with its 24-pin bundle, and the
 * RGB RAM row beside the pump. Parts at least 2 cells thick, gaps at least 2 wide, round rims ≥ 1 cell.
 * The layout follows the map size (5×3×5 and 3×2×3 both hold up); the seed moves and varies the parts.
 */
export const pcCase: TerrainGenerator = (terrain, seed, layout) => {
  terrain.beginGeneration();
  if (layout) resetLayout(layout, terrain);
  const { W, H, D } = terrain;
  const rng = createRng(seed * 7919 + 13);
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const s = Math.min(1, Math.min(W, D) / 160);
  const P = BOARD_TOP;
  const glassY = H - 6;
  const { free, claim } = createPlacement(W, D, WALL1 + 2);
  /** Everything drawn (with or without a layout), for `giveBodies`. */
  const drawn: ReturnType<typeof feature>[] = [];
  const put = (f: ReturnType<typeof feature>): void => {
    drawn.push(f);
    if (layout) layout.features.push(f);
  };
  /** A detail: a terrain block (the destructible part) and a clean render shape over it. */
  const part = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    material: number, shape: 'box' | 'cylX' | 'cylY' | 'cylZ', color: number, metal: number, rough: number,
  ): void => detail(terrain, layout ? layout.features : null, x0, y0, z0, x1, y1, z1, material, shape, color, metal, rough);
  /**
   * A soft cable from `a` (rising off it) to `b` (coming in level along `axis`, from its `facing` side),
   * through the `via` points (x, y, z triples), or sagging by `sag` without them. With a `material` (>= 0)
   * the terrain gets the cable too, `radius - 0.3` thick, so bugs can walk on it; the renderer draws the
   * same polyline as a smooth tube of `radius`.
   */
  const softCable = (a: Vec3, b: Vec3, sag: number, axis: 0 | 2, facing: number, via: number[], radius: number, color: number, material: number): void => {
    const ctrl = [a[0], a[1], a[2], a[0], a[1] + 2.2, a[2]];
    if (via.length > 0) {
      ctrl.push(...via);
    } else {
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const top = Math.max(a[1], b[1]);
      ctrl.push(a[0] + dx * 0.3, top + 3 - sag * 0.4, a[2] + dz * 0.28, a[0] + dx * 0.62, top + 2 - sag, a[2] + dz * 0.66);
    }
    ctrl.push(b[0] + (axis === 0 ? facing * 3 : 0), b[1] + 0.6, b[2] + (axis === 2 ? facing * 3 : 0), b[0], b[1], b[2]);
    const pts = wirePath(ctrl, 8);
    // (the solid cable stops one span short of each end: the bends into the plugs would poke out of the tube)
    if (material >= 0) wire(terrain, pts.slice(24, -24), radius - 0.3, material);
    // (a drawn-only lead still stops bugs: a hidden collision body along it)
    else wire(terrain, pts, Math.max(0.55, radius * 0.9), COLLIDER, true);
    put(feature('wire', a[0], a[1], a[2], { path: [radius, ...pts], color }));
  };
  if (layout) {
    layout.glassY = glassY;
    layout.floorY = BOARD_TOP;
    layout.inner = [WALL1, TRAY_TOP, WALL1, W - WALL1, glassY, D - WALL1];
  }

  // ---- the case: four steel walls up to the glass, and the tray
  add(terrain, boxMinMax(WALL0, WALL0, WALL0, W - WALL0, glassY, WALL1, 0.5), STEEL); // front
  add(terrain, boxMinMax(WALL0, WALL0, D - WALL1, W - WALL0, glassY, D - WALL0, 0.5), STEEL); // rear
  add(terrain, boxMinMax(WALL0, WALL0, WALL0, WALL1, glassY, D - WALL0, 0.5), STEEL); // bottom edge
  add(terrain, boxMinMax(W - WALL1, WALL0, WALL0, W - WALL0, glassY, D - WALL0, 0.5), STEEL); // top edge
  add(terrain, boxMinMax(WALL1 - 1, TRAY_TOP - 6, WALL1 - 1, W - WALL1 + 1, TRAY_TOP, D - WALL1 + 1, 0.5), STEEL);

  // ---- layout on the board plane
  const psuX1 = Math.round(WALL1 + Math.max(12, 20 * s)); // PSU shroud: x from the wall to here
  const bx0 = psuX1 + CUTOUT + 4; // board
  const bx1 = W - WALL1 - CUTOUT - 5;
  const radDepth = 10; // radiator thickness (z), fans add 4
  const bz0 = WALL1 + radDepth + 4 + Math.round(4 + 6 * s);
  const bz1 = D - WALL1 - 4;
  claim(0, 0, psuX1 + 1, D); // the shroud
  claim(0, 0, W, bz0 - 1); // the radiator wall

  // ---- cable cutouts beside the board on both long edges, with rubber grommet rims
  const cutA = psuX1 + 2;
  const cutB = bx1 + 2;
  // the rim runs into the shroud and along its whole base: no rim end meets the shroud face (that corner creases)
  // (the hole starts 3 cells from the shroud face: a 2-cell strip of rim between them melts into a crease)
  cutout(terrain, cutA + 1, D * 0.24, cutA + CUTOUT, D * 0.76, psuX1 - 1.5, WALL1 - 1, D - WALL1 + 1);
  cutout(terrain, cutB, D * 0.3, cutB + CUTOUT, D * 0.7);
  claim(cutA - 2, 0, cutA + CUTOUT + 2, D);
  claim(cutB - 2, 0, W, D);

  // ---- motherboard
  add(terrain, boxMinMax(bx0, TRAY_TOP - 0.5, bz0, bx1, P, bz1, 0.8), PCB);

  // ---- stiffening ribs along the side walls (the walls are long flat steel otherwise)
  for (const ry of [P + 22, P + 44]) {
    if (ry + 2 > glassY - 4) continue;
    part(W - WALL1 - 1.2, ry, WALL1 + 6, W - WALL1, ry + 1.6, D - WALL1 - 6, STEEL, 'box', 0x5d6168, 0.8, 0.45);
    part(WALL1, ry + 6, WALL1 + 6, WALL1 + 1.2, ry + 7.6, D - WALL1 - 6, STEEL, 'box', 0x5d6168, 0.8, 0.45);
  }

  // stamped panels and cable tie-down slots on the side walls (render-only: thin details on solid steel)
  const shelfY = P + 12;
  for (const [wx, sx] of [
    [WALL1, 1],
    [W - WALL1, -1],
  ] as const) {
    const y0 = wx === WALL1 ? shelfY + 3 : P + 3;
    const y1 = Math.min(glassY - 4, y0 + 18);
    if (y1 - y0 < 8) continue;
    for (const [za, zb] of [
      [D * 0.12, D * 0.44],
      [D * 0.56, D * 0.88],
    ]) {
      const xa = sx > 0 ? wx - 0.2 : wx - 0.6;
      put(feature('part', wx, (y0 + y1) / 2, (za + zb) / 2, { shape: 'box', box: [xa, y0 + 1, za, xa + 0.8, y1 - 1, zb], color: 0x50545b, metal: 0.8, rough: 0.5 }));
      for (let z = za + 3; z + 2 <= zb - 3; z += 6) {
        const xs = sx > 0 ? wx + 0.55 : wx - 0.75;
        put(feature('part', wx, y1 - 3, z + 1, { shape: 'box', box: [xs, y1 - 3.6, z, xs + 0.2, y1 - 2.4, z + 2.4], color: 0x0b0c0e, metal: 0, rough: 0.8 }));
      }
    }
  }

  // ---- copper traces with gold pads (under everything else)
  const pads: number[] = [];
  // the board's mounting holes (placed below): traces keep clear of them
  const holes: [number, number][] = [
    [bx0 + 5, bz0 + 5],
    [bx1 - 5, bz0 + 5],
    [bx0 + 5, bz1 - 5],
    [bx1 - 5, bz1 - 5],
    [(bx0 + bx1) / 2, bz1 - 5],
  ];
  const nearHole = (x0: number, z0: number, x1: number, z1: number): boolean => {
    for (const [hx, hz] of holes) if (x0 < hx + 5.5 && x1 > hx - 5.5 && z0 < hz + 5.5 && z1 > hz - 5.5) return true;
    return false;
  };
  for (let n = Math.round(((bx1 - bx0) * (bz1 - bz0)) / 520); n > 0; n--) {
    let x = rand(bx0 + 4, bx1 - 4);
    let z = rand(bz0 + 4, bz1 - 4);
    for (let leg = 0; leg < 3; leg++) {
      const alongX = (leg & 1) === 0;
      const len = rand(6, 26) * (rng() < 0.5 ? -1 : 1);
      const x2 = alongX ? Math.min(bx1 - 3, Math.max(bx0 + 3, x + len)) : x;
      const z2 = alongX ? z : Math.min(bz1 - 3, Math.max(bz0 + 3, z + len));
      const tb: [number, number, number, number, number, number] = [Math.min(x, x2) - 1.25, P - 0.5, Math.min(z, z2) - 1.25, Math.max(x, x2) + 1.25, P + 1.5, Math.max(z, z2) + 1.25];
      if (!nearHole(tb[0], tb[2], tb[3], tb[5])) {
        add(terrain, boxMinMax(tb[0], tb[1], tb[2], tb[3], tb[4], tb[5], 0.5), COPPER);
        put(feature('trace', (tb[0] + tb[3]) / 2, P, (tb[2] + tb[5]) / 2, { box: tb }));
      }
      x = x2;
      z = z2;
    }
    pads.push(x, z); // placed last, where nothing stands on them (see the end)
  }

  // ---- mounting holes: copper ring and a steel screw head
  for (const [hx, hz] of holes) {
    add(terrain, torus(hx, P, hz, 3.2, 1), COPPER);
    add(terrain, cylinder(hx, P + 1, hz, 2.4, 1, 1, 0.8), STEEL);
    put(feature('screw', hx, P, hz, { radius: 3.2 }));
    claim(hx - 4.5, hz - 4.5, hx + 4.5, hz + 4.5);
  }

  // ---- CPU socket and the AIO pump block with its RGB ring
  const sock = Math.max(9, 15 * s);
  const cx = Math.round(bx0 + (bx1 - bx0) * 0.32 + rand(-3, 3) * s);
  const cz = Math.round(bz0 + (bz1 - bz0) * 0.28 + rand(-3, 3) * s);
  add(terrain, boxMinMax(cx - sock, P, cz - sock, cx + sock, P + 2.5, cz + sock, 0.5), BLACK_PLASTIC);
  claim(cx - sock - 2, cz - sock - 2, cx + sock + 2, cz + sock + 2);
  const pumpR = Math.max(8, 10 * s);
  const pumpTop = P + 2.5 + Math.max(7, 9 * s);
  add(terrain, cylinder(cx, (P + 2.5 + pumpTop) / 2, cz, pumpR, (pumpTop - P - 2.5) / 2, 1, 1.5), BLACK_PLASTIC);
  // the glowing ring lies on the top face, inside the rounded rim, around an aluminium cap
  add(terrain, cylinder(cx, pumpTop, cz, pumpR - 6, 1.3, 1, 1), ALUMINIUM);
  add(terrain, torus(cx, pumpTop, cz, pumpR - 3.2, 1), RGB_LIGHT);
  put(feature('pump', cx, pumpTop, cz, { radius: pumpR - 3.2 }));
  put(feature('heat', cx, pumpTop, cz, { box: [cx - pumpR, pumpTop + 1, cz - pumpR, cx + pumpR, pumpTop + 15, cz + pumpR] }));

  // ---- VRM heatsinks along two sides of the socket, and the 8-pin CPU power
  const vrm = (x0: number, z0: number, x1: number, z1: number): void => {
    if (!free(x0, z0, x1, z1)) return;
    claim(x0, z0, x1, z1);
    add(terrain, boxMinMax(x0, P, z0, x1, P + 7, z1, 0.6), SHROUD);
    // fins across the long side (cut 2 wide, 2 apart)
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let t = 2; t + 2 <= len - 2; t += 4) {
      if (alongX) cut(terrain, boxMinMax(x0 + t, P + 4, z0 - 1, x0 + t + 2, P + 8, z1 + 1, 0.3));
      else cut(terrain, boxMinMax(x0 - 1, P + 4, z0 + t, x1 + 1, P + 8, z0 + t + 2, 0.3));
    }
  };
  vrm(cx - sock, cz + sock + 3, cx + sock, cz + sock + 9);
  vrm(cx - sock - 10, cz - sock, cx - sock - 3, cz + sock);
  if (free(cx - sock - 9, cz - sock - 9, cx - sock - 3, cz - sock - 2)) {
    claim(cx - sock - 9, cz - sock - 9, cx - sock - 3, cz - sock - 2);
    part(cx - sock - 8.5, P, cz - sock - 8.5, cx - sock - 3.5, P + 5, cz - sock - 2.5, BLACK_PLASTIC, 'box', 0x15161a, 0, 0.55);
  }

  // ---- RGB RAM row beside the pump: four sticks with light bars
  const ramHalf = Math.max(12, 30 * s - 6);
  const ramTop = P + Math.max(14, 19 * s);
  let ramX = cx + sock + 6;
  for (let n = 0; n < 4; n++, ramX += 6) {
    if (!free(ramX - 2.5, cz - ramHalf - 1, ramX + 2.5, cz + ramHalf + 1)) break;
    claim(ramX - 2.5, cz - ramHalf - 1, ramX + 2.5, cz + ramHalf + 1);
    add(terrain, boxMinMax(ramX - 2, P, cz - ramHalf - 1, ramX + 2, P + 3, cz + ramHalf + 1, 0.4), BLACK_PLASTIC);
    add(terrain, boxMinMax(ramX - 1.8, P + 2.5, cz - ramHalf + 1.5, ramX + 1.8, ramTop - 0.5, cz + ramHalf - 1.5, 0.5), SHROUD);
    put(feature('ramBody', ramX, P + 2.5, cz, { box: [ramX - 1.8, P + 2.5, cz - ramHalf + 1.5, ramX + 1.8, ramTop - 0.5, cz + ramHalf - 1.5] }));
    add(terrain, boxMinMax(ramX - 1.2, ramTop - 0.5, cz - ramHalf + 2.5, ramX + 1.2, ramTop + 1.6, cz + ramHalf - 2.5, 0.6), RGB_LIGHT);
    put(feature('lightBar', ramX, ramTop + 1.6, cz, { box: [ramX - 1.2, ramTop - 0.5, cz - ramHalf + 2.5, ramX + 1.2, ramTop + 1.6, cz + ramHalf - 2.5] }));
  }

  // ---- capacitor towers around the socket
  for (let placed = 0, tries = 0; placed < 8 && tries < 200; tries++) {
    const side = Math.floor(rng() * 4);
    const along = rand(-sock, sock);
    const off = sock + rand(4, 7);
    const x = cx + (side === 0 ? -off : side === 1 ? off : along);
    const z = cz + (side === 2 ? -off : side === 3 ? off : along);
    const r = rand(2.2, 2.8);
    if (!free(x - r - 0.8, z - r - 0.8, x + r + 0.8, z + r + 0.8)) continue;
    claim(x - r - 0.8, z - r - 0.8, x + r + 0.8, z + r + 0.8);
    const h = rand(6, 10);
    add(terrain, cylinder(x, P + h / 2, z, r, h / 2, 1, 1), BLACK_PLASTIC);
    add(terrain, cylinder(x, P + h + 0.1, z, r - 0.7, 0.6, 1, 0.5), STEEL);
    put(feature('capacitor', x, P, z, { radius: r, box: [x - r, P, z - r, x + r, P + h + 0.7, z + r] }));
    placed++;
  }

  // ---- AIO radiator on the front wall: an aluminium fin comb between two end tanks, two fans
  const radLen = Math.max(40, Math.round(64 * s));
  const radH = Math.max(16, Math.round(24 * s));
  const rx0 = Math.round((bx0 + bx1) / 2 - radLen / 2);
  const rx1 = rx0 + radLen;
  const rz0 = WALL1;
  const rz1 = WALL1 + radDepth;
  const ry0 = TRAY_TOP;
  const ry1 = TRAY_TOP + radH;
  add(terrain, boxMinMax(rx0, ry0, rz0, rx0 + 5, ry1, rz1, 0.6), BLACK_PLASTIC); // end tanks
  add(terrain, boxMinMax(rx1 - 5, ry0, rz0, rx1, ry1, rz1, 0.6), BLACK_PLASTIC);
  add(terrain, boxMinMax(rx0 + 5, ry0, rz0, rx1 - 5, ry0 + 2, rz1, 0.3), ALUMINIUM); // rails
  // (no top rail: the fin comb shows from above)
  for (let x = rx0 + 7; x + 2 <= rx1 - 7; x += 4) add(terrain, boxMinMax(x, ry0 + 2, rz0 + 0.5, x + 2, ry1, rz1 - 0.5, 0.4), ALUMINIUM);
  const fanHalf = radH / 2;
  const fanR = fanHalf - 1.5;
  const fanZ = rz1 + 2;
  for (const fx of [rx0 + radLen * 0.27, rx0 + radLen * 0.73]) {
    const fy = (ry0 + ry1) / 2;
    fan(terrain, fx, fy, fanZ, 2, fanHalf, fanR, true);
    add(terrain, torus(fx, fy, fanZ + 2, fanR + 0.3, 1, 2), RGB_LIGHT);
    put(feature('fan', fx, fy, fanZ, { axis: 2, radius: fanR }));
  }
  // two thick black tubes from the pump to the end tank nearer to it: walkable bridges
  const tankX = Math.abs(rx0 + 2.5 - cx) < Math.abs(rx1 - 2.5 - cx) ? rx0 + 2.5 : rx1 - 2.5;
  const lift = Math.max(8, 12 * s);
  // they leave the side of the pump block (like elbow fittings), clear of the ring on top
  const tubeA: Vec3 = [cx - pumpR - 0.8, P + 6, cz - 4];
  const tubeB: Vec3 = [cx - pumpR - 0.8, P + 6, cz + 4];
  const tubeEndA: Vec3 = [tankX, ry1, rz0 + 2.2];
  const tubeEndB: Vec3 = [tankX, ry1, rz1 - 2.2];
  cable(terrain, tubeA, tubeEndA, lift, BLACK_PLASTIC, 2.2, 28);
  cable(terrain, tubeB, tubeEndB, lift + 3, BLACK_PLASTIC, 2.2, 28);
  put(feature('tube', tubeA[0], tubeA[1], tubeA[2], { path: [...tubeA, ...tubeEndA, lift, 2.2] }));
  put(feature('tube', tubeB[0], tubeB[1], tubeB[2], { path: [...tubeB, ...tubeEndB, lift + 3, 2.2] }));

  // ---- PSU shroud plateau along the bottom edge: steel shelf with grommet holes, 24-pin bundle
  const shelfTop = P + 12;
  add(terrain, boxMinMax(WALL1 - 1, TRAY_TOP - 1, WALL1 - 1, psuX1, shelfTop, D - WALL1 + 1, 1), STEEL);
  add(terrain, boxMinMax(psuX1 - 1.2, shelfTop - 2.5, D * 0.12, psuX1 + 0.4, shelfTop - 0.5, D * 0.88, 0.5), RGB_LIGHT);
  put(feature('lightBar', psuX1 - 0.4, shelfTop - 0.5, D / 2, { box: [psuX1 - 1.2, shelfTop - 2.5, D * 0.12, psuX1 + 0.4, shelfTop - 0.5, D * 0.88] }));
  const grommetZ = [D * 0.3, cz, D * 0.72];
  for (const gz of grommetZ) {
    const gx = psuX1 - 6;
    cut(terrain, cylinder(gx, shelfTop, gz, 3.6, 2.5, 1, 1));
    put(feature('grommet', gx, shelfTop, gz, { radius: 3.6 }));
  }
  // 24-pin connector on the board edge, and its bundle (three strands, zip-tied) out of a grommet
  const atxX = bx0 + 4;
  add(terrain, boxMinMax(atxX - 2, P, cz - 7, atxX + 2.5, P + 5, cz + 7, 0.4), BLACK_PLASTIC);
  claim(atxX - 3, cz - 8, atxX + 3.5, cz + 8);
  for (let k = -1; k <= 1; k++) {
    const from: Vec3 = [psuX1 - 6, shelfTop - 1, cz + k * 2.9];
    const to: Vec3 = [atxX, P + 5, cz + k * 2.9];
    cable(terrain, from, to, Math.max(6, 9 * s), BLACK_PLASTIC, 1.5, 18);
    // sleeved strands, white between black
    put(feature('tube', from[0], from[1], from[2], { path: [...from, ...to, Math.max(6, 9 * s), 1.5], color: k === 0 ? 0xbcbdc1 : 0x16161a }));
  }
  put(feature('connector', atxX, P, cz, { box: [atxX - 2, P, cz - 7, atxX + 2.5, P + 5, cz + 7] }));
  for (const u of [0.3, 0.7]) {
    // zip ties: bands around the bundle where it crests (a slightly wider rounded box)
    const zx = psuX1 - 6 + (atxX - psuX1 + 6) * u;
    add(terrain, box(zx, shelfTop + Math.max(6, 9 * s) - 0.5, cz, 1, 2.4, 5.6, 0.8), SHROUD);
  }

  // ---- vertical GPU on a riser bracket by the rear wall, fans facing +x, and the riser ribbon
  const cardLen = Math.max(28, Math.round(64 * s - 8));
  const cardH = Math.max(18, Math.round(26 * s));
  const gx = bx1 - 12;
  const gz1 = D - WALL1 - 2;
  const gz0 = gz1 - cardLen;
  const gy0 = P + 4;
  const gy1 = gy0 + cardH;
  add(terrain, boxMinMax(gx - 6, P, gz0 - 1, gx + 10, gy0, gz1, 0.6), STEEL); // riser bracket foot
  add(terrain, boxMinMax(gx - 1, gy0, gz0, gx + 1, gy1, gz1, 0.3), PCB);
  add(terrain, boxMinMax(gx + 1, gy0 + 0.5, gz0 + 0.5, gx + 3, gy1 - 0.5, gz1 - 0.5, 0.5), ALUMINIUM); // backplate
  add(terrain, boxMinMax(gx - 8, gy0 + 1, gz0 + 1.5, gx - 1, gy1 - 1, gz1 - 1, 0.9), SHROUD);
  add(terrain, boxMinMax(gx - 1, gy0, gz1 - 1, gx + 5, gy1 + 2, gz1 + 1, 0.4), STEEL); // bracket on the rear wall
  const nFans = cardLen / 3 >= 15 ? 3 : 2;
  const gfR = Math.min(cardH / 2 - 2.5, cardLen / nFans / 2 - 2);
  for (let f = 0; f < nFans; f++) {
    const fz = gz0 + (cardLen * (f + 0.5)) / nFans;
    const fy = (gy0 + gy1) / 2;
    fan(terrain, gx - 6, fy, fz, 0, 0, gfR, false);
    add(terrain, torus(gx - 8, fy, fz, gfR + 0.3, 1, 0), RGB_LIGHT);
    put(feature('fan', gx - 6, fy, fz, { axis: 0, facing: -1, radius: gfR }));
  }
  add(terrain, boxMinMax(gx - 2, gy1, gz0 + cardLen * 0.55, gx + 3, gy1 + 3, gz0 + cardLen * 0.75, 0.4), BLACK_PLASTIC); // power plug
  put(feature('heat', gx + 2, gy1, (gz0 + gz1) / 2, { box: [gx - 9, gy1 + 1, gz0, gx + 5, gy1 + 17, gz1] }));
  claim(gx - 10, gz0 - 2, gx + 11, D);
  // PCIe slot on the board, riser ribbon arching from it onto the bracket foot: a low bridge
  const slotZ = gz0 - 12;
  const pcie = free(gx, slotZ - 3, gx + 11, slotZ + 3);
  if (pcie) {
    add(terrain, boxMinMax(gx, P, slotZ - 2, gx + 11, P + 3, slotZ + 2, 0.4), BLACK_PLASTIC);
    claim(gx, slotZ - 3, gx + 11, slotZ + 3);
  }
  ribbon(terrain, [gx + 6.5, P + 2.5, slotZ], [gx + 6.5, gy0, gz0 + 3], 5, SHROUD, 3, 1, 14);

  // ---- rear I/O: shield plate on the rear wall, the backs of the port stacks, and an I/O cover
  // (the port faces look out of the back of the case; from inside we see their housings)
  const ioX0 = bx0 + 2;
  const ioX1 = ioX0 + Math.max(18, 30 * s);
  const ioZ = D - WALL1; // inner face of the rear wall
  add(terrain, boxMinMax(ioX0, TRAY_TOP, ioZ - 1.5, ioX1, P + 16, ioZ + 0.5, 0.4), ALUMINIUM);
  claim(ioX0 - 1, ioZ - 24, ioX1 + 1, D);
  // I/O cover: a dark shroud over the left part of the stack, with an RGB slash on top
  const coverX1 = ioX0 + (ioX1 - ioX0) * 0.42;
  part(ioX0, P, ioZ - 20, coverX1, P + 18, ioZ - 1.5, SHROUD, 'box', 0x1d1f24, 0.4, 0.5);
  // a brushed aluminium top plate: light neutral grey, with fine grooves along it
  put(feature('part', (ioX0 + coverX1) / 2, P + 18.1, ioZ - 11, { shape: 'box', box: [ioX0 + 0.6, P + 17.9, ioZ - 19.4, coverX1 - 0.6, P + 18.3, ioZ - 2.1], color: 0x9aa0a8, metal: 0.9, rough: 0.3 }));
  for (let gx2 = ioX0 + 4.5; gx2 < coverX1 - 1.2; gx2 += 1.4) {
    put(feature('part', gx2, P + 18.3, ioZ - 11, { shape: 'box', box: [gx2 - 0.12, P + 18.25, ioZ - 18.8, gx2 + 0.12, P + 18.34, ioZ - 2.7], color: 0x6c727b, metal: 0.9, rough: 0.45 }));
  }
  for (let k = 0; k < 5; k++) {
    const vy = P + 4 + k * 2.4;
    put(feature('part', coverX1, vy, ioZ - 11, { shape: 'box', box: [coverX1 - 0.1, vy - 0.45, ioZ - 17, coverX1 + 0.12, vy + 0.45, ioZ - 5], color: 0x060607, metal: 0, rough: 0.9 }));
  }
  add(terrain, boxMinMax(ioX0 + 1.5, P + 17, ioZ - 16, ioX0 + 3.5, P + 19.5, ioZ - 4, 0.6), RGB_LIGHT);
  put(feature('lightBar', ioX0 + 2.5, P + 19.5, ioZ - 10, { box: [ioX0 + 1.5, P + 17, ioZ - 16, ioX0 + 3.5, P + 19.5, ioZ - 4] }));
  // port housings, left to right: USB stack, Ethernet (two activity LEDs) under USB, fast USB, Wi-Fi antennas, audio
  let px = coverX1 + 1;
  const portW = Math.max(3, (ioX1 - coverX1 - 4) / 4.5);
  const opening = (x0: number, y0: number, x1: number, y1: number, z: number): void => {
    put(feature('part', (x0 + x1) / 2, (y0 + y1) / 2, z, { shape: 'box', box: [x0, y0, z - 0.12, x1, y1, z + 0.05], color: 0x060607, metal: 0, rough: 0.9 }));
  };
  part(px, P, ioZ - 6, px + portW, P + 9, ioZ - 1.5, STEEL, 'box', 0xb9bec6, 0.85, 0.35); // USB stack
  opening(px + 0.6, P + 1.6, px + portW - 0.6, P + 3.4, ioZ - 6);
  opening(px + 0.6, P + 5.4, px + portW - 0.6, P + 7.2, ioZ - 6);
  px += portW + 1;
  part(px, P, ioZ - 7, px + portW, P + 7, ioZ - 1.5, BLACK_PLASTIC, 'box', 0x15161a, 0, 0.55); // RJ45
  put(feature('led', px + 0.8, P + 7.6, ioZ - 6.5, { color: 0x3dff6a }));
  put(feature('led', px + portW - 0.8, P + 7.6, ioZ - 6.5, { color: 0xffa21a }));
  opening(px + 0.7, P + 1.2, px + portW - 0.7, P + 5.4, ioZ - 7);
  part(px, P + 7, ioZ - 6, px + portW, P + 12, ioZ - 1.5, STEEL, 'box', 0xb9bec6, 0.85, 0.35); // USB on top
  opening(px + 0.6, P + 8.6, px + portW - 0.6, P + 10.4, ioZ - 6);
  px += portW + 1;
  part(px, P, ioZ - 6, px + portW, P + 10, ioZ - 1.5, STEEL, 'box', 0x5a8fd6, 0.6, 0.4); // fast USB (blue)
  opening(px + 0.6, P + 2, px + portW - 0.6, P + 3.8, ioZ - 6);
  opening(px + 0.6, P + 6, px + portW - 0.6, P + 7.8, ioZ - 6);
  px += portW + 1;
  for (const y of [P + 4, P + 10]) {
    // Wi-Fi antenna connectors: gold threaded barrels through the shield
    part(px + portW / 2 - 1.1, y - 1.1, ioZ - 4, px + portW / 2 + 1.1, y + 1.1, ioZ - 1.5, GOLD, 'cylZ', 0xd9a441, 1, 0.3);
  }
  const antennaX = px + portW / 2;
  px += portW * 0.5 + 1;
  const audioX1 = Math.min(px + portW, ioX1 - 0.5);
  part(px, P, ioZ - 6, audioX1, P + 13, ioZ - 1.5, BLACK_PLASTIC, 'box', 0x15161a, 0, 0.55); // audio jacks
  // the audio jacks' coloured rings, on the side of the stack
  const jackColours = [0x2f7fe0, 0x34c759, 0xff5ca8];
  for (let k = 0; k < 3; k++) {
    put(feature('part', px - 0.2, P + 2.5 + k * 4, ioZ - 3.5, { shape: 'cylX', box: [px - 0.5, P + 1.6 + k * 4, ioZ - 4.4, px + 0.1, P + 3.4 + k * 4, ioZ - 2.6], color: jackColours[k], metal: 0, rough: 0.4, glow: 0.3 }));
  }

  // ---- network and Wi-Fi: Wi-Fi card (M.2 E-key) with its antenna leads, LAN controller
  const wifiZ = ioZ - 30;
  if (free(antennaX - 6, wifiZ - 4, antennaX + 6, wifiZ + 4)) {
    claim(antennaX - 6, wifiZ - 4, antennaX + 6, wifiZ + 4);
    part(antennaX - 5, P, wifiZ - 3, antennaX + 5, P + 1.4, wifiZ + 3, PCB, 'box', 0x1d5a35, 0, 0.6);
    part(antennaX - 3.5, P + 1.4, wifiZ - 2.2, antennaX + 2.5, P + 2.6, wifiZ + 2.2, STEEL, 'box', 0xc4c8cf, 0.9, 0.3); // RF shield
    const leads: [number, number][] = [
      [-1, P + 4],
      [1, P + 10],
    ];
    for (const [k, y] of leads) {
      softCable([antennaX + k * 1.2, P + 2.9, wifiZ + 1.6], [antennaX, y, ioZ - 4], 4, 2, -1, [], 0.42, 0x9aa0a8, -1); // too thin to walk on
      put(feature('part', antennaX + k * 1.2, P + 2.9, wifiZ + 1.6, { shape: 'cylY', box: [antennaX + k * 1.2 - 0.6, P + 2.5, wifiZ + 1, antennaX + k * 1.2 + 0.6, P + 3.2, wifiZ + 2.2], color: 0xd9a441, metal: 1, rough: 0.3 }));
    }
  }
  if (free(antennaX + 7, wifiZ - 3, antennaX + 13, wifiZ + 3)) {
    claim(antennaX + 7, wifiZ - 3, antennaX + 13, wifiZ + 3);
    part(antennaX + 8, P, wifiZ - 2.5, antennaX + 12.5, P + 1.4, wifiZ + 2, SILICON, 'box', 0x1b1c20, 0.1, 0.45); // LAN controller
  }

  // ---- audio corner: codec under a metal shield, audio capacitors, a light line along the divide
  const ax0 = bx0 + 2;
  const az1 = ioZ - 26;
  const az0 = az1 - Math.max(14, 22 * s);
  if (free(ax0, az0, ax0 + 18, az1)) {
    claim(ax0, az0, ax0 + 18, az1);
    part(ax0 + 2, P, az1 - 8, ax0 + 8, P + 1.6, az1 - 2, STEEL, 'box', 0xaeb3ba, 0.8, 0.58); // codec shield
    for (let i = 0; i < 6; i++) {
      const x = ax0 + 3 + (i % 3) * 4.5;
      const z = az0 + 3 + Math.floor(i / 3) * 4.5;
      part(x - 1.3, P, z - 1.3, x + 1.3, P + 3, z + 1.3, GOLD, 'cylY', 0xd9a441, 0.8, 0.35);
    }
    add(terrain, boxMinMax(ax0 + 15, P - 0.4, az0, ax0 + 17, P + 0.8, az1, 0.3), RGB_LIGHT);
    put(feature('lightBar', ax0 + 16, P + 0.8, (az0 + az1) / 2, { box: [ax0 + 15, P - 0.4, az0, ax0 + 17, P + 0.8, az1] }));
  }

  // ---- PCIe slots: two armoured x16, two x1, a CMOS battery, and a wide chipset / M.2 cover
  const sx0 = bx0 + Math.max(16, 24 * s);
  const sx1 = Math.min(gx - 12, sx0 + Math.max(30, 44 * s));
  let sz = cz + sock + 16;
  const slots = ['x16', 'x1', 'x16', 'x1'];
  for (const kind of slots) {
    const len = kind === 'x16' ? sx1 - sx0 : Math.max(8, (sx1 - sx0) * 0.3);
    if (sz + 3 > bz1 - 4) break;
    if (free(sx0, sz - 2, sx0 + len, sz + 2)) {
      claim(sx0, sz - 2.5, sx0 + len, sz + 2.5);
      add(terrain, boxMinMax(sx0, P, sz - 1.5, sx0 + len, P + 3, sz + 1.5, 0.4), BLACK_PLASTIC);
      if (kind === 'x16') part(sx0 - 0.3, P, sz - 1.9, sx0 + len + 0.3, P + 3.4, sz + 1.9, STEEL, 'box', 0xc9cdd3, 0.9, 0.28); // armour
      else part(sx0, P, sz - 1.5, sx0 + len, P + 3, sz + 1.5, BLACK_PLASTIC, 'box', 0x16171b, 0, 0.5);
      // the card slot itself: a dark groove along the top, and a latch at the far end
      const top = kind === 'x16' ? P + 3.4 : P + 3;
      const key = sx0 + Math.min(6, len * 0.22);
      put(feature('part', (sx0 + key) / 2, top, sz, { shape: 'box', box: [sx0 + 0.9, top - 0.1, sz - 0.75, key - 0.5, top + 0.22, sz + 0.75], color: 0x0b0c0e, metal: 0, rough: 0.8 }));
      put(feature('part', (key + sx0 + len) / 2, top, sz, { shape: 'box', box: [key + 0.5, top - 0.1, sz - 0.75, sx0 + len - 0.9, top + 0.22, sz + 0.75], color: 0x0b0c0e, metal: 0, rough: 0.8 }));
      put(feature('part', sx0 + len, top, sz, { shape: 'box', box: [sx0 + len - 0.2, P + 0.5, sz - 1.4, sx0 + len + 1.2, top + 0.6, sz + 1.4], color: 0x1a1b1f, metal: 0, rough: 0.5 }));
    }
    sz += kind === 'x16' ? 8 : 7;
  }
  if (free(sx1 + 2, sz - 6, sx1 + 9, sz + 1)) {
    claim(sx1 + 2, sz - 6, sx1 + 9, sz + 1);
    part(sx1 + 2.3, P, sz - 5.8, sx1 + 8.7, P + 2.2, sz + 0.8, STEEL, 'cylY', 0xd5d9de, 0.95, 0.22); // CMOS battery
  }
  const cvz0 = sz + 2;
  const cvz1 = Math.min(bz1 - 6, cvz0 + Math.max(10, 16 * s));
  if (cvz1 - cvz0 >= 8 && free(sx0, cvz0, sx1, cvz1)) {
    claim(sx0, cvz0, sx1, cvz1);
    part(sx0, P, cvz0, sx1, P + 3, cvz1, SHROUD, 'box', 0x1d1f24, 0.45, 0.45);
    add(terrain, boxMinMax(sx0 + 3, P + 2.6, cvz0 + 2, sx1 - 3, P + 4, cvz0 + 4, 0.5), RGB_LIGHT);
    put(feature('lightBar', (sx0 + sx1) / 2, P + 4, cvz0 + 3, { box: [sx0 + 3, P + 2.6, cvz0 + 2, sx1 - 3, P + 4, cvz0 + 4] }));
  }

  // ---- SATA ports on the near board edge, with two red SATA cables to the drives on the shroud
  const sataZ = bz0 + 14; // clear of the mounting hole in the corner
  const sata = free(bx0, sataZ - 4, bx0 + 7, sataZ + 8);
  if (sata) {
    claim(bx0, sataZ - 4, bx0 + 7, sataZ + 8);
    for (let k = 0; k < 2; k++) part(bx0 + 1, P, sataZ - 3 + k * 6, bx0 + 6, P + 4, sataZ + 1 + k * 6, BLACK_PLASTIC, 'box', 0x15161a, 0, 0.55);
  }

  // ---- drive bay on the PSU shroud: two 2.5" SSDs and a 3.5" drive in a steel cage
  const dx0 = WALL1 + 2;
  const dx1 = psuX1 - 4;
  const ssdLen = Math.max(11, 16 * s);
  const ssdZ = [WALL1 + 4, WALL1 + 6 + ssdLen];
  for (const z0 of ssdZ) {
    part(dx0, shelfTop, z0, dx1, shelfTop + 3.4, z0 + ssdLen, ALUMINIUM, 'box', 0x2a2d33, 0.7, 0.35); // drive body
    put(feature('part', (dx0 + dx1) / 2, shelfTop + 3.45, z0 + ssdLen / 2, { shape: 'box', box: [dx0 + 1, shelfTop + 3.3, z0 + 1, dx1 - 1, shelfTop + 3.6, z0 + ssdLen - 1], color: 0x9aa0a8, metal: 0.9, rough: 0.3 })); // brushed top
    // a printed sticker: white paper, a red brand line and a few lines of dark text
    const lz0 = z0 + 2.2;
    const lz1 = z0 + ssdLen * 0.58;
    put(feature('part', (dx0 + dx1) / 2, shelfTop + 3.6, (lz0 + lz1) / 2, { shape: 'box', box: [dx0 + 2, shelfTop + 3.55, lz0, dx1 - 2, shelfTop + 3.66, lz1], color: 0xdedfe2, metal: 0, rough: 0.85 }));
    put(feature('part', (dx0 + dx1) / 2, shelfTop + 3.6, lz0 + 1, { shape: 'box', box: [dx0 + 2.5, shelfTop + 3.62, lz0 + 0.6, dx1 - 2.5, shelfTop + 3.7, lz0 + 1.4], color: 0xc8302c, metal: 0, rough: 0.6 }));
    for (let k = 0; k < 3; k++) {
      const tz = lz0 + 2.4 + k * 1.1;
      if (tz + 0.4 > lz1 - 0.5) break;
      put(feature('part', (dx0 + dx1) / 2, shelfTop + 3.6, tz, { shape: 'box', box: [dx0 + 2.6, shelfTop + 3.62, tz, dx1 - 2.6 - k * 1.7, shelfTop + 3.68, tz + 0.35], color: 0x2a2c31, metal: 0, rough: 0.8 }));
    }
    put(feature('part', dx1 - 0.6, shelfTop + 1.7, z0 + 4, { shape: 'box', box: [dx1 - 1.2, shelfTop + 0.8, z0 + 2.5, dx1 + 0.2, shelfTop + 2.6, z0 + 6], color: 0x111214, metal: 0, rough: 0.55 })); // SATA socket
  }
  if (sata) {
    ssdZ.forEach((z0, k) => {
      const from: Vec3 = [bx0 + 3.5, P + 4, sataZ - 1 + k * 6];
      const to: Vec3 = [dx1 - 1, shelfTop + 2.5, z0 + 4];
      const over: Vec3 = [psuX1 + 1, shelfTop + 2.8, to[2] + (from[2] - to[2]) * 0.35];
      softCable(from, to, 0, 0, 1, over, 1.25, 0xb3201c, CABLE_RED);
    });
  }
  const cageZ1 = D - WALL1 - 4;
  const cageZ0 = cageZ1 - Math.max(16, 24 * s);
  const bay = Math.max(4.5, 6 * s); // height of one drive bay
  const cageTop = shelfTop + 2 + 3 * bay;
  // open towards the board (+x): a back panel, two side panels, a roof and a floor
  const cageColor = 0x8b9098;
  part(dx0 - 1, shelfTop, cageZ0, dx0 + 1.4, cageTop + 2, cageZ1, STEEL, 'box', cageColor, 0.85, 0.38);
  part(dx0 - 1, shelfTop, cageZ0, dx1 + 1, cageTop + 2, cageZ0 + 2.4, STEEL, 'box', cageColor, 0.85, 0.38);
  part(dx0 - 1, shelfTop, cageZ1 - 2.4, dx1 + 1, cageTop + 2, cageZ1, STEEL, 'box', cageColor, 0.85, 0.38);
  part(dx0 - 1, cageTop - 0.4, cageZ0, dx1 + 1, cageTop + 2, cageZ1, STEEL, 'box', cageColor, 0.85, 0.38);
  part(dx0 - 1, shelfTop, cageZ0, dx1 + 1, shelfTop + 2.4, cageZ1, STEEL, 'box', cageColor, 0.85, 0.38);
  for (let k = 0; k < 3; k++) {
    const y0 = shelfTop + 2 + k * bay;
    part(dx0 + 1.2, y0 + 0.4, cageZ0 + 2.2, dx1 - 0.5, y0 + bay - 1.2, cageZ1 - 2.2, ALUMINIUM, 'box', 0x7d838c, 0.85, 0.4); // the drive
    put(feature('part', dx1 + 0.2, y0 + bay / 2 - 0.4, (cageZ0 + cageZ1) / 2, { shape: 'box', box: [dx1 - 0.6, y0 + 0.5, cageZ0 + 3, dx1 + 0.4, y0 + bay - 1.3, cageZ1 - 3], color: 0x1b1d22, metal: 0.3, rough: 0.5 })); // sled handle
    put(feature('led', dx1 + 0.6, y0 + bay - 1.8, cageZ1 - 4.5, { color: 0x3a7bff, glow: k === 1 ? 1 : 0 })); // glow 1: steady
  }
  // a blue SATA cable from the board to the middle drive: one more bridge
  for (let bz = cageZ0 - 4; sata && bz > sataZ + 10; bz -= 3) {
    if (!free(bx0, bz - 3, bx0 + 7, bz + 3)) continue;
    claim(bx0, bz - 3, bx0 + 7, bz + 3);
    part(bx0 + 1, P, bz - 2, bx0 + 6, P + 4, bz + 2, BLACK_PLASTIC, 'box', 0x15161a, 0, 0.55);
    const from: Vec3 = [bx0 + 3.5, P + 4, bz];
    const to: Vec3 = [dx0 + 3, shelfTop + 2 + bay * 1.5, cageZ0 - 0.6];
    const via = [psuX1 + 1.2, shelfTop + 1.8, bz - 2, psuX1 - 3, shelfTop + 1.15, cageZ0 - 5, dx0 + 3.5, shelfTop + 1.15, cageZ0 - 3.2];
    softCable(from, to, 0, 2, -1, via, 1.25, 0x2d7fd8, CABLE_BLUE);
    // its plug on the cage side, at the rear of the drive
    put(feature('part', dx0 + 3, to[1], cageZ0 - 0.3, { shape: 'box', box: [dx0 + 1.5, to[1] - 0.9, cageZ0 - 0.7, dx0 + 4.5, to[1] + 0.9, cageZ0 + 0.1], color: 0x15161a, metal: 0, rough: 0.55 }));
    break;
  }

  const vx0 = ioX1 + 6;
  const vx1 = gx - 10;
  const exHalf = Math.min(12, (vx1 - vx0) / 2 - 1);
  const ex = vx0 + exHalf + 1;
  const ey = P + 6 + exHalf;
  for (let x = Math.floor(vx0) + 0.5; x + 3 <= vx1; x += 5) {
    for (let y = P + 4.5; y + 3 <= Math.min(glassY - 6, P + 4 + 44 * s); y += 5) {
      // no holes behind the exhaust fan: its frame sits on solid wall
      if (exHalf >= 7 && x + 3 > ex - exHalf - 1 && x < ex + exHalf + 1 && y + 3 > ey - exHalf - 1 && y < ey + exHalf + 1) continue;
      cut(terrain, boxMinMax(x, y, D - WALL1 - 1, x + 3, y + 3, D - WALL0 + 1, 0.2));
    }
  }

  // ---- rear exhaust fan over the vent grid, and the expansion slot covers beside the graphics card
  if (exHalf >= 7) {
    const ez = ioZ - 2;
    fan(terrain, ex, ey, ez, 2, exHalf, exHalf - 1.5, true);
    add(terrain, torus(ex, ey, ez - 2, exHalf - 1.2, 1, 2), RGB_LIGHT);
    put(feature('fan', ex, ey, ez, { axis: 2, facing: -1, radius: exHalf - 1.5 }));
  }
  for (let x = vx1 + 1.5; x + 2 <= gx - 3; x += 4) {
    part(x, P + 2, ioZ - 1.4, x + 2.4, P + 24, ioZ - 0.2, STEEL, 'box', 0x6e737b, 0.85, 0.4);
  }

  // ---- M.2 heatsink slab between the socket and the slot
  const m2z = cz + sock + 8;
  if (free(cx - 12 * s - 1, m2z - 5, cx + 12 * s + 1, m2z + 5)) {
    part(cx - 12 * s, P, m2z - 4, cx + 12 * s, P + 2.5, m2z + 4, ALUMINIUM, 'box', 0x3a3d44, 0.8, 0.4);
    for (let x = cx - 12 * s + 2; x + 2 <= cx + 12 * s - 2; x += 4) part(x, P + 2.5, m2z - 3, x + 2, P + 4.2, m2z + 3, ALUMINIUM, 'box', 0x4a4e56, 0.85, 0.35);
    claim(cx - 12 * s - 1, m2z - 5, cx + 12 * s + 1, m2z + 5);
  }

  // ---- chipset under a finned heatsink, in the open part of the board
  for (let tries = 0; tries < 80; tries++) {
    const x = rand(bx0 + (bx1 - bx0) * 0.3, bx0 + (bx1 - bx0) * 0.62);
    const z = rand(bz0 + (bz1 - bz0) * 0.62, bz1 - 12);
    const hs = Math.max(6, 9 * s);
    if (!free(x - hs - 1, z - hs - 1, x + hs + 1, z + hs + 1)) continue;
    claim(x - hs - 1, z - hs - 1, x + hs + 1, z + hs + 1);
    part(x - hs, P, z - hs, x + hs, P + 2, z + hs, SILICON, 'box', 0x1b1c20, 0.1, 0.45);
    for (let f = x - hs + 1; f + 2 <= x + hs - 1; f += 4) part(f, P + 2, z - hs + 1, f + 2, P + 6, z + hs - 1, ALUMINIUM, 'box', 0xa9aeb6, 0.9, 0.32);
    break;
  }

  // ---- SMD chip clusters
  for (let n = 0, tries = 0; n < Math.round(9 * s * s + 2) && tries < 300; tries++) {
    const x = rand(bx0 + 6, bx1 - 6);
    const z = rand(bz0 + 6, bz1 - 6);
    if (!free(x - 7, z - 7, x + 7, z + 7)) continue;
    claim(x - 7, z - 7, x + 7, z + 7);
    add(terrain, box(x, P + 1, z, 3.5, 1, 3.5, 0.4), SILICON);
    for (let c = 0; c < 4; c++) {
      const ox = c & 1 ? 5.2 : -5.2;
      const oz = c & 2 ? rand(-3, 3) : rand(-3, 3);
      add(terrain, box(x + (c < 2 ? ox : oz), P + 0.7, z + (c < 2 ? oz : ox), 1.2, 0.7, 1.2, 0.3), c === 3 ? GOLD : SILICON);
    }
    n++;
  }

  // ---- activity LEDs on the board (render-only lights sit on these small bases)
  const ledColors = [0xffa21a, 0x3dff6a, 0xffa21a];
  for (let n = 0, tries = 0; n < 3 && tries < 200; tries++) {
    const nearAtx = n === 0 && tries < 30; // the first one beside the power connector, if there is room
    const x = nearAtx ? atxX + rand(4, 9) : rand(bx0 + 4, bx1 - 4);
    const z = nearAtx ? cz + rand(-14, 14) : rand(bz0 + 4, bz1 - 4);
    if (!free(x - 1.6, z - 1.6, x + 1.6, z + 1.6)) continue;
    claim(x - 1.6, z - 1.6, x + 1.6, z + 1.6);
    add(terrain, box(x, P + 0.8, z, 1.2, 0.8, 1.2, 0.3), SILICON);
    put(feature('led', x, P + 1.9, z, { color: ledColors[n] }));
    n++;
  }

  // ---- dust bunnies: small smooth lumps, on the board and in the tray corners
  for (let n = 0, tries = 0; n < Math.round(3 + 4 * s) && tries < 200; tries++) {
    const corner = n < 3;
    const x = corner ? (n === 1 ? W - WALL1 - 3 : bx0 + rand(2, 8)) : rand(bx0 + 4, bx1 - 4);
    const z = corner ? (n === 0 ? D - WALL1 - 3 : bz0 + rand(1, 3)) : rand(bz0 + 4, bz1 - 4);
    if (!corner && !free(x - 4, z - 4, x + 4, z + 4)) continue;
    if (!corner) claim(x - 4, z - 4, x + 4, z + 4);
    const base = corner && n === 1 ? TRAY_TOP : P;
    const r = rand(1.6, 2.1);
    rand(-1.8, 1.8); // (keeps the seed's sequence of numbers as before)
    rand(-1.8, 1.8);
    put(feature('dust', x, base, z, { radius: r }));
    n++;
  }

  // ---- the traces' solder pads, where no part covers them (half under a block they read as a crumpled blob)
  for (let i = 0; i < pads.length; i += 2) {
    const x = pads[i];
    const z = pads[i + 1];
    if (!free(x - 2.5, z - 2.5, x + 2.5, z + 2.5)) continue;
    add(terrain, cylinder(x, P + 0.6, z, 2, 1.1, 1, 0.8), GOLD);
    put(feature('pad', x, P, z, { radius: 2 }));
  }

  giveBodies(terrain, drawn);
  terrain.commitGeneration();
};

/**
 * A cable cutout through the board and the tray (falls out of the map) with a rubber grommet rim.
 * `rimFrom`: where the rim starts on the low-x side, to run it into a wall next to it (a rim that stops
 * just short of a wall leaves a crease where the two rounded shapes nearly touch); `rimZ0`, `rimZ1`: how
 * far the rim runs along z.
 */
function cutout(t: Terrain, x0: number, z0: number, x1: number, z1: number, rimFrom = x0 - 1.4, rimZ0 = z0 - 1.4, rimZ1 = z1 + 1.4): void {
  add(t, boxMinMax(rimFrom, TRAY_TOP - 1, rimZ0, x1 + 1.4, TRAY_TOP + 1.4, rimZ1, 0.6), BLACK_PLASTIC);
  cut(t, boxMinMax(x0, -4, z0, x1, TRAY_TOP + 4, z1, 1.2));
}
