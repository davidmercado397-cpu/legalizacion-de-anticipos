import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { LectorTabularArchivos, leerCsv } from './lector-tabular';

const lector = new LectorTabularArchivos();

describe('LectorTabularArchivos', () => {
  it('CSV con punto y coma, comillas y saltos de línea Windows', async () => {
    const csv = 'Fecha;Descripción;Valor\r\n03/10/2026;"COMPRA ""POS"" CAFÉ; CENTRO";-45.230,50\r\n';
    expect(await lector.leer(Buffer.from(csv, 'utf8'), 'extracto.csv')).toEqual([
      ['Fecha', 'Descripción', 'Valor'],
      ['03/10/2026', 'COMPRA "POS" CAFÉ; CENTRO', '-45.230,50'],
    ]);
  });

  it('detecta Windows-1252 (exportado desde Excel en español)', async () => {
    const latin1 = Buffer.from('Fecha,Descripción\n03/10/2026,CAFÉ\n', 'latin1');
    expect((await lector.leer(latin1, 'x.txt'))[1]).toEqual(['03/10/2026', 'CAFÉ']);
  });

  it('detecta tabuladores y comas', () => {
    expect(leerCsv('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(leerCsv('a,b\n"1,5",2')).toEqual([['a', 'b'], ['1,5', '2']]);
  });

  it('Excel: fechas a AAAA-MM-DD y números con punto decimal', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Movimientos');
    hoja.addRow(['Fecha', 'Descripción', 'Valor']);
    hoja.addRow([new Date(Date.UTC(2026, 9, 3)), 'UBER', -45230.5]);
    const contenido = Buffer.from(await libro.xlsx.writeBuffer());
    expect(await lector.leer(contenido, 'extracto.xlsx')).toEqual([
      ['Fecha', 'Descripción', 'Valor'],
      ['2026-10-03', 'UBER', '-45230.5'],
    ]);
  });

  it('PDF y .xls antiguos se rechazan con un mensaje claro', async () => {
    await expect(lector.leer(Buffer.from('%PDF-1.7'), 'x.pdf')).rejects.toThrow('.csv, .txt o .xlsx');
    await expect(lector.leer(Buffer.from('xx'), 'x.xls')).rejects.toThrow('.xlsx o .csv');
  });
});
