import type { ComprobanteRegistrado } from './detector-duplicados';
import type { HuellaComprobante } from './huella-comprobante';

export interface HuellaRepository {
  /**
   * Comprobantes vigentes que comparten alguna señal con la huella (búsqueda por
   * índices: sha256, clave fiscal, emisor+número, emisor+fecha, cercanía de hash
   * perceptual). No recorre toda la base.
   */
  buscarCandidatos(huella: HuellaComprobante): Promise<ComprobanteRegistrado[]>;

  /**
   * Registra la huella. Debe garantizar unicidad de sha256, clave fiscal y
   * emisor+número entre comprobantes vigentes (índices únicos en PostgreSQL),
   * lanzando CONFLICTO ante una carrera entre peticiones simultáneas.
   */
  registrar(comprobante: ComprobanteRegistrado): Promise<void>;

  /** Un comprobante anulado o rechazado deja de bloquear. */
  anular(comprobanteId: string): Promise<void>;
}
