import type { Money } from '@viaticos/shared-kernel';
import type { ConfiguracionExclusion } from './reglas-exclusion';

/** Parámetros que administra contabilidad. */
export interface PoliticaLegalizacion {
  /** NIT de la empresa colombiana: todas las facturas deben venir a su nombre. */
  nitEmpresa: string;
  /** Tope de un recibo de caja (proveedor 222), uno por moneda. */
  topesReciboCaja: Money[];
  exclusiones: ConfiguracionExclusion[];
  actualizadaPor: string | null;
  actualizadaEn: Date | null;
}

export interface PoliticaLegalizacionRepository {
  obtener(): Promise<PoliticaLegalizacion>;
  guardar(politica: PoliticaLegalizacion): Promise<void>;
}
