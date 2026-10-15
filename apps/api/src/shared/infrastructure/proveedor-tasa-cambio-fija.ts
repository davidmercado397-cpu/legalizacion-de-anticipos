import { DomainError, TasaCambio, type FechaCalendario } from '@viaticos/shared-kernel';
import type { ProveedorTasaCambio } from '../application/puertos';

/**
 * Solo para desarrollo: TRM fija USD→COP. En producción se usa un adaptador de
 * la TRM oficial (Superintendencia Financiera / datos.gov.co).
 */
export class ProveedorTasaCambioFija implements ProveedorTasaCambio {
  constructor(private readonly trmUsdCop: string) {}

  async obtener(origen: string, destino: string, fecha: FechaCalendario): Promise<TasaCambio> {
    if (origen === destino) return TasaCambio.identidad(origen, fecha);
    const trm = new TasaCambio('USD', 'COP', this.trmUsdCop, fecha, 'TRM_DESARROLLO');
    if (origen === 'USD' && destino === 'COP') return trm;
    if (origen === 'COP' && destino === 'USD') return trm.invertir();
    throw new DomainError('TASA_NO_DISPONIBLE', 'REGLA_NEGOCIO', `No hay tasa de cambio ${origen}->${destino}`, {
      origen,
      destino,
    });
  }
}
