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

  it('los viajes de directivos (sin jefe inmediato) los aprueba la gerencia', () => {
    const directivo = { viajeroId: 'd', jefeInmediatoId: null, jefeDirectivoId: null, gerenciaId: 'g' };
    expect(niveles(RutaAprobacion.construir(directivo, false))).toEqual(['GERENCIA:g']);
    expect(niveles(RutaAprobacion.construir(directivo, true))).toEqual(['GERENCIA:g']);
    // Sin jefe directivo asignado, el escalamiento va a la gerencia.
    expect(niveles(RutaAprobacion.construir({ ...aprobadores, jefeDirectivoId: null, gerenciaId: 'g' }, true))).toEqual([
      'JEFE_INMEDIATO:j',
      'GERENCIA:g',
    ]);
  });

  it('nadie aprueba su propio viaje: sin otro aprobador, no se puede crear la ruta', () => {
    expect(() => RutaAprobacion.construir({ viajeroId: 'g', jefeInmediatoId: null, jefeDirectivoId: null, gerenciaId: 'g' }, false)).toThrowError(
      /No hay quién apruebe/,
    );
    expect(niveles(RutaAprobacion.construir({ ...aprobadores, jefeInmediatoId: 'v', gerenciaId: 'g' }, false))).toEqual(['GERENCIA:g']);
    expect(() => RutaAprobacion.construir({ ...aprobadores, jefeDirectivoId: null }, true)).toThrowError(/No hay quién apruebe/);
  });

  it('en orden: el jefe inmediato y luego el directivo', () => {
    const ruta = RutaAprobacion.construir(aprobadores, true);
    expect(() => ruta.aprobar('x', new Date(), null)).toThrowError(/No le corresponde/);
    ruta.aprobar('j', new Date(), null);
    expect(ruta.esAprobadorActual('d')).toBe(true);
    ruta.aprobar('d', new Date(), 'ok');
    expect(ruta.estaCompleta()).toBe(true);
    expect(() => ruta.aprobar('d', new Date(), null)).toThrowError(/no tiene aprobaciones pendientes/);
  });

  it('el directivo puede aprobar sin esperar al jefe inmediato: la ruta queda completa', () => {
    const ruta = RutaAprobacion.construir(aprobadores, true);
    expect(ruta.esAprobadorActual('j')).toBe(true);
    expect(ruta.esAprobadorActual('d')).toBe(true);
    ruta.aprobar('d', new Date(), 'Aprobado por dirección');
    expect(ruta.estaCompleta()).toBe(true);
    expect(ruta.pasosSnapshot.map((p) => p.estado)).toEqual(['OMITIDO', 'APROBADO']);
    expect(ruta.esAprobadorActual('j')).toBe(false);
  });

  it('el rechazo exige comentario y cierra la ruta', () => {
    const ruta = RutaAprobacion.construir(aprobadores, true);
    expect(() => ruta.rechazar('j', new Date(), 'no')).toThrowError(/explicar el motivo/);
    ruta.rechazar('j', new Date(), 'Fechas no coinciden con el evento');
    expect(ruta.pasoActual()).toBeNull();
    expect(ruta.estaCompleta()).toBe(false);
  });
});
