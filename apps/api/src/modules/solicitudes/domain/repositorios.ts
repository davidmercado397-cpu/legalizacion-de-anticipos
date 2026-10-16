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
  /** Quién y cuándo la cambió por última vez (null: valores iniciales del sistema). */
  auditoria(): Promise<{ actualizadoPor: string | null; actualizadoEn: Date | null }>;
  guardar(configuracion: readonly ConfiguracionReglaEscalamiento[], usuarioId: string, ahora: Date): Promise<void>;
}
