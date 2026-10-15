import { DomainError, TasaCambio, type FechaCalendario } from '@viaticos/shared-kernel';
import type { ProveedorTasaCambio } from '../application/puertos';

/**
 * Solo para desarrollo: tasas fijas por dólar (ej. "COP=4000,BRL=5.40,EUR=0.92").
 * Las cruzadas se calculan vía USD. En producción se usa la TRM oficial y, para
 * pagos con tarjeta, la tasa real del extracto.
 */
export class ProveedorTasaCambioFija implements ProveedorTasaCambio {
  private readonly porDolar = new Map<string, string>([['USD', '1']]);

  constructor(tasasPorDolar: string) {
    for (const par of tasasPorDolar.split(',').map((p) => p.trim()).filter(Boolean)) {
      const [moneda, valor] = par.split('=');
      if (moneda && valor) this.porDolar.set(moneda.trim().toUpperCase(), valor.trim());
    }
  }

  async obtener(origen: string, destino: string, fecha: FechaCalendario): Promise<TasaCambio> {
    if (origen === destino) return TasaCambio.identidad(origen, fecha);
    const desdeDolar = (moneda: string) => {
      const valor = this.porDolar.get(moneda);
      if (!valor) {
        throw new DomainError('TASA_NO_DISPONIBLE', 'REGLA_NEGOCIO', `No hay tasa de cambio ${origen}->${destino}`, { origen, destino });
      }
      return new TasaCambio('USD', moneda, valor, fecha, 'TASA_DESARROLLO');
    };
    if (origen === 'USD') return desdeDolar(destino);
    if (destino === 'USD') return desdeDolar(origen).invertir();
    return desdeDolar(origen).invertir().combinar(desdeDolar(destino));
  }
}
