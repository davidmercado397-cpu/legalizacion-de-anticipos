import { sql } from 'drizzle-orm';
import { migrar } from '../../src/database/migrar';
import { sembrar } from '../../src/database/sembrar';
import { ConexionBaseDatos } from '../../src/shared/infrastructure/base-datos/conexion';

/** Las pruebas de integración corren solo si hay una base de pruebas (docker compose up -d db). */
export const URL_PRUEBAS = process.env.TEST_DATABASE_URL;

export async function prepararBaseDePruebas(): Promise<ConexionBaseDatos> {
  await migrar(URL_PRUEBAS!);
  const conexion = new ConexionBaseDatos(URL_PRUEBAS!, 5);
  await conexion.db.execute(sql`
    TRUNCATE solicitudes, solicitud_destinos, solicitud_lineas, solicitud_pasos_aprobacion,
             huellas_comprobante, sesiones, credenciales, tarifas, conceptos_viatico,
             configuracion_escalamiento, usuarios CASCADE`);
  await sembrar(URL_PRUEBAS!);
  return conexion;
}
