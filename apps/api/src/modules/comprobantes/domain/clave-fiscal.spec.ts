import { describe, expect, it } from 'vitest';
import { BASE_CHAVE, CHAVE_VALIDA, CUFE } from '../test-support/claves';
import { ClaveFiscal, calcularDvChaveAcesso } from './clave-fiscal';

describe('ClaveFiscal', () => {
  it('normaliza el CUFE (espacios y mayúsculas)', () => {
    const conFormato = CUFE.toUpperCase().replace(/(.{32})/g, '$1 ');
    expect(ClaveFiscal.crear('CUFE', conFormato).valor).toBe(CUFE);
  });

  it('rechaza un CUFE con longitud o caracteres inválidos', () => {
    expect(() => ClaveFiscal.crear('CUFE', 'abc')).toThrowError(/CUFE/);
    expect(() => ClaveFiscal.crear('CUFE', 'z'.repeat(96))).toThrowError(/CUFE/);
  });

  it('valida el dígito verificador de la chave de acesso de Brasil', () => {
    const formateada = CHAVE_VALIDA.replace(/(\d{4})/g, '$1 ');
    expect(ClaveFiscal.crear('CHAVE_ACESSO_BR', formateada).valor).toBe(CHAVE_VALIDA);
    const dvErrado = BASE_CHAVE + ((Number(CHAVE_VALIDA[43]) + 1) % 10);
    expect(() => ClaveFiscal.crear('CHAVE_ACESSO_BR', dvErrado)).toThrowError(/dígito verificador/);
  });

  it('calcula el DV con el algoritmo módulo 11 de la SEFAZ', () => {
    // Ejemplo del Manual de Orientação do Contribuinte (NF-e)
    expect(calcularDvChaveAcesso('5206043300991100250655012000000780026730161')).toBe(5);
  });
});
