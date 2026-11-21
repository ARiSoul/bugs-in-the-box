import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 800 }, // three.js alone is ~500 kB
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
