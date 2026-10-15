import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  DomainError,
  FechaCalendario,
  MONEDAS_ANTICIPO,
  Money,
  TasaCambio,
  type MonedaAnticipo,
} from '@viaticos/shared-kernel';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import { Destino } from '../../domain/destino';
import { LineaPresupuesto, PresupuestoViaje, type UnidadCobro } from '../../domain/presupuesto-viaje';
import type { SolicitudRepository } from '../../domain/repositorios';
import { RutaAprobacion, type EstadoPaso, type NivelAprobacion } from '../../domain/ruta-aprobacion';
import { SolicitudViaje, type EstadoSolicitud } from '../../domain/solicitud-viaje';
import { solicitudDestinos, solicitudes, solicitudLineas, solicitudPasosAprobacion } from './solicitudes.schema';

const LIMITE_LISTADO = 200;

/** Persistencia del agregado SolicitudViaje: 1 fila raíz + destinos, líneas y pasos. */
export class SolicitudRepositoryDrizzle implements SolicitudRepository {
  constructor(private readonly db: BaseDatos) {}

  async guardar(solicitud: SolicitudViaje): Promise<void> {
    const s = solicitud.toSnapshot();
    const raiz = {
      viajeroId: s.viajeroId,
      motivo: s.motivo,
      justificacion: s.justificacion,
      estado: s.estado,
      monedaAnticipo: s.presupuesto.monedaAnticipo,
      totalAnticipo: s.presupuesto.totalAnticipo.monto,
      tasas: s.presupuesto.tasas.map((t) => t.toDto()),
      requiereJefeDirectivo: s.escalamiento.requiereJefeDirectivo,
      motivosEscalamiento: s.escalamiento.motivos,
      actualizadaEn: s.actualizadaEn,
    };
    const pasos = s.ruta.pasosSnapshot;

    await this.db.transaction(async (tx) => {
      if (s.version === 0) {
        await tx.insert(solicitudes).values({ id: s.id, ...raiz, creadaEn: s.creadaEn, version: 1 });
        await tx.insert(solicitudDestinos).values(
          s.destinos.map((d, orden) => ({
            solicitudId: s.id,
            orden,
            paisCodigo: d.paisCodigo,
            ciudad: d.ciudad,
            fechaInicio: d.fechaInicio.toString(),
            fechaFin: d.fechaFin.toString(),
          })),
        );
        await tx.insert(solicitudLineas).values(
          s.presupuesto.lineas.map((l, orden) => ({
            solicitudId: s.id,
            orden,
            destinoIndice: l.destinoIndice,
            paisCodigo: l.paisCodigo,
            conceptoCodigo: l.conceptoCodigo,
            conceptoNombre: l.conceptoNombre,
            unidad: l.unidad,
            cantidad: l.cantidad,
            tarifaId: l.tarifaId,
            tarifaUnitaria: l.tarifaUnitaria.monto,
            valorUnitarioSolicitado: l.valorUnitarioSolicitado.monto,
            moneda: l.tarifaUnitaria.moneda,
          })),
        );
        await tx.insert(solicitudPasosAprobacion).values(pasos.map((p) => ({ solicitudId: s.id, ...p })));
        return;
      }

      // Concurrencia optimista: solo actualiza si nadie más cambió la versión.
      const actualizadas = await tx
        .update(solicitudes)
        .set({ ...raiz, version: s.version + 1 })
        .where(and(eq(solicitudes.id, s.id), eq(solicitudes.version, s.version)))
        .returning({ id: solicitudes.id });
      if (actualizadas.length === 0) {
        throw new DomainError(
          'CONFLICTO_CONCURRENCIA',
          'CONFLICTO',
          'La solicitud fue modificada por otra persona; recargue e intente de nuevo',
        );
      }
      // Destinos y líneas son inmutables tras la creación; los pasos cambian con cada decisión.
      for (const p of pasos) {
        await tx
          .update(solicitudPasosAprobacion)
          .set({ estado: p.estado, decididoEn: p.decididoEn, comentario: p.comentario })
          .where(and(eq(solicitudPasosAprobacion.solicitudId, s.id), eq(solicitudPasosAprobacion.orden, p.orden)));
      }
    });
  }

