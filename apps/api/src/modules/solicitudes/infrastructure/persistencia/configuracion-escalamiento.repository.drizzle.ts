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
}
