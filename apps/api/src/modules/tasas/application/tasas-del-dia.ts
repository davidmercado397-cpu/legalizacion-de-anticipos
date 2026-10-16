import { DomainError, FechaCalendario } from '@viaticos/shared-kernel';
import type { Bitacora, ProveedorTasaCambio, Reloj } from '../../../shared/application/puertos';

export interface CotizacionDelDia {
  moneda: string;
  porDolar: string | null;
  fuente: string | null;
}

/**
 * Tasas vigentes en una fecha (por defecto hoy). `actualizar` se ejecuta a diario:
 * deja la TRM del día consultada y guardada antes de que alguien cotice un viaje.
 */
export class TasasDelDia {
  constructor(
    private readonly proveedor: ProveedorTasaCambio,
    private readonly reloj: Reloj,
    private readonly bitacora: Bitacora,
    private readonly monedas: readonly string[],
  ) {}

  async consultar(fecha: FechaCalendario = this.reloj.hoy()): Promise<{ fecha: string; cotizaciones: CotizacionDelDia[] }> {
    const cotizaciones = await Promise.all(
      this.monedas.map(async (moneda): Promise<CotizacionDelDia> => {
        try {
          const tasa = await this.proveedor.obtener('USD', moneda, fecha);
          return { moneda, porDolar: tasa.valor.toString(), fuente: tasa.fuente };
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          return { moneda, porDolar: null, fuente: null };
        }
      }),
    );
    return { fecha: fecha.toString(), cotizaciones };
  }

  async actualizar(): Promise<void> {
    const { fecha, cotizaciones } = await this.consultar();
    const resumen = cotizaciones.map((c) => `${c.moneda}=${c.porDolar ?? 'sin dato'}${c.fuente ? ` (${c.fuente})` : ''}`).join(', ');
    if (cotizaciones.some((c) => c.porDolar === null)) {
      this.bitacora.advertencia(`Tasas del ${fecha} incompletas: ${resumen}`);
    } else {
      this.bitacora.informacion?.(`Tasas del ${fecha}: ${resumen}`);
    }
  }
}
