import type { GestionLegalizaciones } from '../../legalizaciones/application/legalizaciones.use-cases';
import type { ConsultaLegalizaciones } from '../application/puertos';

/** Capa anticorrupción hacia el módulo de legalizaciones. */
export class ConsultaLegalizacionesAdapter implements ConsultaLegalizaciones {
  constructor(private readonly legalizaciones: GestionLegalizaciones) {}

  legalizacion(id: string) {
    return this.legalizaciones.titularDe(id);
  }

  pagosConTarjeta(viajeroId: string) {
    return this.legalizaciones.pagosConTarjeta(viajeroId);
  }
}
