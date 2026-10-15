import { z } from 'zod';

/**
 * Los mensajes de error son claves de i18n (es/pt/en): el mismo esquema sirve
 * para la API y para los formularios web/móvil.
 */
export const decimalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, { error: 'validation.decimal' });

export const monedaAnticipoSchema = z.enum(['USD', 'COP'], { error: 'validation.currency' });
export type MonedaAnticipo = z.infer<typeof monedaAnticipoSchema>;

export const fechaSchema = z.iso.date({ error: 'validation.date' });

export const paisSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: 'validation.country' });

export const idSchema = z.string().trim().min(1, { error: 'validation.required' }).max(64);

export const moneySchema = z.object({
  monto: z.string(),
  moneda: z.string().length(3),
});
export type MoneyDto = z.infer<typeof moneySchema>;

export const tasaCambioSchema = z.object({
  origen: z.string(),
  destino: z.string(),
  valor: z.string(),
  fecha: z.string(),
  fuente: z.string(),
});
export type TasaCambioDto = z.infer<typeof tasaCambioSchema>;

/** Error HTTP en formato RFC 7807 (application/problem+json). */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
