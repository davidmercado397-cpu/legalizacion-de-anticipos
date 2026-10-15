import { defineConfig } from 'vitest/config';

/** Pruebas unitarias y e2e en memoria (rápidas, sin dependencias externas). */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['test/integracion/**', 'node_modules/**'],
  },
});
