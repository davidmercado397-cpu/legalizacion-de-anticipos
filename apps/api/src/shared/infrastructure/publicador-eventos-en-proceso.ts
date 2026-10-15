import { Logger } from '@nestjs/common';
import type { EventoDominio } from '../domain/agregado-raiz';
import type { BusEventos, ManejadorEvento } from '../application/puertos';

/**
 * Bus en proceso. Un manejador que falla se registra en el log pero no revierte
 * la operación que originó el evento (ya confirmada). Los manejadores deben ser
 * idempotentes: el reemplazo previsto es Outbox + pg-boss con reintentos (ADR-0004).
 */
export class PublicadorEventosEnProceso implements BusEventos {
  private readonly logger = new Logger('Eventos');
  private readonly manejadores = new Map<string, ManejadorEvento[]>();

  suscribir<E extends EventoDominio>(tipo: E['tipo'], manejador: ManejadorEvento<E>): void {
    this.manejadores.set(tipo, [...(this.manejadores.get(tipo) ?? []), manejador as ManejadorEvento]);
  }

  async publicar(eventos: readonly EventoDominio[]): Promise<void> {
    for (const evento of eventos) {
      this.logger.log(`${evento.tipo} (${evento.agregadoId})`);
      for (const manejador of this.manejadores.get(evento.tipo) ?? []) {
        try {
          await manejador(evento);
        } catch (error) {
          this.logger.error(
            `Falló un manejador de ${evento.tipo} (${evento.agregadoId}): ${error instanceof Error ? error.stack : String(error)}`,
          );
        }
      }
    }
  }
}
