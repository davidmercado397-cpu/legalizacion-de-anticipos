import type { MoneyDto } from '@viaticos/shared-kernel';
import type { EventoDominio } from '../../../shared/domain/agregado-raiz';
import type { DatosDestino } from './destino';

export interface SolicitudEnviada extends EventoDominio {
  tipo: 'solicitudes.SolicitudEnviada';
  viajeroId: string;
  aprobadorId: string;
  requiereJefeDirectivo: boolean;
}

export interface AprobacionRegistrada extends EventoDominio {
  tipo: 'solicitudes.AprobacionRegistrada';
  aprobadorId: string;
  siguienteAprobadorId: string | null;
}

/** Lo consume el módulo de anticipos para crear el anticipo en Siesa. */
export interface SolicitudAprobada extends EventoDominio {
  tipo: 'solicitudes.SolicitudAprobada';
  viajeroId: string;
  totalAnticipo: MoneyDto;
  motivo: string;
  destinos: DatosDestino[];
}

export interface SolicitudRechazada extends EventoDominio {
  tipo: 'solicitudes.SolicitudRechazada';
  viajeroId: string;
  aprobadorId: string;
  comentario: string;
}

export interface SolicitudCancelada extends EventoDominio {
  tipo: 'solicitudes.SolicitudCancelada';
  viajeroId: string;
}
