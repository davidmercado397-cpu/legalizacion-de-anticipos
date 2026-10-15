import { FechaCalendario, Money, TasaCambio, type MoneyDto, type TasaCambioDto } from '@viaticos/shared-kernel';
import type { EventoHistorial } from '../../domain/legalizacion';
import type { DatosSoporte, DecisionContable } from '../../domain/tipos';

/** Forma JSON (jsonb) de los objetos de dominio con Money / FechaCalendario / TasaCambio. */
export type DatosSoporteJson = Omit<DatosSoporte, 'fecha' | 'total' | 'lineas' | 'tasa'> & {
  fecha: string;
  total: MoneyDto;
  lineas: Array<{ descripcion: string; valor: MoneyDto; excluida: boolean; motivoExclusion: string | null }>;
  tasa: TasaCambioDto | null;
};
export type DecisionJson = Omit<DecisionContable, 'decididoEn'> & { decididoEn: string };
export type HistorialJson = Omit<EventoHistorial, 'en'> & { en: string };

export const datosAJson = (d: DatosSoporte): DatosSoporteJson => ({
  ...d,
  fecha: d.fecha.toString(),
  total: d.total.toDto(),
  lineas: d.lineas.map((l) => ({ ...l, valor: l.valor.toDto() })),
  tasa: d.tasa?.toDto() ?? null,
});

export const datosDesdeJson = (j: DatosSoporteJson): DatosSoporte => ({
  ...j,
  fecha: FechaCalendario.of(j.fecha),
  total: Money.fromDto(j.total),
  lineas: j.lineas.map((l) => ({ ...l, valor: Money.fromDto(l.valor) })),
  tasa: j.tasa && new TasaCambio(j.tasa.origen, j.tasa.destino, j.tasa.valor, FechaCalendario.of(j.tasa.fecha), j.tasa.fuente),
});

export const decisionAJson = (d: DecisionContable): DecisionJson => ({ ...d, decididoEn: d.decididoEn.toISOString() });
export const decisionDesdeJson = (j: DecisionJson): DecisionContable => ({ ...j, decididoEn: new Date(j.decididoEn) });
export const historialAJson = (h: EventoHistorial): HistorialJson => ({ ...h, en: h.en.toISOString() });
export const historialDesdeJson = (j: HistorialJson): EventoHistorial => ({ ...j, en: new Date(j.en) });
