import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { ConceptoViatico } from '../domain/concepto-viatico';
import type { ConceptoViaticoRepository, TarifaRepository } from '../domain/repositorios';
import { Tarifa } from '../domain/tarifa';

export class TarifaRepositoryEnMemoria implements TarifaRepository {
  private readonly tarifas: Map<string, Tarifa>;

  constructor(iniciales: readonly Tarifa[] = []) {
    this.tarifas = new Map(iniciales.map((t) => [t.id, t]));
  }

  async buscarPorCargoYPais(cargoId: string, paisCodigo: string): Promise<Tarifa[]> {
    return this.listar({ cargoId, paisCodigo });
  }

  async listar(filtro: { cargoId?: string | undefined; paisCodigo?: string | undefined }): Promise<Tarifa[]> {
    return [...this.tarifas.values()].filter(
      (t) => (!filtro.cargoId || t.cargoId === filtro.cargoId) && (!filtro.paisCodigo || t.paisCodigo === filtro.paisCodigo),
    );
  }

  async obtenerPorId(id: string): Promise<Tarifa | null> {
    return this.tarifas.get(id) ?? null;
  }

  async guardar(tarifas: readonly Tarifa[]): Promise<void> {
    tarifas.forEach((t) => this.tarifas.set(t.id, t));
  }

  async listarPaisesDeCargo(cargoId: string): Promise<string[]> {
    return [...new Set([...this.tarifas.values()].filter((t) => t.cargoId === cargoId).map((t) => t.paisCodigo))].sort();
  }
}

export class ConceptoViaticoRepositoryEnMemoria implements ConceptoViaticoRepository {
  private readonly conceptos: Map<string, ConceptoViatico>;

  constructor(iniciales: readonly ConceptoViatico[] = []) {
    this.conceptos = new Map(iniciales.map((c) => [c.codigo, c]));
  }

  async listar(): Promise<ConceptoViatico[]> {
    return [...this.conceptos.values()];
  }

  async guardar(concepto: ConceptoViatico): Promise<void> {
    this.conceptos.set(concepto.codigo, concepto);
  }
}

// ---------- Datos de desarrollo (se reemplazan por la matriz real de la empresa) ----------

export const CONCEPTOS_DESARROLLO: readonly ConceptoViatico[] = [
  { codigo: 'ALOJAMIENTO', nombre: 'Alojamiento', unidad: 'NOCHE', activo: true },
  { codigo: 'ALIMENTACION', nombre: 'Alimentación', unidad: 'DIA', activo: true },
  { codigo: 'TRANSPORTE_LOCAL', nombre: 'Transporte local', unidad: 'DIA', activo: true },
];

const BASE_POR_PAIS: Record<string, { moneda: string; valores: Record<string, number> }> = {
  CO: { moneda: 'COP', valores: { ALOJAMIENTO: 250_000, ALIMENTACION: 120_000, TRANSPORTE_LOCAL: 60_000 } },
  BR: { moneda: 'USD', valores: { ALOJAMIENTO: 30, ALIMENTACION: 35, TRANSPORTE_LOCAL: 20 } },
  US: { moneda: 'USD', valores: { ALOJAMIENTO: 120, ALIMENTACION: 60, TRANSPORTE_LOCAL: 30 } },
};
const FACTOR_POR_CARGO: Record<string, number> = { ANALISTA: 1, COORDINADOR: 1.25, DIRECTOR: 1.6 };

export const TARIFAS_DESARROLLO: readonly Tarifa[] = Object.entries(FACTOR_POR_CARGO).flatMap(([cargoId, factor]) =>
  Object.entries(BASE_POR_PAIS).flatMap(([paisCodigo, { moneda, valores }]) =>
    Object.entries(valores).map(([conceptoCodigo, valor]) =>
      Tarifa.crear({
        id: `${cargoId}-${paisCodigo}-${conceptoCodigo}`,
        cargoId,
        paisCodigo,
        conceptoCodigo,
        valorUnitario: Money.of(valor, moneda).multiplicar(factor),
        vigenteDesde: FechaCalendario.of('2026-01-01'),
        vigenteHasta: null,
      }),
    ),
  ),
);
