import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev only: POST /__capture?name=<file> with a PNG body writes captures/<file>.png (see
 * `src/debug/capture.ts`). Used for the fixed poses and fly-through frames of the visual review.
 */
function captures(): Plugin {
  return {
    name: 'captures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'capture').replace(/[^\w.-]/g, '_');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = resolve(__dirname, 'captures');
          mkdirSync(dir, { recursive: true });
          const file = resolve(dir, /\.(png|jpg)$/.test(name) ? name : `${name}.png`);
          writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [captures()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 800, // three.js alone is ~500 kB
    // three's core in its own chunk, shared by both render paths; the WebGPU path loads on demand
    rollupOptions: { output: { manualChunks: (id) => (/node_modules[\/]three[\/]build[\/]three\.core/.test(id) ? 'three-core' : undefined) } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
