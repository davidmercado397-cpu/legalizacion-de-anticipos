import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { BaseDatos } from '../../../shared/infrastructure/base-datos/conexion';
import type { CacheTasas, CotizacionDolar } from '../application/puertos';
import { cotizacionesDolar } from './persistencia/tasas.schema';

export class CacheTasasEnMemoria implements CacheTasas {
  private readonly datos = new Map<string, CotizacionDolar>();

  async obtener(moneda: string, fecha: string) {
    return this.datos.get(`${moneda}|${fecha}`) ?? null;
  }

  async guardar(c: CotizacionDolar) {
    this.datos.set(`${c.moneda}|${c.fecha}`, c);
  }

  async ultimaHasta(moneda: string, fecha: string, desde: string) {
    const candidatas = [...this.datos.values()].filter((c) => c.moneda === moneda && c.fecha <= fecha && c.fecha >= desde);
    return candidatas.sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null;
  }
}

export class CacheTasasDrizzle implements CacheTasas {
  constructor(private readonly db: BaseDatos) {}

  async obtener(moneda: string, fecha: string) {
    const [fila] = await this.db
      .select()
      .from(cotizacionesDolar)
      .where(and(eq(cotizacionesDolar.moneda, moneda), eq(cotizacionesDolar.fecha, fecha)))
      .limit(1);
    return fila ?? null;
  }

  async guardar(c: CotizacionDolar) {
    await this.db.insert(cotizacionesDolar).values(c).onConflictDoNothing();
  }

  async ultimaHasta(moneda: string, fecha: string, desde: string) {
    const [fila] = await this.db
      .select()
      .from(cotizacionesDolar)
      .where(and(eq(cotizacionesDolar.moneda, moneda), lte(cotizacionesDolar.fecha, fecha), gte(cotizacionesDolar.fecha, desde)))
      .orderBy(desc(cotizacionesDolar.fecha))
      .limit(1);
    return fila ?? null;
  }
}
