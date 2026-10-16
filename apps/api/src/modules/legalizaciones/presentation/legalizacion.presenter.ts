import type { FechaCalendario } from '@viaticos/shared-kernel';
import type { LegalizacionResponse, PoliticaLegalizacionResponse, SoporteResponse } from '@viaticos/contracts';
import { Legalizacion, lineasSinVerificar, montosDelSoporte, requiereDecision, type Soporte } from '../domain/legalizacion';
import { liquidarLineas } from '../domain/lineas';
import type { PoliticaLegalizacion } from '../domain/politica';
import { datosAJson } from '../infrastructure/persistencia/serializacion';

export interface DirectorioNombres {
  nombres(ids: readonly string[]): Promise<Map<string, string>>;
  /** Empresa del viajero: las facturas deben venir a su NIT. */
  empresaDe?(viajeroId: string): Promise<{ nombre: string; nit: string } | null>;
}

export class PresentadorLegalizaciones {
  constructor(
    private readonly directorio: DirectorioNombres,
    private readonly hoy: () => FechaCalendario,
  ) {}

  async una(l: Legalizacion): Promise<LegalizacionResponse> {
    return (await this.varias([l]))[0]!;
  }

  async varias(lista: readonly Legalizacion[]): Promise<LegalizacionResponse[]> {
    const ids = lista.flatMap((l) => [
      l.viajeroId,
      ...l.historial.map((h) => h.usuarioId),
      ...l.soportes.flatMap((s) => (s.decision ? [s.decision.contadorId] : [])),
    ]);
    const nombres = await this.directorio.nombres(ids);
    const nombre = (id: string) => nombres.get(id) ?? id;
    const viajeros = [...new Set(lista.map((l) => l.viajeroId))];
    const empresas = new Map(await Promise.all(viajeros.map(async (v) => [v, (await this.directorio.empresaDe?.(v)) ?? null] as const)));

    return lista.map((l) => {
      const resumen = l.resumen();
      return {
        id: l.id,
        anticipoId: l.anticipoId,
        viajeroId: l.viajeroId,
        viajeroNombre: nombre(l.viajeroId),
        estado: l.estado,
        editable: l.estado === 'ABIERTA' || l.estado === 'DEVUELTA',
        montoAnticipo: l.montoAnticipo.toDto(),
        viaje: { inicio: l.viaje.inicio.toString(), fin: l.viaje.fin.toString() },
        empresa: empresas.get(l.viajeroId) ?? null,
        plazo: { fechaLimite: l.fechaLimite().toString(), vencida: l.estaVencida(this.hoy()) },
        resumen: {
          totalAceptado: resumen.totalAceptado.toDto(),
          totalExcluido: resumen.totalExcluido.toDto(),
          totalDescontado: resumen.totalDescontado.toDto(),
          saldo: resumen.saldo.toDto(),
        },
        descuentos: l.descuentos.map((d) => ({ movimientoId: d.movimientoId, descripcion: d.descripcion, fecha: d.fecha.toString(), valor: d.valor.toDto() })),
        soportes: l.soportes.map((s) => presentarSoporte(s, l.montoAnticipo.moneda, nombre)),
        historial: l.historial.map((h) => ({ tipo: h.tipo, usuarioNombre: nombre(h.usuarioId), comentario: h.comentario, en: h.en.toISOString() })),
        creadaEn: l.creadaEn.toISOString(),
      };
    });
  }
}

function presentarSoporte(s: Soporte, monedaAnticipo: string, nombre: (id: string) => string): SoporteResponse {
  const montos = montosDelSoporte(s, monedaAnticipo);
  return {
    id: s.id,
    tipo: s.tipo,
    estado: s.estado,
    descripcion: s.descripcionUsuario,
    // La clave interna de almacenamiento no se expone.
    archivo: s.archivo && { nombre: s.archivo.nombre, mime: s.archivo.mime, tamano: s.archivo.tamano },
    extraccion: s.extraccion,
    datos: s.datos && {
      ...datosAJson(s.datos),
      lineas: liquidarLineas(s.datos.lineas, s.datos.propinaSugerida).map((l) => ({
        descripcion: l.descripcion,
        valor: l.valor.toDto(),
        tipo: l.tipo,
        excluida: !l.valorExcluido.esCero(),
        valorExcluido: l.valorExcluido.toDto(),
        motivoExclusion: l.explicacion,
        porVerificar: l.porVerificar,
        decisionContable: l.decisionContable,
      })),
      propinaSugerida: s.datos.propinaSugerida?.toDto() ?? null,
    },
    montos: { aceptado: montos.aceptado.toDto(), excluido: montos.excluido.toDto() },
    alertas: s.alertas,
    requiereDecision: requiereDecision(s) || lineasSinVerificar(s) > 0,
    decision: s.decision && {
      aplica: s.decision.aplica,
      comentario: s.decision.comentario,
      contadorNombre: nombre(s.decision.contadorId),
      decididoEn: s.decision.decididoEn.toISOString(),
    },
    beneficiario: s.beneficiario,
    cargoBancario: s.cargoBancario && { descripcion: s.cargoBancario.descripcion, fecha: s.cargoBancario.fecha.toString(), valor: s.cargoBancario.valor.toDto() },
    creadoEn: s.creadoEn.toISOString(),
  };
}

export const presentarPolitica = (p: PoliticaLegalizacion): PoliticaLegalizacionResponse => ({
  topesReciboCaja: p.topesReciboCaja.map((t) => t.toDto()),
  exclusiones: p.exclusiones.map((e) => ({ ...e, palabrasAmbiguas: e.palabrasAmbiguas ?? [] })),
  actualizadaPor: p.actualizadaPor,
  actualizadaEn: p.actualizadaEn?.toISOString() ?? null,
});
