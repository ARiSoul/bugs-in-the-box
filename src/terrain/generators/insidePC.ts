import { createRng } from '../noise';
import {
  ALUMINIUM,
  BLACK_PLASTIC,
  CABLE_RED,
  CABLE_YELLOW,
  CAP_SLEEVE,
  COPPER,
  FAN,
  GOLD,
  PCB,
  SHROUD,
  SILICON,
  STEEL,
} from '../materials';
import { add, box, boxMinMax, capsule, cut, cylinder, rotatedBox, torus, type Axis } from '../sdf';
import type { Terrain } from '../Terrain';
import type { TerrainGenerator } from './types';

/** Height of the top of the motherboard. Below it there is nothing: fall off the board and you are gone. */
const BOARD_TOP = 16;
const SQRT3_2 = 0.8660254037844386;
/** Six blade directions, 60° apart, as exact (cos, sin) pairs (no Math.sin/cos). */
const BLADES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, SQRT3_2],
  [-0.5, SQRT3_2],
  [-1, 0],
  [-0.5, -SQRT3_2],
  [0.5, -SQRT3_2],
];

type Rect = [number, number, number, number];

/**
 * Design rule: nothing thinner than ~2 cells, and no gap narrower than ~2 cells. The grid has one sample
 * per world unit, so thinner parts break up into blobs when meshed.
 *
 * Inside a PC: a motherboard floating in the dark, with a CPU tower cooler and its fan, RAM sticks,
 * a graphics card standing on its edge, a power supply with a guarded fan, capacitors, chips, copper
 * traces, and power cables that arc over the board as bridges. Built from SDF stamps (`sdf.ts`).
 * The layout follows the map size; the seed moves and varies the parts.
 */
