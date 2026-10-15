import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { DomainError } from '@viaticos/shared-kernel';
import {
  VIOLACION_UNICIDAD,
  codigoErrorPg,
  type BaseDatos,
} from '../../../../shared/infrastructure/base-datos/conexion';
import type { TipoClaveFiscal } from '../../domain/clave-fiscal';
import type { ComprobanteRegistrado } from '../../domain/duplicados/detector-duplicados';
import { HuellaComprobante } from '../../domain/duplicados/huella-comprobante';
import type { HuellaRepository } from '../../domain/duplicados/huella.repository';
import { huellasComprobante as h } from './comprobantes.schema';

/** Margen al buscar candidatos por imagen: más amplio que el umbral del dominio, que decide. */
const BITS_CANDIDATO_IMAGEN = 16;
const LIMITE_CANDIDATOS = 100;

export class HuellaRepositoryDrizzle implements HuellaRepository {
  constructor(private readonly db: BaseDatos) {}

  async buscarCandidatos(huella: HuellaComprobante): Promise<ComprobanteRegistrado[]> {
    const condiciones: SQL[] = [eq(h.sha256, huella.sha256)];
    if (huella.claveFiscal) condiciones.push(eq(h.claveFiscal, huella.claveFiscal.valor));
    if (huella.emisorId) condiciones.push(eq(h.emisorId, huella.emisorId));
    if (huella.hashPerceptual) {
      condiciones.push(
        sql`(${h.hashPerceptual} IS NOT NULL AND bit_count(('x' || ${h.hashPerceptual})::bit(64) # ('x' || ${huella.hashPerceptual})::bit(64)) <= ${BITS_CANDIDATO_IMAGEN})`,
      );
    }

    const filas = await this.db
      .select()
      .from(h)
      .where(and(eq(h.vigente, true), or(...condiciones)))
      .limit(LIMITE_CANDIDATOS);

    return filas.map((f) => ({
      comprobanteId: f.comprobanteId,
      viajeroId: f.viajeroId,
      huella: HuellaComprobante.crear({
        sha256: f.sha256,
        hashPerceptual: f.hashPerceptual,
        claveFiscal:
          f.claveFiscal && f.claveFiscalTipo
            ? { tipo: f.claveFiscalTipo as TipoClaveFiscal, valor: f.claveFiscal }
            : null,
        emisorId: f.emisorId,
        numeroDocumento: f.numeroDocumento,
        fecha: f.fecha,
        total: f.total && f.moneda ? { monto: f.total, moneda: f.moneda } : null,
      }),
    }));
  }

  async registrar({ comprobanteId, viajeroId, huella }: ComprobanteRegistrado): Promise<void> {
    const datos = {
      viajeroId,
      sha256: huella.sha256,
      hashPerceptual: huella.hashPerceptual,
      claveFiscalTipo: huella.claveFiscal?.tipo ?? null,
      claveFiscal: huella.claveFiscal?.valor ?? null,
      emisorId: huella.emisorId,
      numeroDocumento: huella.numeroDocumento,
      fecha: huella.fecha?.toString() ?? null,
      total: huella.total?.monto ?? null,
      moneda: huella.total?.moneda ?? null,
      vigente: true,
    };
    try {
      await this.db
        .insert(h)
        .values({ comprobanteId, ...datos })
        .onConflictDoUpdate({ target: h.comprobanteId, set: datos });
    } catch (error) {
      // Carrera entre dos radicaciones simultáneas: lo resuelven los índices únicos parciales.
      if (codigoErrorPg(error) === VIOLACION_UNICIDAD) {
        throw new DomainError('COMPROBANTE_DUPLICADO', 'CONFLICTO', 'El comprobante ya fue radicado');
      }
      throw error;
    }
  }

  async anular(comprobanteId: string): Promise<void> {
    await this.db.update(h).set({ vigente: false }).where(eq(h.comprobanteId, comprobanteId));
  }
}
