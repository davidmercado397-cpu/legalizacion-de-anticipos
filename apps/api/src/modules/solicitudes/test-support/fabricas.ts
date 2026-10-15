import { FechaCalendario, Money, TasaCambio } from '@viaticos/shared-kernel';
import type { TarifaAplicable } from '../domain/presupuesto-viaje';

export const HOY = FechaCalendario.of('2026-10-15');
export const TRM = new TasaCambio('USD', 'COP', '4000', HOY, 'TRM');

export const tarifasBrasil = (): TarifaAplicable[] => [
  { tarifaId: 'BR-ALO', conceptoCodigo: 'ALOJAMIENTO', conceptoNombre: 'Alojamiento', unidad: 'NOCHE', valorUnitario: Money.of(30, 'USD') },
  { tarifaId: 'BR-ALI', conceptoCodigo: 'ALIMENTACION', conceptoNombre: 'Alimentación', unidad: 'DIA', valorUnitario: Money.of(35, 'USD') },
];

export const tarifasColombia = (): TarifaAplicable[] => [
  { tarifaId: 'CO-ALO', conceptoCodigo: 'ALOJAMIENTO', conceptoNombre: 'Alojamiento', unidad: 'NOCHE', valorUnitario: Money.of(250000, 'COP') },
  { tarifaId: 'CO-ALI', conceptoCodigo: 'ALIMENTACION', conceptoNombre: 'Alimentación', unidad: 'DIA', valorUnitario: Money.of(120000, 'COP') },
];
