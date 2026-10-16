import { FechaCalendario, Money } from '@viaticos/shared-kernel';
import { describe, expect, it } from 'vitest';
import { Extracto } from './extracto';
import type { PerfilExtracto } from './perfil-extracto';

const AHORA = new Date('2026-10-16T12:00:00Z');
const perfil = {} as PerfilExtracto;
const mov = (id: string, tipo: 'DEBITO' | 'CREDITO' = 'DEBITO') => ({
  id,
  fila: 1,
  fecha: FechaCalendario.of('2026-10-03'),
  descripcion: 'X',
  referencia: null,
  valor: Money.of('100', 'COP'),
  tipo,
});
const nuevo = (movimientos = [mov('m1'), mov('m2'), mov('a1', 'CREDITO')]) =>
  Extracto.cargar({
    id: 'e1',
    titularId: 'u1',
    legalizacionId: 'L1',
    ultimos4: '1234',
    moneda: 'COP',
    archivo: { nombre: 'x.csv', sha256: 'h' },
    perfil,
    movimientos,
    cargadoPor: 'u1',
    cargadoEn: AHORA,
  });
const propuesta = (movimientoId: string, soporteId: string, estado: 'AUTOMATICO' | 'SUGERIDO' = 'AUTOMATICO') => ({
  movimientoId,
  soporteId,
  legalizacionId: 'L1',
  puntaje: 0.9,
  estado,
  montoSoporte: Money.of('100', 'COP'),
});

describe('Extracto', () => {
  it('exige al menos un cargo y últimos 4 dígitos válidos', () => {
    expect(() => nuevo([mov('a', 'CREDITO')])).toThrow('no tiene cargos');
    expect(() => Extracto.cargar({ ...nuevo().toSnapshot(), ultimos4: '12' })).toThrow('4 números');
  });

  it('el recálculo conserva lo que decidió contabilidad y reemplaza lo automático', () => {
    const e = nuevo();
    e.aplicarPropuestas([propuesta('m1', 's1'), propuesta('m2', 's2', 'SUGERIDO')], AHORA);
    e.confirmar('m1', 'conta', AHORA);
    e.aplicarPropuestas([propuesta('m1', 's9'), propuesta('m2', 's1')], AHORA);
    expect(e.cruces.map((c) => [c.movimientoId, c.soporteId, c.estado])).toEqual([['m1', 's1', 'CONFIRMADO']]);
  });

  it('rechazar deshace el cruce y lo recuerda; enlazar a mano reemplaza propuestas', () => {
    const e = nuevo();
    e.aplicarPropuestas([propuesta('m1', 's1'), propuesta('m2', 's2')], AHORA);
    e.rechazar('m1', AHORA);
    expect(e.paresRechazados()).toEqual(new Set(['m1|s1']));
    e.enlazar('m1', { soporteId: 's2', legalizacionId: 'L1', montoSoporte: null }, 'conta', AHORA);
    expect(e.cruces.map((c) => [c.movimientoId, c.soporteId, c.estado])).toEqual([['m1', 's2', 'MANUAL']]);
    expect(() => e.enlazar('a1', { soporteId: 's3', legalizacionId: 'L1', montoSoporte: null }, 'conta', AHORA)).toThrow('Solo los cargos');
    expect(() => e.enlazar('m1', { soporteId: 's3', legalizacionId: 'L1', montoSoporte: null }, 'conta', AHORA)).toThrow('ya está cruzado');
  });

  it('el periodo va del primer al último movimiento', () => {
    const e = nuevo([{ ...mov('m1'), fecha: FechaCalendario.of('2026-10-09') }, { ...mov('m2'), fecha: FechaCalendario.of('2026-10-01') }]);
    const { desde, hasta } = e.periodo();
    expect([desde.toString(), hasta.toString()]).toEqual(['2026-10-01', '2026-10-09']);
  });
});
