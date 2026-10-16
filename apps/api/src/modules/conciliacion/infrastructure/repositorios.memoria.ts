import { DomainError } from '@viaticos/shared-kernel';
import { Extracto, type ExtractoProps, type ExtractoRepository, type PerfilExtractoRepository, type PerfilGuardado } from '../domain/extracto';

const clonar = (p: ExtractoProps): ExtractoProps => ({
  ...p,
  movimientos: [...p.movimientos],
  cruces: p.cruces.map((c) => ({ ...c })),
  rechazos: p.rechazos.map((r) => ({ ...r })),
  decisionesCargos: p.decisionesCargos.map((d) => ({ ...d })),
});

export class ExtractoRepositoryEnMemoria implements ExtractoRepository {
  private readonly datos = new Map<string, ExtractoProps>();

  async guardar(extracto: Extracto) {
    const s = extracto.toSnapshot();
    const actual = this.datos.get(s.id);
    if ((actual?.version ?? 0) !== s.version) {
      throw new DomainError('CONFLICTO_CONCURRENCIA', 'CONFLICTO', 'El extracto fue modificado; recargue e intente de nuevo');
    }
    for (const otro of this.datos.values()) {
      if (otro.id === s.id) continue;
      if (otro.archivo.sha256 === s.archivo.sha256) throw new DomainError('EXTRACTO_YA_CARGADO', 'CONFLICTO', 'Este archivo de extracto ya fue cargado');
      if (otro.cruces.some((c) => s.cruces.some((x) => x.soporteId === c.soporteId))) {
        throw new DomainError('SOPORTE_YA_CONCILIADO', 'CONFLICTO', 'Una de las facturas ya está cruzada en otro extracto');
      }
    }
    this.datos.set(s.id, { ...clonar(s), version: s.version + 1 });
  }

  async obtenerPorId(id: string) {
    const p = this.datos.get(id);
    return p ? Extracto.rehidratar(clonar(p)) : null;
  }

  async existeArchivo(sha256: string) {
    return [...this.datos.values()].some((p) => p.archivo.sha256 === sha256);
  }

  async listarPorTitular(titularId: string) {
    return this.ordenados().filter((p) => p.titularId === titularId).map((p) => Extracto.rehidratar(clonar(p)));
  }

  async listarRecientes(limite: number) {
    return this.ordenados().slice(0, limite).map((p) => Extracto.rehidratar(clonar(p)));
  }

  async soportesCruzadosFuera(extractoId: string, soporteIds: readonly string[]) {
    const buscados = new Set(soporteIds);
    return new Set(
      [...this.datos.values()].filter((p) => p.id !== extractoId).flatMap((p) => p.cruces.map((c) => c.soporteId)).filter((id) => buscados.has(id)),
    );
  }

  private ordenados() {
    return [...this.datos.values()].sort((a, b) => b.cargadoEn.getTime() - a.cargadoEn.getTime());
  }
}

export class PerfilExtractoRepositoryEnMemoria implements PerfilExtractoRepository {
  private readonly datos = new Map<string, PerfilGuardado>();

  async listar() {
    return [...this.datos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async guardar(perfil: PerfilGuardado) {
    const existente = this.datos.get(perfil.nombre.toLowerCase());
    this.datos.set(perfil.nombre.toLowerCase(), { ...perfil, id: existente?.id ?? perfil.id });
  }
}
