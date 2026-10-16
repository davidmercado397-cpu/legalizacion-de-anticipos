/** Lee un archivo de extracto (CSV, TXT, Excel) como una tabla de textos. */
export interface LectorTabular {
  leer(contenido: Buffer, nombreArchivo: string): Promise<string[][]>;
}

export interface PagoTarjetaLegalizado {
  soporteId: string;
  legalizacionId: string;
  fecha: string;
  total: { monto: string; moneda: string };
  emisor: string;
  ultimos4: string | null;
  numeroDocumento: string | null;
}

/** Lo que conciliación necesita del módulo de legalizaciones (capa anticorrupción). */
export interface ConsultaLegalizaciones {
  legalizacion(id: string): Promise<{ id: string; viajeroId: string } | null>;
  /** Facturas confirmadas pagadas con tarjeta por el viajero (sin las que contabilidad rechazó). */
  pagosConTarjeta(viajeroId: string): Promise<PagoTarjetaLegalizado[]>;
}
