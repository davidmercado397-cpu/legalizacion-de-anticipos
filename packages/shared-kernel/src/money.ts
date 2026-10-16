import Big from 'big.js';
import { DomainError } from './errores';
import { codigoMoneda, type CodigoMoneda } from './moneda';
import type { TasaCambio } from './tasa-cambio';

const DECIMALES = 2;
const REDONDEO_HALF_UP = 1;

export interface MoneyDto {
  monto: string;
  moneda: string;
}

/**
 * Valor monetario inmutable con precisión decimal exacta (ADR-0005).
 * Nunca se mezclan monedas sin una tasa de cambio explícita.
 */
export class Money {
  private constructor(
    private readonly valor: Big,
    readonly moneda: CodigoMoneda,
  ) {}

  static of(monto: string | number, moneda: string): Money {
    let valor: Big;
    try {
      valor = new Big(monto);
    } catch {
      throw new DomainError('MONTO_INVALIDO', 'VALIDACION', `Monto inválido: "${monto}"`);
    }
    return new Money(valor.round(DECIMALES, REDONDEO_HALF_UP), codigoMoneda(moneda));
  }

  static cero(moneda: string): Money {
    return Money.of(0, moneda);
  }

  static fromDto(dto: MoneyDto): Money {
    return Money.of(dto.monto, dto.moneda);
  }

  static sumarTodos(valores: readonly Money[], moneda: string): Money {
    return valores.reduce((acc, v) => acc.sumar(v), Money.cero(moneda));
  }

  /** Monto como string decimal con 2 decimales ("1234.50"). */
  get monto(): string {
    return this.valor.toFixed(DECIMALES);
  }

  sumar(otro: Money): Money {
    this.exigirMismaMoneda(otro);
    return new Money(this.valor.plus(otro.valor), this.moneda);
  }

  restar(otro: Money): Money {
    this.exigirMismaMoneda(otro);
    return new Money(this.valor.minus(otro.valor), this.moneda);
  }

  multiplicar(factor: number | string): Money {
    return new Money(this.valor.times(factor).round(DECIMALES, REDONDEO_HALF_UP), this.moneda);
  }

  /** this × (parte / total), redondeado; para prorratear (p. ej. el impuesto de las líneas excluidas). */
  prorratear(parte: Money, total: Money): Money {
    this.exigirMismaMoneda(parte);
    this.exigirMismaMoneda(total);
    if (total.valor.eq(0)) return Money.cero(this.moneda);
    return new Money(this.valor.times(parte.valor).div(total.valor).round(DECIMALES, REDONDEO_HALF_UP), this.moneda);
  }

  convertir(tasa: TasaCambio): Money {
    if (tasa.origen !== this.moneda) {
      throw new DomainError(
        'TASA_NO_APLICA',
        'VALIDACION',
        `La tasa ${tasa.origen}->${tasa.destino} no aplica a un valor en ${this.moneda}`,
      );
    }
    return new Money(
      this.valor.times(tasa.valor).round(DECIMALES, REDONDEO_HALF_UP),
      tasa.destino,
    );
  }

  esMayorQue(otro: Money): boolean {
    this.exigirMismaMoneda(otro);
    return this.valor.gt(otro.valor);
  }

  esMenorQue(otro: Money): boolean {
    this.exigirMismaMoneda(otro);
    return this.valor.lt(otro.valor);
  }

  equals(otro: Money): boolean {
    return this.moneda === otro.moneda && this.valor.eq(otro.valor);
  }

  esCero(): boolean {
    return this.valor.eq(0);
  }

  esNegativo(): boolean {
    return this.valor.lt(0);
  }

  toDto(): MoneyDto {
    return { monto: this.monto, moneda: this.moneda };
  }

  toJSON(): MoneyDto {
    return this.toDto();
  }

  toString(): string {
    return `${this.monto} ${this.moneda}`;
  }

  private exigirMismaMoneda(otro: Money): void {
    if (this.moneda !== otro.moneda) {
      throw new DomainError(
        'MONEDAS_DISTINTAS',
        'VALIDACION',
        `No se pueden operar ${this.moneda} y ${otro.moneda} sin tasa de cambio`,
      );
    }
  }
}
