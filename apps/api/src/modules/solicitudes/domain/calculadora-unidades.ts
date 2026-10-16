import { DomainError } from '@viaticos/shared-kernel';
import type { Destino } from './destino';

export interface UnidadesDestino {
  dias: number;
  noches: number;
}

/**
 * Días y noches de cada destino (en el mismo orden recibido).
 *
 * - Un destino del 1 al 5 tiene 5 días y 4 noches.
 * - Si un destino empieza el mismo día en que termina el anterior (día de
 *   traslado), ese día se cuenta solo una vez, con la tarifa de la ciudad de
 *   llegada (el destino nuevo).
 * - Un solapamiento mayor a un día es un error.
 */
export function calcularUnidades(destinos: readonly Destino[]): UnidadesDestino[] {
  const ordenados = destinos
    .map((destino, indice) => ({ destino, indice }))
    .sort(
      (a, b) =>
        a.destino.fechaInicio.compareTo(b.destino.fechaInicio) || a.destino.fechaFin.compareTo(b.destino.fechaFin),
    );

  const resultado: UnidadesDestino[] = new Array(destinos.length);
  let anterior: Destino | null = null;
  let indiceAnterior = -1;

  for (const { destino, indice } of ordenados) {
    if (anterior && destino.fechaInicio.esAnteriorA(anterior.fechaFin)) {
      throw new DomainError('DESTINOS_SOLAPADOS', 'VALIDACION', 'Las fechas de los destinos se solapan', {
        destinos: [anterior.ciudad, destino.ciudad],
      });
    }
    const noches = destino.fechaInicio.diasHasta(destino.fechaFin);
    resultado[indice] = { dias: noches + 1, noches };
    if (anterior !== null && destino.fechaInicio.equals(anterior.fechaFin)) {
      resultado[indiceAnterior]!.dias -= 1;
    }
    anterior = destino;
    indiceAnterior = indice;
  }

  return resultado;
}
