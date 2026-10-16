import { describe, expect, it } from 'vitest';
import { calcularUnidades } from './calculadora-unidades';
import { Destino } from './destino';

const destino = (fechaInicio: string, fechaFin: string, ciudad = 'Bogotá') =>
  Destino.crear({ paisCodigo: 'CO', ciudad, fechaInicio, fechaFin });

describe('calcularUnidades', () => {
  it('un destino del 1 al 5 tiene 5 días y 4 noches', () => {
    expect(calcularUnidades([destino('2026-11-01', '2026-11-05')])).toEqual([{ dias: 5, noches: 4 }]);
  });

  it('un viaje de ida y vuelta el mismo día tiene 1 día y 0 noches', () => {
    expect(calcularUnidades([destino('2026-11-01', '2026-11-01')])).toEqual([{ dias: 1, noches: 0 }]);
  });

  it('el día de traslado se cuenta una sola vez, con la tarifa de la ciudad de llegada', () => {
    const unidades = calcularUnidades([destino('2026-11-01', '2026-11-05', 'Lima'), destino('2026-11-05', '2026-11-08', 'Quito')]);
    expect(unidades).toEqual([
      { dias: 4, noches: 4 },
      { dias: 4, noches: 3 },
    ]);
    // 1→8 de noviembre: 8 días y 7 noches en total
    expect(unidades.reduce((s, u) => s + u.dias, 0)).toBe(8);
    expect(unidades.reduce((s, u) => s + u.noches, 0)).toBe(7);
  });

  it('devuelve las unidades en el orden recibido aunque los destinos vengan desordenados', () => {
    const unidades = calcularUnidades([destino('2026-11-05', '2026-11-08', 'Quito'), destino('2026-11-01', '2026-11-05', 'Lima')]);
    expect(unidades).toEqual([
      { dias: 4, noches: 3 },
      { dias: 4, noches: 4 },
    ]);
  });

  it('rechaza destinos que se solapan más de un día', () => {
    expect(() =>
      calcularUnidades([destino('2026-11-01', '2026-11-05', 'Lima'), destino('2026-11-04', '2026-11-08', 'Quito')]),
    ).toThrowError(/se solapan/);
  });
});
