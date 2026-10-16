import { z } from 'zod';

export const cotizacionDelDiaSchema = z.object({
  moneda: z.string().length(3),
  /** Unidades de la moneda por 1 USD; null si la fuente no respondió. */
  porDolar: z.string().nullable(),
  /** Fuente y fecha de publicación, ej. "TRM 2026-10-16". */
  fuente: z.string().nullable(),
});

export const tasasDelDiaResponseSchema = z.object({
  fecha: z.string(),
  cotizaciones: z.array(cotizacionDelDiaSchema),
});
export type TasasDelDiaResponse = z.infer<typeof tasasDelDiaResponseSchema>;
