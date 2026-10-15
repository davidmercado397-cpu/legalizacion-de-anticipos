import type { MoneyDto } from '@viaticos/contracts';

const LOCALE = 'es-CO';
const formatosMoneda = new Map<string, Intl.NumberFormat>();

/** "1.900.000 COP" / "US$ 475,00". El monto llega como string decimal exacto; Number() solo para mostrar. */
export function formatoDinero({ monto, moneda }: MoneyDto): string {
  let formato = formatosMoneda.get(moneda);
  if (!formato) {
    const decimales = moneda === 'COP' ? 0 : 2;
    formato = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    });
    formatosMoneda.set(moneda, formato);
  }
  return formato.format(Number(monto));
}

const formatoFecha = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatoFechaHora = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

/** Fecha calendario YYYY-MM-DD sin corrimiento por zona horaria. */
export const formatoFechaCalendario = (iso: string) => formatoFecha.format(new Date(`${iso}T00:00:00Z`));
export const formatoMomento = (iso: string) => formatoFechaHora.format(new Date(iso));

const nombresPais = new Intl.DisplayNames([LOCALE], { type: 'region' });
export const nombrePais = (codigo: string) => nombresPais.of(codigo) ?? codigo;
