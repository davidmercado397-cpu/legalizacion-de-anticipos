import { Module } from '@nestjs/common';
import type { GeneradorIds, ProveedorTasaCambio, PublicadorEventos, Reloj } from '../../shared/application/puertos';
import { segunPersistencia } from '../../shared/infrastructure/base-datos/segun-persistencia';
import { GENERADOR_IDS, PROVEEDOR_TASA_CAMBIO, PUBLICADOR_EVENTOS, RELOJ } from '../../shared/tokens';
import { ConsultarUsuarioUseCase } from '../organizacion/application/consultar-usuario.use-case';
import { OrganizacionModule } from '../organizacion/organizacion.module';
import { ConsultarTarifasVigentesUseCase } from '../tarifas/application/consultar-tarifas-vigentes.use-case';
import { ListarPaisesConTarifaUseCase } from '../tarifas/application/listar-paises-con-tarifa.use-case';
import { TarifasModule } from '../tarifas/tarifas.module';
import { ConsultarSolicitudesUseCase } from './application/consultar-solicitudes.use-case';
import { CotizadorViaje } from './application/cotizador-viaje';
import { CrearSolicitudUseCase } from './application/crear-solicitud.use-case';
import {
  AprobarSolicitudUseCase,
  CancelarSolicitudUseCase,
  RechazarSolicitudUseCase,
} from './application/decidir-solicitud.use-cases';
import { DestinosDisponiblesUseCase } from './application/destinos-disponibles.use-case';
import { EstimarViajeUseCase } from './application/estimar-viaje.use-case';
import type { ConsultaTarifas, DirectorioOrganizacional } from './application/puertos';
import type { ConfiguracionEscalamientoRepository, SolicitudRepository } from './domain/repositorios';
import { ConsultaTarifasAdapter, DirectorioOrganizacionalAdapter } from './infrastructure/adaptadores-modulos';
import {
  CONFIGURACION_ESCALAMIENTO_DESARROLLO,
  ConfiguracionEscalamientoEnMemoria,
} from './infrastructure/configuracion-escalamiento.repository.memoria';
import { ConfiguracionEscalamientoDrizzle } from './infrastructure/persistencia/configuracion-escalamiento.repository.drizzle';
import { SolicitudRepositoryDrizzle } from './infrastructure/persistencia/solicitud.repository.drizzle';
import { SolicitudRepositoryEnMemoria } from './infrastructure/solicitud.repository.memoria';
import { AprobacionesController } from './presentation/aprobaciones.controller';
import { SolicitudesController } from './presentation/solicitudes.controller';
import {
  CONFIGURACION_ESCALAMIENTO_REPOSITORY,
  CONSULTA_TARIFAS,
  DIRECTORIO_ORGANIZACIONAL,
  SOLICITUD_REPOSITORY,
} from './solicitudes.tokens';

const cambioEstado = <T>(Clase: new (r: SolicitudRepository, c: Reloj, e: PublicadorEventos) => T) => ({
  provide: Clase,
  useFactory: (repo: SolicitudRepository, reloj: Reloj, eventos: PublicadorEventos) => new Clase(repo, reloj, eventos),
  inject: [SOLICITUD_REPOSITORY, RELOJ, PUBLICADOR_EVENTOS],
});

@Module({
  imports: [TarifasModule, OrganizacionModule],
  controllers: [SolicitudesController, AprobacionesController],
  providers: [
    // Infraestructura
    segunPersistencia<SolicitudRepository>(SOLICITUD_REPOSITORY, {
      memoria: () => new SolicitudRepositoryEnMemoria(),
      postgres: (db) => new SolicitudRepositoryDrizzle(db),
    }),
    segunPersistencia<ConfiguracionEscalamientoRepository>(CONFIGURACION_ESCALAMIENTO_REPOSITORY, {
      memoria: () => new ConfiguracionEscalamientoEnMemoria(CONFIGURACION_ESCALAMIENTO_DESARROLLO),
      postgres: (db) => new ConfiguracionEscalamientoDrizzle(db),
    }),
    {
      provide: CONSULTA_TARIFAS,
      useFactory: (vigentes: ConsultarTarifasVigentesUseCase, paises: ListarPaisesConTarifaUseCase) =>
        new ConsultaTarifasAdapter(vigentes, paises),
      inject: [ConsultarTarifasVigentesUseCase, ListarPaisesConTarifaUseCase],
    },
    {
      provide: DIRECTORIO_ORGANIZACIONAL,
      useFactory: (uc: ConsultarUsuarioUseCase) => new DirectorioOrganizacionalAdapter(uc),
      inject: [ConsultarUsuarioUseCase],
    },
    // Aplicación
    {
      provide: CotizadorViaje,
      useFactory: (
        directorio: DirectorioOrganizacional,
        tarifas: ConsultaTarifas,
        tasas: ProveedorTasaCambio,
        config: ConfiguracionEscalamientoRepository,
        reloj: Reloj,
      ) => new CotizadorViaje(directorio, tarifas, tasas, config, reloj),
      inject: [DIRECTORIO_ORGANIZACIONAL, CONSULTA_TARIFAS, PROVEEDOR_TASA_CAMBIO, CONFIGURACION_ESCALAMIENTO_REPOSITORY, RELOJ],
    },
    {
      provide: EstimarViajeUseCase,
      useFactory: (cotizador: CotizadorViaje) => new EstimarViajeUseCase(cotizador),
      inject: [CotizadorViaje],
    },
    {
      provide: CrearSolicitudUseCase,
      useFactory: (
        cotizador: CotizadorViaje,
        repo: SolicitudRepository,
        ids: GeneradorIds,
        reloj: Reloj,
        eventos: PublicadorEventos,
      ) => new CrearSolicitudUseCase(cotizador, repo, ids, reloj, eventos),
      inject: [CotizadorViaje, SOLICITUD_REPOSITORY, GENERADOR_IDS, RELOJ, PUBLICADOR_EVENTOS],
    },
    {
      provide: ConsultarSolicitudesUseCase,
      useFactory: (repo: SolicitudRepository) => new ConsultarSolicitudesUseCase(repo),
      inject: [SOLICITUD_REPOSITORY],
    },
    {
      provide: DestinosDisponiblesUseCase,
      useFactory: (directorio: DirectorioOrganizacional, tarifas: ConsultaTarifas) =>
        new DestinosDisponiblesUseCase(directorio, tarifas),
      inject: [DIRECTORIO_ORGANIZACIONAL, CONSULTA_TARIFAS],
    },
    cambioEstado(AprobarSolicitudUseCase),
    cambioEstado(RechazarSolicitudUseCase),
    cambioEstado(CancelarSolicitudUseCase),
  ],
})
export class SolicitudesModule {}
