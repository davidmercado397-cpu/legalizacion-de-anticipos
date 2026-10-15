import { describe, expect, it } from 'vitest';
import { Money } from '@viaticos/shared-kernel';
import { tarifasBrasil } from '../../test-support/fabricas';
import { Destino } from '../destino';
import { estimarPresupuesto } from '../presupuesto-viaje';
import { ExcedeTarifaRegla } from './excede-tarifa.regla';
import { crearReglasEscalamiento } from './fabrica-reglas';
import { MontoTotalSuperaRegla } from './monto-total-supera.regla';
import { evaluarEscalamiento } from './regla-escalamiento';

const presupuestoConHotelA = (valorHotel: string) =>
  estimarPresupuesto({
    monedaAnticipo: 'USD',
    destinos: [
      {
        destino: Destino.crear({ paisCodigo: 'BR', ciudad: 'Rio', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }),
        tarifas: tarifasBrasil(),
        valoresSolicitados: new Map([['ALOJAMIENTO', valorHotel]]),
      },
    ],
    tasas: [],
  });

const umbrales = (usd: number) => [Money.of(usd, 'USD'), Money.of(usd * 4000, 'COP')];

describe('ExcedeTarifaRegla', () => {
  it('escala cuando se proyectan 50 USD/noche y la tarifa es 30', () => {
    const motivos = new ExcedeTarifaRegla().evaluar(presupuestoConHotelA('50'));
    expect(motivos).toHaveLength(1);
    expect(motivos[0]!.codigo).toBe('EXCEDE_TARIFA');
    expect(motivos[0]!.descripcion).toContain('50.00 USD por noche supera la tarifa de 30.00 USD');
  });

  it('no escala si el valor es igual o menor a la tarifa', () => {
    expect(new ExcedeTarifaRegla().evaluar(presupuestoConHotelA('30'))).toEqual([]);
    expect(new ExcedeTarifaRegla().evaluar(presupuestoConHotelA('25'))).toEqual([]);
  });

  it('respeta la tolerancia configurada', () => {
    expect(new ExcedeTarifaRegla(10).evaluar(presupuestoConHotelA('33'))).toEqual([]);
    expect(new ExcedeTarifaRegla(10).evaluar(presupuestoConHotelA('33.01'))).toHaveLength(1);
  });
});

describe('MontoTotalSuperaRegla', () => {
  it('escala cuando el total supera el umbral de la moneda del anticipo', () => {
    // total con hotel a 30: 120 + 175 = 295 USD
    expect(new MontoTotalSuperaRegla(umbrales(300)).evaluar(presupuestoConHotelA('30'))).toEqual([]);
    expect(new MontoTotalSuperaRegla(umbrales(290)).evaluar(presupuestoConHotelA('30'))).toHaveLength(1);
  });

  it('exige un umbral por cada moneda de anticipo', () => {
    expect(() => new MontoTotalSuperaRegla([Money.of(100, 'USD')])).toThrowError(/umbral en COP/);
  });
});

describe('crearReglasEscalamiento + evaluarEscalamiento', () => {
  it('construye solo las reglas activas a partir de la configuración', () => {
    const reglas = crearReglasEscalamiento([
      { tipo: 'EXCEDE_TARIFA', activa: true, parametros: { toleranciaPorcentaje: 0 } },
      {
        tipo: 'MONTO_TOTAL_SUPERA',
        activa: false,
        parametros: { umbrales: umbrales(1).map((u) => u.toDto()) },
      },
    ]);
    expect(reglas).toHaveLength(1);

    const resultado = evaluarEscalamiento(presupuestoConHotelA('50'), reglas);
    expect(resultado.requiereJefeDirectivo).toBe(true);
    expect(evaluarEscalamiento(presupuestoConHotelA('30'), reglas).requiereJefeDirectivo).toBe(false);
  });
});
