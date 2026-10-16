import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import {
  Legalizacion,
  type EstadoLegalizacion,
  type EstadoSoporte,
  type TipoSoporte,
} from '../../domain/legalizacion';
import type { PoliticaLegalizacion, PoliticaLegalizacionRepository } from '../../domain/politica';
import type { LegalizacionRepository } from '../../domain/repositorios';
import { politicaPorDefecto } from '../repositorios.memoria';
import { legalizaciones, politicaLegalizacion, soportes } from './legalizaciones.schema';
import {
  datosAJson,
  datosDesdeJson,
  decisionAJson,
  decisionDesdeJson,
  historialAJson,
  historialDesdeJson,
} from './serializacion';

export class LegalizacionRepositoryDrizzle implements LegalizacionRepository {
  constructor(private readonly db: BaseDatos) {}

  async guardar(l: Legalizacion): Promise<void> {
    const s = l.toSnapshot();
    const raiz = { estado: s.estado, historial: s.historial.map(historialAJson), actualizadaEn: s.actualizadaEn };

    await this.db.transaction(async (tx) => {
      if (s.version === 0) {
        await tx.insert(legalizaciones).values({
          id: s.id,
          anticipoId: s.anticipoId,
          viajeroId: s.viajeroId,
          monto: s.montoAnticipo.monto,
          moneda: s.montoAnticipo.moneda,
          viajeInicio: s.viaje.inicio.toString(),
          viajeFin: s.viaje.fin.toString(),
          creadaEn: s.creadaEn,
          version: 1,
          ...raiz,
        });
      } else {
        const filas = await tx
          .update(legalizaciones)
          .set({ ...raiz, version: s.version + 1 })
          .where(and(eq(legalizaciones.id, s.id), eq(legalizaciones.version, s.version)))
          .returning({ id: legalizaciones.id });
        if (filas.length === 0) {
          throw new DomainError('CONFLICTO_CONCURRENCIA', 'CONFLICTO', 'La legalización fue modificada; recargue e intente de nuevo');
        }
      }

      const ids = s.soportes.map((x) => x.id);
      await tx
        .delete(soportes)
        .where(ids.length ? and(eq(soportes.legalizacionId, s.id), notInArray(soportes.id, ids)) : eq(soportes.legalizacionId, s.id));
      for (const x of s.soportes) {
        const fila = {
          tipo: x.tipo,
          estado: x.estado,
          descripcion: x.descripcionUsuario,
          archivo: x.archivo,
          extraccion: x.extraccion,
          datos: x.datos && datosAJson(x.datos),
          alertas: x.alertas,
          decision: x.decision && decisionAJson(x.decision),
          beneficiario: x.beneficiario,
          actualizadoEn: x.actualizadoEn,
        };
        await tx
          .insert(soportes)
          .values({ id: x.id, legalizacionId: s.id, creadoEn: x.creadoEn, ...fila })
          .onConflictDoUpdate({ target: soportes.id, set: fila });
      }
    });
  }

  async obtenerPorId(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await this.cargar(eq(legalizaciones.id, id)))[0] ?? null;
  }

  async obtenerPorAnticipo(anticipoId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(anticipoId)) return null;
    return (await this.cargar(eq(legalizaciones.anticipoId, anticipoId)))[0] ?? null;
  }

  listarPorEstados(estados: readonly EstadoLegalizacion[]) {
    return this.cargar(inArray(legalizaciones.estado, [...estados]));
  }

  listarPorViajero(viajeroId: string) {
    return this.cargar(eq(legalizaciones.viajeroId, viajeroId));
  }

  async listarSoportesProcesando() {
    const filas = await this.db
      .select({ legalizacionId: soportes.legalizacionId, soporteId: soportes.id })
      .from(soportes)
      .where(eq(soportes.estado, 'PROCESANDO'));
    return filas;
  }

  private async cargar(condicion: ReturnType<typeof eq>): Promise<Legalizacion[]> {
    const raices = await this.db.select().from(legalizaciones).where(condicion).orderBy(asc(legalizaciones.actualizadaEn)).limit(500);
    if (raices.length === 0) return [];
    const hijos = await this.db
      .select()
      .from(soportes)
      .where(inArray(soportes.legalizacionId, raices.map((r) => r.id)))
      .orderBy(asc(soportes.creadoEn));

    return raices.map((r) =>
      Legalizacion.rehidratar({
        id: r.id,
        anticipoId: r.anticipoId,
        viajeroId: r.viajeroId,
        montoAnticipo: Money.of(r.monto, r.moneda),
        viaje: { inicio: FechaCalendario.of(r.viajeInicio), fin: FechaCalendario.of(r.viajeFin) },
        estado: r.estado as EstadoLegalizacion,
        soportes: hijos
          .filter((h) => h.legalizacionId === r.id)
          .map((h) => ({
            id: h.id,
            tipo: h.tipo as TipoSoporte,
            estado: h.estado as EstadoSoporte,
            descripcionUsuario: h.descripcion,
            archivo: h.archivo,
            extraccion: h.extraccion,
            datos: h.datos && datosDesdeJson(h.datos),
            alertas: h.alertas,
            decision: h.decision && decisionDesdeJson(h.decision),
            beneficiario: h.beneficiario,
            creadoEn: h.creadoEn,
            actualizadoEn: h.actualizadoEn,
          })),
        historial: r.historial.map(historialDesdeJson),
        creadaEn: r.creadaEn,
        actualizadaEn: r.actualizadaEn,
        version: r.version,
      }),
    );
  }
}

export class PoliticaLegalizacionDrizzle implements PoliticaLegalizacionRepository {
  constructor(private readonly db: BaseDatos) {}

  async obtener(): Promise<PoliticaLegalizacion> {
    const [fila] = await this.db.select().from(politicaLegalizacion).where(eq(politicaLegalizacion.id, 1)).limit(1);
    if (!fila) return politicaPorDefecto();
    return {
      nitEmpresa: fila.nitEmpresa,
      topesReciboCaja: fila.topesReciboCaja.map(Money.fromDto),
      exclusiones: fila.exclusiones,
      actualizadaPor: fila.actualizadaPor,
      actualizadaEn: fila.actualizadaEn,
    };
  }

  async guardar(p: PoliticaLegalizacion): Promise<void> {
    const fila = {
      nitEmpresa: p.nitEmpresa,
      topesReciboCaja: p.topesReciboCaja.map((t) => t.toDto()),
      exclusiones: p.exclusiones,
      actualizadaPor: p.actualizadaPor,
      actualizadaEn: p.actualizadaEn,
    };
    await this.db.insert(politicaLegalizacion).values({ id: 1, ...fila }).onConflictDoUpdate({ target: politicaLegalizacion.id, set: fila });
  }
}
