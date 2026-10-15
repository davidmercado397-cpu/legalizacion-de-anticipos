import type { GeneradorIds, PublicadorEventos, Reloj } from '../../../shared/application/puertos';
import type { SolicitudRepository } from '../domain/repositorios';
import { SolicitudViaje } from '../domain/solicitud-viaje';
import type { CotizadorViaje, CotizarViajeComando } from './cotizador-viaje';

export interface CrearSolicitudComando extends CotizarViajeComando {
  motivo: string;
  justificacion?: string | undefined;
}

/** El viajero acepta el estimado y lo envía a aprobación. */
export class CrearSolicitudUseCase {
  constructor(
    private readonly cotizador: CotizadorViaje,
    private readonly solicitudes: SolicitudRepository,
    private readonly ids: GeneradorIds,
    private readonly reloj: Reloj,
    private readonly eventos: PublicadorEventos,
  ) {}

  async ejecutar(comando: CrearSolicitudComando): Promise<SolicitudViaje> {
    // Se recalcula en el servidor: nunca se confía en un estimado enviado por el cliente.
    const { viajero, destinos, presupuesto, escalamiento } = await this.cotizador.cotizar(comando);

    const solicitud = SolicitudViaje.crear({
      id: this.ids.nuevo(),
      aprobadores: {
        viajeroId: viajero.id,
        jefeInmediatoId: viajero.jefeInmediatoId,
        jefeDirectivoId: viajero.jefeDirectivoId,
      },
      motivo: comando.motivo,
      justificacion: comando.justificacion ?? null,
      destinos,
      presupuesto,
      escalamiento,
      ahora: this.reloj.ahora(),
    });

    await this.solicitudes.guardar(solicitud);
    await this.eventos.publicar(solicitud.extraerEventos());
    return solicitud;
  }
}
