import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/infrastructure/persistencia/*.schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://viaticos:viaticos_local@localhost:5432/viaticos' },
  strict: true,
  verbose: true,
});
