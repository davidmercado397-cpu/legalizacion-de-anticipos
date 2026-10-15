import { Module } from '@nestjs/common';
import { ConsultarTarifasVigentesUseCase } from './application/consultar-tarifas-vigentes.use-case';
import type { ConceptoViaticoRepository, TarifaRepository } from './domain/repositorios';
import {
  CONCEPTOS_DESARROLLO,
  ConceptoViaticoRepositoryEnMemoria,
  TARIFAS_DESARROLLO,
  TarifaRepositoryEnMemoria,
} from './infrastructure/repositorios.memoria';
import { CONCEPTO_VIATICO_REPOSITORY, TARIFA_REPOSITORY } from './tarifas.tokens';

@Module({
  providers: [
    { provide: TARIFA_REPOSITORY, useFactory: () => new TarifaRepositoryEnMemoria(TARIFAS_DESARROLLO) },
    {
      provide: CONCEPTO_VIATICO_REPOSITORY,
      useFactory: () => new ConceptoViaticoRepositoryEnMemoria(CONCEPTOS_DESARROLLO),
    },
    {
      provide: ConsultarTarifasVigentesUseCase,
      useFactory: (tarifas: TarifaRepository, conceptos: ConceptoViaticoRepository) =>
        new ConsultarTarifasVigentesUseCase(tarifas, conceptos),
      inject: [TARIFA_REPOSITORY, CONCEPTO_VIATICO_REPOSITORY],
    },
  ],
  exports: [ConsultarTarifasVigentesUseCase],
})
export class TarifasModule {}