export const insidePC: TerrainGenerator = (terrain, seed) => {
  terrain.beginGeneration();
  const { W, D } = terrain;
  const rng = createRng(seed * 4099 + 7);
  const rand = (a: number, b: number): number => a + rng() * (b - a);
  const P = BOARD_TOP;
  const used: Rect[] = [];
  const free = (x0: number, z0: number, x1: number, z1: number): boolean => {
    if (x0 < 9 || z0 < 9 || x1 > W - 9 || z1 > D - 9) return false;
    for (const r of used) if (x0 < r[2] && x1 > r[0] && z0 < r[3] && z1 > r[1]) return false;
    return true;
  };
  const claim = (x0: number, z0: number, x1: number, z1: number): void => {
    used.push([x0, z0, x1, z1]);
  };

  // ---- motherboard, with plated mounting holes in the corners
  add(terrain, boxMinMax(6, P - 3, 6, W - 6, P, D - 6, 0.8), PCB);
  for (const [hx, hz] of [
    [14, 14],
    [W - 14, 14],
    [14, D - 14],
    [W - 14, D - 14],
  ]) {
    add(terrain, torus(hx, P, hz, 3.4, 0.9), COPPER);
    cut(terrain, cylinder(hx, P - 1.5, hz, 2.6, 3));
    claim(hx - 5, hz - 5, hx + 5, hz + 5);
  }

  // ---- copper traces (under everything else, so parts may sit on them)
  for (let n = Math.round((W * D) / 700); n > 0; n--) {
    let x = rand(12, W - 12);
    let z = rand(12, D - 12);
    for (let leg = 0; leg < 3; leg++) {
      const alongX = (leg & 1) === 0;
      const len = rand(8, 34) * (rng() < 0.5 ? -1 : 1);
      const x2 = alongX ? Math.min(W - 10, Math.max(10, x + len)) : x;
      const z2 = alongX ? z : Math.min(D - 10, Math.max(10, z + len));
      add(terrain, boxMinMax(Math.min(x, x2) - 1.1, P - 0.5, Math.min(z, z2) - 1.1, Math.max(x, x2) + 1.1, P + 1.1, Math.max(z, z2) + 1.1, 0.4), COPPER);
      x = x2;
      z = z2;
    }
    add(terrain, cylinder(x, P + 0.2, z, 1.8, 0.9, 1, 0.8), GOLD);
  }

  // ---- CPU: socket, tower cooler with fins, fan on top
  const cx = W * 0.42 + rand(-6, 6);
  const cz = D * 0.42 + rand(-6, 6);
  add(terrain, boxMinMax(cx - 15, P, cz - 15, cx + 15, P + 2.5, cz + 15, 0.5), BLACK_PLASTIC);
  claim(cx - 17, cz - 17, cx + 17, cz + 17);
  add(terrain, box(cx, P + 4, cz, 12, 1.5, 12, 0.4), COPPER);
  const finsAlongX = rng() < 0.5;
  const finTop = P + 25.5;
  for (let f = 0; f < 6; f++) {
    const o = (f - 2.5) * 4.4;
    const fin = finsAlongX
      ? box(cx, (P + 5.5 + finTop) / 2, cz + o, 12, (finTop - P - 5.5) / 2, 1, 0.3)
      : box(cx + o, (P + 5.5 + finTop) / 2, cz, 1, (finTop - P - 5.5) / 2, 12, 0.3);
    add(terrain, fin, ALUMINIUM);
  }
  fan(terrain, cx, finTop + 2, cz, 1, 13, 11.5, true);

  // ---- RAM: four sticks beside the socket
  const ramX = cx + 25 + rand(0, 4);
  for (let s = 0; s < 4; s++) {
    const x = ramX + s * 6.5;
    if (!free(x - 2.5, cz - 26, x + 2.5, cz + 26)) continue;
    claim(x - 2.5, cz - 26, x + 2.5, cz + 26);
    add(terrain, boxMinMax(x - 2, P, cz - 25, x + 2, P + 3, cz + 25, 0.4), BLACK_PLASTIC);
    add(terrain, box(x, P + 11, cz, 1, 8, 23, 0.3), PCB);
    if (rng() < 0.5) {
      add(terrain, box(x, P + 11.5, cz, 1.7, 6.5, 22, 0.5), ALUMINIUM); // heat spreader
    } else {
      for (let c = 0; c < 4; c++) add(terrain, box(x, P + 10, cz - 18 + c * 12, 1.7, 3, 4, 0.3), SILICON);
    }
  }
  // 24-pin power connector after the RAM
  const atxX = ramX + 4 * 6.5 + 9; // room for the cable to come down beside the last stick
  const atx = free(atxX - 3, cz - 8, atxX + 3, cz + 8);
  if (atx) {
    add(terrain, boxMinMax(atxX - 2, P, cz - 7, atxX + 2, P + 5, cz + 7, 0.4), BLACK_PLASTIC);
    claim(atxX - 3, cz - 8, atxX + 3, cz + 8);
  }

  // ---- graphics card standing on its edge, cooler and two fans facing -z
  const gz = D * 0.78;
  const gx0 = W * 0.1;
  const gx1 = W * 0.62;
  add(terrain, boxMinMax(gx0 - 1, P, gz - 2, gx1 + 1, P + 3, gz + 2, 0.4), BLACK_PLASTIC);
  add(terrain, boxMinMax(gx0, P + 3, gz - 1, gx1, P + 20, gz + 1, 0.3), PCB);
  add(terrain, boxMinMax(gx0 + 2, P + 4, gz - 8, gx1 - 2, P + 19, gz - 1, 0.8), SHROUD);
  add(terrain, boxMinMax(gx0 + 1, P + 4, gz + 1, gx1 - 1, P + 19, gz + 2, 0.3), ALUMINIUM);
  for (let f = 0; f < 2; f++) {
    const fx = gx0 + 2 + (gx1 - gx0 - 4) * (0.27 + 0.46 * f);
    fan(terrain, fx, P + 11.5, gz - 8, 2, 0, 6.5, false);
  }
  claim(gx0 - 2, gz - 9, gx1 + 2, gz + 3);
  const gpuPowerX = gx1 - 8;
  add(terrain, box(gpuPowerX, P + 21, gz, 3, 1.2, 1.6, 0.3), BLACK_PLASTIC);

  // ---- power supply in the back-left corner: steel case, guarded fan on top, vents on the front
  const psu: Rect = [8, 8, 46, 44];
  const psuTop = P + 28;
  add(terrain, boxMinMax(psu[0], P, psu[1], psu[2], psuTop, psu[3], 1), STEEL);
  claim(psu[0] - 1, psu[1] - 1, psu[2] + 1, psu[3] + 1);
  const pfx = (psu[0] + psu[2]) / 2;
  const pfz = (psu[1] + psu[3]) / 2;
  cut(terrain, cylinder(pfx, psuTop, pfz, 12, 2.5));
  fanRotor(terrain, pfx, psuTop - 1.4, pfz, 1, 3.5, 11);
  // (no wire guard over it: at one sample per unit a guard this fine melts into the blades)
  for (let v = 0; v < 8; v++) {
    const vx = psu[0] + 3 + v * 4.4;
    cut(terrain, boxMinMax(vx, P + 6, psu[3] - 1.5, vx + 2.2, P + 22, psu[3] + 2, 0.4));
  }

  // ---- 8-pin CPU power next to the socket
  const epsX = cx - 20;
  const epsZ = cz - 20;
  const eps = free(epsX - 3, epsZ - 3, epsX + 3, epsZ + 3);
  if (eps) {
    add(terrain, boxMinMax(epsX - 2.5, P, epsZ - 2, epsX + 2.5, P + 5, epsZ + 2, 0.4), BLACK_PLASTIC);
    claim(epsX - 3, epsZ - 3, epsX + 3, epsZ + 3);
  }

  // ---- capacitors around the socket
  const caps = 10 + Math.floor(rng() * 7);
  for (let placed = 0, tries = 0; placed < caps && tries < 300; tries++) {
    let ux = rng() - 0.5;
    let uz = rng() - 0.5;
    const ul = Math.sqrt(ux * ux + uz * uz);
    if (ul < 0.05) continue;
    ux /= ul;
    uz /= ul;
    const dist = rand(20, 30);
    const x = cx + ux * dist;
    const z = cz + uz * dist;
    const r = rand(2.2, 3.1);
    if (!free(x - r - 0.6, z - r - 0.6, x + r + 0.6, z + r + 0.6)) continue;
    claim(x - r - 0.6, z - r - 0.6, x + r + 0.6, z + r + 0.6);
    const h = rand(7, 12);
    add(terrain, cylinder(x, P + h / 2, z, r, h / 2, 1, 1), rng() < 0.7 ? CAP_SLEEVE : BLACK_PLASTIC);
    add(terrain, cylinder(x, P + h - 0.2, z, r - 0.5, 0.9, 1, 0.8), STEEL);
    placed++;
  }

  // ---- chipset with a small heatsink, and a few loose chips
  for (let tries = 0; tries < 60; tries++) {
    const x = rand(W * 0.5, W * 0.75);
    const z = rand(D * 0.55, D * 0.68);
    if (!free(x - 8, z - 8, x + 8, z + 8)) continue;
    claim(x - 8, z - 8, x + 8, z + 8);
    add(terrain, box(x, P + 1, z, 7, 1, 7, 0.4), SILICON);
    for (let f = 0; f < 3; f++) add(terrain, box(x - 4.4 + f * 4.4, P + 4.5, z, 1, 2.5, 6, 0.3), ALUMINIUM);
    break;
  }
  for (let n = 0, tries = 0; n < 7 && tries < 120; tries++) {
    const hx = rand(2.5, 4.5);
    const hz = rand(2, 5);
    const x = rand(12, W - 12);
    const z = rand(12, D - 12);
    if (!free(x - hx - 1, z - hz - 1, x + hx + 1, z + hz + 1)) continue;
    claim(x - hx - 1, z - hz - 1, x + hx + 1, z + hz + 1);
    add(terrain, box(x, P + 0.9, z, hx, 0.9, hz, 0.3), SILICON);
    n++;
  }

  // ---- power cables from the PSU, arcing over the board: bridges (two strands side by side)
  const from = (k: number): [number, number, number] => [psu[0] + 8 + k * 9, P + 14, psu[3] + 1];
  const targets: [number, number, number][] = [];
  if (atx) targets.push([atxX, P + 5, cz]);
  targets.push([gpuPowerX, P + 22.2, gz]);
  if (eps) targets.push([epsX, P + 5, epsZ]);
  targets.forEach((to, k) => cable(terrain, from(k), to, rand(16, 24), k % 2 === 0 ? CABLE_RED : CABLE_YELLOW));

  terrain.commitGeneration();
};

