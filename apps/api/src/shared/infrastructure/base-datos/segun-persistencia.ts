import type { FactoryProvider, InjectionToken } from '@nestjs/common';
import type { Configuracion } from '../../configuracion';
import { CONFIGURACION, CONEXION_BASE_DATOS } from '../../tokens';
import type { BaseDatos, ConexionBaseDatos } from './conexion';

/**
 * Provider que elige el adaptador según PERSISTENCIA (memoria | postgres).
 * Los casos de uso no se enteran: dependen del puerto.
 */
export function segunPersistencia<T>(
  token: InjectionToken,
  adaptadores: { memoria: () => T; postgres: (db: BaseDatos) => T },
): FactoryProvider<T> {
  return {
    provide: token,
    useFactory: (config: Configuracion, conexion: ConexionBaseDatos | null) =>
      config.PERSISTENCIA === 'postgres' ? adaptadores.postgres(conexion!.db) : adaptadores.memoria(),
    inject: [CONFIGURACION, CONEXION_BASE_DATOS],
  };
}
