import { DomainError } from '@viaticos/shared-kernel';
import { Anticipo, type AnticipoProps, type AnticipoRepository, type EstadoAnticipo } from '../domain/anticipo';

// Money y FechaCalendario son inmutables: basta copiar los objetos mutables (structuredClone les quitaría sus métodos).
const clonar = (p: AnticipoProps): AnticipoProps => ({
  ...p,
  erp: { ...p.erp },
  desembolso: p.desembolso && { ...p.desembolso },
});

export class AnticipoRepositoryEnMemoria implements AnticipoRepository {
  private readonly datos = new Map<string, AnticipoProps>();

  async guardar(anticipo: Anticipo): Promise<void> {
    const actual = this.datos.get(anticipo.id);
    if (actual && actual.version !== anticipo.version) {
      throw new DomainError('CONFLICTO_CONCURRENCIA', 'CONFLICTO', 'El anticipo fue modificado por otra persona');
    }
    this.datos.set(anticipo.id, { ...anticipo.toSnapshot(), version: anticipo.version + 1 });
  }

  async obtenerPorId(id: string) {
    const p = this.datos.get(id);
    return p ? Anticipo.rehidratar(clonar(p)) : null;
  }

  async obtenerPorSolicitud(solicitudId: string) {
    const p = [...this.datos.values()].find((x) => x.solicitudId === solicitudId);
    return p ? Anticipo.rehidratar(clonar(p)) : null;
  }

  async listarPorViajero(viajeroId: string) {
    return this.filtrar((p) => p.viajeroId === viajeroId);
  }

  async listarPorEstados(estados: readonly EstadoAnticipo[]) {
    return this.filtrar((p) => estados.includes(p.estado));
  }

  private filtrar(criterio: (p: AnticipoProps) => boolean): Anticipo[] {
    return [...this.datos.values()]
      .filter(criterio)
      .sort((a, b) => b.creadoEn.getTime() - a.creadoEn.getTime())
      .map((p) => Anticipo.rehidratar(clonar(p)));
  }
}
