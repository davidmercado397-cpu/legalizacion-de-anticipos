import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import type { Configuracion } from './configuracion';
import { GeneradorIdsUuid } from './infrastructure/generador-ids-uuid';
import { ProveedorTasaCambioFija } from './infrastructure/proveedor-tasa-cambio-fija';
import { PublicadorEventosEnProceso } from './infrastructure/publicador-eventos-en-proceso';
import { RelojSistema } from './infrastructure/reloj-sistema';
import { AutenticacionGuard } from './presentation/autenticacion';
import { ProblemDetailsFilter } from './presentation/problem-details.filter';
import { GENERADOR_IDS, PROVEEDOR_TASA_CAMBIO, PUBLICADOR_EVENTOS, RELOJ } from './tokens';

export const CONFIGURACION = Symbol('Configuracion');

@Global()
@Module({})
export class SharedModule {
  static forRoot(configuracion: Configuracion): DynamicModule {
    return {
      module: SharedModule,
      providers: [
        { provide: CONFIGURACION, useValue: configuracion },
        { provide: RELOJ, useFactory: () => new RelojSistema() },
        { provide: GENERADOR_IDS, useFactory: () => new GeneradorIdsUuid() },
        { provide: PUBLICADOR_EVENTOS, useFactory: () => new PublicadorEventosEnProceso() },
        {
          provide: PROVEEDOR_TASA_CAMBIO,
          useFactory: () => new ProveedorTasaCambioFija(configuracion.TRM_DESARROLLO),
        },
        { provide: APP_FILTER, useFactory: () => new ProblemDetailsFilter() },
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector) => new AutenticacionGuard(configuracion.AUTH_MODE, reflector),
          inject: [Reflector],
        },
      ],
      exports: [CONFIGURACION, RELOJ, GENERADOR_IDS, PUBLICADOR_EVENTOS, PROVEEDOR_TASA_CAMBIO],
    };
  }
}
