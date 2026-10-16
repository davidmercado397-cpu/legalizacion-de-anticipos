import { DomainError, FechaCalendario, TasaCambio } from '@viaticos/shared-kernel';
import { describe, expect, it, vi } from 'vitest';
import { TasasDelDia } from './tasas-del-dia';

const HOY = FechaCalendario.of('2026-10-16');
const reloj = { ahora: () => new Date('2026-10-16T15:00:00Z'), hoy: () => HOY };

describe('TasasDelDia', () => {
  const proveedor = {
    obtener: async (_o: string, destino: string, fecha: FechaCalendario) => {
      if (destino === 'BRL') throw new DomainError('TASA_NO_DISPONIBLE', 'REGLA_NEGOCIO', 'sin dato');
      return new TasaCambio('USD', destino, '4100', fecha, `TRM ${fecha}`);
    },
  };

  it('consulta las monedas visibles en la fecha de hoy', async () => {
    const r = await new TasasDelDia(proveedor, reloj, { advertencia: vi.fn() }, ['COP', 'BRL']).consultar();
    expect(r).toEqual({
      fecha: '2026-10-16',
      cotizaciones: [
        { moneda: 'COP', porDolar: '4100', fuente: 'TRM 2026-10-16' },
        { moneda: 'BRL', porDolar: null, fuente: null },
      ],
    });
  });

  it('actualizar avisa si falta alguna tasa', async () => {
    const bitacora = { advertencia: vi.fn(), informacion: vi.fn() };
    await new TasasDelDia(proveedor, reloj, bitacora, ['COP', 'BRL']).actualizar();
    expect(bitacora.advertencia).toHaveBeenCalledWith(expect.stringContaining('BRL=sin dato'));
    await new TasasDelDia(proveedor, reloj, bitacora, ['COP']).actualizar();
    expect(bitacora.informacion).toHaveBeenCalledWith('Tasas del 2026-10-16: COP=4100 (TRM 2026-10-16)');
  });
});
