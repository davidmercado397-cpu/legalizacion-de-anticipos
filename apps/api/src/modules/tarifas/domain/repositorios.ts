import type { ConceptoViatico } from './concepto-viatico';
import type { Tarifa } from './tarifa';

export interface TarifaRepository {
  buscarPorCargoYPais(cargoId: string, paisCodigo: string): Promise<Tarifa[]>;
  /** Países con al menos una tarifa para el cargo (para el selector de destino). */
  listarPaisesDeCargo(cargoId: string): Promise<string[]>;
}

export interface ConceptoViaticoRepository {
  listar(): Promise<ConceptoViatico[]>;
}
