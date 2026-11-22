import type { SceneLayout } from '../terrain/generators/types';
import type { Terrain } from '../terrain/Terrain';

/** A camera pose: where it is and what it looks at. */
export interface CameraKey {
  p: [number, number, number];
  t: [number, number, number];
}

/**
 * The fixed camera work of a scenario: the game's start pose, six fixed poses for visual review, and a
 * looping 60 s fly-through path for performance and motion review. All derived from the map size and
 * the generator's layout only, so they are the same on every run for a given seed and map.
 */
export interface ScenarioViews {
  start: CameraKey;
  poses: CameraKey[];
  /** Keys of a closed Catmull-Rom loop, flown in `duration` seconds. */
  path: CameraKey[];
  duration: number;
}

type ViewBuilder = (t: Terrain, layout: SceneLayout) => ScenarioViews;

const key = (p: [number, number, number], t: [number, number, number]): CameraKey => ({ p, t });

/** Any map: the classic start pose, poses around the middle, and an orbit. */
const generic: ViewBuilder = (t) => {
  const c: [number, number, number] = [t.W / 2, t.H * 0.3, t.D / 2];
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [c[0] + dx, c[1] + dy, c[2] + dz];
  const path: CameraKey[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    path.push(key(at(Math.cos(a) * t.W * 0.6, t.H * (0.5 + 0.25 * (i % 2)), Math.sin(a) * t.D * 0.6), c));
  }
  return {
    start: key(at(95, 80, 105), c),
    poses: [
      key(at(95, 80, 105), c),
      key(at(-90, 60, 90), c),
      key(at(0, 140, 1), c),
      key(at(60, 20, -60), c),
      key(at(-40, 30, -70), c),
      key(at(25, 12, 25), c),
    ],
    path,
    duration: 60,
  };
};

/** Tower Case: the set pieces seen through the glass, then down among the parts. */
const pcCase: ViewBuilder = (t, layout) => {
  const { W, H, D } = t;
  const c: [number, number, number] = [W / 2, H * 0.3, D / 2];
  const find = (kind: string, axis?: number) => layout.features.find((f) => f.kind === kind && (axis === undefined || f.axis === axis));
  const pump = find('pump');
  const radFans = layout.features.filter((f) => f.kind === 'fan' && f.axis === 2 && f.facing > 0);
  const radFan = radFans.length ? { x: radFans.reduce((a, f) => a + f.x, 0) / radFans.length, y: radFans[0].y, z: radFans[0].z } : undefined;
  const gpuFans = layout.features.filter((f) => f.kind === 'fan' && f.axis === 0);
  // RAM light bars (short ones; long strips elsewhere are accents)
  const bars = layout.features.filter((f) => f.kind === 'lightBar' && f.box[5] - f.box[2] < D * 0.5);
  const p: [number, number, number] = pump ? [pump.x, pump.y, pump.z] : c;
  const rad: [number, number, number] = radFan ? [radFan.x, radFan.y, radFan.z] : [W / 2, 28, 12];
  const gpu: [number, number, number] = gpuFans.length ? [gpuFans[Math.floor(gpuFans.length / 2)].x, gpuFans[0].y, gpuFans[Math.floor(gpuFans.length / 2)].z] : [W * 0.75, 30, D * 0.8];
  const ram: [number, number, number] = bars.length ? [(bars[0].x + bars[bars.length - 1].x) / 2, bars[0].y, bars[0].z] : p;
  const s = Math.min(1, Math.min(W, D) / 160);
  const glassY = layout.glassY > 0 ? layout.glassY : H;
  // the start: above the glass, looking down at the pump, the tubes and the RAM
  // (the case fog is measured from the camera: clear for ~40, dark by ~150, so the start stays close)
  // seen along the window blinds (along z), so the light sheets in the dust show edge-on as shafts
  const start = key([c[0] + 4 * s, glassY + 8 * s, c[2] + 58 * s], [c[0] - 2 * s, 20, (p[2] + rad[2]) / 2]);
  const poses = [
    start,
    // 2: AIO wall: radiator fans and the tube bridges, from inside the case
    key([rad[0] + 2 * s, rad[1] + 52 * s, rad[2] + 34 * s], [rad[0], rad[1] - 2, rad[2] + 3]),
    // 3: vertical GPU on its riser, fans and ribbon
    key([gpu[0] - 40 * s, gpu[1] + 16 * s, gpu[2] - 30 * s], [gpu[0], gpu[1] - 2, gpu[2] + 4 * s]),
    // 4: PSU shroud plateau from the rear: drive cage, grommets, the 24-pin bundle, the cutout beside it
    key([40 * s + 14, 36 * s + 20, D - 16 * s - 8], [12 * s + 4, 26, p[2] + 6 * s]),
    // 5: RGB RAM row, the brightest pose
    key([ram[0] + 16 * s, ram[1] + 14 * s, ram[2] + 36 * s], [ram[0] - 4, ram[1] - 3, ram[2] - 4]),
    // 6: low across the board under the tubes, toward the radiator
    key([p[0] - 4 * s, p[1] + 5, p[2] + 30 * s], [p[0] - 12 * s, p[1] + 4, rad[2] + 4]),
    // 7 (detail): the rear I/O corner: I/O cover, port housings, Wi-Fi card, audio corner
    key([W * 0.42, 52 * s + 6, D - 52 * s], [W * 0.2, 20, D - 14 * s]),
    // 8 (detail): the drives on the shroud and the SATA cables to the board
    key([42 * s + 10, 34 * s + 18, 8], [14 * s + 4, 26, 40 * s + 8]),
  ];
  const path: CameraKey[] = [
    start,
    key([c[0] - 40 * s, glassY + 30 * s, c[2] + 40 * s], [p[0], p[1], p[2]]),
    poses[1],
    key([rad[0] - 30 * s, rad[1] + 26 * s, rad[2] + 40 * s], [p[0], p[1] + 6, p[2]]),
    poses[5],
    key([p[0] + 26 * s, p[1] + 16 * s, p[2] + 20 * s], ram),
    poses[4],
    key([gpu[0] - 46 * s, gpu[1] + 26 * s, gpu[2] - 10 * s], gpu),
    poses[2],
    key([W * 0.55, glassY - 8, D * 0.8], [W * 0.3, 20, D * 0.45]),
    poses[3],
    key([c[0] - 20 * s, glassY + 50 * s, c[2] + 20 * s], c),
  ];
  return { start, poses, path, duration: 60 };
};

