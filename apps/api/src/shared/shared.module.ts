import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { Configuracion } from './configuracion';
import { GeneradorIdsUuid } from './infrastructure/generador-ids-uuid';
import { ProveedorTasaCambioFija } from './infrastructure/proveedor-tasa-cambio-fija';
import { PublicadorEventosEnProceso } from './infrastructure/publicador-eventos-en-proceso';
import { RelojSistema } from './infrastructure/reloj-sistema';
import { ProblemDetailsFilter } from './presentation/problem-details.filter';
import { ConexionBaseDatos } from './infrastructure/base-datos/conexion';
import {
  CONEXION_BASE_DATOS,
  CONFIGURACION,
  GENERADOR_IDS,
  PROVEEDOR_TASA_CAMBIO,
  PUBLICADOR_EVENTOS,
  RELOJ,
} from './tokens';

@Global()
@Module({})
export class SharedModule {
  static forRoot(configuracion: Configuracion): DynamicModule {
    return {
      module: SharedModule,
      providers: [
        { provide: CONFIGURACION, useValue: configuracion },
        {
          provide: CONEXION_BASE_DATOS,
          useFactory: () =>
            configuracion.PERSISTENCIA === 'postgres' ? new ConexionBaseDatos(configuracion.DATABASE_URL!) : null,
        },
        { provide: RELOJ, useFactory: () => new RelojSistema() },
        { provide: GENERADOR_IDS, useFactory: () => new GeneradorIdsUuid() },
        { provide: PUBLICADOR_EVENTOS, useFactory: () => new PublicadorEventosEnProceso() },
        {
          provide: PROVEEDOR_TASA_CAMBIO,
          useFactory: () => new ProveedorTasaCambioFija(configuracion.TRM_DESARROLLO),
        },
        { provide: APP_FILTER, useFactory: () => new ProblemDetailsFilter() },
      ],
      exports: [CONFIGURACION, CONEXION_BASE_DATOS, RELOJ, GENERADOR_IDS, PUBLICADOR_EVENTOS, PROVEEDOR_TASA_CAMBIO],
    };
  }
}