  async obtenerPorId(id: string): Promise<SolicitudViaje | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null; // evita un error de cast en la columna uuid
    const [solicitud] = await this.cargar([id]);
    return solicitud ?? null;
  }

  async listarPorViajero(viajeroId: string): Promise<SolicitudViaje[]> {
    const filas = await this.db
      .select({ id: solicitudes.id })
      .from(solicitudes)
      .where(eq(solicitudes.viajeroId, viajeroId))
      .orderBy(desc(solicitudes.creadaEn))
      .limit(LIMITE_LISTADO);
    return this.cargar(filas.map((f) => f.id));
  }

  async listarPendientesDeAprobador(aprobadorId: string): Promise<SolicitudViaje[]> {
    // Paso pendiente del aprobador cuyos pasos anteriores ya están aprobados (es el turno actual).
    const p = solicitudPasosAprobacion;
    const filas = await this.db
      .select({ id: solicitudes.id })
      .from(p)
      .innerJoin(solicitudes, eq(solicitudes.id, p.solicitudId))
      .where(
        and(
          eq(p.aprobadorId, aprobadorId),
          eq(p.estado, 'PENDIENTE'),
          eq(solicitudes.estado, 'EN_APROBACION'),
          sql`NOT EXISTS (
            SELECT 1 FROM ${p} AS previo
            WHERE previo.solicitud_id = ${p.solicitudId}
              AND previo.orden < ${p.orden}
              AND previo.estado <> 'APROBADO')`,
        ),
      )
      .orderBy(asc(solicitudes.creadaEn))
      .limit(LIMITE_LISTADO);
    return this.cargar(filas.map((f) => f.id));
  }

  /** Carga varias solicitudes con 4 consultas en total (sin N+1), respetando el orden de `ids`. */
  private async cargar(ids: string[]): Promise<SolicitudViaje[]> {
    if (ids.length === 0) return [];
    const [raices, destinos, lineas, pasos] = await Promise.all([
      this.db.select().from(solicitudes).where(inArray(solicitudes.id, ids)),
      this.db.select().from(solicitudDestinos).where(inArray(solicitudDestinos.solicitudId, ids)).orderBy(asc(solicitudDestinos.orden)),
      this.db.select().from(solicitudLineas).where(inArray(solicitudLineas.solicitudId, ids)).orderBy(asc(solicitudLineas.orden)),
      this.db
        .select()
        .from(solicitudPasosAprobacion)
        .where(inArray(solicitudPasosAprobacion.solicitudId, ids))
        .orderBy(asc(solicitudPasosAprobacion.orden)),
    ]);
    const de = <T extends { solicitudId: string }>(filas: T[], id: string) => filas.filter((f) => f.solicitudId === id);
    const porId = new Map(raices.map((r) => [r.id, r]));

    return ids.flatMap((id) => {
      const r = porId.get(id);
      if (!r) return [];
      const moneda = r.monedaAnticipo as MonedaAnticipo;
      if (!MONEDAS_ANTICIPO.includes(moneda)) throw new Error(`Moneda de anticipo inválida en BD: ${moneda}`);

      return [
        SolicitudViaje.rehidratar({
          id: r.id,
          viajeroId: r.viajeroId,
          motivo: r.motivo,
          justificacion: r.justificacion,
          destinos: de(destinos, id).map((d) => Destino.crear(d)),
          presupuesto: PresupuestoViaje.crear(
            moneda,
            de(lineas, id).map((l) =>
              LineaPresupuesto.crear({
                destinoIndice: l.destinoIndice,
                paisCodigo: l.paisCodigo,
                conceptoCodigo: l.conceptoCodigo,
                conceptoNombre: l.conceptoNombre,
                unidad: l.unidad as UnidadCobro,
                cantidad: l.cantidad,
                tarifaId: l.tarifaId,
                tarifaUnitaria: Money.of(l.tarifaUnitaria, l.moneda),
                valorUnitarioSolicitado: Money.of(l.valorUnitarioSolicitado, l.moneda),
              }),
            ),
            r.tasas.map((t) => new TasaCambio(t.origen, t.destino, t.valor, FechaCalendario.of(t.fecha), t.fuente)),
          ),
          escalamiento: { requiereJefeDirectivo: r.requiereJefeDirectivo, motivos: r.motivosEscalamiento },
          ruta: RutaAprobacion.rehidratar(
            de(pasos, id).map((p) => ({
              orden: p.orden,
              nivel: p.nivel as NivelAprobacion,
              aprobadorId: p.aprobadorId,
              estado: p.estado as EstadoPaso,
              decididoEn: p.decididoEn,
              comentario: p.comentario,
            })),
          ),
          estado: r.estado as EstadoSolicitud,
          creadaEn: r.creadaEn,
          actualizadaEn: r.actualizadaEn,
          version: r.version,
        }),
      ];
    });
  }
}
