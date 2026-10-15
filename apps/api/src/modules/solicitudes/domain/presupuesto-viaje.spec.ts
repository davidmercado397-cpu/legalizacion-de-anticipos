import { describe, expect, it } from 'vitest';
import { DomainError } from '@viaticos/shared-kernel';
import { TRM, tarifasBrasil, tarifasColombia } from '../test-support/fabricas';
import { Destino } from './destino';
import { estimarPresupuesto } from './presupuesto-viaje';

const saoPaulo = Destino.crear({ paisCodigo: 'BR', ciudad: 'São Paulo', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' });
const bogota = Destino.crear({ paisCodigo: 'CO', ciudad: 'Bogotá', fechaInicio: '2026-11-06', fechaFin: '2026-11-07' });

describe('estimarPresupuesto', () => {
  it('cuenta noches para alojamiento y días para alimentación', () => {
    const p = estimarPresupuesto({
      monedaAnticipo: 'USD',
      destinos: [{ destino: saoPaulo, tarifas: tarifasBrasil(), valoresSolicitados: new Map() }],
      tasas: [],
    });
    const resumen = p.lineas.map((l) => [l.conceptoCodigo, l.cantidad, l.subtotal.monto]);
    expect(resumen).toEqual([
      ['ALOJAMIENTO', 4, '120.00'],
      ['ALIMENTACION', 5, '175.00'],
    ]);
    expect(p.totalAnticipo.toDto()).toEqual({ monto: '295.00', moneda: 'USD' });
    expect(p.lineas.some((l) => l.excedeTarifa)).toBe(false);
  });

  it('usa el valor propuesto por el viajero y marca la línea que excede la tarifa', () => {
    const p = estimarPresupuesto({
      monedaAnticipo: 'USD',
      destinos: [{ destino: saoPaulo, tarifas: tarifasBrasil(), valoresSolicitados: new Map([['ALOJAMIENTO', '50']]) }],
      tasas: [],
    });
    const hotel = p.lineas.find((l) => l.conceptoCodigo === 'ALOJAMIENTO')!;
    expect(hotel.valorUnitarioSolicitado.monto).toBe('50.00');
    expect(hotel.subtotal.monto).toBe('200.00');
    expect(hotel.excedeTarifa).toBe(true);
  });

  it('convierte a la moneda del anticipo sumando primero por moneda', () => {
    const p = estimarPresupuesto({
      monedaAnticipo: 'COP',
      destinos: [
        { destino: saoPaulo, tarifas: tarifasBrasil(), valoresSolicitados: new Map() },
        { destino: bogota, tarifas: tarifasColombia(), valoresSolicitados: new Map() },
      ],
      tasas: [TRM],
    });
    // Brasil: 295 USD × 4000 = 1.180.000 COP. Bogotá: 1 noche (250.000) + 1 día (120.000; el 6 ya se contó en Brasil)
    expect(p.totalAnticipo.toDto()).toEqual({ monto: '1550000.00', moneda: 'COP' });
    expect(p.tasasAplicadas.map((t) => `${t.origen}->${t.destino}`)).toEqual(['USD->COP']);
  });

  it('falla si falta la tasa de cambio', () => {
    expect(() =>
      estimarPresupuesto({
        monedaAnticipo: 'COP',
        destinos: [{ destino: saoPaulo, tarifas: tarifasBrasil(), valoresSolicitados: new Map() }],
        tasas: [],
      }),
    ).toThrowError(/Falta la tasa/);
  });

  it('falla si el país no tiene tarifas para el cargo', () => {
    const error = (() => {
      try {
        estimarPresupuesto({
          monedaAnticipo: 'USD',
          destinos: [{ destino: saoPaulo, tarifas: [], valoresSolicitados: new Map() }],
          tasas: [],
        });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).codigo).toBe('TARIFA_NO_DEFINIDA');
  });

  it('rechaza valores para conceptos sin tarifa', () => {
    expect(() =>
      estimarPresupuesto({
        monedaAnticipo: 'USD',
        destinos: [{ destino: saoPaulo, tarifas: tarifasBrasil(), valoresSolicitados: new Map([['SPA', '100']]) }],
        tasas: [],
      }),
    ).toThrowError(/no tiene tarifa/);
  });
});
