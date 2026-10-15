import type { OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type BaseDatos = NodePgDatabase;

/** Pool de conexiones + instancia Drizzle; se cierra al apagar la aplicación. */
export class ConexionBaseDatos implements OnApplicationShutdown {
  readonly db: BaseDatos;
  private readonly pool: pg.Pool;

  constructor(url: string, max = 10) {
    this.pool = new pg.Pool({ connectionString: url, max });
    this.db = drizzle(this.pool);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** Código SQLSTATE de un error de PostgreSQL (Drizzle lo envuelve en `cause`). */
export function codigoErrorPg(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export const VIOLACION_UNICIDAD = '23505';
