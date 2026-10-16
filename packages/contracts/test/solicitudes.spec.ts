import { describe, expect, it } from 'vitest';
import { crearSolicitudRequestSchema, estimarViajeRequestSchema } from '../src';

const destino = {
  paisCodigo: 'br',
  ciudad: 'São Paulo',
  fechaInicio: '2026-11-02',
  fechaFin: '2026-11-06',
};

describe('estimarViajeRequestSchema', () => {
  it('normaliza el país y asigna valores por defecto', () => {
    const r = estimarViajeRequestSchema.parse({ destinos: [destino] });
    expect(r.destinos[0]?.paisCodigo).toBe('BR');
    expect(r.destinos[0]?.valoresSolicitados).toEqual([]);
  });

  it('rechaza fecha fin anterior a inicio con una clave i18n', () => {
    const r = estimarViajeRequestSchema.safeParse({
      destinos: [{ ...destino, fechaFin: '2026-11-01' }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      path: ['destinos', 0, 'fechaFin'],
      message: 'validation.endBeforeStart',
    });
  });

  it('rechaza montos con más de 2 decimales o no numéricos', () => {
    const conValor = (valorUnitario: string) =>
      estimarViajeRequestSchema.safeParse({
          destinos: [{ ...destino, valoresSolicitados: [{ conceptoCodigo: 'ALOJAMIENTO', valorUnitario }] }],
      }).success;
    expect(conValor('50.00')).toBe(true);
    expect(conValor('50.001')).toBe(false);
    expect(conValor('-5')).toBe(false);
  });

  it('no permite el mismo concepto dos veces en un destino', () => {
    const r = estimarViajeRequestSchema.safeParse({
      destinos: [
        {
          ...destino,
          valoresSolicitados: [
            { conceptoCodigo: 'ALOJAMIENTO', valorUnitario: '40' },
            { conceptoCodigo: 'ALOJAMIENTO', valorUnitario: '50' },
          ],
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('crearSolicitudRequestSchema', () => {
  it('exige un motivo descriptivo', () => {
    const r = crearSolicitudRequestSchema.safeParse({ monedaAnticipo: 'COP', destinos: [destino], motivo: 'corto' });
    expect(r.success).toBe(false);
  });
});
