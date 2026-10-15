import { DomainError } from '@viaticos/shared-kernel';
import type { DetectorDuplicados, ResultadoDuplicidad } from '../domain/duplicados/detector-duplicados';
import { HuellaComprobante, type DatosHuella } from '../domain/duplicados/huella-comprobante';
import type { HuellaRepository } from '../domain/duplicados/huella.repository';

/**
 * Capa anti-duplicados (ADR-0007). La usan la ingesta (solo SHA-256, antes de
 * pagar OCR), el procesamiento OCR, la corrección manual de campos y WhatsApp.
 */
export class ControlDuplicados {
  constructor(
    private readonly huellas: HuellaRepository,
    private readonly detector: DetectorDuplicados,
  ) {}

  async verificar(datos: DatosHuella, comprobanteIdActual?: string): Promise<ResultadoDuplicidad> {
    const huella = HuellaComprobante.crear(datos);
    const candidatos = await this.huellas.buscarCandidatos(huella);
    return this.detector.evaluar(huella, candidatos, comprobanteIdActual);
  }

  /**
   * Verifica y registra. Un DUPLICADO se rechaza; un SOSPECHOSO se registra y el
   * resultado viaja con el comprobante para que contabilidad lo revise.
   */
  async registrar(comprobanteId: string, viajeroId: string, datos: DatosHuella): Promise<ResultadoDuplicidad> {
    const huella = HuellaComprobante.crear(datos);
    const resultado = this.detector.evaluar(huella, await this.huellas.buscarCandidatos(huella), comprobanteId);
    if (resultado.veredicto === 'DUPLICADO') {
      throw new DomainError('COMPROBANTE_DUPLICADO', 'CONFLICTO', 'El comprobante ya fue radicado', {
        coincidencias: resultado.coincidencias.map((c) => c.codigo),
      });
    }
    await this.huellas.registrar({ comprobanteId, viajeroId, huella });
    return resultado;
  }
}
