import type { FechaCalendario } from '@viaticos/shared-kernel';
import type { ConsultarUsuarioUseCase } from '../../organizacion/application/consultar-usuario.use-case';
import type { ConsultarTarifasVigentesUseCase } from '../../tarifas/application/consultar-tarifas-vigentes.use-case';
import type { ListarPaisesConTarifaUseCase } from '../../tarifas/application/listar-paises-con-tarifa.use-case';
import type { TarifaAplicable } from '../domain/presupuesto-viaje';
import type { ConsultaTarifas, DirectorioOrganizacional, PerfilViajero } from '../application/puertos';

/** Capa anticorrupción hacia el módulo de tarifas: solo se usa su API pública (caso de uso). */
export class ConsultaTarifasAdapter implements ConsultaTarifas {
  constructor(
    private readonly consultarTarifas: ConsultarTarifasVigentesUseCase,
    private readonly listarPaises: ListarPaisesConTarifaUseCase,
  ) {}

  paisesDisponibles(cargoId: string): Promise<string[]> {
    return this.listarPaises.ejecutar(cargoId);
  }

  async vigentes(cargoId: string, paisCodigo: string, fecha: FechaCalendario): Promise<TarifaAplicable[]> {
    const tarifas = await this.consultarTarifas.ejecutar(cargoId, paisCodigo, fecha);
    return tarifas.map((t) => ({
      tarifaId: t.tarifaId,
      conceptoCodigo: t.conceptoCodigo,
      conceptoNombre: t.conceptoNombre,
      unidad: t.unidad,
      valorUnitario: t.valorUnitario,
    }));
  }
}

export class DirectorioOrganizacionalAdapter implements DirectorioOrganizacional {
  constructor(private readonly consultarUsuario: ConsultarUsuarioUseCase) {}

  async nombres(usuarioIds: readonly string[]): Promise<Map<string, string>> {
    return new Map((await this.consultarUsuario.varios(usuarioIds)).map((u) => [u.id, u.nombre]));
  }

  async obtenerViajero(usuarioId: string): Promise<PerfilViajero | null> {
    const usuario = await this.consultarUsuario.ejecutar(usuarioId);
    if (!usuario) return null;
    const gerencia = (await this.consultarUsuario.conRol('GERENCIA')).find((g) => g.id !== usuario.id);
    return {
      id: usuario.id,
      cargoId: usuario.cargoId,
      jefeInmediatoId: usuario.jefeInmediatoId,
      jefeDirectivoId: usuario.jefeDirectivoId,
      gerenciaId: gerencia?.id ?? null,
    };
  }
}
