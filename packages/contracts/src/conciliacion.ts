import { z } from 'zod';
import { idSchema, moneySchema } from './comunes';

export const FORMATOS_FECHA_EXTRACTO = ['DD/MM/AAAA', 'MM/DD/AAAA', 'AAAA-MM-DD', 'DD/MM/AA', 'AAAAMMDD'] as const;

const columna = z.number().int().min(0).max(200);

/** Cómo leer el extracto de un banco (mapeo de columnas). Las columnas se numeran desde 0. */
export const perfilExtractoSchema = z
  .object({
    filaEncabezado: z.number().int().min(0).max(100),
    columnas: z.object({
      fecha: columna,
      descripcion: columna,
      referencia: columna.nullable(),
      valor: columna.nullable(),
      debito: columna.nullable(),
      credito: columna.nullable(),
    }),
    formatoFecha: z.enum(FORMATOS_FECHA_EXTRACTO),
    separadorDecimal: z.enum([',', '.']),
    signoCargos: z.enum(['NEGATIVO', 'POSITIVO']),
    moneda: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: 'validation.currency' }),
  })
  .refine((p) => (p.columnas.valor === null) !== (p.columnas.debito === null), {
    error: 'validation.columnaValor',
    path: ['columnas', 'valor'],
  });
export type PerfilExtractoDto = z.infer<typeof perfilExtractoSchema>;

/** Campos de texto que acompañan el archivo (multipart). `perfil` llega como JSON. */
const perfilEnTexto = z
  .string()
  .transform((t, ctx) => {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'validation.json' });
      return z.NEVER;
    }
  })
  .pipe(perfilExtractoSchema);

export const vistaPreviaExtractoRequestSchema = z.object({
  perfil: perfilEnTexto.optional(),
  moneda: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('COP'),
});

export const cargarExtractoRequestSchema = z.object({
  legalizacionId: idSchema,
  ultimos4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, { error: 'validation.ultimos4' })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  perfil: perfilEnTexto,
  guardarPerfilComo: z.string().trim().max(80).optional(),
});

export const enlazarMovimientoRequestSchema = z.object({ soporteId: idSchema });

export const movimientoLeidoSchema = z.object({
  fila: z.number(),
  fecha: z.string(),
  descripcion: z.string(),
  referencia: z.string().nullable(),
  valor: moneySchema,
  tipo: z.enum(['DEBITO', 'CREDITO']),
});

export const perfilGuardadoSchema = z.object({ id: z.string(), nombre: z.string(), perfil: perfilExtractoSchema });
export type PerfilGuardadoResponse = z.infer<typeof perfilGuardadoSchema>;

export const vistaPreviaExtractoResponseSchema = z.object({
  filas: z.array(z.array(z.string())),
  totalFilas: z.number(),
  perfil: perfilExtractoSchema,
  confianza: z.enum(['ALTA', 'BAJA']),
  movimientos: z.array(movimientoLeidoSchema),
  totalCargos: z.number(),
  totalAbonos: z.number(),
  omitidas: z.array(z.object({ fila: z.number(), motivo: z.string() })),
  perfilesGuardados: z.array(perfilGuardadoSchema),
});
export type VistaPreviaExtractoResponse = z.infer<typeof vistaPreviaExtractoResponseSchema>;

export const estadoCruceSchema = z.enum(['AUTOMATICO', 'SUGERIDO', 'CONFIRMADO', 'MANUAL']);
export type EstadoCruce = z.infer<typeof estadoCruceSchema>;

const pagoSchema = z.object({
  soporteId: z.string(),
  legalizacionId: z.string(),
  fecha: z.string(),
  emisor: z.string(),
  totalOriginal: moneySchema,
  totalEnMonedaExtracto: moneySchema.nullable(),
});

export const resumenConciliacionSchema = z.object({
  cargos: z.number(),
  conciliados: z.number(),
  porRevisar: z.number(),
  cargosSinSoporte: z.number(),
  pagosSinMovimiento: z.number(),
  totalCargos: moneySchema,
  totalCargosSinSoporte: moneySchema,
});

export const extractoResumenResponseSchema = z.object({
  id: z.string(),
  titularId: z.string(),
  titularNombre: z.string().nullable(),
  legalizacionId: z.string(),
  ultimos4: z.string().nullable(),
  moneda: z.string(),
  archivoNombre: z.string(),
  cargadoEn: z.string(),
  periodo: z.object({ desde: z.string(), hasta: z.string() }),
  resumen: resumenConciliacionSchema.omit({ pagosSinMovimiento: true }),
});
export type ExtractoResumenResponse = z.infer<typeof extractoResumenResponseSchema>;

export const extractoResponseSchema = extractoResumenResponseSchema.extend({
  resumen: resumenConciliacionSchema,
  movimientos: z.array(
    movimientoLeidoSchema.extend({
      id: z.string(),
      cruce: z
        .object({
          estado: estadoCruceSchema,
          puntaje: z.number().nullable(),
          montoSoporte: moneySchema.nullable(),
          pago: pagoSchema.nullable(),
        })
        .nullable(),
    }),
  ),
  /** Facturas con tarjeta del periodo que no aparecen en este ni en otro extracto. */
  pagosSinMovimiento: z.array(pagoSchema),
});
export type ExtractoResponse = z.infer<typeof extractoResponseSchema>;
