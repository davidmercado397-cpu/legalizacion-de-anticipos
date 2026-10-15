import { Module } from '@nestjs/common';
import { ControlDuplicados } from './application/control-duplicados';
import { HUELLA_REPOSITORY } from './comprobantes.tokens';
import { DetectorDuplicados } from './domain/duplicados/detector-duplicados';
import type { HuellaRepository } from './domain/duplicados/huella.repository';
import { HuellaRepositoryEnMemoria } from './infrastructure/huella.repository.memoria';
import { ComprobantesController } from './presentation/comprobantes.controller';

@Module({
  controllers: [ComprobantesController],
  providers: [
    { provide: HUELLA_REPOSITORY, useFactory: () => new HuellaRepositoryEnMemoria() },
    {
      provide: ControlDuplicados,
      useFactory: (repo: HuellaRepository) => new ControlDuplicados(repo, new DetectorDuplicados()),
      inject: [HUELLA_REPOSITORY],
    },
  ],
  exports: [ControlDuplicados],
})
export class ComprobantesModule {}
