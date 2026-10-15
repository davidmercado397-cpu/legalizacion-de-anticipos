import { describe, expect, it } from 'vitest';
import { CHAVE_VALIDA, CUFE } from '../../test-support/claves';
import { DetectorDuplicados, type ComprobanteRegistrado } from './detector-duplicados';
import { HuellaComprobante, distanciaHamming, type DatosHuella } from './huella-comprobante';

const sha = (n: number) => n.toString(16).padStart(64, '0');
const huella = (datos: Partial<DatosHuella>) => HuellaComprobante.crear({ sha256: sha(1), ...datos });
const registrado = (id: string, datos: Partial<DatosHuella>): ComprobanteRegistrado => ({
  comprobanteId: id,
  viajeroId: `viajero-${id}`,
  huella: huella(datos),
});

const detector = new DetectorDuplicados();

describe('DetectorDuplicados', () => {
  it('UNICO cuando no hay coincidencias', () => {
    const r = detector.evaluar(huella({ sha256: sha(1) }), [registrado('c1', { sha256: sha(2) })]);
    expect(r).toEqual({ veredicto: 'UNICO', coincidencias: [] });
  });

  it('DUPLICADO por archivo idéntico (incluso de otro viajero)', () => {
    const r = detector.evaluar(huella({ sha256: sha(7) }), [registrado('c1', { sha256: sha(7) })]);
    expect(r.veredicto).toBe('DUPLICADO');
    expect(r.coincidencias[0]).toMatchObject({ codigo: 'ARCHIVO_IDENTICO', comprobanteId: 'c1', viajeroId: 'viajero-c1' });
  });

  it('DUPLICADO por CUFE repetido aunque sea otra foto', () => {
    const r = detector.evaluar(huella({ sha256: sha(1), claveFiscal: { tipo: 'CUFE', valor: CUFE.toUpperCase() } }), [
      registrado('c1', { sha256: sha(2), claveFiscal: { tipo: 'CUFE', valor: CUFE } }),
    ]);
    expect(r.veredicto).toBe('DUPLICADO');
    expect(r.coincidencias.map((c) => c.codigo)).toEqual(['CLAVE_FISCAL_REPETIDA']);
  });

  it('DUPLICADO por chave de acesso de Brasil repetida', () => {
    const r = detector.evaluar(huella({ claveFiscal: { tipo: 'CHAVE_ACESSO_BR', valor: CHAVE_VALIDA } }), [
      registrado('c1', { sha256: sha(2), claveFiscal: { tipo: 'CHAVE_ACESSO_BR', valor: CHAVE_VALIDA } }),
    ]);
    expect(r.veredicto).toBe('DUPLICADO');
  });

  it('DUPLICADO por emisor + número aunque el OCR los lea con formato distinto', () => {
    const r = detector.evaluar(huella({ emisorId: '900.123.456-7', numeroDocumento: 'FE-000123' }), [
      registrado('c1', { sha256: sha(2), emisorId: '900123456', numeroDocumento: 'fe 123' }),
    ]);
    expect(r.veredicto).toBe('DUPLICADO');
    expect(r.coincidencias[0]!.codigo).toBe('EMISOR_Y_NUMERO_REPETIDOS');
  });

  it('SOSPECHOSO por imagen casi idéntica (otra foto del mismo papel)', () => {
    const r = detector.evaluar(huella({ hashPerceptual: 'ffffffffffffff00' }), [
      registrado('c1', { sha256: sha(2), hashPerceptual: 'ffffffffffffff0f' }),
      registrado('c2', { sha256: sha(3), hashPerceptual: '0000000000000000' }),
    ]);
    expect(r.veredicto).toBe('SOSPECHOSO');
    expect(r.coincidencias.map((c) => c.comprobanteId)).toEqual(['c1']);
  });

  it('SOSPECHOSO por mismo emisor, fecha y total con distinto número', () => {
    const base = { emisorId: '900123456', fecha: '2026-11-03', total: { monto: '85000', moneda: 'COP' } };
    const r = detector.evaluar(huella({ ...base, numeroDocumento: 'FE-124' }), [
      registrado('c1', { ...base, sha256: sha(2), numeroDocumento: 'FE-123' }),
    ]);
    expect(r).toMatchObject({ veredicto: 'SOSPECHOSO', coincidencias: [{ codigo: 'EMISOR_FECHA_TOTAL_IGUALES' }] });
  });

  it('las coincidencias bloqueantes se listan primero', () => {
    const r = detector.evaluar(huella({ sha256: sha(9), hashPerceptual: 'ffffffffffffffff' }), [
      registrado('c1', { sha256: sha(2), hashPerceptual: 'ffffffffffffffff' }),
      registrado('c2', { sha256: sha(9) }),
    ]);
    expect(r.coincidencias.map((c) => c.severidad)).toEqual(['BLOQUEANTE', 'SOSPECHOSA']);
  });

  it('no compara un comprobante consigo mismo al re-verificarlo', () => {
    const r = detector.evaluar(huella({ sha256: sha(5) }), [registrado('c1', { sha256: sha(5) })], 'c1');
    expect(r.veredicto).toBe('UNICO');
  });
});

describe('distanciaHamming', () => {
  it('cuenta los bits distintos', () => {
    expect(distanciaHamming('0000000000000000', '0000000000000000')).toBe(0);
    expect(distanciaHamming('0000000000000000', '000000000000000f')).toBe(4);
    expect(distanciaHamming('ffffffffffffffff', '0000000000000000')).toBe(64);
  });
});
