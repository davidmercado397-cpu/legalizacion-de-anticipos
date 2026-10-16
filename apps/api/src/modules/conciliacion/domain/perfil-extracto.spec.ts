import { describe, expect, it } from 'vitest';
import { leerFecha, leerMovimientos, leerNumero, type PerfilExtracto } from './perfil-extracto';
import { sugerirPerfil } from './sugerir-perfil';

describe('leerNumero', () => {
  it.each([
    ['1.234.567,89', ',', '1234567.89'],
    ['$ -45.000', ',', '-45000'],
    ['(1.200,50)', ',', '-1200.50'],
    ['1.200,00-', ',', '-1200.00'],
    ['1,234.56', '.', '1234.56'],
    ['-12.5', '.', '-12.5'],
    ['R$ 89,90', ',', '89.90'],
    ['COP 50.000', ',', '50000'],
    ['abc', ',', null],
    ['', ',', null],
  ] as const)('%s con separador %s → %s', (texto, sep, esperado) => {
    expect(leerNumero(texto, sep)).toBe(esperado);
  });
});

describe('leerFecha', () => {
  it('lee el formato del perfil y siempre acepta ISO', () => {
    expect(leerFecha('05/10/2026', 'DD/MM/AAAA')?.toString()).toBe('2026-10-05');
    expect(leerFecha('10/05/2026', 'MM/DD/AAAA')?.toString()).toBe('2026-10-05');
    expect(leerFecha('05-10-26', 'DD/MM/AA')?.toString()).toBe('2026-10-05');
    expect(leerFecha('20261005', 'AAAAMMDD')?.toString()).toBe('2026-10-05');
    expect(leerFecha('2026-10-05', 'DD/MM/AAAA')?.toString()).toBe('2026-10-05');
    expect(leerFecha('2026-10-05T00:00:00', 'DD/MM/AAAA')?.toString()).toBe('2026-10-05');
  });

  it('rechaza textos que no son fechas o fechas imposibles', () => {
    expect(leerFecha('SALDO FINAL', 'DD/MM/AAAA')).toBeNull();
    expect(leerFecha('31/02/2026', 'DD/MM/AAAA')).toBeNull();
  });
});

const BANCOLOMBIA: string[][] = [
  ['BANCO X - EXTRACTO TARJETA DÉBITO'],
  ['Fecha', 'Descripción', 'Referencia', 'Valor'],
  ['03/10/2026', 'COMPRA POS STARBUCKS COFFEE SAO PAULO', '123', '-45.230,50'],
  ['04/10/2026', 'ABONO NOMINA', '', '2.000.000,00'],
  ['', '', '', ''],
  ['SALDO FINAL', '', '', '1.954.769,50'],
];

describe('leerMovimientos', () => {
  const perfil: PerfilExtracto = {
    filaEncabezado: 2,
    columnas: { fecha: 0, descripcion: 1, referencia: 2, valor: 3, debito: null, credito: null },
    formatoFecha: 'DD/MM/AAAA',
    separadorDecimal: ',',
    signoCargos: 'NEGATIVO',
    moneda: 'COP',
  };

  it('convierte filas en cargos y abonos positivos, e ignora títulos, vacías y totales', () => {
    const { movimientos, omitidas } = leerMovimientos(BANCOLOMBIA, perfil);
    expect(movimientos.map((m) => [m.fila, m.fecha.toString(), m.tipo, m.valor.monto])).toEqual([
      [3, '2026-10-03', 'DEBITO', '45230.50'],
      [4, '2026-10-04', 'CREDITO', '2000000.00'],
    ]);
    expect(movimientos[0]!.referencia).toBe('123');
    expect(omitidas).toEqual([{ fila: 6, motivo: 'Fecha no reconocida: "SALDO FINAL"' }]);
  });

  it('con signo POSITIVO los cargos son los valores positivos', () => {
    const { movimientos } = leerMovimientos(BANCOLOMBIA, { ...perfil, signoCargos: 'POSITIVO' });
    expect(movimientos.map((m) => m.tipo)).toEqual(['CREDITO', 'DEBITO']);
  });

  it('lee columnas separadas de débito y crédito', () => {
    const filas = [
      ['Data', 'Histórico', 'Débito', 'Crédito'],
      ['03/10/2026', 'PADARIA REAL', '89,90', ''],
      ['04/10/2026', 'PIX RECEBIDO', '', '100,00'],
    ];
    const { movimientos } = leerMovimientos(filas, {
      ...perfil,
      filaEncabezado: 1,
      columnas: { fecha: 0, descripcion: 1, referencia: null, valor: null, debito: 2, credito: 3 },
      moneda: 'BRL',
    });
    expect(movimientos.map((m) => [m.tipo, m.valor.toDto()])).toEqual([
      ['DEBITO', { monto: '89.90', moneda: 'BRL' }],
      ['CREDITO', { monto: '100.00', moneda: 'BRL' }],
    ]);
  });

  it('exige una columna de valor o la de débito', () => {
    expect(() => leerMovimientos(BANCOLOMBIA, { ...perfil, columnas: { ...perfil.columnas, valor: null } })).toThrow('columna del valor');
  });
});

describe('sugerirPerfil', () => {
  it('encuentra la fila de títulos, las columnas y los formatos de un banco colombiano', () => {
    const { perfil, confianza } = sugerirPerfil(BANCOLOMBIA);
    expect(confianza).toBe('ALTA');
    expect(perfil).toMatchObject({
      filaEncabezado: 2,
      columnas: { fecha: 0, descripcion: 1, referencia: 2, valor: 3, debito: null, credito: null },
      formatoFecha: 'DD/MM/AAAA',
      separadorDecimal: ',',
      moneda: 'COP',
    });
  });

  it('reconoce débito/crédito en portugués y montos con punto decimal (formato EE. UU.)', () => {
    const br = sugerirPerfil([['Data', 'Descrição', 'Débito', 'Crédito'], ['03/10/2026', 'X', '89,90', '']], 'BRL');
    expect(br.perfil.columnas).toMatchObject({ fecha: 0, descripcion: 1, debito: 2, credito: 3, valor: null });

    const us = sugerirPerfil([['Posting Date', 'Description', 'Amount'], ['10/13/2026', 'UBER', '-1,234.56'], ['10/20/2026', 'HOTEL', '-89.10']], 'USD');
    expect(us.perfil).toMatchObject({ formatoFecha: 'MM/DD/AAAA', separadorDecimal: '.', columnas: { valor: 2 } });
  });

  it('sin títulos reconocibles avisa con confianza BAJA', () => {
    expect(sugerirPerfil([['a', 'b'], ['1', '2']]).confianza).toBe('BAJA');
  });
});
