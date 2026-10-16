import type { ConceptoViatico } from './concepto-viatico';
import type { Tarifa } from './tarifa';

export interface TarifaRepository {
  buscarPorCargoYPais(cargoId: string, paisCodigo: string): Promise<Tarifa[]>;
  listar(filtro: { cargoId?: string | undefined; paisCodigo?: string | undefined }): Promise<Tarifa[]>;
  obtenerPorId(id: string): Promise<Tarifa | null>;
  /** Inserta o actualiza varias en una transacción (p. ej. cerrar la anterior y crear la nueva). */
  guardar(tarifas: readonly Tarifa[]): Promise<void>;
  /** Países con al menos una tarifa para el cargo (para el selector de destino). */
  listarPaisesDeCargo(cargoId: string): Promise<string[]>;
}

export interface ConceptoViaticoRepository {
  listar(): Promise<ConceptoViatico[]>;
  guardar(concepto: ConceptoViatico): Promise<void>;
}
