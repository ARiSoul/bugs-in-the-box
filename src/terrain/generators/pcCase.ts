import { createRng } from '../noise';
import {
  ALUMINIUM,
  BLACK_PLASTIC,
  COPPER,
  DUST,
  GOLD,
  PCB,
  RGB_LIGHT,
  SHROUD,
  SILICON,
  STEEL,
} from '../materials';
import { add, box, boxMinMax, cut, cylinder, sphere, torus } from '../sdf';
import type { Terrain } from '../Terrain';
import { cable, createPlacement, fan, ribbon, type Vec3 } from './parts';
import { feature, resetLayout, type TerrainGenerator } from './types';

/** Height of the top of the motherboard (as in Inside a PC). */
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
  const put = (f: ReturnType<typeof feature>): void => {
    if (layout) layout.features.push(f);
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
  cutout(terrain, cutA, D * 0.24, cutA + CUTOUT, D * 0.76);
  cutout(terrain, cutB, D * 0.3, cutB + CUTOUT, D * 0.7);
  claim(cutA - 2, 0, cutA + CUTOUT + 2, D);
  claim(cutB - 2, 0, W, D);

  // ---- motherboard
  add(terrain, boxMinMax(bx0, TRAY_TOP - 0.5, bz0, bx1, P, bz1, 0.8), PCB);

  // ---- copper traces with gold pads (under everything else)
  for (let n = Math.round(((bx1 - bx0) * (bz1 - bz0)) / 520); n > 0; n--) {
    let x = rand(bx0 + 4, bx1 - 4);
    let z = rand(bz0 + 4, bz1 - 4);
    for (let leg = 0; leg < 3; leg++) {
      const alongX = (leg & 1) === 0;
      const len = rand(6, 26) * (rng() < 0.5 ? -1 : 1);
      const x2 = alongX ? Math.min(bx1 - 3, Math.max(bx0 + 3, x + len)) : x;
      const z2 = alongX ? z : Math.min(bz1 - 3, Math.max(bz0 + 3, z + len));
      add(terrain, boxMinMax(Math.min(x, x2) - 1.25, P - 0.5, Math.min(z, z2) - 1.25, Math.max(x, x2) + 1.25, P + 1.5, Math.max(z, z2) + 1.25, 0.5), COPPER);
      x = x2;
      z = z2;
    }
    add(terrain, cylinder(x, P + 0.6, z, 2, 1.1, 1, 0.8), GOLD);
    put(feature('pad', x, P, z, { radius: 2 }));
  }

  // ---- mounting holes: copper ring and a steel screw head
  for (const [hx, hz] of [
    [bx0 + 5, bz0 + 5],
    [bx1 - 5, bz0 + 5],
    [bx0 + 5, bz1 - 5],
    [bx1 - 5, bz1 - 5],
    [(bx0 + bx1) / 2, bz1 - 5],
  ]) {
    add(terrain, torus(hx, P, hz, 3.2, 1), COPPER);
    add(terrain, cylinder(hx, P + 1, hz, 2.4, 1, 1, 0.8), STEEL);
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
  add(terrain, torus(cx, pumpTop, cz, pumpR - 3.2, 1.1), RGB_LIGHT);
  put(feature('pump', cx, pumpTop, cz, { radius: pumpR - 3.2 }));
  put(feature('heat', cx, pumpTop, cz, { box: [cx - pumpR, pumpTop + 1, cz - pumpR, cx + pumpR, pumpTop + 15, cz + pumpR] }));

  // ---- RGB RAM row beside the pump: four sticks with light bars
  const ramHalf = Math.max(12, 30 * s - 6);
  const ramTop = P + Math.max(14, 19 * s);
  let ramX = cx + sock + 6;
  for (let n = 0; n < 4; n++, ramX += 6) {
    if (!free(ramX - 2.5, cz - ramHalf - 1, ramX + 2.5, cz + ramHalf + 1)) break;
    claim(ramX - 2.5, cz - ramHalf - 1, ramX + 2.5, cz + ramHalf + 1);
    add(terrain, boxMinMax(ramX - 2, P, cz - ramHalf - 1, ramX + 2, P + 3, cz + ramHalf + 1, 0.4), BLACK_PLASTIC);
    add(terrain, boxMinMax(ramX - 1.8, P + 2.5, cz - ramHalf + 1.5, ramX + 1.8, ramTop - 0.5, cz + ramHalf - 1.5, 0.5), SHROUD);
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
    add(terrain, torus(fx, fy, fanZ + 2, fanR + 0.3, 1.05, 2), RGB_LIGHT);
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
  const grommetZ = [D * 0.3, cz, D * 0.72];
  for (const gz of grommetZ) {
    const gx = psuX1 - 6;
    cut(terrain, cylinder(gx, shelfTop, gz, 3.6, 2.5, 1, 1));
    add(terrain, torus(gx, shelfTop, gz, 4, 1.3), BLACK_PLASTIC);
    put(feature('grommet', gx, shelfTop, gz, { radius: 4 }));
  }
  // 24-pin connector on the board edge, and its bundle (three strands, zip-tied) out of a grommet
  const atxX = bx0 + 4;
  add(terrain, boxMinMax(atxX - 2, P, cz - 7, atxX + 2.5, P + 5, cz + 7, 0.4), BLACK_PLASTIC);
  claim(atxX - 3, cz - 8, atxX + 3.5, cz + 8);
  for (let k = -1; k <= 1; k++) {
    cable(terrain, [psuX1 - 6, shelfTop - 1, cz + k * 2.9], [atxX, P + 5, cz + k * 2.9], Math.max(6, 9 * s), BLACK_PLASTIC, 1.5, 18);
  }
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
    add(terrain, torus(gx - 8, fy, fz, gfR + 0.3, 1.05, 0), RGB_LIGHT);
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

  // ---- I/O shield on the rear wall, and the vent grid (holes 3 wide, bars 2 wide)
  const ioX0 = bx0 + 2;
  const ioX1 = ioX0 + Math.max(18, 30 * s);
  add(terrain, boxMinMax(ioX0, TRAY_TOP, D - WALL1 - 1.5, ioX1, P + 16, D - WALL1 + 0.5, 0.4), ALUMINIUM);
  for (let p = 0, x = ioX0 + 3; x + 4 < ioX1; p++, x += 6) {
    add(terrain, boxMinMax(x, P + 3 + (p % 2) * 5, D - WALL1 - 4, x + 4, P + 7 + (p % 2) * 5, D - WALL1, 0.5), p % 3 === 2 ? GOLD : BLACK_PLASTIC);
  }
  claim(ioX0 - 1, D - WALL1 - 6, ioX1 + 1, D);
  const vx0 = ioX1 + 6;
  const vx1 = gx - 10;
  for (let x = Math.floor(vx0) + 0.5; x + 3 <= vx1; x += 5) {
    for (let y = P + 4.5; y + 3 <= Math.min(glassY - 6, P + 4 + 44 * s); y += 5) {
      cut(terrain, boxMinMax(x, y, D - WALL1 - 1, x + 3, y + 3, D - WALL0 + 1, 0.2));
    }
  }

  // ---- M.2 heatsink slab between the socket and the slot
  const m2z = cz + sock + 8;
  if (free(cx - 12 * s - 1, m2z - 5, cx + 12 * s + 1, m2z + 5)) {
    add(terrain, boxMinMax(cx - 12 * s, P, m2z - 4, cx + 12 * s, P + 2.5, m2z + 4, 0.6), ALUMINIUM);
    for (let x = cx - 12 * s + 2; x + 2 <= cx + 12 * s - 2; x += 4) add(terrain, boxMinMax(x, P + 2.5, m2z - 3, x + 2, P + 4, m2z + 3, 0.3), ALUMINIUM);
    claim(cx - 12 * s - 1, m2z - 5, cx + 12 * s + 1, m2z + 5);
  }

  // ---- chipset under a finned heatsink, in the open part of the board
  for (let tries = 0; tries < 80; tries++) {
    const x = rand(bx0 + (bx1 - bx0) * 0.3, bx0 + (bx1 - bx0) * 0.62);
    const z = rand(bz0 + (bz1 - bz0) * 0.62, bz1 - 12);
    const hs = Math.max(6, 9 * s);
    if (!free(x - hs - 1, z - hs - 1, x + hs + 1, z + hs + 1)) continue;
    claim(x - hs - 1, z - hs - 1, x + hs + 1, z + hs + 1);
    add(terrain, box(x, P + 1, z, hs, 1, hs, 0.5), SILICON);
    for (let f = x - hs + 1; f + 2 <= x + hs - 1; f += 4) add(terrain, boxMinMax(f, P + 2, z - hs + 1, f + 2, P + 6, z + hs - 1, 0.3), ALUMINIUM);
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
    const r = rand(1.5, 2.3);
    add(terrain, sphere(x, base + r * 0.5, z, r), DUST, 1.2);
    add(terrain, sphere(x + rand(-1.8, 1.8), base + r * 0.4, z + rand(-1.8, 1.8), r * 0.8), DUST, 1.5);
    add(terrain, sphere(x + rand(-1.5, 1.5), base + r * 0.9, z + rand(-1.5, 1.5), r * 0.6), DUST, 1.5);
    n++;
  }

  terrain.commitGeneration();
};

/** A cable cutout through the board and the tray (falls out of the map) with a rubber grommet rim. */
function cutout(t: Terrain, x0: number, z0: number, x1: number, z1: number): void {
  add(t, boxMinMax(x0 - 1.4, TRAY_TOP - 1, z0 - 1.4, x1 + 1.4, TRAY_TOP + 1.4, z1 + 1.4, 1.2), BLACK_PLASTIC);
  cut(t, boxMinMax(x0, -4, z0, x1, TRAY_TOP + 4, z1, 2.4));
}
