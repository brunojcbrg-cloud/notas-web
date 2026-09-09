import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/notas-web/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default', './scripts/test-audit-reporter.mjs'],
  },
});
