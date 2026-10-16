import { DomainError, FechaCalendario } from '@viaticos/shared-kernel';
import { describe, expect, it, vi } from 'vitest';
import { CacheTasasEnMemoria } from '../infrastructure/cache-tasas';
import { FuenteTasasConfiguradas } from '../infrastructure/fuentes-oficiales';
import type { CotizacionDolar, FuenteTasas } from './puertos';
import { ProveedorTasasOficiales } from './proveedor-tasas-oficiales';

const HOY = FechaCalendario.of('2026-10-16');
const reloj = { ahora: () => new Date('2026-10-16T15:00:00Z'), hoy: () => HOY };

function fuente(moneda: string, porDolar: string, fechaPublicada?: (fecha: string) => string): FuenteTasas & { cotizar: ReturnType<typeof vi.fn> } {
  return {
    soporta: (m) => m === moneda,
    cotizar: vi.fn(async (m: string, f: FechaCalendario): Promise<CotizacionDolar> => ({
      moneda: m,
      fecha: f.toString(),
      porDolar,
      fechaPublicada: fechaPublicada ? fechaPublicada(f.toString()) : f.toString(),
      fuente: moneda === 'COP' ? 'TRM' : 'BCE',
    })),
  };
}

describe('ProveedorTasasOficiales', () => {
  it('usa la TRM de la fecha pedida y deja la fuente en la tasa', async () => {
    const trm = fuente('COP', '4123.45');
    const tasa = await new ProveedorTasasOficiales([trm], new CacheTasasEnMemoria(), reloj).obtener('USD', 'COP', FechaCalendario.of('2026-10-10'));
    expect(tasa.valor.toString()).toBe('4123.45');
    expect(tasa.fuente).toBe('TRM 2026-10-10');
    expect(trm.cotizar).toHaveBeenCalledWith('COP', FechaCalendario.of('2026-10-10'));
  });

  it('invierte la tasa para pasar de COP a USD', async () => {
    const tasa = await new ProveedorTasasOficiales([fuente('COP', '4000')], new CacheTasasEnMemoria(), reloj).obtener('COP', 'USD', HOY);
    expect(tasa.valor.toString()).toBe('0.00025');
  });

  it('calcula las cruzadas vía USD (BRL → COP)', async () => {
    const proveedor = new ProveedorTasasOficiales([fuente('COP', '4000'), fuente('BRL', '5')], new CacheTasasEnMemoria(), reloj);
    const tasa = await proveedor.obtener('BRL', 'COP', HOY);
    expect(tasa.valor.toString()).toBe('800');
    expect(tasa.fuente).toBe('BCE 2026-10-16+TRM 2026-10-16');
  });

  it('cotiza un viaje futuro con la TRM de hoy', async () => {
    const trm = fuente('COP', '4000');
    await new ProveedorTasasOficiales([trm], new CacheTasasEnMemoria(), reloj).obtener('USD', 'COP', FechaCalendario.of('2026-12-01'));
    expect(trm.cotizar).toHaveBeenCalledWith('COP', HOY);
  });

  it('una fecha pasada se consulta una sola vez (caché)', async () => {
    const trm = fuente('COP', '4000', () => '2026-10-09');
    const proveedor = new ProveedorTasasOficiales([trm], new CacheTasasEnMemoria(), reloj);
    await proveedor.obtener('USD', 'COP', FechaCalendario.of('2026-10-11'));
    await proveedor.obtener('USD', 'COP', FechaCalendario.of('2026-10-11'));
    expect(trm.cotizar).toHaveBeenCalledTimes(1);
  });

  it('hoy sin TRM nueva publicada usa la anterior pero vuelve a consultar después (se ajusta solo)', async () => {
    const trm = fuente('COP', '4000', () => '2026-10-15');
    const proveedor = new ProveedorTasasOficiales([trm], new CacheTasasEnMemoria(), reloj);
    await proveedor.obtener('USD', 'COP', HOY);
    await proveedor.obtener('USD', 'COP', HOY);
    expect(trm.cotizar).toHaveBeenCalledTimes(2);
  });

  it('la TRM de hoy ya publicada queda en caché', async () => {
    const trm = fuente('COP', '4000');
    const proveedor = new ProveedorTasasOficiales([trm], new CacheTasasEnMemoria(), reloj);
    await proveedor.obtener('USD', 'COP', HOY);
    await proveedor.obtener('USD', 'COP', HOY);
    expect(trm.cotizar).toHaveBeenCalledTimes(1);
  });

  it('usa las tasas configuradas para monedas sin fuente oficial, sin guardarlas', async () => {
    const cache = new CacheTasasEnMemoria();
    const tasa = await new ProveedorTasasOficiales([new FuenteTasasConfiguradas('PEN=3.75')], cache, reloj).obtener('USD', 'PEN', FechaCalendario.of('2026-10-01'));
    expect(tasa.valor.toString()).toBe('3.75');
    expect(tasa.fuente).toBe('CONFIGURADA 2026-10-01');
    expect(await cache.obtener('PEN', '2026-10-01')).toBeNull();
  });

  it('TASA_NO_DISPONIBLE si no hay fuente, si la fuente falla o si no tiene dato', async () => {
    const sinDato: FuenteTasas = { soporta: () => true, cotizar: async () => null };
    const caida: FuenteTasas = { soporta: () => true, cotizar: async () => { throw new Error('HTTP 503'); } };
    for (const fuentes of [[], [sinDato], [caida]]) {
      const error = await new ProveedorTasasOficiales(fuentes, new CacheTasasEnMemoria(), reloj).obtener('USD', 'COP', HOY).catch((e) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect(error.codigo).toBe('TASA_NO_DISPONIBLE');
    }
  });

  it('si la fuente no responde usa la última TRM guardada de hasta 5 días antes, marcada como tal', async () => {
    const cache = new CacheTasasEnMemoria();
    await cache.guardar({ moneda: 'COP', fecha: '2026-10-14', porDolar: '4050', fechaPublicada: '2026-10-14', fuente: 'TRM' });
    const caida: FuenteTasas = { soporta: () => true, cotizar: async () => { throw new Error('HTTP 503'); } };
    const proveedor = new ProveedorTasasOficiales([caida], cache, reloj);
    const tasa = await proveedor.obtener('USD', 'COP', HOY);
    expect(tasa.valor.toString()).toBe('4050');
    expect(tasa.fuente).toBe('TRM (última disponible) 2026-10-14');
    const soloVieja = new CacheTasasEnMemoria();
    await soloVieja.guardar({ moneda: 'COP', fecha: '2026-10-05', porDolar: '4000', fechaPublicada: '2026-10-05', fuente: 'TRM' });
    const error = await new ProveedorTasasOficiales([caida], soloVieja, reloj).obtener('USD', 'COP', HOY).catch((e) => e);
    expect(error).toBeInstanceOf(DomainError);
  });

  it('la misma moneda no consulta nada', async () => {
    const tasa = await new ProveedorTasasOficiales([], new CacheTasasEnMemoria(), reloj).obtener('COP', 'COP', HOY);
    expect(tasa.valor.toString()).toBe('1');
  });
});
