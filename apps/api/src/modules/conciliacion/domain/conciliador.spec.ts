import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import { describe, expect, it } from 'vitest';
import { conciliar, puntuar, similitudComercio, type CargoBancario, type PagoTarjeta } from './conciliador';

const f = FechaCalendario.of;
const cargo = (id: string, fecha: string, valor: string, descripcion = 'COMPRA POS'): CargoBancario => ({
  movimientoId: id,
  fecha: f(fecha),
  descripcion,
  valor: Money.of(valor, 'COP'),
});
const pago = (id: string, fecha: string, cop: string, extra: Partial<PagoTarjeta> = {}): PagoTarjeta => ({
  soporteId: id,
  legalizacionId: 'L1',
  fecha: f(fecha),
  emisor: 'Comercio genérico',
  ultimos4: null,
  totalOriginal: Money.of(cop, 'COP'),
  totalEnMonedaExtracto: Money.of(cop, 'COP'),
  ...extra,
});

describe('puntuar', () => {
  it('mismo valor y mismo día: automático aunque el nombre del comercio no se parezca', () => {
    expect(puntuar(cargo('m', '2026-10-03', '100000'), pago('s', '2026-10-03', '100000'), null)).toBe(0.8);
  });

  it('con conversión de moneda acepta hasta 6 % de diferencia (tasa y comisión del banco)', () => {
    const enReales = pago('s', '2026-10-03', '0', { totalOriginal: Money.of('100', 'BRL'), totalEnMonedaExtracto: Money.of('80000', 'COP') });
    expect(puntuar(cargo('m', '2026-10-04', '83000', 'STARBUCKS'), enReales, null)).not.toBeNull();
    expect(puntuar(cargo('m', '2026-10-04', '86000'), enReales, null)).toBeNull();
  });

  it('en la misma moneda la tolerancia es 1 %', () => {
    expect(puntuar(cargo('m', '2026-10-03', '100900'), pago('s', '2026-10-03', '100000'), null)).not.toBeNull();
    expect(puntuar(cargo('m', '2026-10-03', '102000'), pago('s', '2026-10-03', '100000'), null)).toBeNull();
  });

  it('descarta más de 5 días de diferencia, otra tarjeta o sin tasa de conversión', () => {
    expect(puntuar(cargo('m', '2026-10-09', '100000'), pago('s', '2026-10-03', '100000'), null)).toBeNull();
    expect(puntuar(cargo('m', '2026-10-03', '100000'), pago('s', '2026-10-03', '100000', { ultimos4: '1111' }), '2222')).toBeNull();
    expect(puntuar(cargo('m', '2026-10-03', '100000'), pago('s', '2026-10-03', '100000', { totalEnMonedaExtracto: null }), null)).toBeNull();
  });
});

describe('similitudComercio', () => {
  it('ignora mayúsculas, tildes, palabras genéricas y nombres truncados', () => {
    expect(similitudComercio('COMPRA POS STARBUCKS COF SAO PAULO', 'Starbucks Coffee')).toBe(1);
    expect(similitudComercio('COMPRA POS HOTEL IBIS', 'Restaurante Dom')).toBe(0);
    expect(similitudComercio('PAG*UBER TRIP', 'Uber do Brasil Ltda')).toBeGreaterThan(0);
  });
});

describe('conciliar', () => {
  it('asigna uno a uno, de mayor a menor puntaje', () => {
    const cargos = [cargo('m1', '2026-10-03', '50000', 'CAFE ALTO'), cargo('m2', '2026-10-03', '50000', 'TAXI LIBRE')];
    const pagos = [pago('s1', '2026-10-03', '50000', { emisor: 'Taxi Libre SAS' }), pago('s2', '2026-10-03', '50000', { emisor: 'Café Alto' })];
    const r = conciliar(cargos, pagos, { ultimos4Extracto: null });
    expect(r.map((p) => [p.movimientoId, p.soporteId, p.estado])).toEqual([
      ['m1', 's2', 'AUTOMATICO'],
      ['m2', 's1', 'AUTOMATICO'],
    ]);
  });

  it('a 3 días sin parecido de nombre queda SUGERIDO; no vuelve a proponer pares rechazados', () => {
    const cargos = [cargo('m1', '2026-10-06', '50000')];
    const pagos = [pago('s1', '2026-10-03', '50000')];
    expect(conciliar(cargos, pagos, { ultimos4Extracto: null })[0]?.estado).toBe('SUGERIDO');
    expect(conciliar(cargos, pagos, { ultimos4Extracto: null, rechazados: new Set(['m1|s1']) })).toEqual([]);
  });
});
