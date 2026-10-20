import type { Perfil } from '@viaticos/client-api';

/** Monedas habilitadas para elegir. Si el registro ya trae otra (p. ej. leída de una factura), se incluye para no perderla. */
export function opcionesDeMoneda(usuario: Perfil | null, actual?: string | null): string[] {
  const monedas = usuario?.supported_currencies ?? [];
  return actual && !monedas.includes(actual) ? [actual, ...monedas] : monedas;
}
