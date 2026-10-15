import { describe, expect, it } from 'vitest';
import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import { Tarifa, seleccionarTarifasVigentes } from './tarifa';

const f = FechaCalendario.of;

const tarifa = (id: string, desde: string, hasta: string | null, concepto = 'ALOJAMIENTO') =>
  Tarifa.crear({
    id,
    cargoId: 'ANALISTA',
    paisCodigo: 'BR',
    conceptoCodigo: concepto,
    valorUnitario: Money.of(30, 'USD'),
    vigenteDesde: f(desde),
    vigenteHasta: hasta ? f(hasta) : null,
  });

describe('Tarifa', () => {
  it('respeta la vigencia (límites incluidos)', () => {
    const t = tarifa('t1', '2026-01-01', '2026-12-31');
    expect(t.estaVigenteEn(f('2026-01-01'))).toBe(true);
    expect(t.estaVigenteEn(f('2026-12-31'))).toBe(true);
    expect(t.estaVigenteEn(f('2027-01-01'))).toBe(false);
  });

  it('rechaza vigencias invertidas', () => {
    expect(() => tarifa('t1', '2026-12-31', '2026-01-01')).toThrowError(/vigencia/);
  });

  it('selecciona la tarifa vigente de cada concepto', () => {
    const vigentes = seleccionarTarifasVigentes(
      [tarifa('vieja', '2025-01-01', '2025-12-31'), tarifa('nueva', '2026-01-01', null)],
      f('2026-10-15'),
    );
    expect(vigentes.map((t) => t.id)).toEqual(['nueva']);
  });

  it('falla si hay dos tarifas vigentes para el mismo concepto', () => {
    expect(() =>
      seleccionarTarifasVigentes([tarifa('a', '2026-01-01', null), tarifa('b', '2026-06-01', null)], f('2026-10-15')),
    ).toThrowError(/más de una tarifa vigente/);
  });
});
