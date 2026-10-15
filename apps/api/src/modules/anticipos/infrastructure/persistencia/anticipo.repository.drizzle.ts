import { and, desc, eq, inArray } from 'drizzle-orm';
import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import {
  Anticipo,
  type AnticipoRepository,
  type EstadoAnticipo,
  type MedioDesembolso,
} from '../../domain/anticipo';
import { anticipos } from './anticipos.schema';

type Fila = typeof anticipos.$inferSelect;

const aDominio = (f: Fila): Anticipo =>
  Anticipo.rehidratar({
    id: f.id,
    solicitudId: f.solicitudId,
    viajeroId: f.viajeroId,
    monto: Money.of(f.monto, f.moneda),
    viaje: f.viaje,
    estado: f.estado as EstadoAnticipo,
    erp: { referencia: f.erpReferencia, ultimoError: f.erpUltimoError, intentos: f.erpIntentos },
    desembolso:
      f.desembolsoFecha && f.desembolsoMedio && f.desembolsadoPor && f.desembolsadoEn
        ? {
            fecha: FechaCalendario.of(f.desembolsoFecha),
            medio: f.desembolsoMedio as MedioDesembolso,
            referencia: f.desembolsoReferencia,
            registradoPor: f.desembolsadoPor,
            registradoEn: f.desembolsadoEn,
          }
        : null,
    creadoEn: f.creadoEn,
    actualizadoEn: f.actualizadoEn,
    version: f.version,
  });

export class AnticipoRepositoryDrizzle implements AnticipoRepository {
  constructor(private readonly db: BaseDatos) {}

  async guardar(anticipo: Anticipo): Promise<void> {
    const s = anticipo.toSnapshot();
    const fila = {
      viajeroId: s.viajeroId,
      monto: s.monto.monto,
      moneda: s.monto.moneda,
      viaje: s.viaje,
      estado: s.estado,
      erpReferencia: s.erp.referencia,
      erpUltimoError: s.erp.ultimoError,
      erpIntentos: s.erp.intentos,
      desembolsoFecha: s.desembolso?.fecha.toString() ?? null,
      desembolsoMedio: s.desembolso?.medio ?? null,
      desembolsoReferencia: s.desembolso?.referencia ?? null,
      desembolsadoPor: s.desembolso?.registradoPor ?? null,
      desembolsadoEn: s.desembolso?.registradoEn ?? null,
      actualizadoEn: s.actualizadoEn,
    };
    if (s.version === 0) {
      await this.db.insert(anticipos).values({ id: s.id, solicitudId: s.solicitudId, creadoEn: s.creadoEn, version: 1, ...fila });
      return;
    }
    const filas = await this.db
      .update(anticipos)
      .set({ ...fila, version: s.version + 1 })
      .where(and(eq(anticipos.id, s.id), eq(anticipos.version, s.version)))
      .returning({ id: anticipos.id });
    if (filas.length === 0) {
      throw new DomainError('CONFLICTO_CONCURRENCIA', 'CONFLICTO', 'El anticipo fue modificado por otra persona');
    }
  }

  async obtenerPorId(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [f] = await this.db.select().from(anticipos).where(eq(anticipos.id, id)).limit(1);
    return f ? aDominio(f) : null;
  }

  async obtenerPorSolicitud(solicitudId: string) {
    const [f] = await this.db.select().from(anticipos).where(eq(anticipos.solicitudId, solicitudId)).limit(1);
    return f ? aDominio(f) : null;
  }

  async listarPorViajero(viajeroId: string) {
    const filas = await this.db.select().from(anticipos).where(eq(anticipos.viajeroId, viajeroId)).orderBy(desc(anticipos.creadoEn)).limit(200);
    return filas.map(aDominio);
  }

  async listarPorEstados(estados: readonly EstadoAnticipo[]) {
    const filas = await this.db
      .select()
      .from(anticipos)
      .where(inArray(anticipos.estado, [...estados]))
      .orderBy(desc(anticipos.creadoEn))
      .limit(500);
    return filas.map(aDominio);
  }
}
