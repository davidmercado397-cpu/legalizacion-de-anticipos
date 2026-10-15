import { describe, expect, it } from 'vitest';
import { RutaAprobacion } from './ruta-aprobacion';

const aprobadores = { viajeroId: 'v', jefeInmediatoId: 'j', jefeDirectivoId: 'd' };
const niveles = (r: RutaAprobacion) => r.pasosSnapshot.map((p) => `${p.nivel}:${p.aprobadorId}`);

describe('RutaAprobacion', () => {
  it('sin escalamiento aprueba solo el jefe inmediato', () => {
    expect(niveles(RutaAprobacion.construir(aprobadores, false))).toEqual(['JEFE_INMEDIATO:j']);
  });

  it('con escalamiento aprueba el jefe inmediato y luego el directivo', () => {
    expect(niveles(RutaAprobacion.construir(aprobadores, true))).toEqual(['JEFE_INMEDIATO:j', 'JEFE_DIRECTIVO:d']);
  });

  it('si jefe inmediato y directivo son la misma persona, aprueba una sola vez', () => {
    const ruta = RutaAprobacion.construir({ ...aprobadores, jefeDirectivoId: 'j' }, true);
    expect(niveles(ruta)).toEqual(['JEFE_DIRECTIVO:j']);
  });

  it('impide la autoaprobación y exige los jefes configurados', () => {
    expect(() => RutaAprobacion.construir({ ...aprobadores, jefeInmediatoId: 'v' }, false)).toThrowError(/propio viaje/);
    expect(() => RutaAprobacion.construir({ ...aprobadores, jefeInmediatoId: null }, false)).toThrowError(/jefe inmediato/);
    expect(() => RutaAprobacion.construir({ ...aprobadores, jefeDirectivoId: null }, true)).toThrowError(/jefe directivo/);
  });

  it('solo el aprobador del paso actual puede decidir, en orden', () => {
    const ruta = RutaAprobacion.construir(aprobadores, true);
    expect(() => ruta.aprobar('d', new Date(), null)).toThrowError(/No le corresponde/);
    ruta.aprobar('j', new Date(), null);
    expect(ruta.esAprobadorActual('d')).toBe(true);
    ruta.aprobar('d', new Date(), 'ok');
    expect(ruta.estaCompleta()).toBe(true);
    expect(() => ruta.aprobar('d', new Date(), null)).toThrowError(/no tiene aprobaciones pendientes/);
  });

  it('el rechazo exige comentario y cierra la ruta', () => {
    const ruta = RutaAprobacion.construir(aprobadores, true);
    expect(() => ruta.rechazar('j', new Date(), 'no')).toThrowError(/explicar el motivo/);
    ruta.rechazar('j', new Date(), 'Fechas no coinciden con el evento');
    expect(ruta.pasoActual()).toBeNull();
    expect(ruta.estaCompleta()).toBe(false);
  });
});
