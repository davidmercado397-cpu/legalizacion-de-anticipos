import { DomainError } from '@viaticos/shared-kernel';
import type { PublicadorEventos, Reloj } from '../../../shared/application/puertos';
import type { SolicitudRepository } from '../domain/repositorios';
import type { SolicitudViaje } from '../domain/solicitud-viaje';

abstract class CambioEstadoSolicitud<C extends { solicitudId: string }> {
  constructor(
    protected readonly solicitudes: SolicitudRepository,
    protected readonly reloj: Reloj,
    private readonly eventos: PublicadorEventos,
  ) {}

  /** Template method: cargar → aplicar la regla de dominio → guardar → publicar. */
  async ejecutar(comando: C): Promise<SolicitudViaje> {
    const solicitud = await this.solicitudes.obtenerPorId(comando.solicitudId);
    if (!solicitud) {
      throw new DomainError('SOLICITUD_NO_ENCONTRADA', 'NO_ENCONTRADO', 'La solicitud no existe');
    }
    this.aplicar(solicitud, comando, this.reloj.ahora());
    await this.solicitudes.guardar(solicitud);
    await this.eventos.publicar(solicitud.extraerEventos());
    return solicitud;
  }

  protected abstract aplicar(solicitud: SolicitudViaje, comando: C, ahora: Date): void;
}

export interface AprobarSolicitudComando {
  solicitudId: string;
  aprobadorId: string;
  comentario?: string | undefined;
}

export class AprobarSolicitudUseCase extends CambioEstadoSolicitud<AprobarSolicitudComando> {
  protected aplicar(s: SolicitudViaje, c: AprobarSolicitudComando, ahora: Date): void {
    s.aprobar(c.aprobadorId, ahora, c.comentario ?? null);
  }
}

export interface RechazarSolicitudComando {
  solicitudId: string;
  aprobadorId: string;
  comentario: string;
}

export class RechazarSolicitudUseCase extends CambioEstadoSolicitud<RechazarSolicitudComando> {
  protected aplicar(s: SolicitudViaje, c: RechazarSolicitudComando, ahora: Date): void {
    s.rechazar(c.aprobadorId, ahora, c.comentario);
  }
}

export interface CancelarSolicitudComando {
  solicitudId: string;
  usuarioId: string;
}

export class CancelarSolicitudUseCase extends CambioEstadoSolicitud<CancelarSolicitudComando> {
  protected aplicar(s: SolicitudViaje, c: CancelarSolicitudComando, ahora: Date): void {
    s.cancelar(c.usuarioId, ahora);
  }
}
