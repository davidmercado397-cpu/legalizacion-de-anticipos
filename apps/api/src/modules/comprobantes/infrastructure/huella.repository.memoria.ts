import { DomainError } from '@viaticos/shared-kernel';
import type { ComprobanteRegistrado } from '../domain/duplicados/detector-duplicados';
import type { HuellaComprobante } from '../domain/duplicados/huella-comprobante';
import type { HuellaRepository } from '../domain/duplicados/huella.repository';

/**
 * En memoria para desarrollo/pruebas. Reproduce los índices únicos parciales que
 * tendrá PostgreSQL (iteración 2):
 *   UNIQUE (sha256)                     WHERE vigente
 *   UNIQUE (clave_fiscal)               WHERE vigente AND clave_fiscal IS NOT NULL
 *   UNIQUE (emisor_id, numero_documento) WHERE vigente AND ambos NOT NULL
 */
export class HuellaRepositoryEnMemoria implements HuellaRepository {
  private readonly vigentes = new Map<string, ComprobanteRegistrado>();

  async buscarCandidatos(h: HuellaComprobante): Promise<ComprobanteRegistrado[]> {
    return [...this.vigentes.values()].filter(({ huella: e }) =>
      e.sha256 === h.sha256 ||
      (h.claveFiscal && e.claveFiscal?.equals(h.claveFiscal)) ||
      (h.emisorId && e.emisorId === h.emisorId) ||
      (h.hashPerceptual && e.hashPerceptual),
    );
  }

  async registrar(c: ComprobanteRegistrado): Promise<void> {
    const choca = [...this.vigentes.values()].some(
      ({ comprobanteId, huella: e }) =>
        comprobanteId !== c.comprobanteId &&
        (e.sha256 === c.huella.sha256 ||
          (!!c.huella.claveFiscal && !!e.claveFiscal?.equals(c.huella.claveFiscal)) ||
          (!!c.huella.emisorId &&
            !!c.huella.numeroDocumento &&
            e.emisorId === c.huella.emisorId &&
            e.numeroDocumento === c.huella.numeroDocumento)),
    );
    if (choca) {
      throw new DomainError('COMPROBANTE_DUPLICADO', 'CONFLICTO', 'El comprobante ya fue radicado');
    }
    this.vigentes.set(c.comprobanteId, c);
  }

  async anular(comprobanteId: string): Promise<void> {
    this.vigentes.delete(comprobanteId);
  }
}
