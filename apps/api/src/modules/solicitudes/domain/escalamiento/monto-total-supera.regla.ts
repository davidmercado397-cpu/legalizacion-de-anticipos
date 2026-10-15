import { MONEDAS_ANTICIPO, invariante, type Money } from '@viaticos/shared-kernel';
import type { PresupuestoViaje } from '../presupuesto-viaje';
import type { MotivoEscalamiento, ReglaEscalamiento } from './regla-escalamiento';

/** Escala cuando el total del anticipo supera un umbral (uno por cada moneda de anticipo). */
export class MontoTotalSuperaRegla implements ReglaEscalamiento {
  static readonly CODIGO = 'MONTO_TOTAL_SUPERA';

  constructor(private readonly umbrales: readonly Money[]) {
    for (const moneda of MONEDAS_ANTICIPO) {
      invariante(
        umbrales.filter((u) => u.moneda === moneda).length === 1,
        'UMBRAL_INCOMPLETO',
        `Debe configurarse exactamente un umbral en ${moneda}`,
      );
    }
  }

  evaluar(presupuesto: PresupuestoViaje): MotivoEscalamiento[] {
    const umbral = this.umbrales.find((u) => u.moneda === presupuesto.monedaAnticipo)!;
    const total = presupuesto.totalAnticipo;
    if (!total.esMayorQue(umbral)) return [];
    return [
      {
        codigo: MontoTotalSuperaRegla.CODIGO,
        descripcion: `El total del anticipo (${total}) supera el umbral de ${umbral}`,
        detalles: { total: total.toDto(), umbral: umbral.toDto() },
      },
    ];
  }
}
