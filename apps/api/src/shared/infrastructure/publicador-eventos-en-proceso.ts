import { Logger } from '@nestjs/common';
import type { EventoDominio } from '../domain/agregado-raiz';
import type { PublicadorEventos } from '../application/puertos';

export type ManejadorEvento = (evento: EventoDominio) => Promise<void>;

/**
 * Publicador en proceso. En la iteración 2 se reemplaza por Outbox + pg-boss
 * (ADR-0004) sin cambiar los casos de uso.
 */
export class PublicadorEventosEnProceso implements PublicadorEventos {
  private readonly logger = new Logger('Eventos');
  private readonly manejadores = new Map<string, ManejadorEvento[]>();

  suscribir(tipo: string, manejador: ManejadorEvento): void {
    this.manejadores.set(tipo, [...(this.manejadores.get(tipo) ?? []), manejador]);
  }

  async publicar(eventos: readonly EventoDominio[]): Promise<void> {
    for (const evento of eventos) {
      this.logger.log(`${evento.tipo} (${evento.agregadoId})`);
      for (const manejador of this.manejadores.get(evento.tipo) ?? []) {
        await manejador(evento);
      }
    }
  }
}
