import type { BusEventos } from '../../../shared/application/puertos';
import type { ConsultarUsuarioUseCase } from '../../organizacion/application/consultar-usuario.use-case';
import type { LegalizacionAprobada } from '../../legalizaciones/application/eventos-publicos';
import type { SolicitudAprobada } from '../../solicitudes/application/eventos-publicos';
import type { GestionAnticipos } from '../application/anticipos.use-cases';
import type { DirectorioPersonas } from '../application/puertos';

/** Suscripción al evento público del módulo de solicitudes. */
export function suscribirCreacionDeAnticipos(bus: BusEventos, anticipos: GestionAnticipos): void {
  bus.suscribir<SolicitudAprobada>('solicitudes.SolicitudAprobada', async (evento) => {
    await anticipos.crearDesdeSolicitudAprobada({
      solicitudId: evento.agregadoId,
      viajeroId: evento.viajeroId,
      monto: evento.totalAnticipo,
      viaje: { motivo: evento.motivo, destinos: evento.destinos },
    });
  });
}

export class DirectorioPersonasAdapter implements DirectorioPersonas {
  constructor(private readonly consultar: ConsultarUsuarioUseCase) {}

  async nombres(ids: readonly string[]): Promise<Map<string, string>> {
    return new Map((await this.consultar.varios(ids)).map((u) => [u.id, u.nombre]));
  }
}

/** La legalización aprobada cierra el anticipo. */
export function suscribirCierreDeAnticipos(bus: BusEventos, anticipos: GestionAnticipos): void {
  bus.suscribir<LegalizacionAprobada>('legalizaciones.LegalizacionAprobada', async (evento) => {
    await anticipos.marcarLegalizado(evento.anticipoId);
  });
}
