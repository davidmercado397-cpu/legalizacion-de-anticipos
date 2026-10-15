export interface EventoDominio {
  readonly tipo: string;
  readonly agregadoId: string;
  readonly ocurridoEn: Date;
}

/** Raíz de agregado: acumula los eventos de dominio hasta que la aplicación los publica. */
export abstract class AgregadoRaiz {
  private eventosPendientes: EventoDominio[] = [];

  protected registrarEvento<E extends EventoDominio>(evento: E): void {
    this.eventosPendientes.push(evento);
  }

  extraerEventos(): EventoDominio[] {
    const eventos = this.eventosPendientes;
    this.eventosPendientes = [];
    return eventos;
  }
}
