import { z } from 'zod';
import {
  decimalSchema,
  fechaSchema,
  idSchema,
  monedaAnticipoSchema,
  moneySchema,
  paisSchema,
  tasaCambioSchema,
} from './comunes';

// ---------- Peticiones ----------

export const valorSolicitadoSchema = z.object({
  conceptoCodigo: idSchema,
  /** Valor unitario (por día o por noche) en la moneda de la tarifa. */
  valorUnitario: decimalSchema,
});

export const destinoSchema = z
  .object({
    paisCodigo: paisSchema,
    ciudad: z.string().trim().min(2, { error: 'validation.required' }).max(120),
    fechaInicio: fechaSchema,
    fechaFin: fechaSchema,
    valoresSolicitados: z.array(valorSolicitadoSchema).max(20).default([]),
  })
  .refine((d) => d.fechaFin >= d.fechaInicio, {
    path: ['fechaFin'],
    error: 'validation.endBeforeStart',
  })
  .refine(
    (d) => new Set(d.valoresSolicitados.map((v) => v.conceptoCodigo)).size === d.valoresSolicitados.length,
    { path: ['valoresSolicitados'], error: 'validation.duplicatedConcept' },
  );

/** La moneda del anticipo no se pide: la define el país de destino (COP en Colombia, USD en el exterior). */
export const estimarViajeRequestSchema = z.object({
  destinos: z.array(destinoSchema).min(1, { error: 'validation.atLeastOneDestination' }).max(10),
});
export type EstimarViajeRequest = z.input<typeof estimarViajeRequestSchema>;
export type EstimarViajeCommand = z.output<typeof estimarViajeRequestSchema>;

export const crearSolicitudRequestSchema = estimarViajeRequestSchema.extend({
  motivo: z.string().trim().min(10, { error: 'validation.minLength' }).max(500),
  justificacion: z.string().trim().max(1000).optional(),
});
export type CrearSolicitudRequest = z.input<typeof crearSolicitudRequestSchema>;
export type CrearSolicitudCommand = z.output<typeof crearSolicitudRequestSchema>;

export const aprobarSolicitudRequestSchema = z.object({
  comentario: z.string().trim().max(1000).optional(),
});
export type AprobarSolicitudRequest = z.input<typeof aprobarSolicitudRequestSchema>;

export const rechazarSolicitudRequestSchema = z.object({
  comentario: z.string().trim().min(5, { error: 'validation.minLength' }).max(1000),
});
export type RechazarSolicitudRequest = z.input<typeof rechazarSolicitudRequestSchema>;

// ---------- Respuestas ----------

export const unidadCobroSchema = z.enum(['NOCHE', 'DIA']);

export const lineaPresupuestoSchema = z.object({
  destinoIndice: z.number().int(),
  paisCodigo: z.string(),
  conceptoCodigo: z.string(),
  conceptoNombre: z.string(),
  unidad: unidadCobroSchema,
  cantidad: z.number().int(),
  tarifaUnitaria: moneySchema,
  valorUnitarioSolicitado: moneySchema,
  subtotal: moneySchema,
  excedeTarifa: z.boolean(),
});
export type LineaPresupuestoDto = z.infer<typeof lineaPresupuestoSchema>;

export const motivoEscalamientoSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  detalles: z.record(z.string(), z.unknown()),
});

export const escalamientoSchema = z.object({
  requiereJefeDirectivo: z.boolean(),
  motivos: z.array(motivoEscalamientoSchema),
});

export const presupuestoSchema = z.object({
  monedaAnticipo: monedaAnticipoSchema,
  lineas: z.array(lineaPresupuestoSchema),
  totalAnticipo: moneySchema,
  tasasAplicadas: z.array(tasaCambioSchema),
});

export const estimadoResponseSchema = z.object({
  presupuesto: presupuestoSchema,
  escalamiento: escalamientoSchema,
});
export type EstimadoResponse = z.infer<typeof estimadoResponseSchema>;

export const estadoSolicitudSchema = z.enum(['EN_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA']);
export type EstadoSolicitud = z.infer<typeof estadoSolicitudSchema>;

export const pasoAprobacionSchema = z.object({
  orden: z.number().int(),
  nivel: z.enum(['JEFE_INMEDIATO', 'JEFE_DIRECTIVO', 'GERENCIA']),
  aprobadorId: z.string(),
  aprobadorNombre: z.string(),
  estado: z.enum(['PENDIENTE', 'APROBADO', 'RECHAZADO', 'OMITIDO']),
  decididoEn: z.string().nullable(),
  comentario: z.string().nullable(),
});

export const solicitudResponseSchema = z.object({
  id: z.string(),
  estado: estadoSolicitudSchema,
  viajeroId: z.string(),
  viajeroNombre: z.string(),
  motivo: z.string(),
  justificacion: z.string().nullable(),
  destinos: z.array(
    z.object({ paisCodigo: z.string(), ciudad: z.string(), fechaInicio: z.string(), fechaFin: z.string() }),
  ),
  presupuesto: presupuestoSchema,
  escalamiento: escalamientoSchema,
  ruta: z.array(pasoAprobacionSchema),
  creadaEn: z.string(),
  actualizadaEn: z.string(),
});
export type SolicitudResponse = z.infer<typeof solicitudResponseSchema>;

// ---------- Configuración de escalamiento (contabilidad) ----------

/** Cuándo una solicitud necesita también la aprobación del jefe directivo. */
export const configuracionEscalamientoSchema = z.object({
  excedeTarifa: z.object({
    activa: z.boolean(),
    /** Porcentaje sobre la tarifa que se tolera sin escalar (10 = hasta 33 USD con tarifa de 30). */
    toleranciaPorcentaje: z.coerce.number({ error: 'validation.decimal' }).min(0, { error: 'validation.porcentaje' }).max(100, { error: 'validation.porcentaje' }),
  }),
  montoTotal: z.object({
    activa: z.boolean(),
    umbralUsd: decimalSchema,
    umbralCop: decimalSchema,
  }),
});
export type ConfiguracionEscalamientoRequest = z.input<typeof configuracionEscalamientoSchema>;

export const configuracionEscalamientoResponseSchema = configuracionEscalamientoSchema.extend({
  actualizadoPorNombre: z.string().nullable(),
  actualizadoEn: z.string().nullable(),
});
export type ConfiguracionEscalamientoResponse = z.infer<typeof configuracionEscalamientoResponseSchema>;
