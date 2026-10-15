import { sql } from 'drizzle-orm';
import { char, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ConfiguracionExclusion } from '../../domain/reglas-exclusion';
import type { Alerta, ArchivoSoporte, DatosExtraidos } from '../../domain/tipos';
import type { DatosSoporteJson, DecisionJson, HistorialJson } from './serializacion';

export const legalizaciones = pgTable(
  'legalizaciones',
  {
    id: uuid('id').primaryKey(),
    anticipoId: uuid('anticipo_id').notNull().unique(),
    viajeroId: text('viajero_id').notNull(),
    monto: numeric('monto', { precision: 18, scale: 2 }).notNull(),
    moneda: char('moneda', { length: 3 }).notNull(),
    viajeInicio: date('viaje_inicio', { mode: 'string' }).notNull(),
    viajeFin: date('viaje_fin', { mode: 'string' }).notNull(),
    estado: text('estado').notNull(),
    historial: jsonb('historial').$type<HistorialJson[]>().notNull(),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull(),
    actualizadaEn: timestamp('actualizada_en', { withTimezone: true }).notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    index('legalizaciones_estado_idx').on(t.estado),
    check('legalizaciones_estado_ck', sql`${t.estado} IN ('ABIERTA', 'EN_REVISION', 'DEVUELTA', 'APROBADA')`),
  ],
);

export const soportes = pgTable(
  'soportes',
  {
    id: uuid('id').primaryKey(),
    legalizacionId: uuid('legalizacion_id')
      .notNull()
      .references(() => legalizaciones.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    estado: text('estado').notNull(),
    descripcion: text('descripcion').notNull(),
    archivo: jsonb('archivo').$type<ArchivoSoporte>(),
    extraccion: jsonb('extraccion').$type<DatosExtraidos>(),
    datos: jsonb('datos').$type<DatosSoporteJson>(),
    alertas: jsonb('alertas').$type<Alerta[]>().notNull(),
    decision: jsonb('decision').$type<DecisionJson>(),
    beneficiario: text('beneficiario'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('soportes_legalizacion_idx').on(t.legalizacionId),
    index('soportes_procesando_idx').on(t.estado).where(sql`${t.estado} = 'PROCESANDO'`),
    check('soportes_tipo_ck', sql`${t.tipo} IN ('FACTURA', 'RECIBO_CAJA')`),
  ],
);

/** Una sola fila (id = 1): la política vigente que administra contabilidad. */
export const politicaLegalizacion = pgTable('politica_legalizacion', {
  id: integer('id').primaryKey(),
  nitEmpresa: text('nit_empresa').notNull(),
  topesReciboCaja: jsonb('topes_recibo_caja').$type<Array<{ monto: string; moneda: string }>>().notNull(),
  exclusiones: jsonb('exclusiones').$type<ConfiguracionExclusion[]>().notNull(),
  actualizadaPor: text('actualizada_por'),
  actualizadaEn: timestamp('actualizada_en', { withTimezone: true }),
});
