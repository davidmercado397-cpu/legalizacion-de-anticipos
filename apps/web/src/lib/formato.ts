const LOCALE = 'es-CO';
const formatosMoneda = new Map<string, Intl.NumberFormat>();

/** Monedas sin centavos en el uso diario. */
const SIN_DECIMALES = new Set(['COP', 'CLP']);

/** "$ 1.900.000" / "US$ 475,00". El valor llega como texto decimal exacto; Number() solo para mostrar. */
export function formatoDinero(valor: string | number | null | undefined, moneda: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (!moneda) return String(valor);
  let formato = formatosMoneda.get(moneda);
  if (!formato) {
    const decimales = SIN_DECIMALES.has(moneda) ? 0 : 2;
    formato = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: moneda, minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    formatosMoneda.set(moneda, formato);
  }
  return formato.format(Number(valor));
}

const formatoFecha = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatoFechaHora = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

/** Fecha de negocio YYYY-MM-DD, sin corrimiento por zona horaria. */
export const formatoFechaCalendario = (iso: string | null | undefined) => (iso ? formatoFecha.format(new Date(`${iso}T00:00:00Z`)) : '—');
/** Instante con offset (la API lo manda en la zona de la compañía). */
export const formatoMomento = (iso: string | null | undefined) => (iso ? formatoFechaHora.format(new Date(iso)) : '—');

export const rangoFechas = (inicio: string | null | undefined, fin: string | null | undefined) =>
  inicio && fin ? `${formatoFechaCalendario(inicio)} – ${formatoFechaCalendario(fin)}` : '';
