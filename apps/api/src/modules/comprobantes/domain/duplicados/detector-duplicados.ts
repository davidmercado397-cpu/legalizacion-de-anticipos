import { estrategiasPorDefecto, type CodigoCoincidencia, type EstrategiaDuplicado, type Severidad } from './estrategias';
import type { HuellaComprobante } from './huella-comprobante';

/** Comprobante vigente ya registrado (los anulados o rechazados no participan). */
export interface ComprobanteRegistrado {
  comprobanteId: string;
  viajeroId: string;
  huella: HuellaComprobante;
}

export interface Coincidencia {
  codigo: CodigoCoincidencia;
  severidad: Severidad;
  comprobanteId: string;
  viajeroId: string;
  detalle: string;
}

export type Veredicto = 'UNICO' | 'SOSPECHOSO' | 'DUPLICADO';

export interface ResultadoDuplicidad {
  veredicto: Veredicto;
  coincidencias: Coincidencia[];
}

/** Servicio de dominio: aplica cada estrategia a los candidatos y resume el veredicto. */
export class DetectorDuplicados {
  constructor(private readonly estrategias: readonly EstrategiaDuplicado[] = estrategiasPorDefecto()) {}

  evaluar(
    nueva: HuellaComprobante,
    candidatos: readonly ComprobanteRegistrado[],
    comprobanteIdActual?: string,
  ): ResultadoDuplicidad {
    const coincidencias = candidatos
      // Al re-verificar un comprobante (p. ej. tras corregir datos del OCR) no debe coincidir consigo mismo.
      .filter((c) => c.comprobanteId !== comprobanteIdActual)
      .flatMap((candidato) =>
        this.estrategias.flatMap((estrategia) => {
          const detalle = estrategia.comparar(nueva, candidato.huella);
          return detalle
            ? [
                {
                  codigo: estrategia.codigo,
                  severidad: estrategia.severidad,
                  comprobanteId: candidato.comprobanteId,
                  viajeroId: candidato.viajeroId,
                  detalle,
                },
              ]
            : [];
        }),
      )
      .sort((a, b) => Number(b.severidad === 'BLOQUEANTE') - Number(a.severidad === 'BLOQUEANTE'));

    const veredicto: Veredicto = coincidencias.some((c) => c.severidad === 'BLOQUEANTE')
      ? 'DUPLICADO'
      : coincidencias.length > 0
        ? 'SOSPECHOSO'
        : 'UNICO';
    return { veredicto, coincidencias };
  }
}
