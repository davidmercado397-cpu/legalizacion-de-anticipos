import { FechaCalendario, Money, TasaCambio, type MoneyDto, type TasaCambioDto } from '@viaticos/shared-kernel';
import type { EventoHistorial } from '../../domain/legalizacion';
import type { LineaSoporte, TipoLinea } from '../../domain/lineas';
import type { DatosSoporte, DecisionContable } from '../../domain/tipos';

/** Forma JSON (jsonb) de los objetos de dominio con Money / FechaCalendario / TasaCambio. */
/** Las líneas guardadas antes de las reglas por línea no tienen tipo ni verificación (se leen como gasto). */
interface LineaJson {
  descripcion: string;
  valor: MoneyDto;
  tipo?: TipoLinea;
  motivoExclusion: string | null;
  porVerificar?: string | null;
  decisionContable?: LineaSoporte['decisionContable'];
}

export type DatosSoporteJson = Omit<DatosSoporte, 'fecha' | 'total' | 'lineas' | 'tasa' | 'propinaSugerida'> & {
  fecha: string;
  total: MoneyDto;
  lineas: LineaJson[];
  propinaSugerida?: MoneyDto | null;
  tasa: TasaCambioDto | null;
};
export type DecisionJson = Omit<DecisionContable, 'decididoEn'> & { decididoEn: string };
export type HistorialJson = Omit<EventoHistorial, 'en'> & { en: string };

export const datosAJson = (d: DatosSoporte): DatosSoporteJson => ({
  ...d,
  fecha: d.fecha.toString(),
  total: d.total.toDto(),
  lineas: d.lineas.map((l) => ({ ...l, valor: l.valor.toDto() })),
  propinaSugerida: d.propinaSugerida?.toDto() ?? null,
  tasa: d.tasa?.toDto() ?? null,
});

export const datosDesdeJson = (j: DatosSoporteJson): DatosSoporte => ({
  ...j,
  fecha: FechaCalendario.of(j.fecha),
  total: Money.fromDto(j.total),
  lineas: j.lineas.map(
    (l): LineaSoporte => ({
      descripcion: l.descripcion,
      valor: Money.fromDto(l.valor),
      tipo: l.tipo ?? 'GASTO',
      motivoExclusion: l.motivoExclusion,
      porVerificar: l.porVerificar ?? null,
      decisionContable: l.decisionContable ?? null,
    }),
  ),
  propinaSugerida: j.propinaSugerida ? Money.fromDto(j.propinaSugerida) : null,
  tasa: j.tasa && new TasaCambio(j.tasa.origen, j.tasa.destino, j.tasa.valor, FechaCalendario.of(j.tasa.fecha), j.tasa.fuente),
});

export const decisionAJson = (d: DecisionContable): DecisionJson => ({ ...d, decididoEn: d.decididoEn.toISOString() });
export const decisionDesdeJson = (j: DecisionJson): DecisionContable => ({ ...j, decididoEn: new Date(j.decididoEn) });
export const historialAJson = (h: EventoHistorial): HistorialJson => ({ ...h, en: h.en.toISOString() });
export const historialDesdeJson = (j: HistorialJson): EventoHistorial => ({ ...j, en: new Date(j.en) });