/**
 * A fan: square frame with a round opening (if `framed`), hub and six blades. `axis` 1 = blowing up,
 * 2 = facing -z. `half` is the frame's half size, `radius` the opening.
 */
function fan(t: Terrain, x: number, y: number, z: number, axis: Axis, half: number, radius: number, framed: boolean): void {
  if (framed) {
    add(t, box(x, y, z, half, 2, half, 0.6), FAN);
    cut(t, cylinder(x, y, z, radius, 2.2, axis));
  } else {
    cut(t, cylinder(x, y, z, radius, 2.5, axis));
  }
  fanRotor(t, x, y, axis === 2 ? z + 1 : z, axis, 0, radius - 0.8);
}

/** Hub and six blades of a fan rotor centred at (x, y, z), spinning about `axis` (1 or 2). */
function fanRotor(t: Terrain, x: number, y: number, z: number, axis: Axis, hubRadius: number, reach: number): void {
  const hub = hubRadius > 0 ? hubRadius : reach * 0.32;
  add(t, cylinder(x, y, z, hub, 1.3, axis, 1), FAN);
  const len = (reach - hub) / 2;
  const mid = hub + len - 0.3;
  for (const [c, s] of BLADES) {
    if (axis === 1) add(t, rotatedBox(x + c * mid, y, z + s * mid, len, 1, reach * 0.2, 1, c, s, 0.4), FAN);
    else add(t, rotatedBox(x + c * mid, y + s * mid, z, len, reach * 0.2, 1, 2, c, s, 0.4), FAN);
  }
}

