import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ConexionBaseDatos } from '../shared/infrastructure/base-datos/conexion';

/** Aplica las migraciones SQL pendientes (carpeta apps/api/drizzle). */
export async function migrar(url: string, carpeta = process.env.MIGRACIONES_DIR ?? 'drizzle'): Promise<void> {
  const conexion = new ConexionBaseDatos(url, 1);
  try {
    await migrate(conexion.db, { migrationsFolder: resolve(carpeta) });
  } finally {
    await conexion.onApplicationShutdown();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL');
  await migrar(url);
  console.log('Migraciones aplicadas');
}
