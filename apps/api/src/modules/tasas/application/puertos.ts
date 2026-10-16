import type { FechaCalendario } from '@viaticos/shared-kernel';

/** Unidades de `moneda` por 1 USD vigentes en una fecha, según una fuente oficial. */
export interface CotizacionDolar {
  moneda: string;
  /** Fecha solicitada (la clave de caché). */
  fecha: string;
  porDolar: string;
  /** Fecha de la publicación usada (p. ej. el viernes para un domingo). */
  fechaPublicada: string;
  fuente: string;
}

export interface FuenteTasas {
  /** Monedas que esta fuente sabe cotizar contra el dólar. */
  soporta(moneda: string): boolean;
  /** null si la fuente no tiene dato para esa fecha (o anterior cercana). */
  cotizar(moneda: string, fecha: FechaCalendario): Promise<CotizacionDolar | null>;
}

export interface CacheTasas {
  obtener(moneda: string, fecha: string): Promise<CotizacionDolar | null>;
  guardar(cotizacion: CotizacionDolar): Promise<void>;
  /** La cotización guardada más reciente con fecha ≤ `fecha` y ≥ `desde` (respaldo si la fuente no responde). */
  ultimaHasta(moneda: string, fecha: string, desde: string): Promise<CotizacionDolar | null>;
}
