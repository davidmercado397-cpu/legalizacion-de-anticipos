import { z } from 'zod';
import { fechaSchema, moneySchema } from './comunes';

export const estadoAnticipoSchema = z.enum(['PENDIENTE_ERP', 'POR_DESEMBOLSAR', 'DESEMBOLSADO', 'LEGALIZADO']);
export type EstadoAnticipo = z.infer<typeof estadoAnticipoSchema>;

export const medioDesembolsoSchema = z.enum(['TRANSFERENCIA', 'EFECTIVO', 'TARJETA_DEBITO']);
export type MedioDesembolso = z.infer<typeof medioDesembolsoSchema>;

export const registrarDesembolsoRequestSchema = z.object({
  fecha: fechaSchema,
  medio: medioDesembolsoSchema,
  referencia: z.string().trim().max(100).optional(),
});
export type RegistrarDesembolsoRequest = z.input<typeof registrarDesembolsoRequestSchema>;

export const anticipoResponseSchema = z.object({
  id: z.string(),
  solicitudId: z.string(),
  viajeroId: z.string(),
  viajeroNombre: z.string(),
  monto: moneySchema,
  estado: estadoAnticipoSchema,
  viaje: z.object({
    motivo: z.string(),
    fechaInicio: z.string(),
    fechaFin: z.string(),
    destinos: z.array(z.object({ paisCodigo: z.string(), ciudad: z.string() })),
  }),
  erp: z.object({ referencia: z.string().nullable(), ultimoError: z.string().nullable(), intentos: z.number().int() }),
  desembolso: z
    .object({
      fecha: z.string(),
      medio: medioDesembolsoSchema,
      referencia: z.string().nullable(),
      registradoPor: z.string(),
      registradoEn: z.string(),
    })
    .nullable(),
  creadoEn: z.string(),
});
export type AnticipoResponse = z.infer<typeof anticipoResponseSchema>;
