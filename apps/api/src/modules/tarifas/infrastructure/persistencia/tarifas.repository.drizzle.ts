import { and, asc, eq } from 'drizzle-orm';
import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import type { ConceptoViatico, UnidadCobro } from '../../domain/concepto-viatico';
import type { ConceptoViaticoRepository, TarifaRepository } from '../../domain/repositorios';
import { Tarifa } from '../../domain/tarifa';
import { conceptosViatico, tarifas } from './tarifas.schema';

const aDominio = (f: typeof tarifas.$inferSelect) =>
  Tarifa.crear({
    id: f.id,
    cargoId: f.cargoId,
    paisCodigo: f.paisCodigo,
    conceptoCodigo: f.conceptoCodigo,
    valorUnitario: Money.of(f.valor, f.moneda),
    vigenteDesde: FechaCalendario.of(f.vigenteDesde),
    vigenteHasta: f.vigenteHasta ? FechaCalendario.of(f.vigenteHasta) : null,
  });

export class TarifaRepositoryDrizzle implements TarifaRepository {
  constructor(private readonly db: BaseDatos) {}

  async buscarPorCargoYPais(cargoId: string, paisCodigo: string): Promise<Tarifa[]> {
    return this.listar({ cargoId, paisCodigo });
  }

  async listar(filtro: { cargoId?: string | undefined; paisCodigo?: string | undefined }): Promise<Tarifa[]> {
    const filas = await this.db
      .select()
      .from(tarifas)
      .where(
        and(
          filtro.cargoId ? eq(tarifas.cargoId, filtro.cargoId) : undefined,
          filtro.paisCodigo ? eq(tarifas.paisCodigo, filtro.paisCodigo) : undefined,
        ),
      )
      .orderBy(asc(tarifas.cargoId), asc(tarifas.paisCodigo), asc(tarifas.conceptoCodigo), asc(tarifas.vigenteDesde));
    return filas.map(aDominio);
  }

  async obtenerPorId(id: string): Promise<Tarifa | null> {
    const [fila] = await this.db.select().from(tarifas).where(eq(tarifas.id, id)).limit(1);
    return fila ? aDominio(fila) : null;
  }

  async guardar(lista: readonly Tarifa[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const t of lista) {
        const fila = {
          cargoId: t.cargoId,
          paisCodigo: t.paisCodigo,
          conceptoCodigo: t.conceptoCodigo,
          valor: t.valorUnitario.monto,
          moneda: t.valorUnitario.moneda,
          vigenteDesde: t.vigenteDesde.toString(),
          vigenteHasta: t.vigenteHasta?.toString() ?? null,
        };
        await tx.insert(tarifas).values({ id: t.id, ...fila }).onConflictDoUpdate({ target: tarifas.id, set: fila });
      }
    });
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
    const filas = await this.db.select().from(conceptosViatico).orderBy(asc(conceptosViatico.nombre));
    return filas.map((f) => ({ ...f, unidad: f.unidad as UnidadCobro }));
  }

  async guardar(c: ConceptoViatico): Promise<void> {
    const fila = { nombre: c.nombre, unidad: c.unidad, activo: c.activo };
    await this.db.insert(conceptosViatico).values({ codigo: c.codigo, ...fila }).onConflictDoUpdate({ target: conceptosViatico.codigo, set: fila });
  }
}
