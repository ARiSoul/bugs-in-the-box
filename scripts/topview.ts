/**
 * Top-down picture of a generated map, for checking a layout without the browser:
 *   npx tsx scripts/topview.ts <scenario> <map, e.g. 5x3x5> <seed> <out.ppm>
 * Each pixel is the highest solid sample of that column, coloured by material and shaded by height.
 * Columns with nothing solid (holes out of the map) are red. Writes a binary PPM (any viewer, or
 * `ffmpeg -i out.ppm out.png`).
 */
import { writeFileSync } from 'node:fs';
import { MATERIAL_RGB } from '../src/terrain/materials';
import { scenarioById } from '../src/terrain/scenarios';
import { Terrain } from '../src/terrain/Terrain';

const [id = 'pc-case', map = '5x3x5', seedArg = '1234', out = 'topview.ppm'] = process.argv.slice(2);
const [cx, cy, cz] = map.split('x').map(Number);
const t = new Terrain(cx, cy, cz);
scenarioById(id).generate(t, Number(seedArg));
const S = 4; // pixels per cell
const w = t.W * S;
const h = t.D * S;
const img = Buffer.alloc(w * h * 3);
for (let z = 0; z < t.D; z++) {
  for (let x = 0; x < t.W; x++) {
    let r = 0.6;
    let g = 0;
    let b = 0;
    for (let y = t.H; y >= 0; y--) {
      const i = t.idx(x, y, z);
      if (t.dens[i] < 0) {
        const c = MATERIAL_RGB[t.material[i]] ?? [1, 0, 1];
        const k = 0.35 + (0.65 * y) / t.H;
        // gamma-ish lift so dark materials stay readable
        r = Math.sqrt(c[0]) * k;
        g = Math.sqrt(c[1]) * k;
        b = Math.sqrt(c[2]) * k;
        break;
      }
    }
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const o = ((z * S + py) * w + x * S + px) * 3;
        img[o] = Math.min(255, r * 255);
        img[o + 1] = Math.min(255, g * 255);
        img[o + 2] = Math.min(255, b * 255);
      }
    }
  }
}
writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${w} ${h} 255\n`), img]));
console.log(`${id} ${map} seed ${seedArg}: ${t.W}x${t.H}x${t.D} -> ${out}`);
