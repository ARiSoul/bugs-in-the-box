import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The layers and who may see whom. The game's core (`terrain`, `game`) must run anywhere: in a Worker, and on a server
 * that checks matches. The client's data (`data`) is its own layer, under the UI, never under the game.
 */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(p) ? [p] : [];
  });

/** The modules a file imports (relative ones as paths under src, packages by name). */
function imports(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    out.push(spec.startsWith('.') ? relative('src', resolve(join(file, '..'), spec)).replace(/\\/g, '/') : spec);
  }
  return out;
}

/** What each layer may not import (paths under src, or package names). */
const RULES: Record<string, readonly RegExp[]> = {
  'src/terrain': [/^(game|render|ui|input|audio|data|debug|workers)\//, /^three/, /^dexie/],
  'src/game': [/^(render|ui|input|audio|data|debug|workers)\//, /^three/, /^dexie/],
  'src/data': [/^(render|ui|input|audio|debug|workers|game|terrain)\//, /^three/],
  'src/sim': [/^(render|ui|input|audio|data|debug|workers)\//, /^three/, /^dexie/],
  'src/net': [/^(render|ui|input|audio|data|debug|workers)\//, /^three/, /^dexie/],
};

describe('architecture', () => {
  it('reads imports (the checks below are not empty)', () => {
    expect(imports('src/game/bug.ts')).toContain('game/engine/attributes');
    expect(imports('src/data/dexie.ts')).toContain('dexie');
  });

  for (const [layer, banned] of Object.entries(RULES)) {
    it(`${layer} imports only what its layer may`, () => {
      const offenders: string[] = [];
      for (const f of files(layer)) for (const i of imports(f)) if (banned.some((b) => b.test(i))) offenders.push(`${f} -> ${i}`);
      expect(offenders).toEqual([]);
    });
  }

  it('the game core uses no DOM or browser storage', () => {
    const offenders: string[] = [];
    for (const f of [...files('src/game'), ...files('src/terrain'), ...files('src/sim')]) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const m = code.match(/\b(document|window|localStorage|indexedDB|navigator)\./);
      if (m) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('only the data layer touches browser storage', () => {
    const offenders: string[] = [];
    for (const f of files('src')) {
      if (f.replace(/\\/g, '/').startsWith('src/data/')) continue;
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/\b(localStorage|indexedDB)\b/.test(code)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
