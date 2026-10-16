import { z } from 'zod';
import { decimalSchema, fechaSchema, moneySchema, paisSchema } from './comunes';
import { rolSchema } from './identidad';

const codigoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,29}$/, { error: 'validation.codigo' });

// ---------- Empresas del holding ----------

export const empresaRequestSchema = z.object({
  nombre: z.string().trim().min(2, { error: 'validation.required' }).max(150),
  /** Sin dígito de verificación; se aceptan puntos y guiones. */
  nit: z.string().trim().min(6, { error: 'validation.nit' }).max(20),
  activa: z.boolean().default(true),
});
export type EmpresaRequest = z.input<typeof empresaRequestSchema>;
export const empresaResponseSchema = z.object({ id: z.string(), nombre: z.string(), nit: z.string(), activa: z.boolean() });
export type EmpresaResponse = z.infer<typeof empresaResponseSchema>;

// ---------- Cargos ----------

export const cargoSchema = z.object({
  codigo: codigoSchema,
  nombre: z.string().trim().min(2, { error: 'validation.required' }).max(80),
  activo: z.boolean().default(true),
});
export type CargoRequest = z.input<typeof cargoSchema>;
export type CargoResponse = z.output<typeof cargoSchema>;

// ---------- Usuarios ----------

export const usuarioRequestSchema = z.object({
  nombre: z.string().trim().min(3, { error: 'validation.required' }).max(120),
  email: z.string().trim().toLowerCase().email({ error: 'validation.email' }),
  cargoId: z.string().trim().min(1, { error: 'validation.required' }),
  empresaId: z.string().trim().min(1, { error: 'validation.required' }),
  jefeInmediatoId: z.string().trim().nullish().or(z.literal('')).transform((v) => v || null),
  jefeDirectivoId: z.string().trim().nullish().or(z.literal('')).transform((v) => v || null),
  roles: z.array(rolSchema).min(1, { error: 'validation.roles' }),
  activo: z.boolean().default(true),
});
export type UsuarioRequest = z.input<typeof usuarioRequestSchema>;

export const usuarioAdminResponseSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string(),
  cargoId: z.string(),
  empresaId: z.string(),
  jefeInmediatoId: z.string().nullable(),
  jefeDirectivoId: z.string().nullable(),
  roles: z.array(rolSchema),
  activo: z.boolean(),
});
export type UsuarioAdminResponse = z.infer<typeof usuarioAdminResponseSchema>;

export const contrasenaRequestSchema = z.object({
  contrasena: z.string().min(10, { error: 'validation.contrasena' }).max(200),
});

// ---------- Conceptos y tarifas ----------

export const conceptoSchema = z.object({
  codigo: codigoSchema,
  nombre: z.string().trim().min(2, { error: 'validation.required' }).max(80),
  unidad: z.enum(['DIA', 'NOCHE']),
  activo: z.boolean().default(true),
});
export type ConceptoRequest = z.input<typeof conceptoSchema>;
export type ConceptoResponse = z.output<typeof conceptoSchema>;

export const tarifaRequestSchema = z
  .object({
    cargoId: z.string().trim().min(1, { error: 'validation.required' }),
    paisCodigo: paisSchema,
    conceptoCodigo: z.string().trim().min(1, { error: 'validation.required' }),
    valor: decimalSchema,
    moneda: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { error: 'validation.currency' }),
    vigenteDesde: fechaSchema,
    vigenteHasta: fechaSchema.nullish().or(z.literal('')).transform((v) => v || null),
  })
  .refine((t) => !t.vigenteHasta || t.vigenteHasta >= t.vigenteDesde, { error: 'validation.endBeforeStart', path: ['vigenteHasta'] });
export type TarifaRequest = z.input<typeof tarifaRequestSchema>;

export const tarifaResponseSchema = z.object({
  id: z.string(),
  cargoId: z.string(),
  paisCodigo: z.string(),
  conceptoCodigo: z.string(),
  valor: moneySchema,
  vigenteDesde: z.string(),
  vigenteHasta: z.string().nullable(),
});
export type TarifaResponse = z.infer<typeof tarifaResponseSchema>;

export const cierreTarifaRequestSchema = z.object({ vigenteHasta: fechaSchema });
