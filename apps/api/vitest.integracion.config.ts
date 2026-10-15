import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Toma TEST_DATABASE_URL del .env de la raíz si existe (docker compose up -d db).
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

/** Pruebas contra PostgreSQL real: comparten la base, así que corren en serie. */
export default defineConfig({
  test: {
    include: ['test/integracion/**/*.int.spec.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
