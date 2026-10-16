import { DomainError } from '@viaticos/shared-kernel';
import type { Reloj } from '../../../shared/application/puertos';
import { crearReglasEscalamiento, type ConfiguracionReglaEscalamiento } from '../domain/escalamiento/fabrica-reglas';
import type { ConfiguracionEscalamientoRepository } from '../domain/repositorios';

/** Contabilidad ajusta cuándo una solicitud escala al jefe directivo (tolerancia sobre la tarifa y umbral total). */
export class ConfigurarEscalamientoUseCase {
  constructor(
    private readonly repo: ConfiguracionEscalamientoRepository,
    private readonly reloj: Reloj,
  ) {}

  async obtener() {
    const [reglas, auditoria] = await Promise.all([this.repo.obtener(), this.repo.auditoria()]);
    return { reglas, ...auditoria };
  }

  async actualizar(reglas: ConfiguracionReglaEscalamiento[], usuarioId: string) {
    const tipos = new Set(reglas.map((r) => r.tipo));
    if (tipos.size !== reglas.length) throw new DomainError('REGLA_REPETIDA', 'VALIDACION', 'Cada regla se configura una sola vez');
    crearReglasEscalamiento(reglas); // valida los parámetros antes de guardar
    await this.repo.guardar(reglas, usuarioId, this.reloj.ahora());
    return this.obtener();
  }
}
