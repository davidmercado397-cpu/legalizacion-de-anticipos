import Big from 'big.js';
import { DomainError } from './errores';
import { codigoMoneda, type CodigoMoneda } from './moneda';
import type { FechaCalendario } from './fecha-calendario';

export interface TasaCambioDto {
  origen: string;
  destino: string;
  valor: string;
  fecha: string;
  fuente: string;
}

/** Tasa de cambio con su fecha y fuente; se guarda como snapshot (ej. TRM). */
export class TasaCambio {
  readonly origen: CodigoMoneda;
  readonly destino: CodigoMoneda;
  readonly valor: Big;

  constructor(
    origen: string,
    destino: string,
    valor: string | number,
    readonly fecha: FechaCalendario,
    readonly fuente: string,
  ) {
    this.origen = codigoMoneda(origen);
    this.destino = codigoMoneda(destino);
    this.valor = new Big(valor);
    if (this.valor.lte(0)) {
      throw new DomainError('TASA_INVALIDA', 'VALIDACION', 'La tasa de cambio debe ser mayor que cero');
    }
  }

  static identidad(moneda: string, fecha: FechaCalendario): TasaCambio {
    return new TasaCambio(moneda, moneda, 1, fecha, 'IDENTIDAD');
  }

  invertir(): TasaCambio {
    return new TasaCambio(
      this.destino,
      this.origen,
      new Big(1).div(this.valor).toString(),
      this.fecha,
      this.fuente,
    );
  }

  toDto(): TasaCambioDto {
    return {
      origen: this.origen,
      destino: this.destino,
      valor: this.valor.toString(),
      fecha: this.fecha.toString(),
      fuente: this.fuente,
    };
  }
}
