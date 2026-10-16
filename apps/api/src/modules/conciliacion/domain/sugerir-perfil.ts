import { FORMATOS_FECHA, leerFecha, leerNumero, type FormatoFecha, type PerfilExtracto } from './perfil-extracto';

/** Palabras con que los bancos (es/pt/en) titulan sus columnas. */
const TITULOS = {
  fecha: ['fecha', 'fecha transaccion', 'fecha movimiento', 'fecha operacion', 'data', 'date', 'transaction date', 'posting date'],
  descripcion: ['descripcion', 'concepto', 'detalle', 'establecimiento', 'comercio', 'historico', 'descricao', 'description', 'merchant', 'details'],
  referencia: ['referencia', 'documento', 'numero documento', 'autorizacion', 'comprobante', 'reference', 'ref', 'documento'],
  valor: ['valor', 'monto', 'importe', 'amount', 'valor transaccion', 'movimiento'],
  debito: ['debito', 'debitos', 'cargo', 'cargos', 'retiro', 'retiros', 'egreso', 'debit', 'withdrawal', 'saida'],
  credito: ['credito', 'creditos', 'abono', 'abonos', 'deposito', 'ingreso', 'credit', 'deposit', 'entrada'],
} as const;

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function columnaDe(encabezados: string[], palabras: readonly string[], usadas: Set<number>): number | null {
  // Primero coincidencia exacta; luego que el título empiece por la palabra.
  for (const comparar of [(e: string, p: string) => e === p, (e: string, p: string) => e.startsWith(`${p} `)]) {
    for (const p of palabras) {
      const i = encabezados.findIndex((e, idx) => !usadas.has(idx) && comparar(e, p));
      if (i >= 0) return i;
    }
  }
  return null;
}

export interface SugerenciaPerfil {
  perfil: PerfilExtracto;
  /** Qué tan seguro está el sistema; con BAJA, contabilidad debe revisar el mapeo. */
  confianza: 'ALTA' | 'BAJA';
}

/** Propone el perfil mirando los títulos y una muestra de valores. Contabilidad lo revisa en la vista previa. */
export function sugerirPerfil(filas: readonly (readonly string[])[], moneda = 'COP'): SugerenciaPerfil {
  // La fila de títulos es la primera (de las 15 primeras) que nombra una fecha y un valor.
  let filaEncabezado = 0;
  let encabezados: string[] = [];
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const normalizados = filas[i]!.map(normalizar);
    const tieneFecha = columnaDe(normalizados, TITULOS.fecha, new Set()) !== null;
    const tieneValor = [TITULOS.valor, TITULOS.debito].some((p) => columnaDe(normalizados, p, new Set()) !== null);
    if (tieneFecha && tieneValor) {
      filaEncabezado = i + 1;
      encabezados = normalizados;
      break;
    }
  }

  const usadas = new Set<number>();
  const tomar = (palabras: readonly string[]) => {
    const i = columnaDe(encabezados, palabras, usadas);
    if (i !== null) usadas.add(i);
    return i;
  };
  const fecha = tomar(TITULOS.fecha) ?? 0;
  const debito = tomar(TITULOS.debito);
  const credito = debito !== null ? tomar(TITULOS.credito) : null;
  const valor = debito === null ? tomar(TITULOS.valor) : null;
  const descripcion = tomar(TITULOS.descripcion) ?? (fecha === 0 ? 1 : 0);
  const referencia = tomar(TITULOS.referencia);

  const muestra = filas.slice(filaEncabezado, filaEncabezado + 50);
  const textosFecha = muestra.map((f) => (f[fecha] ?? '').trim()).filter(Boolean);
  const columnasNumero = [valor, debito, credito].filter((c): c is number => c !== null);
  const textosNumero = muestra.flatMap((f) => columnasNumero.map((c) => (f[c] ?? '').trim())).filter(Boolean);

  const perfil: PerfilExtracto = {
    filaEncabezado,
    columnas: { fecha, descripcion, referencia, valor: debito === null ? (valor ?? 1) : null, debito, credito },
    formatoFecha: elegirFormatoFecha(textosFecha),
    separadorDecimal: elegirSeparador(textosNumero),
    signoCargos: 'NEGATIVO',
    moneda,
  };
  const confianza = filaEncabezado > 0 && (valor !== null || debito !== null) ? 'ALTA' : 'BAJA';
  return { perfil, confianza };
}

/** El formato que reconoce más fechas; si DD/MM y MM/DD empatan, gana DD/MM (uso en Colombia y Brasil). */
function elegirFormatoFecha(textos: string[]): FormatoFecha {
  let mejor: FormatoFecha = 'DD/MM/AAAA';
  let mejorCuenta = -1;
  for (const formato of FORMATOS_FECHA) {
    const cuenta = textos.filter((t) => leerFecha(t, formato) !== null).length;
    if (cuenta > mejorCuenta) {
      mejor = formato;
      mejorCuenta = cuenta;
    }
  }
  return mejor;
}

/**
 * "1.234,56" → coma; "1,234.56" → punto. Si solo hay un separador, se mira cuántos dígitos
 * lo siguen: 3 suele ser separador de miles ("45.000" en pesos).
 */
function elegirSeparador(textos: string[]): ',' | '.' {
  let votosComa = 0;
  let votosPunto = 0;
  for (const t of textos) {
    const ultimoPunto = t.lastIndexOf('.');
    const ultimaComa = t.lastIndexOf(',');
    if (ultimoPunto >= 0 && ultimaComa >= 0) {
      if (ultimaComa > ultimoPunto) votosComa++;
      else votosPunto++;
    } else if (ultimaComa >= 0) {
      if (/,\d{3}$/.test(t)) votosPunto++;
      else if (/,\d{1,2}$/.test(t)) votosComa++;
    } else if (ultimoPunto >= 0) {
      if (/\.\d{3}$/.test(t)) votosComa++;
      else if (/\.\d{1,2}$/.test(t)) votosPunto++;
    }
  }
  const separador = votosComa > votosPunto ? ',' : '.';
  // Validación: si con ese separador casi nada se lee, se usa el otro.
  const leidos = (s: ',' | '.') => textos.filter((t) => leerNumero(t, s) !== null).length;
  return leidos(separador) >= leidos(separador === ',' ? '.' : ',') ? separador : separador === ',' ? '.' : ',';
}
