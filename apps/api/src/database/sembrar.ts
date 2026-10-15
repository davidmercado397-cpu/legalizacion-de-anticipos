import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { ConexionBaseDatos } from '../shared/infrastructure/base-datos/conexion';
import { credenciales } from '../modules/identidad/infrastructure/persistencia/identidad.schema';
import { usuarios } from '../modules/organizacion/infrastructure/persistencia/organizacion.schema';
import { USUARIOS_DESARROLLO } from '../modules/organizacion/infrastructure/usuario.repository.memoria';
import { configuracionEscalamiento } from '../modules/solicitudes/infrastructure/persistencia/solicitudes.schema';
import { CONFIGURACION_ESCALAMIENTO_DESARROLLO } from '../modules/solicitudes/infrastructure/configuracion-escalamiento.repository.memoria';
import { conceptosViatico, tarifas } from '../modules/tarifas/infrastructure/persistencia/tarifas.schema';
import { CONCEPTOS_DESARROLLO, TARIFAS_DESARROLLO } from '../modules/tarifas/infrastructure/repositorios.memoria';

/** Contraseña de todos los usuarios de desarrollo. Solo para entornos locales. */
export const CONTRASENA_DESARROLLO = 'Viaticos2026*';

/**
 * Datos de desarrollo idempotentes (se puede ejecutar varias veces).
 * Se niega a correr en producción: allí los datos reales se cargan por administración.
 */
export async function sembrar(url: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('La semilla de desarrollo no se ejecuta en producción');
  const conexion = new ConexionBaseDatos(url, 1);
  const db = conexion.db;
  try {
    await db.transaction(async (tx) => {
      // Usuarios sin jefes primero, luego se enlaza la jerarquía (las FK lo exigen).
      await tx
        .insert(usuarios)
        .values(USUARIOS_DESARROLLO.map((u) => ({ ...u, roles: [...u.roles], jefeInmediatoId: null, jefeDirectivoId: null })))
        .onConflictDoNothing();
      for (const u of USUARIOS_DESARROLLO) {
        await tx
          .update(usuarios)
          .set({ jefeInmediatoId: u.jefeInmediatoId, jefeDirectivoId: u.jefeDirectivoId })
          .where(sql`${usuarios.id} = ${u.id}`);
      }

      const hashContrasena = await hash(CONTRASENA_DESARROLLO, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
      await tx
        .insert(credenciales)
        .values(USUARIOS_DESARROLLO.map((u) => ({ usuarioId: u.id, hashContrasena })))
        .onConflictDoNothing();

      await tx.insert(conceptosViatico).values([...CONCEPTOS_DESARROLLO]).onConflictDoNothing();
      await tx
        .insert(tarifas)
        .values(
          TARIFAS_DESARROLLO.map((t) => ({
            id: t.id,
            cargoId: t.cargoId,
            paisCodigo: t.paisCodigo,
            conceptoCodigo: t.conceptoCodigo,
            valor: t.valorUnitario.monto,
            moneda: t.valorUnitario.moneda,
            vigenteDesde: '2026-01-01',
            vigenteHasta: null,
          })),
        )
        .onConflictDoNothing();

      await tx
        .insert(configuracionEscalamiento)
        .values(CONFIGURACION_ESCALAMIENTO_DESARROLLO)
        .onConflictDoNothing();
    });
  } finally {
    await conexion.onApplicationShutdown();
  }
}
