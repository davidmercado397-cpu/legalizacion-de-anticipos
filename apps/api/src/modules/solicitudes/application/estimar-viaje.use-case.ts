import type { CotizadorViaje, CotizarViajeComando } from './cotizador-viaje';

/** Proyección del viaje: no persiste nada, solo calcula el estimado y si escalaría. */
export class EstimarViajeUseCase {
  constructor(private readonly cotizador: CotizadorViaje) {}

  async ejecutar(comando: CotizarViajeComando) {
    const { presupuesto, escalamiento } = await this.cotizador.cotizar(comando);
    return { presupuesto, escalamiento };
  }
}
