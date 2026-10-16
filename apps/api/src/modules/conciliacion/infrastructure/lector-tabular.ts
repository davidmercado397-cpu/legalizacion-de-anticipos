import { DomainError } from '@viaticos/shared-kernel';
import ExcelJS from 'exceljs';
import type { LectorTabular } from '../application/puertos';

const MAXIMO_FILAS = 20_000;

/** CSV/TXT (cualquier separador y codificación) y Excel .xlsx. */
export class LectorTabularArchivos implements LectorTabular {
  async leer(contenido: Buffer, nombreArchivo: string): Promise<string[][]> {
    const extension = nombreArchivo.toLowerCase().split('.').pop() ?? '';
    const esZip = contenido.subarray(0, 2).toString('latin1') === 'PK';
    let filas: string[][];
    if (extension === 'xlsx' || esZip) filas = await leerXlsx(contenido);
    else if (extension === 'xls') {
      throw new DomainError('FORMATO_NO_SOPORTADO', 'VALIDACION', 'Guarde el archivo como .xlsx o .csv (Excel 97-2003 no es compatible)');
    } else if (extension === 'pdf' || contenido.subarray(0, 4).toString('latin1') === '%PDF') {
      throw new DomainError('FORMATO_NO_SOPORTADO', 'VALIDACION', 'Por ahora el extracto debe ser .csv, .txt o .xlsx; descárguelo así desde la banca en línea');
    } else filas = leerCsv(decodificar(contenido));
    if (filas.length > MAXIMO_FILAS) throw new DomainError('EXTRACTO_MUY_GRANDE', 'VALIDACION', `El extracto supera ${MAXIMO_FILAS} filas`);
    return filas;
  }
}

/** UTF-8 si es válido; si no, Windows-1252 (lo usual en archivos exportados desde Excel en español). */
export function decodificar(contenido: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contenido).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(contenido);
  }
}

/** CSV con comillas (RFC 4180). Detecta el separador: ; , tabulador o |. */
export function leerCsv(texto: string): string[][] {
  const separador = detectarSeparador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"' && campo === '') entreComillas = true;
    else if (c === separador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.map((f) => f.map((v) => v.trim()));
}

function detectarSeparador(texto: string): string {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let mejor = ',';
  let mejorPuntaje = -1;
  for (const s of [';', ',', '\t', '|']) {
    const conteos = lineas.map((l) => l.split(s).length - 1).filter((n) => n > 0);
    if (conteos.length === 0) continue;
    // El separador correcto aparece igual número de veces en la mayoría de las líneas.
    const moda = [...conteos].sort((a, b) => conteos.filter((x) => x === b).length - conteos.filter((x) => x === a).length)[0]!;
    const puntaje = conteos.filter((n) => n === moda).length * Math.min(moda, 10);
    if (puntaje > mejorPuntaje) {
      mejor = s;
      mejorPuntaje = puntaje;
    }
  }
  return mejor;
}

/** Primera hoja del libro. Fechas → AAAA-MM-DD y números → decimal con punto. */
async function leerXlsx(contenido: Buffer): Promise<string[][]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    throw new DomainError('ARCHIVO_ILEGIBLE', 'VALIDACION', 'No se pudo leer el archivo de Excel');
  }
  const hoja = libro.worksheets[0];
  if (!hoja) return [];
  const filas: string[][] = [];
  hoja.eachRow({ includeEmpty: true }, (row, numero) => {
    const valores: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) valores.push(textoCelda(row.getCell(c).value));
    filas[numero - 1] = valores;
  });
  return Array.from(filas, (f) => f ?? []);
}

function textoCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'object') {
    if ('result' in valor) return textoCelda(valor.result as ExcelJS.CellValue);
    if ('richText' in valor) return valor.richText.map((t) => t.text).join('');
    if ('text' in valor) return String(valor.text);
  }
  return String(valor).trim();
}
