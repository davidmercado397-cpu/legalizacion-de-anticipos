import type { ConfiguracionReglaEscalamiento } from './escalamiento/fabrica-reglas';
import type { SolicitudViaje } from './solicitud-viaje';

export interface SolicitudRepository {
  /** Inserta o actualiza. Lanza CONFLICTO si la versión cambió (concurrencia optimista). */
  guardar(solicitud: SolicitudViaje): Promise<void>;
  obtenerPorId(id: string): Promise<SolicitudViaje | null>;
  listarPorViajero(viajeroId: string): Promise<SolicitudViaje[]>;
  listarPendientesDeAprobador(aprobadorId: string): Promise<SolicitudViaje[]>;
}

export interface ConfiguracionEscalamientoRepository {
  obtener(): Promise<ConfiguracionReglaEscalamiento[]>;
}
