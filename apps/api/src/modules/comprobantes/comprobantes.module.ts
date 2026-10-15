import { Module } from '@nestjs/common';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { ControlDuplicados } from './application/control-duplicados';
import { HUELLA_REPOSITORY } from './comprobantes.tokens';
import { DetectorDuplicados } from './domain/duplicados/detector-duplicados';
import type { HuellaRepository } from './domain/duplicados/huella.repository';
import { HuellaRepositoryEnMemoria } from './infrastructure/huella.repository.memoria';
import { HuellaRepositoryDrizzle } from './infrastructure/persistencia/huella.repository.drizzle';
import { ComprobantesController } from './presentation/comprobantes.controller';

@Module({
  controllers: [ComprobantesController],
  providers: [
    segunPersistencia<HuellaRepository>(HUELLA_REPOSITORY, {
      memoria: () => new HuellaRepositoryEnMemoria(),
      postgres: (db) => new HuellaRepositoryDrizzle(db),
    }),
    {
      provide: ControlDuplicados,
      useFactory: (repo: HuellaRepository) => new ControlDuplicados(repo, new DetectorDuplicados()),
      inject: [HUELLA_REPOSITORY],
    },
  ],
  exports: [ControlDuplicados],
})
export class ComprobantesModule {}
