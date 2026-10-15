import { DomainError, Money } from '@viaticos/shared-kernel';
import { Legalizacion, type EstadoLegalizacion, type LegalizacionProps } from '../domain/legalizacion';
import type { PoliticaLegalizacion, PoliticaLegalizacionRepository } from '../domain/politica';
import { EXCLUSIONES_POR_DEFECTO } from '../domain/reglas-exclusion';
import type { LegalizacionRepository } from '../domain/repositorios';

// Money y FechaCalendario son inmutables; se copian las estructuras mutables.
const clonar = (p: LegalizacionProps): LegalizacionProps => ({
  ...p,
  soportes: p.soportes.map((s) => ({ ...s, alertas: [...s.alertas] })),
  historial: [...p.historial],
});

export class LegalizacionRepositoryEnMemoria implements LegalizacionRepository {
  private readonly datos = new Map<string, LegalizacionProps>();

  async guardar(l: Legalizacion): Promise<void> {
    const actual = this.datos.get(l.id);
    if (actual && actual.version !== l.version) {
      throw new DomainError('CONFLICTO_CONCURRENCIA', 'CONFLICTO', 'La legalización fue modificada; recargue e intente de nuevo');
    }
    this.datos.set(l.id, { ...l.toSnapshot(), version: l.version + 1 });
  }

  async obtenerPorId(id: string) {
    const p = this.datos.get(id);
    return p ? Legalizacion.rehidratar(clonar(p)) : null;
  }

  async obtenerPorAnticipo(anticipoId: string) {
    const p = [...this.datos.values()].find((x) => x.anticipoId === anticipoId);
    return p ? Legalizacion.rehidratar(clonar(p)) : null;
  }

  async listarPorEstados(estados: readonly EstadoLegalizacion[]) {
    return [...this.datos.values()]
      .filter((p) => estados.includes(p.estado))
      .sort((a, b) => a.actualizadaEn.getTime() - b.actualizadaEn.getTime())
      .map((p) => Legalizacion.rehidratar(clonar(p)));
  }

  async listarSoportesProcesando() {
    return [...this.datos.values()].flatMap((p) =>
      p.soportes.filter((s) => s.estado === 'PROCESANDO').map((s) => ({ legalizacionId: p.id, soporteId: s.id })),
    );
  }
}

/** Valores iniciales; contabilidad los cambia desde la aplicación. */
export const politicaPorDefecto = (nitEmpresa = '900123456'): PoliticaLegalizacion => ({
  nitEmpresa,
  topesReciboCaja: [Money.of(50, 'USD'), Money.of(200_000, 'COP')],
  exclusiones: EXCLUSIONES_POR_DEFECTO,
  actualizadaPor: null,
  actualizadaEn: null,
});

export class PoliticaLegalizacionEnMemoria implements PoliticaLegalizacionRepository {
  constructor(private politica: PoliticaLegalizacion = politicaPorDefecto()) {}

  async obtener() {
    return { ...this.politica, exclusiones: this.politica.exclusiones.map((e) => ({ ...e, palabras: [...e.palabras] })) };
  }

  async guardar(politica: PoliticaLegalizacion) {
    this.politica = politica;
  }
}
