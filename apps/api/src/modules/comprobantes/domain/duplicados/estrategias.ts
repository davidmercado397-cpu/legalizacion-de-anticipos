import { distanciaHamming, type HuellaComprobante } from './huella-comprobante';

export type CodigoCoincidencia =
  | 'ARCHIVO_IDENTICO'
  | 'CLAVE_FISCAL_REPETIDA'
  | 'EMISOR_Y_NUMERO_REPETIDOS'
  | 'IMAGEN_SIMILAR'
  | 'EMISOR_FECHA_TOTAL_IGUALES';

/** BLOQUEANTE: no se admite. SOSPECHOSA: se admite con alerta para contabilidad. */
export type Severidad = 'BLOQUEANTE' | 'SOSPECHOSA';

export interface EstrategiaDuplicado {
  readonly codigo: CodigoCoincidencia;
  readonly severidad: Severidad;
  /** Devuelve el detalle de la coincidencia, o null si no coincide. */
  comparar(nueva: HuellaComprobante, existente: HuellaComprobante): string | null;
}

export class ArchivoIdenticoEstrategia implements EstrategiaDuplicado {
  readonly codigo = 'ARCHIVO_IDENTICO';
  readonly severidad = 'BLOQUEANTE';

  comparar(nueva: HuellaComprobante, existente: HuellaComprobante): string | null {
    return nueva.sha256 === existente.sha256 ? 'El mismo archivo ya fue radicado' : null;
  }
}

export class ClaveFiscalRepetidaEstrategia implements EstrategiaDuplicado {
  readonly codigo = 'CLAVE_FISCAL_REPETIDA';
  readonly severidad = 'BLOQUEANTE';

  comparar(nueva: HuellaComprobante, existente: HuellaComprobante): string | null {
    const [a, b] = [nueva.claveFiscal, existente.claveFiscal];
    return a && b && a.equals(b) ? `Ya existe un comprobante con el mismo ${a.tipo}` : null;
  }
}

export class EmisorYNumeroEstrategia implements EstrategiaDuplicado {
  readonly codigo = 'EMISOR_Y_NUMERO_REPETIDOS';
  readonly severidad = 'BLOQUEANTE';

  comparar(nueva: HuellaComprobante, existente: HuellaComprobante): string | null {
    return nueva.emisorId &&
      nueva.numeroDocumento &&
      nueva.emisorId === existente.emisorId &&
      nueva.numeroDocumento === existente.numeroDocumento
      ? `La factura ${nueva.numeroDocumento} del emisor ${nueva.emisorId} ya fue radicada`
      : null;
  }
}

/** Otra foto del mismo papel: archivos distintos pero imágenes casi iguales. */
export class ImagenSimilarEstrategia implements EstrategiaDuplicado {
  readonly codigo = 'IMAGEN_SIMILAR';
  readonly severidad = 'SOSPECHOSA';

  constructor(private readonly umbralBits = 10) {}

  comparar(nueva: HuellaComprobante, existente: HuellaComprobante): string | null {
    if (!nueva.hashPerceptual || !existente.hashPerceptual || nueva.sha256 === existente.sha256) return null;
    const distancia = distanciaHamming(nueva.hashPerceptual, existente.hashPerceptual);
    return distancia <= this.umbralBits ? `La imagen es muy similar a otro comprobante (distancia ${distancia})` : null;
  }
}

/** Mismo emisor, fecha y total con distinto número (o sin número): posible duplicado. */
export class EmisorFechaTotalEstrategia implements EstrategiaDuplicado {
  readonly codigo = 'EMISOR_FECHA_TOTAL_IGUALES';
  readonly severidad = 'SOSPECHOSA';

  comparar(nueva: HuellaComprobante, existente: HuellaComprobante): string | null {
    if (!nueva.emisorId || !nueva.fecha || !nueva.total) return null;
    if (!existente.fecha || !existente.total || nueva.emisorId !== existente.emisorId) return null;
    const mismoNumero = !!nueva.numeroDocumento && nueva.numeroDocumento === existente.numeroDocumento;
    const coincide =
      !mismoNumero && nueva.fecha.equals(existente.fecha) && nueva.total.equals(existente.total);
    return coincide ? `Otro comprobante del mismo emisor tiene la misma fecha y total (${nueva.total})` : null;
  }
}

export const estrategiasPorDefecto = (): EstrategiaDuplicado[] => [
  new ArchivoIdenticoEstrategia(),
  new ClaveFiscalRepetidaEstrategia(),
  new EmisorYNumeroEstrategia(),
  new ImagenSimilarEstrategia(),
  new EmisorFechaTotalEstrategia(),
];
