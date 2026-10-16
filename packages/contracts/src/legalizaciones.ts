import { z } from 'zod';
import { decimalSchema, fechaSchema, moneySchema, paisSchema, tasaCambioSchema } from './comunes';
import { tipoClaveFiscalSchema } from './comprobantes';

export const categoriaGastoSchema = z.enum(['ALOJAMIENTO', 'ALIMENTACION', 'VIVERES', 'TRANSPORTE', 'OTROS']);
export type CategoriaGasto = z.infer<typeof categoriaGastoSchema>;
export const medioPagoSchema = z.enum(['TARJETA', 'EFECTIVO', 'TRANSFERENCIA', 'DESCONOCIDO']);
export type MedioPago = z.infer<typeof medioPagoSchema>;
export const estadoLegalizacionSchema = z.enum(['ABIERTA', 'EN_REVISION', 'DEVUELTA', 'APROBADA']);
export type EstadoLegalizacion = z.infer<typeof estadoLegalizacionSchema>;
export const monedaSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: 'validation.currency' });

// ---------- Peticiones ----------

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const confirmarSoporteRequestSchema = z.object({
  emisorNombre: z.string().trim().min(1, { error: 'validation.required' }).max(200),
  emisorId: textoOpcional(40),
  adquirienteId: textoOpcional(40),
  numeroDocumento: textoOpcional(60),
  fecha: fechaSchema,
  moneda: monedaSchema,
  total: decimalSchema,
  claveFiscal: z.object({ tipo: tipoClaveFiscalSchema, valor: z.string().trim().min(1) }).nullish().transform((v) => v ?? null),
  medioPago: medioPagoSchema,
  ultimos4Tarjeta: z
    .string()
    .trim()
    .regex(/^\d{4}$/, { error: 'validation.last4' })
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  paisCodigo: paisSchema,
  categoria: categoriaGastoSchema,
  lineas: z
    .array(z.object({ descripcion: z.string().trim().min(1, { error: 'validation.required' }).max(200), valor: decimalSchema }))
    .max(60)
    .default([]),
  /** Propina sugerida impresa en la factura; la propina aceptada no la supera. */
  propinaSugerida: decimalSchema.nullish().or(z.literal('')).transform((v) => v || null),
});
export type ConfirmarSoporteRequest = z.input<typeof confirmarSoporteRequestSchema>;

/** Campos de texto del formulario multipart del recibo de caja (la foto es opcional). */
export const reciboCajaRequestSchema = z.object({
  descripcion: z.string().trim().min(5, { error: 'validation.minLength' }).max(300),
  fecha: fechaSchema,
  moneda: monedaSchema,
  valor: decimalSchema,
  categoria: categoriaGastoSchema,
  medioPago: medioPagoSchema.default('EFECTIVO'),
  paisCodigo: paisSchema,
  beneficiario: textoOpcional(120),
  /** El viajero declara que el recibo está firmado por quien le vendió (la foto es obligatoria). */
  firmado: z.union([z.literal(true), z.literal('true')], { error: 'validation.firmaRequerida' }).transform(() => true as const),
});
export type ReciboCajaRequest = z.input<typeof reciboCajaRequestSchema>;

export const subirSoporteRequestSchema = z.object({
  descripcion: z.string().trim().min(5, { error: 'validation.minLength' }).max(300),
});

export const decisionLineaRequestSchema = z.object({ excluir: z.boolean() });
export type DecisionLineaRequest = z.input<typeof decisionLineaRequestSchema>;

export const decisionSoporteRequestSchema = z.object({
  aplica: z.boolean(),
  comentario: z.string().trim().max(500).optional(),
});
export type DecisionSoporteRequest = z.input<typeof decisionSoporteRequestSchema>;

export const devolverLegalizacionRequestSchema = z.object({
  comentario: z.string().trim().min(5, { error: 'validation.minLength' }).max(1000),
});

export const politicaLegalizacionSchema = z.object({
  topesReciboCaja: z.array(z.object({ monto: decimalSchema, moneda: monedaSchema })).min(1).max(10),
  exclusiones: z
    .array(
      z.object({
        codigo: z.string().trim().min(1).max(30),
        nombre: z.string().trim().min(1).max(80),
        palabras: z.array(z.string().trim().min(1).max(60)).max(300),
        /** También tienen otro sentido ("pizza margarita"): la línea queda por verificar en vez de excluirse. */
        palabrasAmbiguas: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
      }),
    )
    .max(30),
});
export type PoliticaLegalizacionRequest = z.input<typeof politicaLegalizacionSchema>;

export const politicaLegalizacionResponseSchema = politicaLegalizacionSchema.extend({
  actualizadaPor: z.string().nullable(),
  actualizadaEn: z.string().nullable(),
});
export type PoliticaLegalizacionResponse = z.infer<typeof politicaLegalizacionResponseSchema>;

