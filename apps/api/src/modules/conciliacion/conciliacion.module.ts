import { Module } from '@nestjs/common';
import type { GeneradorIds, ProveedorTasaCambio, Reloj } from '../../shared/application/puertos';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { GENERADOR_IDS, PROVEEDOR_TASA_CAMBIO, RELOJ } from '../../shared/tokens';
import { GestionLegalizaciones } from '../legalizaciones/application/legalizaciones.use-cases';
import { LegalizacionesModule } from '../legalizaciones/legalizaciones.module';
import { ConsultarUsuarioUseCase } from '../organizacion/application/consultar-usuario.use-case';
import { OrganizacionModule } from '../organizacion/organizacion.module';
import { GestionConciliacion } from './application/conciliacion.use-cases';
import type { ExtractoRepository, PerfilExtractoRepository } from './domain/extracto';
import { ConsultaLegalizacionesAdapter } from './infrastructure/adaptadores-modulos';
import { LectorTabularArchivos } from './infrastructure/lector-tabular';
import { ExtractoRepositoryDrizzle, PerfilExtractoRepositoryDrizzle } from './infrastructure/persistencia/extracto.repository.drizzle';
import { ExtractoRepositoryEnMemoria, PerfilExtractoRepositoryEnMemoria } from './infrastructure/repositorios.memoria';
import { ConciliacionController } from './presentation/conciliacion.controller';
import { PresentadorExtractos } from './presentation/extracto.presenter';

const EXTRACTO_REPOSITORY = Symbol('ExtractoRepository');
const PERFIL_EXTRACTO_REPOSITORY = Symbol('PerfilExtractoRepository');

@Module({
  imports: [OrganizacionModule, LegalizacionesModule],
  controllers: [ConciliacionController],
  providers: [
    segunPersistencia<ExtractoRepository>(EXTRACTO_REPOSITORY, {
      memoria: () => new ExtractoRepositoryEnMemoria(),
      postgres: (db) => new ExtractoRepositoryDrizzle(db),
    }),
    segunPersistencia<PerfilExtractoRepository>(PERFIL_EXTRACTO_REPOSITORY, {
      memoria: () => new PerfilExtractoRepositoryEnMemoria(),
      postgres: (db) => new PerfilExtractoRepositoryDrizzle(db),
    }),
    {
      provide: GestionConciliacion,
      useFactory: (
        extractos: ExtractoRepository,
        perfiles: PerfilExtractoRepository,
        legalizaciones: GestionLegalizaciones,
        tasas: ProveedorTasaCambio,
        ids: GeneradorIds,
        reloj: Reloj,
      ) =>
        new GestionConciliacion(extractos, perfiles, new LectorTabularArchivos(), new ConsultaLegalizacionesAdapter(legalizaciones), tasas, ids, reloj),
      inject: [EXTRACTO_REPOSITORY, PERFIL_EXTRACTO_REPOSITORY, GestionLegalizaciones, PROVEEDOR_TASA_CAMBIO, GENERADOR_IDS, RELOJ],
    },
    {
      provide: PresentadorExtractos,
      useFactory: (consultar: ConsultarUsuarioUseCase) =>
        new PresentadorExtractos({ nombres: async (ids) => new Map((await consultar.varios(ids)).map((u) => [u.id, u.nombre])) }),
      inject: [ConsultarUsuarioUseCase],
    },
  ],
})
export class ConciliacionModule {}
