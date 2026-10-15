import type { ExtractorComprobantes } from '../application/puertos';

/** Sin lectura automática: el viajero digita los datos (no se inventa nada). */
export class ExtractorManual implements ExtractorComprobantes {
  readonly automatico = false;

  async extraer() {
    return null;
  }
}
