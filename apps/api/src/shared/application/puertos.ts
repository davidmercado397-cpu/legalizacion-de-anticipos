import type { FechaCalendario, TasaCambio } from '@viaticos/shared-kernel';
import type { EventoDominio } from '../domain/agregado-raiz';

export interface Reloj {
  ahora(): Date;
  /** Fecha calendario en la zona horaria de la empresa. */
  hoy(): FechaCalendario;
}

export interface GeneradorIds {
  nuevo(): string;
}

export interface PublicadorEventos {
  publicar(eventos: readonly EventoDominio[]): Promise<void>;
}

export type ManejadorEvento<E extends EventoDominio = EventoDominio> = (evento: E) => Promise<void>;

/** Publicación + suscripción (los módulos se suscriben a eventos de otros módulos). */
export interface BusEventos extends PublicadorEventos {
  suscribir<E extends EventoDominio>(tipo: E['tipo'], manejador: ManejadorEvento<E>): void;
}

export interface ProveedorTasaCambio {
  /** Tasa para convertir de `origen` a `destino` vigente en `fecha` (ej. TRM). */
  obtener(origen: string, destino: string, fecha: FechaCalendario): Promise<TasaCambio>;
}
