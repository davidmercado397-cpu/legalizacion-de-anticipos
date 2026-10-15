import { DomainError } from '@viaticos/shared-kernel';
import type { SolicitudRepository } from '../domain/repositorios';
import type { SolicitudViaje } from '../domain/solicitud-viaje';

export class ConsultarSolicitudesUseCase {
  constructor(private readonly solicitudes: SolicitudRepository) {}

  async obtener(solicitudId: string, usuarioId: string): Promise<SolicitudViaje> {
    const solicitud = await this.solicitudes.obtenerPorId(solicitudId);
    // Misma respuesta si no existe o no tiene acceso: no se revela la existencia.
    if (!solicitud || !solicitud.puedeSerVistaPor(usuarioId)) {
      throw new DomainError('SOLICITUD_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La solicitud no existe');
    }
    return solicitud;
  }

  listarDelViajero(viajeroId: string): Promise<SolicitudViaje[]> {
    return this.solicitudes.listarPorViajero(viajeroId);
  }

  listarPendientesDeAprobar(aprobadorId: string): Promise<SolicitudViaje[]> {
    return this.solicitudes.listarPendientesDeAprobador(aprobadorId);
  }
}
