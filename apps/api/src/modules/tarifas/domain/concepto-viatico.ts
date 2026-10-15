/** Cómo se cuenta un concepto: alojamiento por noche, alimentación por día, etc. */
export type UnidadCobro = 'NOCHE' | 'DIA';

export interface ConceptoViatico {
  readonly codigo: string;
  readonly nombre: string;
  readonly unidad: UnidadCobro;
  readonly activo: boolean;
}
