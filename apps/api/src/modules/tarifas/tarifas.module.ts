import type { GeneradorIds } from '../../shared/application/puertos';
import { GENERADOR_IDS } from '../../shared/tokens';
import { AdministrarTarifasUseCase } from './application/administrar-tarifas.use-case';
import { AdministracionTarifasController } from './presentation/administracion-tarifas.controller';
import { Module } from '@nestjs/common';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { ConsultarTarifasVigentesUseCase } from './application/consultar-tarifas-vigentes.use-case';
import { ListarPaisesConTarifaUseCase } from './application/listar-paises-con-tarifa.use-case';
import type { ConceptoViaticoRepository, TarifaRepository } from './domain/repositorios';
import {
  ConceptoViaticoRepositoryDrizzle,
  TarifaRepositoryDrizzle,
} from './infrastructure/persistencia/tarifas.repository.drizzle';
import {
  CONCEPTOS_DESARROLLO,
  ConceptoViaticoRepositoryEnMemoria,
  TARIFAS_DESARROLLO,
  TarifaRepositoryEnMemoria,
} from './infrastructure/repositorios.memoria';
import { CONCEPTO_VIATICO_REPOSITORY, TARIFA_REPOSITORY } from './tarifas.tokens';

@Module({
  controllers: [AdministracionTarifasController],
  providers: [
    {
      provide: AdministrarTarifasUseCase,
      useFactory: (tarifas: TarifaRepository, conceptos: ConceptoViaticoRepository, ids: GeneradorIds) =>
        new AdministrarTarifasUseCase(tarifas, conceptos, ids),
      inject: [TARIFA_REPOSITORY, CONCEPTO_VIATICO_REPOSITORY, GENERADOR_IDS],
    },
    segunPersistencia<TarifaRepository>(TARIFA_REPOSITORY, {
      memoria: () => new TarifaRepositoryEnMemoria(TARIFAS_DESARROLLO),
      postgres: (db) => new TarifaRepositoryDrizzle(db),
    }),
    segunPersistencia<ConceptoViaticoRepository>(CONCEPTO_VIATICO_REPOSITORY, {
      memoria: () => new ConceptoViaticoRepositoryEnMemoria(CONCEPTOS_DESARROLLO),
      postgres: (db) => new ConceptoViaticoRepositoryDrizzle(db),
    }),
    {
      provide: ConsultarTarifasVigentesUseCase,
      useFactory: (tarifas: TarifaRepository, conceptos: ConceptoViaticoRepository) =>
        new ConsultarTarifasVigentesUseCase(tarifas, conceptos),
      inject: [TARIFA_REPOSITORY, CONCEPTO_VIATICO_REPOSITORY],
    },
    {
      provide: ListarPaisesConTarifaUseCase,
      useFactory: (tarifas: TarifaRepository) => new ListarPaisesConTarifaUseCase(tarifas),
      inject: [TARIFA_REPOSITORY],
    },
  ],
  exports: [ConsultarTarifasVigentesUseCase, ListarPaisesConTarifaUseCase],
})
export class TarifasModule {}
