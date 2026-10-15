import type { Money } from '@viaticos/shared-kernel';

/**
 * Registro del anticipo en el ERP (Siesa Enterprise). La operación debe ser
 * idempotente por `anticipoId`: un reintento no puede crear dos anticipos.
 */
export interface ErpAnticiposGateway {
  registrarAnticipo(datos: {
    anticipoId: string;
    solicitudId: string;
    viajeroId: string;
    monto: Money;
    concepto: string;
  }): Promise<{ referencia: string }>;
}

export interface DirectorioPersonas {
  nombres(ids: readonly string[]): Promise<Map<string, string>>;
}
