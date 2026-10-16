import { char, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { PerfilExtracto } from '../../domain/perfil-extracto';

export const perfilesExtracto = pgTable('perfiles_extracto', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull().unique(),
  perfil: jsonb('perfil').$type<PerfilExtracto>().notNull(),
  actualizadoPor: text('actualizado_por').notNull(),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull(),
});

export const extractos = pgTable(
  'extractos',
  {
    id: uuid('id').primaryKey(),
    titularId: text('titular_id').notNull(),
    legalizacionId: uuid('legalizacion_id').notNull(),
    ultimos4: char('ultimos4', { length: 4 }),
    moneda: char('moneda', { length: 3 }).notNull(),
    archivoNombre: text('archivo_nombre').notNull(),
    /** Un mismo archivo no se carga dos veces. */
    sha256: char('sha256', { length: 64 }).notNull().unique(),
    perfil: jsonb('perfil').$type<PerfilExtracto>().notNull(),
    rechazos: jsonb('rechazos').$type<Array<{ movimientoId: string; soporteId: string }>>().notNull(),
    cargadoPor: text('cargado_por').notNull(),
    cargadoEn: timestamp('cargado_en', { withTimezone: true }).notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull(),
    version: integer('version').notNull(),
  },
  (t) => [index('extractos_titular_idx').on(t.titularId)],
);

export const movimientosExtracto = pgTable(
  'movimientos_extracto',
  {
    id: uuid('id').primaryKey(),
    extractoId: uuid('extracto_id')
      .notNull()
      .references(() => extractos.id, { onDelete: 'cascade' }),
    fila: integer('fila').notNull(),
    fecha: date('fecha', { mode: 'string' }).notNull(),
    descripcion: text('descripcion').notNull(),
    referencia: text('referencia'),
    valor: numeric('valor', { precision: 20, scale: 4 }).notNull(),
    tipo: text('tipo').$type<'DEBITO' | 'CREDITO'>().notNull(),
  },
  (t) => [index('movimientos_extracto_idx').on(t.extractoId)],
);

export const crucesExtracto = pgTable(
  'cruces_extracto',
  {
    /** Un cargo se cruza con una sola factura… */
    movimientoId: uuid('movimiento_id')
      .primaryKey()
      .references(() => movimientosExtracto.id, { onDelete: 'cascade' }),
    extractoId: uuid('extracto_id')
      .notNull()
      .references(() => extractos.id, { onDelete: 'cascade' }),
    /** …y una factura con un solo cargo, en todos los extractos. */
    soporteId: uuid('soporte_id').notNull().unique(),
    legalizacionId: uuid('legalizacion_id').notNull(),
    puntaje: numeric('puntaje', { precision: 4, scale: 3 }),
    estado: text('estado').$type<'AUTOMATICO' | 'SUGERIDO' | 'CONFIRMADO' | 'MANUAL'>().notNull(),
    montoSoporte: numeric('monto_soporte', { precision: 20, scale: 4 }),
    decididoPor: text('decidido_por'),
    decididoEn: timestamp('decidido_en', { withTimezone: true }),
  },
  (t) => [index('cruces_extracto_idx').on(t.extractoId)],
);
