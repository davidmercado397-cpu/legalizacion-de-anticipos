import { Inject, Logger, Module, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import type { BusEventos, GeneradorIds, ProveedorTasaCambio, Reloj } from '../../shared/application/puertos';
import type { Configuracion } from '../../shared/configuracion';
import { BitacoraNest } from '../../shared/infrastructure/bitacora-nest';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import {
  BUS_EVENTOS,
  COLA_TRABAJOS,
  CONFIGURACION,
  GENERADOR_IDS,
  PROVEEDOR_TASA_CAMBIO,
  RELOJ,
} from '../../shared/tokens';
import { ControlDuplicados } from '../comprobantes/application/control-duplicados';
import { ComprobantesModule } from '../comprobantes/comprobantes.module';
import { ConsultarUsuarioUseCase } from '../organizacion/application/consultar-usuario.use-case';
import { OrganizacionModule } from '../organizacion/organizacion.module';
import { GestionLegalizaciones } from './application/legalizaciones.use-cases';
import type { AlmacenArchivos, ColaTrabajos, ExtractorComprobantes } from './application/puertos';
import type { PoliticaLegalizacionRepository } from './domain/politica';
import type { LegalizacionRepository } from './domain/repositorios';
import { ControlDuplicadosAdapter, DirectorioEmpresasAdapter, suscribirAperturaDeLegalizaciones } from './infrastructure/adaptadores-modulos';
import { AlmacenLocal } from './infrastructure/almacen-local';
import { ExtractorClaude } from './infrastructure/extractor-claude';
import { ExtractorManual } from './infrastructure/extractor-manual';
import {
  LegalizacionRepositoryDrizzle,
  PoliticaLegalizacionDrizzle,
} from './infrastructure/persistencia/legalizacion.repository.drizzle';
import { LegalizacionRepositoryEnMemoria, PoliticaLegalizacionEnMemoria } from './infrastructure/repositorios.memoria';
import {
  ALMACEN_ARCHIVOS,
  EXTRACTOR_COMPROBANTES,
  LEGALIZACION_REPOSITORY,
  POLITICA_LEGALIZACION_REPOSITORY,
} from './legalizaciones.tokens';
import { PresentadorLegalizaciones } from './presentation/legalizacion.presenter';
import { LegalizacionesController } from './presentation/legalizaciones.controller';

@Module({
  imports: [OrganizacionModule, ComprobantesModule],
  controllers: [LegalizacionesController],
  providers: [
    segunPersistencia<LegalizacionRepository>(LEGALIZACION_REPOSITORY, {
      memoria: () => new LegalizacionRepositoryEnMemoria(),
      postgres: (db) => new LegalizacionRepositoryDrizzle(db),
    }),
    segunPersistencia<PoliticaLegalizacionRepository>(POLITICA_LEGALIZACION_REPOSITORY, {
      memoria: () => new PoliticaLegalizacionEnMemoria(),
      postgres: (db) => new PoliticaLegalizacionDrizzle(db),
    }),
    { provide: ALMACEN_ARCHIVOS, useFactory: (c: Configuracion) => new AlmacenLocal(c.ALMACEN_DIR), inject: [CONFIGURACION] },
    {
      provide: EXTRACTOR_COMPROBANTES,
      useFactory: (c: Configuracion): ExtractorComprobantes =>
        c.OCR_PROVEEDOR === 'claude' ? new ExtractorClaude(c.ANTHROPIC_API_KEY!, c.OCR_ESFUERZO) : new ExtractorManual(),
      inject: [CONFIGURACION],
    },
    {
      provide: GestionLegalizaciones,
      useFactory: (
        repo: LegalizacionRepository,
        politica: PoliticaLegalizacionRepository,
        almacen: AlmacenArchivos,
        extractor: ExtractorComprobantes,
        cola: ColaTrabajos,
        duplicados: ControlDuplicados,
        tasas: ProveedorTasaCambio,
        ids: GeneradorIds,
        reloj: Reloj,
        bus: BusEventos,
        usuarios: ConsultarUsuarioUseCase,
      ) =>
        new GestionLegalizaciones(
          repo,
          politica,
          almacen,
          extractor,
          cola,
          new ControlDuplicadosAdapter(duplicados),
          tasas,
          ids,
          reloj,
          bus,
          new BitacoraNest('Legalizaciones'),
          new DirectorioEmpresasAdapter(usuarios),
        ),
      inject: [
        LEGALIZACION_REPOSITORY,
        POLITICA_LEGALIZACION_REPOSITORY,
        ALMACEN_ARCHIVOS,
        EXTRACTOR_COMPROBANTES,
        COLA_TRABAJOS,
        ControlDuplicados,
        PROVEEDOR_TASA_CAMBIO,
        GENERADOR_IDS,
        RELOJ,
        BUS_EVENTOS,
        ConsultarUsuarioUseCase,
      ],
    },
    {
      provide: PresentadorLegalizaciones,
      useFactory: (consultar: ConsultarUsuarioUseCase, reloj: Reloj) =>
        new PresentadorLegalizaciones(
          {
            nombres: async (ids) => new Map((await consultar.varios(ids)).map((u) => [u.id, u.nombre])),
            empresaDe: (viajeroId) => new DirectorioEmpresasAdapter(consultar).empresaDe(viajeroId),
          },
          () => reloj.hoy(),
        ),
      inject: [ConsultarUsuarioUseCase, RELOJ],
    },
  ],
  exports: [GestionLegalizaciones],
})
export class LegalizacionesModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(LegalizacionesModule.name);

  constructor(
    @Inject(BUS_EVENTOS) private readonly bus: BusEventos,
    @Inject(GestionLegalizaciones) private readonly gestion: GestionLegalizaciones,
    @Inject(EXTRACTOR_COMPROBANTES) private readonly extractor: ExtractorComprobantes,
  ) {}

  onModuleInit(): void {
    suscribirAperturaDeLegalizaciones(this.bus, this.gestion);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(`Lectura de facturas: ${this.extractor.automatico ? 'automática (Claude)' : 'manual'}`);
    const reanudadas = await this.gestion.reanudarPendientes();
    if (reanudadas) this.logger.log(`Lecturas reanudadas: ${reanudadas}`);
  }
}
