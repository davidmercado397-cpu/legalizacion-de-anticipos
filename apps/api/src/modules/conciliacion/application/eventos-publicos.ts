import type { MoneyDto } from '@viaticos/shared-kernel';
import type { EventoDominio } from '../../../shared/domain/agregado-raiz';

/** Contrato público del módulo de conciliación: lo consume legalizaciones. */

/**
 * Estado de un pago con tarjeta frente al extracto:
 * CRUZADO (se legaliza lo cobrado por el banco), SIN_CARGO (no aparece en el
 * extracto: alerta para contabilidad) o PENDIENTE (cruce por confirmar o fuera del periodo).
 */
export interface EstadoBancarioActualizado extends EventoDominio {
  tipo: 'conciliacion.EstadoBancarioActualizado';
  legalizacionId: string;
  soporteId: string;
  estado: 'CRUZADO' | 'SIN_CARGO' | 'PENDIENTE';
  cargo: { movimientoId: string; descripcion: string; fecha: string; valor: MoneyDto } | null;
}

/** Contabilidad decidió si un cargo de la tarjeta sin factura se descuenta al viajero. */
export interface CargoSinSoporteDecidido extends EventoDominio {
  tipo: 'conciliacion.CargoSinSoporteDecidido';
  legalizacionId: string;
  movimientoId: string;
  descontar: boolean;
  descripcion: string;
  fecha: string;
  valor: MoneyDto;
  decididoPor: string;
}
