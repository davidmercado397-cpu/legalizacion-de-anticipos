import type { Legalizacion, EstadoLegalizacion } from './legalizacion';

export interface LegalizacionRepository {
  /** Inserta o actualiza con concurrencia optimista (CONFLICTO si cambió la versión). */
  guardar(legalizacion: Legalizacion): Promise<void>;
  obtenerPorId(id: string): Promise<Legalizacion | null>;
  obtenerPorAnticipo(anticipoId: string): Promise<Legalizacion | null>;
  listarPorEstados(estados: readonly EstadoLegalizacion[]): Promise<Legalizacion[]>;
  listarPorViajero(viajeroId: string): Promise<Legalizacion[]>;
  /** Soportes que quedaron en PROCESANDO (para reencolar al arrancar). */
  listarSoportesProcesando(): Promise<Array<{ legalizacionId: string; soporteId: string }>>;
}
