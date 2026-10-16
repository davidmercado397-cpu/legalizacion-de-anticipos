import { Money } from '@viaticos/shared-kernel';
import { describe, expect, it } from 'vitest';
import { clasificarLinea, liquidarLineas, tipoDeLinea, type LineaSoporte } from './lineas';
import { EXCLUSIONES_POR_DEFECTO, ReglaExclusion } from './reglas-exclusion';

const reglas = EXCLUSIONES_POR_DEFECTO.map((c) => new ReglaExclusion(c));
const cop = (n: number) => Money.of(n, 'COP');
const clasificar = (lineas: Array<[string, number]>, hayPropinaSugerida = false): LineaSoporte[] =>
  lineas.map(([descripcion, valor]) => clasificarLinea({ descripcion, valor: cop(valor) }, reglas, hayPropinaSugerida));
const excluido = (l: ReturnType<typeof liquidarLineas>) => l.map((x) => Number(x.valorExcluido.monto));

describe('tipoDeLinea', () => {
  it.each([
    ['IVA 19%', 'IMPUESTO'],
    ['Impoconsumo 8%', 'IMPUESTO'],
    ['ICMS', 'IMPUESTO'],
    ['Sales tax', 'IMPUESTO'],
    ['Propina sugerida', 'PROPINA'],
    ['Taxa de serviço 10%', 'PROPINA'],
    ['Tip', 'PROPINA'],
    ['Servicio de lavandería', 'GASTO'],
    ['Bandeja paisa', 'GASTO'],
  ])('%s → %s', (descripcion, tipo) => {
    expect(tipoDeLinea(descripcion)).toBe(tipo);
  });
});

describe('liquidarLineas', () => {
  it('excluye el impuesto en proporción a los gastos excluidos (el IVA de la cerveza)', () => {
    // Gastos 100.000, de los que 20.000 son cerveza → 20 % del IVA (19.000) = 3.800
    const lineas = clasificar([
      ['Bandeja paisa', 80_000],
      ['2 Cerveza Club Colombia', 20_000],
      ['IVA 19%', 19_000],
    ]);
    expect(excluido(liquidarLineas(lineas, null))).toEqual([0, 20_000, 3_800]);
    expect(liquidarLineas(lineas, null)[2]!.explicacion).toBe('Impuesto de las líneas excluidas');
  });

  it('acepta la propina hasta la sugerida en la factura y excluye el exceso', () => {
    const lineas = clasificar(
      [
        ['Almuerzo ejecutivo', 100_000],
        ['Propina', 15_000],
      ],
      true,
    );
    expect(excluido(liquidarLineas(lineas, cop(10_000)))).toEqual([0, 5_000]);
    expect(excluido(liquidarLineas(lineas, cop(20_000)))).toEqual([0, 0]);
  });

  it('una propina sin valor sugerido queda por verificar y contabilidad decide', () => {
    const [comida, propina] = clasificar([
      ['Almuerzo ejecutivo', 100_000],
      ['Propina', 15_000],
    ]);
    expect(propina!.porVerificar).toBe('Propina sin valor sugerido en la factura');
    expect(excluido(liquidarLineas([comida!, propina!], null))).toEqual([0, 0]);
    expect(excluido(liquidarLineas([comida!, { ...propina!, decisionContable: 'EXCLUIR' }], null))).toEqual([0, 15_000]);
  });

  it('una palabra ambigua no excluye sola: queda por verificar', () => {
    const [pizza, cerveza] = clasificar([
      ['Pizza margarita', 40_000],
      ['Cerveza artesanal', 15_000],
    ]);
    expect(pizza).toMatchObject({ motivoExclusion: null, porVerificar: 'Posible bebidas alcohólicas' });
    expect(cerveza).toMatchObject({ motivoExclusion: 'Bebidas alcohólicas', porVerificar: null });
    expect(excluido(liquidarLineas([pizza!, cerveza!], null))).toEqual([0, 15_000]);
    expect(excluido(liquidarLineas([{ ...pizza!, decisionContable: 'ACEPTAR' }, cerveza!], null))).toEqual([0, 15_000]);
  });

  it('excluye cine, películas y spa, pero no la lavandería', () => {
    const lineas = clasificar([
      ['Película en habitación', 30_000],
      ['Masaje relajante spa', 120_000],
      ['Servicio de lavandería', 25_000],
    ]);
    expect(lineas.map((l) => l.motivoExclusion)).toEqual(['Películas y entretenimiento', 'Spa y bienestar', null]);
  });
});
