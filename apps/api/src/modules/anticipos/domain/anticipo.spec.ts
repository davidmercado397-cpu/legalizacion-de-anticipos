import { describe, expect, it } from 'vitest';
import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import { Anticipo } from './anticipo';

const ahora = new Date('2026-10-20T15:00:00Z');
const nuevo = () =>
  Anticipo.crearDesdeSolicitud({
    id: 'a1',
    solicitudId: 's1',
    viajeroId: 'ana',
    monto: Money.of(475, 'USD'),
    viaje: {
      motivo: 'Cliente',
      destinos: [
        { paisCodigo: 'BR', ciudad: 'São Paulo', fechaInicio: '2026-11-02', fechaFin: '2026-11-06' },
        { paisCodigo: 'CO', ciudad: 'Bogotá', fechaInicio: '2026-11-06', fechaFin: '2026-11-08' },
      ],
    },
    ahora,
  });

const desembolsar = (a: Anticipo, tesoreroId = 'tomas', fecha = '2026-10-20') =>
  a.registrarDesembolso({ fecha: FechaCalendario.of(fecha), medio: 'TRANSFERENCIA', referencia: 'TR-1', tesoreroId, ahora });

describe('Anticipo', () => {
  it('nace pendiente de registrar en el ERP', () => {
    expect(nuevo().estado).toBe('PENDIENTE_ERP');
  });

  it('un fallo del ERP queda registrado y se puede reintentar', () => {
    const a = nuevo();
    a.falloRegistroErp('Timeout', ahora);
    expect(a.erp).toMatchObject({ ultimoError: 'Timeout', intentos: 1 });
    a.registradoEnErp('SIESA-001', ahora);
    expect(a.estado).toBe('POR_DESEMBOLSAR');
    expect(a.erp).toMatchObject({ referencia: 'SIESA-001', ultimoError: null, intentos: 2 });
  });

  it('no se puede desembolsar antes de registrarlo en el ERP', () => {
    expect(() => desembolsar(nuevo())).toThrowError(/PENDIENTE_ERP/);
  });

  it('el desembolso habilita la legalización y emite un evento', () => {
    const a = nuevo();
    a.registradoEnErp('SIESA-001', ahora);
    desembolsar(a);
    expect(a.estado).toBe('DESEMBOLSADO');
    expect(a.extraerEventos().map((e) => e.tipo)).toEqual(['anticipos.AnticipoDesembolsado']);
  });

  it('nadie desembolsa su propio anticipo, ni con fecha futura', () => {
    const a = nuevo();
    a.registradoEnErp('SIESA-001', ahora);
    expect(() => desembolsar(a, 'ana')).toThrowError(/propio anticipo/);
    expect(() => desembolsar(a, 'tomas', '2026-12-01')).toThrowError(/futura/);
  });

  it('calcula el rango de fechas de todo el viaje', () => {
    const { inicio, fin } = nuevo().rangoViaje;
    expect([inicio.toString(), fin.toString()]).toEqual(['2026-11-02', '2026-11-08']);
  });
});
