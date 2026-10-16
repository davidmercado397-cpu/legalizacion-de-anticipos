import { Global, Inject, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Bitacora, ProveedorTasaCambio, Reloj } from '../../shared/application/puertos';
import type { Configuracion } from '../../shared/configuracion';
import { BitacoraNest } from '../../shared/infrastructure/bitacora-nest';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { ProveedorTasaCambioFija } from '../../shared/infrastructure/proveedor-tasa-cambio-fija';
import { CONFIGURACION, PROVEEDOR_TASA_CAMBIO, RELOJ } from '../../shared/tokens';
import type { CacheTasas } from './application/puertos';
import { ProveedorTasasOficiales } from './application/proveedor-tasas-oficiales';
import { TasasDelDia } from './application/tasas-del-dia';
import { ActualizacionPeriodica } from './infrastructure/actualizacion-periodica';
import { CacheTasasDrizzle, CacheTasasEnMemoria } from './infrastructure/cache-tasas';
import { FuenteBceFrankfurter, FuenteTasasConfiguradas, FuenteTrmDatosGov } from './infrastructure/fuentes-oficiales';
import { TasasController } from './presentation/tasas.controller';

const CACHE_TASAS = Symbol('CacheTasas');
const ACTUALIZACION_TASAS = Symbol('ActualizacionTasas');

/**
 * Tasas de cambio para toda la app (PROVEEDOR_TASA_CAMBIO).
 *  - oficial: TRM del día (datos.gov.co) para COP, BCE para otras monedas y, para las que
 *    no tienen fuente automática, TASAS_RESPALDO. Se actualiza cada hora.
 *  - fija: TRM_DESARROLLO / TASAS_DESARROLLO, para trabajar sin internet y para pruebas.
 */
@Global()
@Module({
  controllers: [TasasController],
  providers: [
    segunPersistencia<CacheTasas>(CACHE_TASAS, {
      memoria: () => new CacheTasasEnMemoria(),
      postgres: (db) => new CacheTasasDrizzle(db),
    }),
    {
      provide: PROVEEDOR_TASA_CAMBIO,
      useFactory: (config: Configuracion, cache: CacheTasas, reloj: Reloj): ProveedorTasaCambio =>
        config.TASAS_PROVEEDOR === 'oficial'
          ? new ProveedorTasasOficiales(
              [new FuenteTrmDatosGov(), new FuenteBceFrankfurter(), new FuenteTasasConfiguradas(config.TASAS_RESPALDO)],
              cache,
              reloj,
            )
          : new ProveedorTasaCambioFija(`COP=${config.TRM_DESARROLLO},${config.TASAS_DESARROLLO}`),
      inject: [CONFIGURACION, CACHE_TASAS, RELOJ],
    },
    {
      provide: TasasDelDia,
      useFactory: (proveedor: ProveedorTasaCambio, reloj: Reloj, config: Configuracion) =>
        new TasasDelDia(proveedor, reloj, new BitacoraNest('Tasas'), config.TASAS_MONEDAS_VISIBLES.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean)),
      inject: [PROVEEDOR_TASA_CAMBIO, RELOJ, CONFIGURACION],
    },
    {
      provide: ACTUALIZACION_TASAS,
      useFactory: (tasas: TasasDelDia, config: Configuracion) => {
        if (config.TASAS_PROVEEDOR !== 'oficial') return null;
        const bitacora: Bitacora = new BitacoraNest('Tasas');
        return new ActualizacionPeriodica(
          () => tasas.actualizar(),
          (e) => bitacora.advertencia(`No se pudieron actualizar las tasas: ${e instanceof Error ? e.message : String(e)}`),
        );
      },
      inject: [TasasDelDia, CONFIGURACION],
    },
  ],
  exports: [PROVEEDOR_TASA_CAMBIO, TasasDelDia],
})
export class TasasModule implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(@Inject(ACTUALIZACION_TASAS) private readonly actualizacion: ActualizacionPeriodica | null) {}

  onApplicationBootstrap() {
    this.actualizacion?.iniciar();
  }

  onModuleDestroy() {
    this.actualizacion?.detener();
  }
}
