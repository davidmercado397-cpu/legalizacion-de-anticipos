import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { Configuracion } from './configuracion';
import { ColaTrabajosEnProceso } from './infrastructure/cola-trabajos-en-proceso';
import { GeneradorIdsUuid } from './infrastructure/generador-ids-uuid';
import { PublicadorEventosEnProceso } from './infrastructure/publicador-eventos-en-proceso';
import { RelojSistema } from './infrastructure/reloj-sistema';
import { ProblemDetailsFilter } from './presentation/problem-details.filter';
import { ConexionBaseDatos } from './infrastructure/base-datos/conexion';
import {
  COLA_TRABAJOS,
  CONEXION_BASE_DATOS,
  CONFIGURACION,
  GENERADOR_IDS,
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
        { provide: COLA_TRABAJOS, useFactory: () => new ColaTrabajosEnProceso() },
        { provide: GENERADOR_IDS, useFactory: () => new GeneradorIdsUuid() },
        { provide: PUBLICADOR_EVENTOS, useFactory: () => new PublicadorEventosEnProceso() },
        { provide: APP_FILTER, useFactory: () => new ProblemDetailsFilter() },
      ],
      exports: [COLA_TRABAJOS, CONFIGURACION, CONEXION_BASE_DATOS, RELOJ, GENERADOR_IDS, PUBLICADOR_EVENTOS],
    };
  }
}
