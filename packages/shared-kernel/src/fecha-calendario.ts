import { DomainError } from './errores';

const MS_POR_DIA = 86_400_000;
const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Fecha sin hora ni zona horaria (YYYY-MM-DD). Evita los errores clásicos de
 * `Date` al contar días de viaje.
 */
export class FechaCalendario {
  private constructor(private readonly diaEpoch: number) {}

  static of(valor: string): FechaCalendario {
    const m = FORMATO.exec(valor);
    if (!m) throw FechaCalendario.invalida(valor);
    const [, a, mes, d] = m.map(Number) as [number, number, number, number];
    const ms = Date.UTC(a, mes - 1, d);
    const fecha = new Date(ms);
    if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== d) {
      throw FechaCalendario.invalida(valor);
    }
    return new FechaCalendario(ms / MS_POR_DIA);
  }

  /** Días desde `this` hasta `otra` (positivo si `otra` es posterior). */
  diasHasta(otra: FechaCalendario): number {
    return otra.diaEpoch - this.diaEpoch;
  }

  sumarDias(dias: number): FechaCalendario {
    return new FechaCalendario(this.diaEpoch + dias);
  }

  esAnteriorA(otra: FechaCalendario): boolean {
    return this.diaEpoch < otra.diaEpoch;
  }

  esPosteriorA(otra: FechaCalendario): boolean {
    return this.diaEpoch > otra.diaEpoch;
  }

  equals(otra: FechaCalendario): boolean {
    return this.diaEpoch === otra.diaEpoch;
  }

  compareTo(otra: FechaCalendario): number {
    return this.diaEpoch - otra.diaEpoch;
  }

  toString(): string {
    return new Date(this.diaEpoch * MS_POR_DIA).toISOString().slice(0, 10);
  }

  toJSON(): string {
    return this.toString();
  }

  private static invalida(valor: string): DomainError {
    return new DomainError('FECHA_INVALIDA', 'VALIDACION', `Fecha inválida: "${valor}" (formato YYYY-MM-DD)`);
  }
}
