import { describe, expect, it } from 'vitest';
import { normalizarIdentificacionTributaria, normalizarNumeroDocumento } from './normalizacion';

describe('normalizarIdentificacionTributaria', () => {
  it.each([
    ['900.123.456-7', '900123456'],
    ['900123456', '900123456'],
    [' 900 123 456 - 7 ', '900123456'],
    ['12.345.678/0001-90', '12345678000190'],
    ['us-12-3456789', 'US123456789'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarIdentificacionTributaria(entrada)).toBe(esperado);
  });

  it('devuelve null si no hay dato', () => {
    expect(normalizarIdentificacionTributaria('')).toBeNull();
    expect(normalizarIdentificacionTributaria(undefined)).toBeNull();
  });
});

describe('normalizarNumeroDocumento', () => {
  it.each([
    ['FE-000123', 'FE123'],
    ['fe 123', 'FE123'],
    ['FE123', 'FE123'],
    ['000456', '456'],
    ['SETP-990000001', 'SETP990000001'],
    ['A1B2', 'A1B2'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarNumeroDocumento(entrada)).toBe(esperado);
  });
});
