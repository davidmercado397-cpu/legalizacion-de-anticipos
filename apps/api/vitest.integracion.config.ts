import { defineConfig } from 'vitest/config';

/** Pruebas contra PostgreSQL real: comparten la base, así que corren en serie. */
export default defineConfig({
  test: {
    include: ['test/integracion/**/*.int.spec.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
