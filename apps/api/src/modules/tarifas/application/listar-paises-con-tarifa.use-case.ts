import type { TarifaRepository } from '../domain/repositorios';

export class ListarPaisesConTarifaUseCase {
  constructor(private readonly tarifas: TarifaRepository) {}

  ejecutar(cargoId: string): Promise<string[]> {
    return this.tarifas.listarPaisesDeCargo(cargoId);
  }
}
