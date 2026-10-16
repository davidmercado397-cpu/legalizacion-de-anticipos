import { FechaCalendario } from '@viaticos/shared-kernel';
import { describe, expect, it, vi } from 'vitest';
import { FuenteBceFrankfurter, FuenteTasasConfiguradas, FuenteTrmDatosGov } from './fuentes-oficiales';

const respuesta = (cuerpo: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(cuerpo), { status }));

describe('FuenteTrmDatosGov', () => {
  it('pide la TRM vigente en la fecha y devuelve su valor', async () => {
    const fetch = respuesta([{ valor: '4123.45', vigenciadesde: '2026-10-10T00:00:00.000', vigenciahasta: '2026-10-13T00:00:00.000' }]);
    const c = await new FuenteTrmDatosGov(fetch).cotizar('COP', FechaCalendario.of('2026-10-12'));
    expect(c).toEqual({ moneda: 'COP', fecha: '2026-10-12', porDolar: '4123.45', fechaPublicada: '2026-10-10', fuente: 'TRM' });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.host).toBe('www.datos.gov.co');
    expect(url.searchParams.get('$where')).toBe("vigenciadesde <= '2026-10-12T00:00:00'");
    expect(url.searchParams.get('$order')).toBe('vigenciadesde DESC');
  });

  it('solo soporta COP', () => {
    const f = new FuenteTrmDatosGov(respuesta([]));
    expect(f.soporta('COP')).toBe(true);
    expect(f.soporta('BRL')).toBe(false);
  });

  it('sin registros o con valor inválido devuelve null', async () => {
    expect(await new FuenteTrmDatosGov(respuesta([])).cotizar('COP', FechaCalendario.of('2026-10-12'))).toBeNull();
    expect(await new FuenteTrmDatosGov(respuesta([{ valor: 'abc', vigenciadesde: '2026-10-10' }])).cotizar('COP', FechaCalendario.of('2026-10-12'))).toBeNull();
  });

  it('un error HTTP se propaga', async () => {
    await expect(new FuenteTrmDatosGov(respuesta({}, 503)).cotizar('COP', FechaCalendario.of('2026-10-12'))).rejects.toThrow('HTTP 503');
  });
});

describe('FuenteBceFrankfurter', () => {
  it('cotiza contra el dólar en la fecha pedida', async () => {
    const fetch = respuesta({ amount: 1, base: 'USD', date: '2026-10-09', rates: { BRL: 5.4321 } });
    const c = await new FuenteBceFrankfurter(fetch).cotizar('BRL', FechaCalendario.of('2026-10-11'));
    expect(c).toEqual({ moneda: 'BRL', fecha: '2026-10-11', porDolar: '5.4321', fechaPublicada: '2026-10-09', fuente: 'BCE' });
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.frankfurter.dev/v1/2026-10-11?base=USD&symbols=BRL');
  });

  it('solo soporta monedas publicadas por el BCE', () => {
    const f = new FuenteBceFrankfurter(respuesta({}));
    expect(['BRL', 'EUR', 'MXN'].every((m) => f.soporta(m))).toBe(true);
    expect(['USD', 'COP', 'PEN', 'CLP'].some((m) => f.soporta(m))).toBe(false);
  });

  it('sin la moneda en la respuesta devuelve null', async () => {
    expect(await new FuenteBceFrankfurter(respuesta({ date: '2026-10-09', rates: {} })).cotizar('BRL', FechaCalendario.of('2026-10-11'))).toBeNull();
  });
});

describe('FuenteTasasConfiguradas', () => {
  it('lee "MONEDA=valor" e ignora entradas inválidas', async () => {
    const f = new FuenteTasasConfiguradas('pen=3.75, CLP=950, XXX=abc');
    expect(f.soporta('PEN')).toBe(true);
    expect(f.soporta('XXX')).toBe(false);
    expect((await f.cotizar('CLP', FechaCalendario.of('2026-10-11')))?.porDolar).toBe('950');
  });
});
