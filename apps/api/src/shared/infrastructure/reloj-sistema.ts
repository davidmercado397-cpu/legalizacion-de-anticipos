import { FechaCalendario } from '@viaticos/shared-kernel';
import type { Reloj } from '../application/puertos';

export class RelojSistema implements Reloj {
  private readonly formato: Intl.DateTimeFormat;

  constructor(zonaHoraria = 'America/Bogota') {
    // en-CA formatea como YYYY-MM-DD
    this.formato = new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria });
  }

  ahora(): Date {
    return new Date();
  }

  hoy(): FechaCalendario {
    return FechaCalendario.of(this.formato.format(this.ahora()));
  }
}
