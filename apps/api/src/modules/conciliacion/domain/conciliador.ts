import type { FechaCalendario, Money } from '@viaticos/shared-kernel';

/** Pago con tarjeta legalizado, con su total ya llevado a la moneda del extracto. */
export interface PagoTarjeta {
  soporteId: string;
  legalizacionId: string;
  fecha: FechaCalendario;
  emisor: string;
  ultimos4: string | null;
  /** Total en la moneda original de la factura. */
  totalOriginal: Money;
  /** Total en la moneda del extracto (null si no hubo tasa para convertir). */
  totalEnMonedaExtracto: Money | null;
}

export interface CargoBancario {
  movimientoId: string;
  fecha: FechaCalendario;
  descripcion: string;
  valor: Money;
}

export interface ParametrosConciliacion {
  /** Diferencia de valor aceptada si la factura está en la misma moneda del extracto (0,01 = 1 %). */
  toleranciaMismaMoneda: number;
  /** Con conversión de moneda: el banco usa su propia tasa y suele sumar comisión. */
  toleranciaOtraMoneda: number;
  /** El banco registra la compra hasta N días después (o antes, por zona horaria). Más allá, no se cruza. */
  diasMaximos: number;
  pesos: { monto: number; fecha: number; comercio: number };
  umbralAutomatico: number;
  umbralSugerido: number;
}

export const PARAMETROS_POR_DEFECTO: ParametrosConciliacion = {
  toleranciaMismaMoneda: 0.01,
  toleranciaOtraMoneda: 0.06,
  diasMaximos: 5,
  pesos: { monto: 0.5, fecha: 0.3, comercio: 0.2 },
  umbralAutomatico: 0.8,
  umbralSugerido: 0.55,
};

export interface Propuesta {
  movimientoId: string;
  soporteId: string;
  legalizacionId: string;
  puntaje: number;
  estado: 'AUTOMATICO' | 'SUGERIDO';
  montoSoporte: Money;
}

/** Puntaje de fecha por días de diferencia: el mismo día es lo ideal; 1–3 días es normal en tarjetas. */
const PUNTAJE_POR_DIAS = [1, 0.9, 0.8, 0.7, 0.4, 0.2];

export function puntuar(
  cargo: CargoBancario,
  pago: PagoTarjeta,
  ultimos4Extracto: string | null,
  p: ParametrosConciliacion = PARAMETROS_POR_DEFECTO,
): number | null {
  // Otra tarjeta: descarta.
  if (ultimos4Extracto && pago.ultimos4 && ultimos4Extracto !== pago.ultimos4) return null;
  const monto = pago.totalEnMonedaExtracto;
  if (!monto || monto.moneda !== cargo.valor.moneda) return null;

  const dias = Math.abs(pago.fecha.diasHasta(cargo.fecha));
  if (dias > p.diasMaximos) return null;
  const puntajeFecha = PUNTAJE_POR_DIAS[dias] ?? 0.1;

  const esperado = Number(monto.monto);
  const diferencia = esperado === 0 ? 1 : Math.abs(Number(cargo.valor.monto) - esperado) / esperado;
  const tolerancia = pago.totalOriginal.moneda === cargo.valor.moneda ? p.toleranciaMismaMoneda : p.toleranciaOtraMoneda;
  if (diferencia > tolerancia) return null;
  const puntajeMonto = 1 - (diferencia / tolerancia) * 0.5;

  const puntaje = p.pesos.monto * puntajeMonto + p.pesos.fecha * puntajeFecha + p.pesos.comercio * similitudComercio(cargo.descripcion, pago.emisor);
  return Math.round(puntaje * 1000) / 1000;
}

/**
 * Cruce uno a uno: se calculan todos los pares posibles y se asignan de mayor a menor
 * puntaje (codicioso). Cada cargo y cada pago se usan una sola vez.
 */
export function conciliar(
  cargos: readonly CargoBancario[],
  pagos: readonly PagoTarjeta[],
  opciones: {
    ultimos4Extracto: string | null;
    /** Pares que contabilidad ya rechazó: no se vuelven a proponer. */
    rechazados?: ReadonlySet<string>;
    parametros?: ParametrosConciliacion;
  },
): Propuesta[] {
  const p = opciones.parametros ?? PARAMETROS_POR_DEFECTO;
  const pares: Propuesta[] = [];
  for (const cargo of cargos) {
    for (const pago of pagos) {
      if (opciones.rechazados?.has(clavePar(cargo.movimientoId, pago.soporteId))) continue;
      const puntaje = puntuar(cargo, pago, opciones.ultimos4Extracto, p);
      if (puntaje === null || puntaje < p.umbralSugerido) continue;
      pares.push({
        movimientoId: cargo.movimientoId,
        soporteId: pago.soporteId,
        legalizacionId: pago.legalizacionId,
        puntaje,
        estado: puntaje >= p.umbralAutomatico ? 'AUTOMATICO' : 'SUGERIDO',
        montoSoporte: pago.totalEnMonedaExtracto!,
      });
    }
  }
  // Desempate estable: a igual puntaje, la fecha y el orden del extracto deciden.
  pares.sort((a, b) => b.puntaje - a.puntaje);
  const cargosUsados = new Set<string>();
  const pagosUsados = new Set<string>();
  const elegidos: Propuesta[] = [];
  for (const par of pares) {
    if (cargosUsados.has(par.movimientoId) || pagosUsados.has(par.soporteId)) continue;
    cargosUsados.add(par.movimientoId);
    pagosUsados.add(par.soporteId);
    elegidos.push(par);
  }
  return elegidos;
}

export const clavePar = (movimientoId: string, soporteId: string) => `${movimientoId}|${soporteId}`;

const PALABRAS_VACIAS = new Set([
  'sas', 'ltda', 'ltd', 'inc', 'llc', 'eireli', 'me', 'cia', 'compra', 'pago', 'pos', 'debito', 'tarjeta', 'internacional',
  'nacional', 'tienda', 'store', 'the', 'del', 'los', 'las', 'com', 'www', 'purchase', 'compras', 'retiro',
]);

function tokens(texto: string): Set<string> {
  return new Set(
    texto
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !PALABRAS_VACIAS.has(t) && !/^\d+$/.test(t)),
  );
}

/** 0..1: qué tanto se parece la descripción del banco al nombre del comercio de la factura. */
export function similitudComercio(descripcionBanco: string, emisor: string): number {
  const a = tokens(descripcionBanco);
  const b = tokens(emisor);
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const t of b) {
    // Los bancos truncan nombres: "STARBUCKS COF" vs "Starbucks Coffee".
    if (a.has(t) || [...a].some((x) => (x.length >= 3 && t.startsWith(x)) || (t.length >= 3 && x.startsWith(t)))) comunes++;
  }
  return Math.min(1, comunes / Math.min(a.size, b.size));
}
