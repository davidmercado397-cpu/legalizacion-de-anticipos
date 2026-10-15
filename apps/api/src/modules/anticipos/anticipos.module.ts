import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { BusEventos, GeneradorIds, Reloj } from '../../shared/application/puertos';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { BUS_EVENTOS, GENERADOR_IDS, RELOJ } from '../../shared/tokens';
import { ConsultarUsuarioUseCase } from '../organizacion/application/consultar-usuario.use-case';
import { OrganizacionModule } from '../organizacion/organizacion.module';
import { ANTICIPO_REPOSITORY, ERP_ANTICIPOS } from './anticipos.tokens';
import { GestionAnticipos } from './application/anticipos.use-cases';
import type { ErpAnticiposGateway } from './application/puertos';
import type { AnticipoRepository } from './domain/anticipo';
import { DirectorioPersonasAdapter, suscribirCreacionDeAnticipos } from './infrastructure/adaptadores-modulos';
import { AnticipoRepositoryEnMemoria } from './infrastructure/anticipo.repository.memoria';
import { ErpAnticiposSimulado } from './infrastructure/erp-anticipos.simulado';
import { AnticipoRepositoryDrizzle } from './infrastructure/persistencia/anticipo.repository.drizzle';
import { AnticiposController } from './presentation/anticipos.controller';
import { PresentadorAnticipos } from './presentation/anticipo.presenter';

@Module({
  imports: [OrganizacionModule],
  controllers: [AnticiposController],
  providers: [
    segunPersistencia<AnticipoRepository>(ANTICIPO_REPOSITORY, {
      memoria: () => new AnticipoRepositoryEnMemoria(),
      postgres: (db) => new AnticipoRepositoryDrizzle(db),
    }),
    // Adaptador real de Siesa Enterprise: pendiente de la documentación de su API.
    { provide: ERP_ANTICIPOS, useFactory: () => new ErpAnticiposSimulado() },
    {
      provide: GestionAnticipos,
      useFactory: (repo: AnticipoRepository, erp: ErpAnticiposGateway, ids: GeneradorIds, reloj: Reloj, bus: BusEventos) =>
        new GestionAnticipos(repo, erp, ids, reloj, bus),
      inject: [ANTICIPO_REPOSITORY, ERP_ANTICIPOS, GENERADOR_IDS, RELOJ, BUS_EVENTOS],
    },
    {
      provide: PresentadorAnticipos,
      useFactory: (consultar: ConsultarUsuarioUseCase) => new PresentadorAnticipos(new DirectorioPersonasAdapter(consultar)),
      inject: [ConsultarUsuarioUseCase],
    },
  ],
  exports: [GestionAnticipos],
})
export class AnticiposModule implements OnModuleInit {
  constructor(
    @Inject(BUS_EVENTOS) private readonly bus: BusEventos,
    @Inject(GestionAnticipos) private readonly anticipos: GestionAnticipos,
  ) {}

  onModuleInit(): void {
    suscribirCreacionDeAnticipos(this.bus, this.anticipos);
  }
}
