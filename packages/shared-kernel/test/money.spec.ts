import { describe, expect, it } from 'vitest';
import { DomainError, FechaCalendario, Money, TasaCambio } from '../src';

describe('Money', () => {
  it('evita errores de punto flotante', () => {
    expect(Money.of('0.1', 'USD').sumar(Money.of('0.2', 'USD')).monto).toBe('0.30');
  });

  it('redondea half-up a 2 decimales', () => {
    expect(Money.of('10.005', 'USD').monto).toBe('10.01');
    expect(Money.of('30', 'USD').multiplicar(1.005).monto).toBe('30.15');
  });

  it('no permite operar monedas distintas', () => {
    expect(() => Money.of(1, 'USD').sumar(Money.of(1, 'COP'))).toThrowError(DomainError);
  });

  it('normaliza y valida el código de moneda', () => {
    expect(Money.of(1, 'usd').moneda).toBe('USD');
    expect(() => Money.of(1, 'DOLAR')).toThrowError(/Moneda inválida/);
  });

  it('rechaza montos no numéricos', () => {
    expect(() => Money.of('abc', 'USD')).toThrowError(/Monto inválido/);
  });

  it('convierte con una tasa explícita', () => {
    const trm = new TasaCambio('USD', 'COP', '4012.35', FechaCalendario.of('2026-10-15'), 'TRM');
    expect(Money.of('100', 'USD').convertir(trm).toDto()).toEqual({ monto: '401235.00', moneda: 'COP' });
    expect(Money.of('401235', 'COP').convertir(trm.invertir()).monto).toBe('100.00');
  });

  it('combina tasas para obtener una cruzada (BRL→USD→COP)', () => {
    const fecha = FechaCalendario.of('2026-11-03');
    const brlUsd = new TasaCambio('USD', 'BRL', '5', fecha, 'X').invertir();
    const usdCop = new TasaCambio('USD', 'COP', '4000', fecha, 'X');
    const brlCop = brlUsd.combinar(usdCop);
    expect(`${brlCop.origen}->${brlCop.destino}`).toBe('BRL->COP');
    expect(Money.of(100, 'BRL').convertir(brlCop).monto).toBe('80000.00');
    expect(() => usdCop.combinar(usdCop)).toThrowError(/encadenar/);
  });

  it('rechaza una tasa que no corresponde a la moneda', () => {
    const trm = new TasaCambio('USD', 'COP', 4000, FechaCalendario.of('2026-10-15'), 'TRM');
    expect(() => Money.of(1, 'BRL').convertir(trm)).toThrowError(/no aplica/);
  });

  it('suma una lista en una moneda', () => {
    const total = Money.sumarTodos([Money.of(10, 'USD'), Money.of('5.5', 'USD')], 'USD');
    expect(total.monto).toBe('15.50');
  });
});

describe('FechaCalendario', () => {
  it('cuenta días sin problemas de zona horaria', () => {
    const inicio = FechaCalendario.of('2026-03-07');
    const fin = FechaCalendario.of('2026-03-10');
    expect(inicio.diasHasta(fin)).toBe(3);
    expect(inicio.sumarDias(25).toString()).toBe('2026-04-01');
  });

  it('suma meses y ajusta al último día cuando el mes es más corto', () => {
    expect(FechaCalendario.of('2026-11-06').sumarMeses(1).toString()).toBe('2026-12-06');
    expect(FechaCalendario.of('2026-12-15').sumarMeses(1).toString()).toBe('2027-01-15');
    expect(FechaCalendario.of('2027-01-31').sumarMeses(1).toString()).toBe('2027-02-28');
  });

  it('rechaza fechas imposibles o mal formadas', () => {
    expect(() => FechaCalendario.of('2026-02-30')).toThrowError(/Fecha inválida/);
    expect(() => FechaCalendario.of('15/10/2026')).toThrowError(/Fecha inválida/);
  });
});
