import { and, asc, eq } from 'drizzle-orm';
import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import type { ConceptoViatico, UnidadCobro } from '../../domain/concepto-viatico';
import type { ConceptoViaticoRepository, TarifaRepository } from '../../domain/repositorios';
import { Tarifa } from '../../domain/tarifa';
import { conceptosViatico, tarifas } from './tarifas.schema';

export class TarifaRepositoryDrizzle implements TarifaRepository {
  constructor(private readonly db: BaseDatos) {}

  async buscarPorCargoYPais(cargoId: string, paisCodigo: string): Promise<Tarifa[]> {
    const filas = await this.db
      .select()
      .from(tarifas)
      .where(and(eq(tarifas.cargoId, cargoId), eq(tarifas.paisCodigo, paisCodigo)));
    return filas.map((f) =>
      Tarifa.crear({
        id: f.id,
        cargoId: f.cargoId,
        paisCodigo: f.paisCodigo,
        conceptoCodigo: f.conceptoCodigo,
        valorUnitario: Money.of(f.valor, f.moneda),
        vigenteDesde: FechaCalendario.of(f.vigenteDesde),
        vigenteHasta: f.vigenteHasta ? FechaCalendario.of(f.vigenteHasta) : null,
      }),
    );
  }

  async listarPaisesDeCargo(cargoId: string): Promise<string[]> {
    const filas = await this.db
      .selectDistinct({ pais: tarifas.paisCodigo })
      .from(tarifas)
      .where(eq(tarifas.cargoId, cargoId))
      .orderBy(asc(tarifas.paisCodigo));
    return filas.map((f) => f.pais);
  }
}

export class ConceptoViaticoRepositoryDrizzle implements ConceptoViaticoRepository {
  constructor(private readonly db: BaseDatos) {}

  async listar(): Promise<ConceptoViatico[]> {
    const filas = await this.db.select().from(conceptosViatico);
    return filas.map((f) => ({ ...f, unidad: f.unidad as UnidadCobro }));
  }
}
