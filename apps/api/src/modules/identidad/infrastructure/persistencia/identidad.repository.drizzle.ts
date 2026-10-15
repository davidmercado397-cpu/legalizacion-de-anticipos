import { and, eq, isNull } from 'drizzle-orm';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import type { CredencialRepository, Sesion, SesionRepository } from '../../domain/sesion';
import { credenciales, sesiones } from './identidad.schema';

export class SesionRepositoryDrizzle implements SesionRepository {
  constructor(private readonly db: BaseDatos) {}

  async crear(s: Sesion): Promise<void> {
    await this.db.insert(sesiones).values(s);
  }

  async obtenerPorHash(hashToken: string): Promise<Sesion | null> {
    const [fila] = await this.db.select().from(sesiones).where(eq(sesiones.hashToken, hashToken)).limit(1);
    return fila
      ? {
          id: fila.id,
          usuarioId: fila.usuarioId,
          familiaId: fila.familiaId,
          hashToken: fila.hashToken,
          expiraEn: fila.expiraEn,
          revocadaEn: fila.revocadaEn,
        }
      : null;
  }

  async revocarSiActiva(id: string, ahora: Date): Promise<boolean> {
    const filas = await this.db
      .update(sesiones)
      .set({ revocadaEn: ahora })
      .where(and(eq(sesiones.id, id), isNull(sesiones.revocadaEn)))
      .returning({ id: sesiones.id });
    return filas.length === 1;
  }

  async revocarFamilia(familiaId: string, ahora: Date): Promise<void> {
    await this.db
      .update(sesiones)
      .set({ revocadaEn: ahora })
      .where(and(eq(sesiones.familiaId, familiaId), isNull(sesiones.revocadaEn)));
  }
}

export class CredencialRepositoryDrizzle implements CredencialRepository {
  constructor(private readonly db: BaseDatos) {}

  async obtenerHash(usuarioId: string): Promise<string | null> {
    const [fila] = await this.db.select().from(credenciales).where(eq(credenciales.usuarioId, usuarioId)).limit(1);
    return fila?.hashContrasena ?? null;
  }

  async guardar(usuarioId: string, hashContrasena: string): Promise<void> {
    await this.db
      .insert(credenciales)
      .values({ usuarioId, hashContrasena })
      .onConflictDoUpdate({ target: credenciales.usuarioId, set: { hashContrasena, actualizadaEn: new Date() } });
  }
}
