import { DomainError } from './errores';

/** Código ISO-4217 (USD, COP, BRL…). */
export type CodigoMoneda = string & { readonly __brand: 'CodigoMoneda' };

/** Monedas en las que se puede entregar un anticipo. */
export const MONEDAS_ANTICIPO = ['USD', 'COP'] as const;
export type MonedaAnticipo = (typeof MONEDAS_ANTICIPO)[number];

const ISO_4217 = /^[A-Z]{3}$/;

export function codigoMoneda(valor: string): CodigoMoneda {
  const normalizado = valor.trim().toUpperCase();
  if (!ISO_4217.test(normalizado)) {
    throw new DomainError('MONEDA_INVALIDA', 'VALIDACION', `Moneda inválida: "${valor}"`);
  }
  return normalizado as CodigoMoneda;
}
