import { DomainError } from '@viaticos/shared-kernel';
import type { SolicitudRepository } from '../domain/repositorios';
import { RutaAprobacion } from '../domain/ruta-aprobacion';
import { SolicitudViaje, type SolicitudViajeProps } from '../domain/solicitud-viaje';

const clonar = (p: SolicitudViajeProps): SolicitudViajeProps => ({
  ...p,
  ruta: RutaAprobacion.rehidratar(p.ruta.pasosSnapshot),
});

/** Implementación en memoria (desarrollo y pruebas). Se reemplaza por Drizzle en la iteración 2. */
export class SolicitudRepositoryEnMemoria implements SolicitudRepository {
  private readonly datos = new Map<string, SolicitudViajeProps>();

  async guardar(solicitud: SolicitudViaje): Promise<void> {
    const actual = this.datos.get(solicitud.id);
    if (actual && actual.version !== solicitud.version) {
      throw new DomainError(
        'CONFLICTO_CONCURRENCIA',
        'CONFLICTO',
        'La solicitud fue modificada por otra persona; recargue e intente de nuevo',
      );
    }
    this.datos.set(solicitud.id, { ...solicitud.toSnapshot(), version: solicitud.version + 1 });
  }

  async obtenerPorId(id: string): Promise<SolicitudViaje | null> {
    const props = this.datos.get(id);
    return props ? SolicitudViaje.rehidratar(clonar(props)) : null;
  }

  async listarPorViajero(viajeroId: string): Promise<SolicitudViaje[]> {
    return this.filtrar((p) => p.viajeroId === viajeroId);
  }

  async listarPendientesDeAprobador(aprobadorId: string): Promise<SolicitudViaje[]> {
    return this.filtrar((p) => p.estado === 'EN_APROBACION' && p.ruta.esAprobadorActual(aprobadorId));
  }

  private filtrar(criterio: (p: SolicitudViajeProps) => boolean): SolicitudViaje[] {
    return [...this.datos.values()]
      .filter(criterio)
      .sort((a, b) => b.creadaEn.getTime() - a.creadaEn.getTime())
      .map((p) => SolicitudViaje.rehidratar(clonar(p)));
  }
}
