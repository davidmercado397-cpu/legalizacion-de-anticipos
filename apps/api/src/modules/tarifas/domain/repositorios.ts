import type { ConceptoViatico } from './concepto-viatico';
import type { Tarifa } from './tarifa';

export interface TarifaRepository {
  buscarPorCargoYPais(cargoId: string, paisCodigo: string): Promise<Tarifa[]>;
}

export interface ConceptoViaticoRepository {
  listar(): Promise<ConceptoViatico[]>;
}
