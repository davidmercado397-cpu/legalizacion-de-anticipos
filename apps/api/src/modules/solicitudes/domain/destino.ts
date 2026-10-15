import { FechaCalendario, invariante } from '@viaticos/shared-kernel';

export interface DatosDestino {
  paisCodigo: string;
  ciudad: string;
  fechaInicio: string;
  fechaFin: string;
}

export class Destino {
  private constructor(
    readonly paisCodigo: string,
    readonly ciudad: string,
    readonly fechaInicio: FechaCalendario,
    readonly fechaFin: FechaCalendario,
  ) {}

  static crear(datos: DatosDestino): Destino {
    const paisCodigo = datos.paisCodigo.trim().toUpperCase();
    const ciudad = datos.ciudad.trim();
    const fechaInicio = FechaCalendario.of(datos.fechaInicio);
    const fechaFin = FechaCalendario.of(datos.fechaFin);
    invariante(/^[A-Z]{2}$/.test(paisCodigo), 'PAIS_INVALIDO', `País inválido: ${datos.paisCodigo}`);
    invariante(ciudad.length >= 2, 'CIUDAD_REQUERIDA', 'La ciudad es obligatoria');
    invariante(!fechaFin.esAnteriorA(fechaInicio), 'RANGO_FECHAS_INVALIDO', 'La fecha fin es anterior a la de inicio', {
      paisCodigo,
      ciudad,
    });
    return new Destino(paisCodigo, ciudad, fechaInicio, fechaFin);
  }

  toDatos(): DatosDestino {
    return {
      paisCodigo: this.paisCodigo,
      ciudad: this.ciudad,
      fechaInicio: this.fechaInicio.toString(),
      fechaFin: this.fechaFin.toString(),
    };
  }
}
