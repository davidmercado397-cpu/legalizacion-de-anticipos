import { invariante } from '@viaticos/shared-kernel';
import type { PresupuestoViaje } from '../presupuesto-viaje';
import type { MotivoEscalamiento, ReglaEscalamiento } from './regla-escalamiento';

/**
 * Escala cuando el valor unitario propuesto supera la tarifa del cargo.
 * Ej.: tarifa de hotel 30 USD/noche y se proyectan 50 → escala.
 */
export class ExcedeTarifaRegla implements ReglaEscalamiento {
  static readonly CODIGO = 'EXCEDE_TARIFA';

  constructor(private readonly toleranciaPorcentaje = 0) {
    invariante(
      toleranciaPorcentaje >= 0 && toleranciaPorcentaje <= 100,
      'TOLERANCIA_INVALIDA',
      'La tolerancia debe estar entre 0 y 100%',
    );
  }

  evaluar(presupuesto: PresupuestoViaje): MotivoEscalamiento[] {
    return presupuesto.lineas
      .filter((linea) => linea.excedeConTolerancia(this.toleranciaPorcentaje))
      .map((linea) => ({
        codigo: ExcedeTarifaRegla.CODIGO,
        descripcion:
          `${linea.conceptoNombre} en ${linea.paisCodigo}: ${linea.valorUnitarioSolicitado} por ` +
          `${linea.unidad === 'NOCHE' ? 'noche' : 'día'} supera la tarifa de ${linea.tarifaUnitaria}`,
        detalles: {
          destinoIndice: linea.destinoIndice,
          conceptoCodigo: linea.conceptoCodigo,
          paisCodigo: linea.paisCodigo,
          unidad: linea.unidad,
          tarifaUnitaria: linea.tarifaUnitaria.toDto(),
          valorUnitarioSolicitado: linea.valorUnitarioSolicitado.toDto(),
          toleranciaPorcentaje: this.toleranciaPorcentaje,
        },
      }));
  }
}
