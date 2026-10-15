import { Logger } from '@nestjs/common';
import type { Bitacora } from '../application/puertos';

export class BitacoraNest implements Bitacora {
  private readonly logger: Logger;

  constructor(contexto: string) {
    this.logger = new Logger(contexto);
  }

  advertencia(mensaje: string): void {
    this.logger.warn(mensaje);
  }
}
