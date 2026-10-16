import type { ExtractoResponse, ExtractoResumenResponse } from '@viaticos/contracts';
import { Money } from '@viaticos/shared-kernel';
import type { DetalleExtracto } from '../application/conciliacion.use-cases';
import type { PagoTarjeta } from '../domain/conciliador';
import type { Extracto } from '../domain/extracto';

export interface DirectorioNombres {
  nombres(ids: readonly string[]): Promise<Map<string, string>>;
}

const presentarPago = (p: PagoTarjeta) => ({
  soporteId: p.soporteId,
  legalizacionId: p.legalizacionId,
  fecha: p.fecha.toString(),
  emisor: p.emisor,
  totalOriginal: p.totalOriginal.toDto(),
  totalEnMonedaExtracto: p.totalEnMonedaExtracto?.toDto() ?? null,
});

function resumen(e: Extracto) {
  const cruzados = new Set(e.cruces.map((c) => c.movimientoId));
  const sinSoporte = e.cargos.filter((m) => !cruzados.has(m.id));
  const sumar = (ms: readonly { valor: Money }[]) => ms.reduce((t, m) => t.sumar(m.valor), Money.cero(e.moneda));
  const decididos = new Set(e.decisionesCargos.map((d) => d.movimientoId));
  return {
    cargos: e.cargos.length,
    cargosSinDecidir: sinSoporte.filter((m) => !decididos.has(m.id)).length,
    conciliados: e.cruces.filter((c) => c.estado !== 'SUGERIDO').length,
    porRevisar: e.cruces.filter((c) => c.estado === 'SUGERIDO').length,
    cargosSinSoporte: sinSoporte.length,
    totalCargos: sumar(e.cargos).toDto(),
    totalCargosSinSoporte: sumar(sinSoporte).toDto(),
  };
}

export class PresentadorExtractos {
  constructor(private readonly directorio: DirectorioNombres) {}

  async varios(extractos: readonly Extracto[]): Promise<ExtractoResumenResponse[]> {
    const nombres = await this.directorio.nombres(extractos.map((e) => e.titularId));
    return extractos.map((e) => this.base(e, nombres));
  }

  async detalle({ extracto: e, pagos, cruzadosEnOtro }: DetalleExtracto): Promise<ExtractoResponse> {
    const nombres = await this.directorio.nombres([e.titularId]);
    const porSoporte = new Map(pagos.map((p) => [p.soporteId, p]));
    const cruces = new Map(e.cruces.map((c) => [c.movimientoId, c]));
    const soportesCruzados = new Set(e.cruces.map((c) => c.soporteId));
    const pagosSinMovimiento = pagos.filter((p) => !soportesCruzados.has(p.soporteId) && !cruzadosEnOtro.has(p.soporteId));
    return {
      ...this.base(e, nombres),
      resumen: { ...resumen(e), pagosSinMovimiento: pagosSinMovimiento.length },
      movimientos: e.movimientos.map((m) => {
        const c = cruces.get(m.id);
        const pago = c && porSoporte.get(c.soporteId);
        return {
          id: m.id,
          fila: m.fila,
          fecha: m.fecha.toString(),
          descripcion: m.descripcion,
          referencia: m.referencia,
          valor: m.valor.toDto(),
          tipo: m.tipo,
          cruce: c
            ? { estado: c.estado, puntaje: c.puntaje, montoSoporte: c.montoSoporte?.toDto() ?? null, pago: pago ? presentarPago(pago) : null }
            : null,
          descuento: (() => {
            const d = !c && m.tipo === 'DEBITO' ? e.decisionesCargos.find((x) => x.movimientoId === m.id) : undefined;
            return d ? { descontar: d.descontar, decididoEn: d.decididoEn.toISOString() } : null;
          })(),
        };
      }),
      pagosSinMovimiento: pagosSinMovimiento.map(presentarPago),
    };
  }

  private base(e: Extracto, nombres: Map<string, string>): ExtractoResumenResponse {
    const s = e.toSnapshot();
    const { desde, hasta } = e.periodo();
    return {
      id: s.id,
      titularId: s.titularId,
      titularNombre: nombres.get(s.titularId) ?? null,
      legalizacionId: s.legalizacionId,
      ultimos4: s.ultimos4,
      moneda: s.moneda,
      archivoNombre: s.archivo.nombre,
      cargadoEn: s.cargadoEn.toISOString(),
      periodo: { desde: desde.toString(), hasta: hasta.toString() },
      resumen: resumen(e),
    };
  }
}

export const presentarMovimientoLeido = (m: { fila: number; fecha: { toString(): string }; descripcion: string; referencia: string | null; valor: Money; tipo: 'DEBITO' | 'CREDITO' }) => ({
  fila: m.fila,
  fecha: m.fecha.toString(),
  descripcion: m.descripcion,
  referencia: m.referencia,
  valor: m.valor.toDto(),
  tipo: m.tipo,
});