/** Studio Monitor: the open cabinet from above, the woofer, the port, the amp plate and the screwdriver. */
const speaker: ViewBuilder = (t, layout) => {
  const { W, D } = t;
  const rim = layout.inner[4];
  const floor = layout.floorY + 6;
  const drivers = layout.features.filter((f) => f.kind === 'driver');
  const woofer = drivers.find((f) => f.path.length === 4);
  const tweeter = drivers.find((f) => f.path.length === 0);
  const port = layout.features.find((f) => f.kind === 'port');
  const heat = layout.features.find((f) => f.kind === 'heat');
  const rods = layout.features.filter((f) => f.kind === 'rod');
  const s = Math.min(1, Math.min(W, D) / 160);
  const w: [number, number, number] = woofer ? [woofer.x, woofer.path[0], woofer.z] : [W * 0.33, floor + 12, D * 0.55];
  const top = woofer ? woofer.path[3] : floor + 34;
  const tw: [number, number, number] = tweeter ? [tweeter.x, floor + 6, tweeter.z] : [W * 0.33, floor + 6, D * 0.2];
  const pt: [number, number, number] = port ? [port.x, port.y, port.z] : [W * 0.33, floor + 20, D * 0.86];
  const amp: [number, number, number] = heat ? [heat.x, heat.y - 8, heat.z + 30 * s] : [W * 0.8, layout.floorY + 6, D * 0.3];
  const sd = rods.length ? rods[0].path : [W - 8, layout.floorY, D * 0.75, W * 0.62, rim, D * 0.75];
  const cab = W * 0.625;
  // the start: from the amp side, over the rim, down into the cabinet at the woofer
  // high over the desk's front edge (the overhang and the drop below it), the whole opening and the amp
  const start = key([W * 0.6, rim + 76 * s, D + 24 * s], [W * 0.48, layout.floorY, D * 0.42]);
  const poses = [
    start,
    // 2: the woofer's back close: magnet tower, arms, the spider under the magnet
    key([w[0] + 26 * s, top + 14 * s, w[2] + 28 * s], [w[0], w[1] + 2, w[2]]),
    // 3: the port over the desk's edge, from inside the cabinet
    key([pt[0] - 30 * s, rim + 8, pt[2] - 8 * s], [pt[0] + 10 * s, pt[1] - 10, pt[2]]),
    // 4: the amp plate: heatsink, capacitors, transformer
    key([amp[0] - 22 * s, amp[1] + 34 * s, amp[2] + 36 * s], [amp[0], amp[1], amp[2] - 8 * s]),
    // 5: the screwdriver from the desk up to the rim
    key([sd[0] + 6, sd[1] + 18 * s, sd[2] - 42 * s], [(sd[0] + sd[3]) / 2, (sd[1] + sd[4]) / 2, sd[2]]),
    // 6: the tweeter and the wadding, from above the near wall
    key([tw[0] + 22 * s, rim - 2, tw[2] + 30 * s], [tw[0] - 4 * s, tw[1] - 2, tw[2] - 4 * s]),
    // 7 (detail): low on the cone, into the gap under the magnet
    key([w[0] + 34 * s, w[1] + 6 * s, w[2] - 14 * s], [w[0], w[1] + 4 * s, w[2]]),
    // 8 (detail): the cable bundle over the rim, from the desk
    key([cab + 30 * s, rim + 10 * s, w[2] - 2 * s], [cab - 2, rim - 6, w[2] - 30 * s]),
  ];
  const path: CameraKey[] = [
    start,
    key([cab + 20 * s, rim + 30 * s, w[2] - 30 * s], [w[0], w[1], w[2]]),
    poses[1],
    key([w[0] - 26 * s, top + 10 * s, w[2] + 20 * s], [w[0], w[1], w[2] - 10 * s]),
    poses[2],
    key([pt[0] - 30 * s, rim + 8 * s, pt[2] - 50 * s], tw),
    poses[5],
    key([cab + 10 * s, rim + 26 * s, tw[2] + 10 * s], [amp[0], amp[1], amp[2] - 20 * s]),
    poses[3],
    key([W - 12, amp[1] + 26 * s, amp[2] + 50 * s], [(sd[0] + sd[3]) / 2, (sd[1] + sd[4]) / 2, sd[2]]),
    poses[4],
    key([W * 0.5, rim + 50 * s, D * 0.5], [w[0], w[1], w[2]]),
  ];
  return { start, poses, path, duration: 60 };
};

const BUILDERS: Record<string, ViewBuilder> = { 'pc-case': pcCase, speaker };

export function viewsFor(scenarioId: string, t: Terrain, layout: SceneLayout): ScenarioViews {
  return (BUILDERS[scenarioId] ?? generic)(t, layout);
}