/**
 * A thick cable from `a` to `b`: a cubic arc that leaves and arrives vertically (so it clears the parts
 * next to its ends) and peaks about `lift` above the higher end. Wide enough to walk on: a bridge.
 */
function cable(t: Terrain, a: [number, number, number], b: [number, number, number], lift: number, material: number): void {
  // Control points straight above the ends; at u = 0.5 the curve is 0.75 of the way up to them.
  const top = Math.max(a[1], b[1]) + lift;
  const c1y = a[1] + (top - (a[1] + b[1]) / 2) / 0.75;
  const c2y = b[1] + (top - (a[1] + b[1]) / 2) / 0.75;
  const SEGMENTS = 24;
  let lx = a[0];
  let ly = a[1];
  let lz = a[2];
  for (let i = 1; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const v = 1 - u;
    const w0 = v * v * v;
    const w1 = 3 * v * v * u;
    const w2 = 3 * v * u * u;
    const w3 = u * u * u;
    const x = (w0 + w1) * a[0] + (w2 + w3) * b[0];
    const y = w0 * a[1] + w1 * c1y + w2 * c2y + w3 * b[1];
    const z = (w0 + w1) * a[2] + (w2 + w3) * b[2];
    add(t, capsule(lx, ly, lz, x, y, z, 1.8), material); // hard union: a smooth one would bulge at the joints
    lx = x;
    ly = y;
    lz = z;
  }
}
