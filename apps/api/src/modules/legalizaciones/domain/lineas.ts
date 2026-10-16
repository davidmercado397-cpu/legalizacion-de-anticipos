import { Money } from '@viaticos/shared-kernel';
import { evaluarExclusion, evaluarAmbiguedad, type ReglaExclusion } from './reglas-exclusion';

/** GASTO: un producto o servicio. IMPUESTO: IVA, impoconsumo, ICMS… PROPINA: propina o servicio voluntario. */
export type TipoLinea = 'GASTO' | 'IMPUESTO' | 'PROPINA';

export interface LineaSoporte {
  descripcion: string;
  valor: Money;
  tipo: TipoLinea;
  /** Excluida por la política (palabra inequívoca: cerveza, minibar, cine…). */
  motivoExclusion: string | null;
  /** Palabra ambigua o propina sin valor sugerido: contabilidad decide. */
  porVerificar: string | null;
  decisionContable: 'EXCLUIR' | 'ACEPTAR' | null;
}

/** La línea con lo que queda excluido de ella (toda, una parte o nada). */
export interface LineaLiquidada extends LineaSoporte {
  valorExcluido: Money;
  explicacion: string | null;
}

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const patron = (palabras: string[]) => new RegExp(`(^|[^\\p{L}\\p{N}])(${palabras.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'u');

// La propina se revisa antes que el impuesto: "taxa de serviço" (Brasil) es propina, no impuesto.
const PROPINA = patron([
  'propina', 'propinas', 'tip', 'tips', 'gratuity', 'gorjeta', 'gorjetas', 'servicio voluntario', 'cargo por servicio', 'cargo de servicio',
  'service charge', 'taxa de servico', 'taxa servico', 'servico 10%', 'servicio 10%', '10% servico', '10% servicio',
]);
const IMPUESTO = patron([
  'iva', 'impuesto', 'impuestos', 'impoconsumo', 'imp consumo', 'imp\\. consumo', 'impuesto al consumo', 'inc', 'ico', 'tax', 'taxes', 'vat',
  'sales tax', 'icms', 'iss', 'pis', 'cofins', 'imposto', 'impostos', 'tributos', 'iva incluido',
]);

export function tipoDeLinea(descripcion: string): TipoLinea {
  const d = normalizar(descripcion);
  if (PROPINA.test(d)) return 'PROPINA';
  if (IMPUESTO.test(d)) return 'IMPUESTO';
  return 'GASTO';
}

/** Clasifica la línea al confirmar la factura. */
export function clasificarLinea(
  linea: { descripcion: string; valor: Money },
  reglas: readonly ReglaExclusion[],
  hayPropinaSugerida: boolean,
): LineaSoporte {
  const tipo = tipoDeLinea(linea.descripcion);
  const base = { ...linea, tipo, motivoExclusion: null, porVerificar: null, decisionContable: null } satisfies LineaSoporte;
  if (tipo === 'PROPINA') {
    return hayPropinaSugerida ? base : { ...base, porVerificar: 'Propina sin valor sugerido en la factura' };
  }
  if (tipo === 'IMPUESTO') return base;
  const regla = evaluarExclusion(linea.descripcion, reglas);
  if (regla) return { ...base, motivoExclusion: regla.config.nombre };
  const ambigua = evaluarAmbiguedad(linea.descripcion, reglas);
  return ambigua ? { ...base, porVerificar: `Posible ${ambigua.config.nombre.toLowerCase()}` } : base;
}

/**
 * Cuánto se excluye de cada línea:
 * - Gasto: todo, si la política lo excluye o contabilidad decidió excluirlo.
 * - Propina: lo que supere la propina sugerida en la factura.
 * - Impuesto: la parte proporcional a los gastos excluidos (el IVA de la cerveza también se excluye).
 */
export function liquidarLineas(lineas: readonly LineaSoporte[], propinaSugerida: Money | null): LineaLiquidada[] {
  const moneda = lineas[0]?.valor.moneda;
  if (!moneda) return [];
  const cero = Money.cero(moneda);
  const excluidaPorDecision = (l: LineaSoporte) => l.decisionContable === 'EXCLUIR';

  const gastos = lineas.filter((l) => l.tipo === 'GASTO');
  const excluidoDeGasto = (l: LineaSoporte) => (l.motivoExclusion !== null || excluidaPorDecision(l) ? l.valor : cero);
  const totalGastos = Money.sumarTodos(gastos.map((l) => l.valor), moneda);
  const gastosExcluidos = Money.sumarTodos(gastos.map(excluidoDeGasto), moneda);

  let propinaDisponible = propinaSugerida && propinaSugerida.moneda === moneda ? propinaSugerida : null;

  return lineas.map((l): LineaLiquidada => {
    if (excluidaPorDecision(l)) return { ...l, valorExcluido: l.valor, explicacion: 'Excluida por contabilidad' };
    switch (l.tipo) {
      case 'GASTO':
        return { ...l, valorExcluido: excluidoDeGasto(l), explicacion: l.motivoExclusion };
      case 'PROPINA': {
        if (!propinaDisponible) return { ...l, valorExcluido: cero, explicacion: null };
        const exceso = l.valor.restar(propinaDisponible);
        propinaDisponible = exceso.esNegativo() ? propinaDisponible.restar(l.valor) : cero;
        return exceso.esNegativo() || exceso.esCero()
          ? { ...l, valorExcluido: cero, explicacion: null }
          : { ...l, valorExcluido: exceso, explicacion: 'Propina superior a la sugerida en la factura' };
      }
      case 'IMPUESTO': {
        const parte = l.valor.prorratear(gastosExcluidos, totalGastos);
        return { ...l, valorExcluido: parte, explicacion: parte.esCero() ? null : 'Impuesto de las líneas excluidas' };
      }
    }
  });
}
