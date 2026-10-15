import { z } from 'zod';
import { decimalSchema, fechaSchema } from './comunes';

export const tipoClaveFiscalSchema = z.enum(['CUFE', 'CUDE', 'CHAVE_ACESSO_BR']);

/** Datos para verificar duplicidad de un comprobante (ADR-0007). */
export const verificarDuplicadoRequestSchema = z.object({
  comprobanteId: z.string().optional(),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, { error: 'validation.sha256' }),
  hashPerceptual: z
    .string()
    .regex(/^[0-9a-fA-F]{16}$/)
    .optional(),
  claveFiscal: z.object({ tipo: tipoClaveFiscalSchema, valor: z.string().min(1) }).optional(),
  emisorId: z.string().trim().min(1).optional(),
  numeroDocumento: z.string().trim().min(1).optional(),
  fecha: fechaSchema.optional(),
  total: z.object({ monto: decimalSchema, moneda: z.string().length(3) }).optional(),
});
export type VerificarDuplicadoRequest = z.input<typeof verificarDuplicadoRequestSchema>;

export const coincidenciaDuplicadoSchema = z.object({
  codigo: z.enum([
    'ARCHIVO_IDENTICO',
    'CLAVE_FISCAL_REPETIDA',
    'EMISOR_Y_NUMERO_REPETIDOS',
    'IMAGEN_SIMILAR',
    'EMISOR_FECHA_TOTAL_IGUALES',
  ]),
  severidad: z.enum(['BLOQUEANTE', 'SOSPECHOSA']),
  comprobanteId: z.string(),
  viajeroId: z.string(),
  detalle: z.string(),
});

export const resultadoDuplicidadSchema = z.object({
  veredicto: z.enum(['UNICO', 'SOSPECHOSO', 'DUPLICADO']),
  coincidencias: z.array(coincidenciaDuplicadoSchema),
});
export type ResultadoDuplicidadResponse = z.infer<typeof resultadoDuplicidadSchema>;
