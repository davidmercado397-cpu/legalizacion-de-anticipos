import { DomainError, TasaCambio, type FechaCalendario } from '@viaticos/shared-kernel';
import type { ProveedorTasaCambio, Reloj } from '../../../shared/application/puertos';
import type { CacheTasas, CotizacionDolar, FuenteTasas } from './puertos';

/**
 * Tasas oficiales: cada moneda se cotiza contra el dólar en su fuente (TRM para
 * COP, BCE para el resto) y las cruzadas se calculan vía USD. Las cotizaciones se
 * guardan en caché: una fecha pasada nunca cambia.
 *
 * La TRM es la del día: un viaje se cotiza con la TRM de hoy y cada factura con la
 * de su fecha de emisión.
 */
/** Si la fuente no responde, se acepta la última tasa guardada de hasta estos días antes. */
export const DIAS_MAXIMOS_RESPALDO = 5;

export class ProveedorTasasOficiales implements ProveedorTasaCambio {
  constructor(
    private readonly fuentes: readonly FuenteTasas[],
    private readonly cache: CacheTasas,
    private readonly reloj: Reloj,
  ) {}

  async obtener(origen: string, destino: string, fecha: FechaCalendario): Promise<TasaCambio> {
    if (origen === destino) return TasaCambio.identidad(origen, fecha);
    // Una fecha futura (viaje proyectado) se cotiza con la tasa de hoy.
    const hoy = this.reloj.hoy();
    const fechaConsulta = fecha.esPosteriorA(hoy) ? hoy : fecha;

    const desdeDolar = async (moneda: string) => {
      const c = await this.cotizacion(moneda, fechaConsulta);
      return new TasaCambio('USD', moneda, c.porDolar, fecha, `${c.fuente} ${c.fechaPublicada}`);
    };
    if (origen === 'USD') return desdeDolar(destino);
    if (destino === 'USD') return (await desdeDolar(origen)).invertir();
    return (await desdeDolar(origen)).invertir().combinar(await desdeDolar(destino));
  }

  private async cotizacion(moneda: string, fecha: FechaCalendario): Promise<CotizacionDolar> {
    const clave = fecha.toString();
    const enCache = await this.cache.obtener(moneda, clave);
    if (enCache) return enCache;

    const fuente = this.fuentes.find((f) => f.soporta(moneda));
    if (!fuente) {
      throw new DomainError('TASA_NO_DISPONIBLE', 'REGLA_NEGOCIO', `No hay fuente oficial de tasas para ${moneda}`, { moneda });
    }
    let cotizacion: CotizacionDolar | null;
    try {
      cotizacion = await fuente.cotizar(moneda, fecha);
    } catch (error) {
      const respaldo = await this.cache.ultimaHasta(moneda, clave, fecha.sumarDias(-DIAS_MAXIMOS_RESPALDO).toString());
      if (respaldo) return { ...respaldo, fuente: `${respaldo.fuente} (última disponible)` };
      throw new DomainError(
        'TASA_NO_DISPONIBLE',
        'REGLA_NEGOCIO',
        `No se pudo consultar la tasa oficial de ${moneda}; intente de nuevo en unos minutos`,
        { moneda, causa: error instanceof Error ? error.message : String(error) },
      );
    }
    if (!cotizacion) {
      throw new DomainError('TASA_NO_DISPONIBLE', 'REGLA_NEGOCIO', `No hay tasa oficial publicada de ${moneda} para ${clave}`, { moneda });
    }
    // Solo se guarda lo definitivo: una fecha pasada, o la de hoy ya publicada. Si hoy aún
    // no hay TRM/BCE nueva se usa la última publicada, y se vuelve a consultar más tarde.
    // Las tasas configuradas tampoco se guardan, para que un cambio de configuración aplique.
    const definitiva = fecha.esAnteriorA(this.reloj.hoy()) || cotizacion.fechaPublicada === clave;
    if (definitiva && cotizacion.fuente !== 'CONFIGURADA') await this.cache.guardar(cotizacion);
    return cotizacion;
  }
}
