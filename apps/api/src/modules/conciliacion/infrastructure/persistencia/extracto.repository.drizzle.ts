import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { VIOLACION_UNICIDAD, codigoErrorPg, type BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import { Extracto, type ExtractoRepository, type PerfilExtractoRepository, type PerfilGuardado } from '../../domain/extracto';
import { crucesExtracto, extractos, movimientosExtracto, perfilesExtracto } from './conciliacion.schema';

export class ExtractoRepositoryDrizzle implements ExtractoRepository {
  constructor(private readonly db: BaseDatos) {}

  async guardar(extracto: Extracto): Promise<void> {
    const s = extracto.toSnapshot();
    try {
      await this.db.transaction(async (tx) => {
        if (s.version === 0) {
          await tx.insert(extractos).values({
            id: s.id,
            titularId: s.titularId,
            legalizacionId: s.legalizacionId,
            ultimos4: s.ultimos4,
            moneda: s.moneda,
            archivoNombre: s.archivo.nombre,
            sha256: s.archivo.sha256,
            perfil: s.perfil,
            rechazos: s.rechazos,
            cargadoPor: s.cargadoPor,
            cargadoEn: s.cargadoEn,
            actualizadoEn: s.actualizadoEn,
            version: 1,
          });
          // Los movimientos no cambian después de cargados.
          for (let i = 0; i < s.movimientos.length; i += 500) {
            await tx.insert(movimientosExtracto).values(
              s.movimientos.slice(i, i + 500).map((m) => ({
                id: m.id,
                extractoId: s.id,
                fila: m.fila,
                fecha: m.fecha.toString(),
                descripcion: m.descripcion,
                referencia: m.referencia,
                valor: m.valor.monto,
                tipo: m.tipo,
              })),
            );
          }
        } else {
          const filas = await tx
            .update(extractos)
            .set({ rechazos: s.rechazos, actualizadoEn: s.actualizadoEn, version: s.version + 1 })
            .where(and(eq(extractos.id, s.id), eq(extractos.version, s.version)))
            .returning({ id: extractos.id });
          if (filas.length === 0) {
            throw new DomainError('CONFLICTO_CONCURRENCIA', 'CONFLICTO', 'El extracto fue modificado; recargue e intente de nuevo');
          }
          await tx.delete(crucesExtracto).where(eq(crucesExtracto.extractoId, s.id));
        }
        if (s.cruces.length) {
          await tx.insert(crucesExtracto).values(
            s.cruces.map((c) => ({
              movimientoId: c.movimientoId,
              extractoId: s.id,
              soporteId: c.soporteId,
              legalizacionId: c.legalizacionId,
              puntaje: c.puntaje === null ? null : String(c.puntaje),
              estado: c.estado,
              montoSoporte: c.montoSoporte?.monto ?? null,
              decididoPor: c.decididoPor,
              decididoEn: c.decididoEn,
            })),
          );
        }
      });
    } catch (error) {
      if (codigoErrorPg(error) === VIOLACION_UNICIDAD) {
        const enArchivo = String((error as { cause?: { constraint?: string } }).cause?.constraint ?? '').includes('sha256');
        throw enArchivo
          ? new DomainError('EXTRACTO_YA_CARGADO', 'CONFLICTO', 'Este archivo de extracto ya fue cargado')
          : new DomainError('SOPORTE_YA_CONCILIADO', 'CONFLICTO', 'Una de las facturas ya está cruzada en otro extracto; recalcule');
      }
      throw error;
    }
  }

  async obtenerPorId(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await this.cargar(eq(extractos.id, id)))[0] ?? null;
  }

  async existeArchivo(sha256: string) {
    const [fila] = await this.db.select({ id: extractos.id }).from(extractos).where(eq(extractos.sha256, sha256)).limit(1);
    return !!fila;
  }

  listarPorTitular(titularId: string) {
    return this.cargar(eq(extractos.titularId, titularId));
  }

  async listarRecientes(limite: number) {
    return this.cargar(undefined, limite);
  }

  async soportesCruzadosFuera(extractoId: string, soporteIds: readonly string[]) {
    if (soporteIds.length === 0) return new Set<string>();
    const filas = await this.db
      .select({ soporteId: crucesExtracto.soporteId })
      .from(crucesExtracto)
      .where(and(ne(crucesExtracto.extractoId, extractoId), inArray(crucesExtracto.soporteId, [...soporteIds])));
    return new Set(filas.map((f) => f.soporteId));
  }

  private async cargar(condicion: ReturnType<typeof eq> | undefined, limite = 200): Promise<Extracto[]> {
    const raices = await this.db.select().from(extractos).where(condicion).orderBy(desc(extractos.cargadoEn)).limit(limite);
    if (raices.length === 0) return [];
    const ids = raices.map((r) => r.id);
    const [movs, cruces] = await Promise.all([
      this.db.select().from(movimientosExtracto).where(inArray(movimientosExtracto.extractoId, ids)).orderBy(asc(movimientosExtracto.fila)),
      this.db.select().from(crucesExtracto).where(inArray(crucesExtracto.extractoId, ids)),
    ]);
    return raices.map((r) =>
      Extracto.rehidratar({
        id: r.id,
        titularId: r.titularId,
        legalizacionId: r.legalizacionId,
        ultimos4: r.ultimos4,
        moneda: r.moneda,
        archivo: { nombre: r.archivoNombre, sha256: r.sha256 },
        perfil: r.perfil,
        movimientos: movs
          .filter((m) => m.extractoId === r.id)
          .map((m) => ({
            id: m.id,
            fila: m.fila,
            fecha: FechaCalendario.of(m.fecha),
            descripcion: m.descripcion,
            referencia: m.referencia,
            valor: Money.of(m.valor, r.moneda),
            tipo: m.tipo,
          })),
        cruces: cruces
          .filter((c) => c.extractoId === r.id)
          .map((c) => ({
            movimientoId: c.movimientoId,
            soporteId: c.soporteId,
            legalizacionId: c.legalizacionId,
            puntaje: c.puntaje === null ? null : Number(c.puntaje),
            estado: c.estado,
            montoSoporte: c.montoSoporte === null ? null : Money.of(c.montoSoporte, r.moneda),
            decididoPor: c.decididoPor,
            decididoEn: c.decididoEn,
          })),
        rechazos: r.rechazos,
        cargadoPor: r.cargadoPor,
        cargadoEn: r.cargadoEn,
        actualizadoEn: r.actualizadoEn,
        version: r.version,
      }),
    );
  }
}

export class PerfilExtractoRepositoryDrizzle implements PerfilExtractoRepository {
  constructor(private readonly db: BaseDatos) {}

  async listar(): Promise<PerfilGuardado[]> {
    return this.db.select().from(perfilesExtracto).orderBy(asc(perfilesExtracto.nombre));
  }

  async guardar(p: PerfilGuardado) {
    await this.db
      .insert(perfilesExtracto)
      .values(p)
      .onConflictDoUpdate({ target: perfilesExtracto.nombre, set: { perfil: p.perfil, actualizadoPor: p.actualizadoPor, actualizadoEn: p.actualizadoEn } });
  }
}
