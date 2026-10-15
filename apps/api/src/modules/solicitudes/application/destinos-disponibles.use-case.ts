import { DomainError } from '@viaticos/shared-kernel';
import type { ConsultaTarifas, DirectorioOrganizacional } from './puertos';

export class DestinosDisponiblesUseCase {
  constructor(
    private readonly directorio: DirectorioOrganizacional,
    private readonly tarifas: ConsultaTarifas,
  ) {}

  async ejecutar(viajeroId: string): Promise<string[]> {
    const viajero = await this.directorio.obtenerViajero(viajeroId);
    if (!viajero) throw new DomainError('VIAJERO_NO_ENCONTRADO', 'NO_ENCONTRADO', 'El viajero no existe o está inactivo');
    return this.tarifas.paisesDisponibles(viajero.cargoId);
  }
}
