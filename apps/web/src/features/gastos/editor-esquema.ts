import type { CorreccionGasto, GastoDetalle } from '@viaticos/contracts';
import { z } from 'zod';

const decimal = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+([.,]\d{1,2})?$/.test(v), 'validation.decimal');

export const esquema = z.object({
  document_type: z.string(),
  vendor_name: z.string().trim(),
  vendor_tax_id: z.string().trim(),
  invoice_number: z.string().trim(),
  invoice_date: z.string(),
  currency: z.string().trim().toUpperCase(),
  subtotal: decimal,
  tax_amount: decimal,
  tip_amount: decimal,
  discount_amount: decimal,
  total: decimal,
  category: z.string(),
  description: z.string().trim(),
  payment_method: z.string(),
});
export type Datos = z.infer<typeof esquema>;
const CAMPOS = Object.keys(esquema.shape) as (keyof Datos)[];
const NUMERICOS = new Set<keyof Datos>(['subtotal', 'tax_amount', 'tip_amount', 'discount_amount', 'total']);

/** Los montos llegan como "15000.00": en el campo se ven sin los centavos en cero. */
const sinCerosDecimales = (valor: string) => valor.replace(/\.00$/, '');

export const aFormulario = (g: GastoDetalle): Datos =>
  Object.fromEntries(
    CAMPOS.map((c) => {
      const valor = (g[c] as string | null) ?? '';
      return [c, NUMERICOS.has(c) ? sinCerosDecimales(valor) : valor];
    }),
  ) as Datos;

/** Solo se envía lo que el usuario cambió; vacío = sin dato. */
export function cambios(datos: Datos, original: Datos): CorreccionGasto {
  const salida: Record<string, string | null> = {};
  for (const campo of CAMPOS) {
    if (datos[campo] === original[campo]) continue;
    const valor = datos[campo];
    salida[campo] = valor === '' ? null : NUMERICOS.has(campo) ? valor.replace(',', '.') : valor;
  }
  return salida as CorreccionGasto;
}
