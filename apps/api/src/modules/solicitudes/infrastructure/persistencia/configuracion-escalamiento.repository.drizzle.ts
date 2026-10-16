import { desc } from 'drizzle-orm';
import type { BaseDatos } from '../../../../shared/infrastructure/base-datos/conexion';
import type { ConfiguracionReglaEscalamiento } from '../../domain/escalamiento/fabrica-reglas';
import type { ConfiguracionEscalamientoRepository } from '../../domain/repositorios';
import { configuracionEscalamiento } from './solicitudes.schema';

export class ConfiguracionEscalamientoDrizzle implements ConfiguracionEscalamientoRepository {
  constructor(private readonly db: BaseDatos) {}

  async obtener(): Promise<ConfiguracionReglaEscalamiento[]> {
    const filas = await this.db.select().from(configuracionEscalamiento);
    // La forma de `parametros` la valida la fábrica de reglas al construirlas.
    return filas.map((f) => ({ tipo: f.tipo, activa: f.activa, parametros: f.parametros }) as ConfiguracionReglaEscalamiento);
  }

  async auditoria() {
    const [fila] = await this.db
      .select({ actualizadoPor: configuracionEscalamiento.actualizadoPor, actualizadoEn: configuracionEscalamiento.actualizadoEn })
      .from(configuracionEscalamiento)
      .orderBy(desc(configuracionEscalamiento.actualizadoEn))
      .limit(1);
    return fila?.actualizadoPor ? fila : { actualizadoPor: null, actualizadoEn: null };
  }

  async guardar(configuracion: readonly ConfiguracionReglaEscalamiento[], usuarioId: string, ahora: Date) {
    await this.db.transaction(async (tx) => {
      for (const c of configuracion) {
        const fila = { activa: c.activa, parametros: c.parametros, actualizadoPor: usuarioId, actualizadoEn: ahora };
        await tx
          .insert(configuracionEscalamiento)
          .values({ tipo: c.tipo, ...fila })
          .onConflictDoUpdate({ target: configuracionEscalamiento.tipo, set: fila });
      }
    });
  }
}