// ---------- Respuestas ----------

export const alertaSchema = z.object({
  codigo: z.string(),
  severidad: z.enum(['INFO', 'REVISION']),
  mensaje: z.string(),
});

export const extraccionSchema = z.object({
  tipoDocumento: z.string(),
  emisorNombre: z.string().nullable(),
  emisorId: z.string().nullable(),
  adquirienteNombre: z.string().nullable(),
  adquirienteId: z.string().nullable(),
  numeroDocumento: z.string().nullable(),
  fecha: z.string().nullable(),
  moneda: z.string().nullable(),
  total: z.string().nullable(),
  claveFiscal: z.object({ tipo: tipoClaveFiscalSchema, valor: z.string() }).nullable(),
  medioPago: medioPagoSchema,
  ultimos4Tarjeta: z.string().nullable(),
  paisCodigo: z.string().nullable(),
  categoriaSugerida: categoriaGastoSchema,
  lineas: z.array(z.object({ descripcion: z.string(), valor: z.string() })),
  propinaSugerida: z.string().nullish(),
  confianza: z.enum(['ALTA', 'MEDIA', 'BAJA']),
  observaciones: z.string().nullable(),
});
export type ExtraccionDto = z.infer<typeof extraccionSchema>;

export const soporteResponseSchema = z.object({
  id: z.string(),
  tipo: z.enum(['FACTURA', 'RECIBO_CAJA']),
  estado: z.enum(['PROCESANDO', 'POR_CONFIRMAR', 'CONFIRMADO']),
  descripcion: z.string(),
  archivo: z.object({ nombre: z.string(), mime: z.string(), tamano: z.number() }).nullable(),
  extraccion: extraccionSchema.nullable(),
  datos: z
    .object({
      emisorNombre: z.string(),
      emisorId: z.string().nullable(),
      adquirienteId: z.string().nullable(),
      numeroDocumento: z.string().nullable(),
      fecha: z.string(),
      total: moneySchema,
      claveFiscal: z.object({ tipo: tipoClaveFiscalSchema, valor: z.string() }).nullable(),
      medioPago: medioPagoSchema,
      ultimos4Tarjeta: z.string().nullable(),
      paisCodigo: z.string(),
      categoria: categoriaGastoSchema,
      lineas: z.array(
        z.object({
          descripcion: z.string(),
          valor: moneySchema,
          tipo: z.enum(['GASTO', 'IMPUESTO', 'PROPINA']),
          excluida: z.boolean(),
          /** Lo que se excluye de la línea: toda, una parte (impuesto, exceso de propina) o nada. */
          valorExcluido: moneySchema,
          motivoExclusion: z.string().nullable(),
          /** Palabra ambigua o propina sin valor sugerido: contabilidad decide. */
          porVerificar: z.string().nullable(),
          decisionContable: z.enum(['EXCLUIR', 'ACEPTAR']).nullable(),
        }),
      ),
      propinaSugerida: moneySchema.nullable(),
      tasa: tasaCambioSchema.nullable(),
    })
    .nullable(),
  montos: z.object({ aceptado: moneySchema, excluido: moneySchema }),
  alertas: z.array(alertaSchema),
  requiereDecision: z.boolean(),
  decision: z
    .object({ aplica: z.boolean(), comentario: z.string().nullable(), contadorNombre: z.string(), decididoEn: z.string() })
    .nullable(),
  beneficiario: z.string().nullable(),
  creadoEn: z.string(),
});
export type SoporteResponse = z.infer<typeof soporteResponseSchema>;

export const legalizacionResponseSchema = z.object({
  id: z.string(),
  anticipoId: z.string(),
  viajeroId: z.string(),
  viajeroNombre: z.string(),
  estado: estadoLegalizacionSchema,
  editable: z.boolean(),
  montoAnticipo: moneySchema,
  viaje: z.object({ inicio: z.string(), fin: z.string() }),
  /** Empresa del viajero: las facturas deben venir a su NIT. */
  empresa: z.object({ nombre: z.string(), nit: z.string() }).nullable(),
  /** Plazo para enviar la legalización (1 mes después del regreso). */
  plazo: z.object({ fechaLimite: z.string(), vencida: z.boolean() }),
  resumen: z.object({ totalAceptado: moneySchema, totalExcluido: moneySchema, saldo: moneySchema }),
  soportes: z.array(soporteResponseSchema),
  historial: z.array(
    z.object({ tipo: z.enum(['ENVIADA', 'DEVUELTA', 'APROBADA']), usuarioNombre: z.string(), comentario: z.string().nullable(), en: z.string() }),
  ),
  creadaEn: z.string(),
});
export type LegalizacionResponse = z.infer<typeof legalizacionResponseSchema>;
