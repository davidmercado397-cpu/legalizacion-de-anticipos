import { DomainError, FechaCalendario, Money } from '@viaticos/shared-kernel';

export const FORMATOS_FECHA = ['DD/MM/AAAA', 'MM/DD/AAAA', 'AAAA-MM-DD', 'DD/MM/AA', 'AAAAMMDD'] as const;
export type FormatoFecha = (typeof FORMATOS_FECHA)[number];

/**
 * Cómo leer el extracto de un banco: qué columna es qué y cómo vienen fechas y números.
 * Sirve para cualquier banco; contabilidad lo guarda con un nombre y lo reutiliza.
 */
export interface PerfilExtracto {
  /** Fila (desde 1) donde están los títulos de las columnas. */
  filaEncabezado: number;
  columnas: {
    fecha: number;
    descripcion: number;
    referencia: number | null;
    /** Una sola columna con signo, o bien débito y crédito por separado. */
    valor: number | null;
    debito: number | null;
    credito: number | null;
  };
  formatoFecha: FormatoFecha;
  separadorDecimal: ',' | '.';
  /** Solo con columna `valor`: cómo se distinguen los cargos. */
  signoCargos: 'NEGATIVO' | 'POSITIVO';
  moneda: string;
}

export interface MovimientoLeido {
  fila: number;
  fecha: FechaCalendario;
  descripcion: string;
  referencia: string | null;
  /** Siempre positivo; el tipo indica el sentido. */
  valor: Money;
  tipo: 'DEBITO' | 'CREDITO';
}

export interface ResultadoLectura {
  movimientos: MovimientoLeido[];
  /** Filas que parecían movimientos pero no se pudieron leer (para avisar, no para fallar). */
  omitidas: Array<{ fila: number; motivo: string }>;
}

export function validarPerfil(perfil: PerfilExtracto): void {
  const { valor, debito, credito } = perfil.columnas;
  if (valor === null && debito === null) {
    throw new DomainError('PERFIL_INVALIDO', 'VALIDACION', 'Indique la columna del valor, o las de débito y crédito');
  }
  if (valor !== null && (debito !== null || credito !== null)) {
    throw new DomainError('PERFIL_INVALIDO', 'VALIDACION', 'Use una columna de valor, o columnas de débito y crédito, pero no ambas');
  }
}

/** Convierte las filas del archivo en movimientos según el perfil. */
export function leerMovimientos(filas: readonly (readonly string[])[], perfil: PerfilExtracto): ResultadoLectura {
  validarPerfil(perfil);
  const movimientos: MovimientoLeido[] = [];
  const omitidas: ResultadoLectura['omitidas'] = [];
  const celda = (fila: readonly string[], i: number | null) => (i === null ? '' : (fila[i] ?? '').trim());

  filas.forEach((fila, indice) => {
    const numeroFila = indice + 1;
    if (numeroFila <= perfil.filaEncabezado || fila.every((c) => !c.trim())) return;
    const textoFecha = celda(fila, perfil.columnas.fecha);
    const fecha = leerFecha(textoFecha, perfil.formatoFecha);
    if (!fecha) {
      // Totales, saldos y pies de página no tienen fecha: se ignoran en silencio.
      if (textoFecha) omitidas.push({ fila: numeroFila, motivo: `Fecha no reconocida: "${textoFecha}"` });
      return;
    }
    let monto: string | null;
    let tipo: 'DEBITO' | 'CREDITO';
    if (perfil.columnas.valor !== null) {
      const v = leerNumero(celda(fila, perfil.columnas.valor), perfil.separadorDecimal);
      if (v === null) {
        omitidas.push({ fila: numeroFila, motivo: 'Valor no reconocido' });
        return;
      }
      const negativo = v.startsWith('-');
      monto = negativo ? v.slice(1) : v;
      tipo = negativo === (perfil.signoCargos === 'NEGATIVO') ? 'DEBITO' : 'CREDITO';
    } else {
      const debito = leerNumero(celda(fila, perfil.columnas.debito), perfil.separadorDecimal);
      const credito = leerNumero(celda(fila, perfil.columnas.credito), perfil.separadorDecimal);
      const esDebito = debito !== null && Number(debito) !== 0;
      monto = esDebito ? debito!.replace(/^-/, '') : (credito?.replace(/^-/, '') ?? null);
      tipo = esDebito ? 'DEBITO' : 'CREDITO';
      if (monto === null) {
        omitidas.push({ fila: numeroFila, motivo: 'Sin valor de débito ni de crédito' });
        return;
      }
    }
    if (Number(monto) === 0) return;
    movimientos.push({
      fila: numeroFila,
      fecha,
      descripcion: celda(fila, perfil.columnas.descripcion).replace(/\s+/g, ' ') || '(sin descripción)',
      referencia: celda(fila, perfil.columnas.referencia) || null,
      valor: Money.of(monto, perfil.moneda),
      tipo,
    });
  });
  return { movimientos, omitidas };
}

/**
 * Lee un número escrito como en el banco: "1.234.567,89", "1,234.56", "$ -45.000",
 * "(1.200,00)" o "1.200,00-". Devuelve un decimal con punto, o null.
 */
export function leerNumero(texto: string, separadorDecimal: ',' | '.'): string | null {
  let t = texto.trim();
  if (!t) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (/-\s*$/.test(t)) {
    negativo = true;
    t = t.replace(/-\s*$/, '');
  }
  t = t.replace(/[A-Za-z$€£R\s ]/g, '');
  if (t.startsWith('-')) {
    negativo = !negativo;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  const miles = separadorDecimal === ',' ? '.' : ',';
  t = t.split(miles).join('');
  if (separadorDecimal === ',') t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return negativo && Number(t) !== 0 ? `-${t}` : t;
}

/** Fecha según el formato del perfil. Las fechas ISO (AAAA-MM-DD, como las de Excel) se aceptan siempre. */
export function leerFecha(texto: string, formato: FormatoFecha): FechaCalendario | null {
  const t = texto.trim().split(/[ T]/)[0] ?? '';
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  let partes: [string, string, string] | null = iso ? [iso[1]!, iso[2]!, iso[3]!] : null;
  if (!partes) {
    if (formato === 'AAAAMMDD') {
      const m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
      partes = m ? [m[1]!, m[2]!, m[3]!] : null;
    } else {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
      if (m) {
        const anio = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
        partes = formato === 'MM/DD/AAAA' ? [anio, m[1]!, m[2]!] : [anio, m[2]!, m[1]!];
      }
    }
  }
  if (!partes) return null;
  const [a, m, d] = partes;
  try {
    return FechaCalendario.of(`${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  } catch {
    return null;
  }
}
