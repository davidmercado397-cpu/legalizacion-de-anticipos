import { Logger } from '@nestjs/common';
import type { ErpAnticiposGateway } from '../application/puertos';

/**
 * ERP simulado mientras se integra Siesa Enterprise. Idempotente por anticipoId,
 * como deberá serlo el adaptador real. Con `fallarVeces` se prueban los reintentos.
 */
export class ErpAnticiposSimulado implements ErpAnticiposGateway {
  private readonly logger = new Logger('ErpSimulado');
  private readonly registrados = new Map<string, string>();

  constructor(private fallarVeces = 0) {}

  async registrarAnticipo(datos: { anticipoId: string; monto: { toString(): string } }): Promise<{ referencia: string }> {
    if (this.fallarVeces > 0) {
      this.fallarVeces--;
      throw new Error('ERP simulado no disponible');
    }
    let referencia = this.registrados.get(datos.anticipoId);
    if (!referencia) {
      referencia = `SIM-ANT-${String(this.registrados.size + 1).padStart(6, '0')}`;
      this.registrados.set(datos.anticipoId, referencia);
      this.logger.log(`Anticipo ${datos.anticipoId} por ${datos.monto} registrado como ${referencia}`);
    }
    return { referencia };
  }
}
