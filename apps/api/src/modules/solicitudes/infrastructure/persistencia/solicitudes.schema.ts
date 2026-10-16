import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MotivoEscalamiento } from '../../domain/escalamiento/regla-escalamiento';
import type { TasaCambioDto } from '@viaticos/shared-kernel';

export const configuracionEscalamiento = pgTable('configuracion_escalamiento', {
  tipo: text('tipo').primaryKey(),
  activa: boolean('activa').notNull(),
  parametros: jsonb('parametros').notNull(),
  actualizadoPor: text('actualizado_por'),
  actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

export const solicitudes = pgTable(
  'solicitudes',
  {
    id: uuid('id').primaryKey(),
    viajeroId: text('viajero_id').notNull(),
    motivo: text('motivo').notNull(),
    justificacion: text('justificacion'),
    estado: text('estado').notNull(),
    monedaAnticipo: char('moneda_anticipo', { length: 3 }).notNull(),
    /** Desnormalizado para listados y reportes; la fuente de verdad son las líneas. */
    totalAnticipo: numeric('total_anticipo', { precision: 18, scale: 2 }).notNull(),
    tasas: jsonb('tasas').$type<TasaCambioDto[]>().notNull(),
    requiereJefeDirectivo: boolean('requiere_jefe_directivo').notNull(),
    motivosEscalamiento: jsonb('motivos_escalamiento').$type<MotivoEscalamiento[]>().notNull(),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull(),
    actualizadaEn: timestamp('actualizada_en', { withTimezone: true }).notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    index('solicitudes_viajero_idx').on(t.viajeroId, t.creadaEn),
    check('solicitudes_estado_ck', sql`${t.estado} IN ('EN_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA')`),
  ],
);

export const solicitudDestinos = pgTable(
  'solicitud_destinos',
  {
    solicitudId: uuid('solicitud_id')
      .notNull()
      .references(() => solicitudes.id, { onDelete: 'cascade' }),
    orden: integer('orden').notNull(),
    paisCodigo: char('pais_codigo', { length: 2 }).notNull(),
    ciudad: text('ciudad').notNull(),
    fechaInicio: date('fecha_inicio', { mode: 'string' }).notNull(),
    fechaFin: date('fecha_fin', { mode: 'string' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.solicitudId, t.orden] })],
);

export const solicitudLineas = pgTable(
  'solicitud_lineas',
  {
    solicitudId: uuid('solicitud_id')
      .notNull()
      .references(() => solicitudes.id, { onDelete: 'cascade' }),
    orden: integer('orden').notNull(),
    destinoIndice: integer('destino_indice').notNull(),
    paisCodigo: char('pais_codigo', { length: 2 }).notNull(),
    conceptoCodigo: text('concepto_codigo').notNull(),
    conceptoNombre: text('concepto_nombre').notNull(),
    unidad: text('unidad').notNull(),
    cantidad: integer('cantidad').notNull(),
    tarifaId: text('tarifa_id').notNull(),
    tarifaUnitaria: numeric('tarifa_unitaria', { precision: 18, scale: 2 }).notNull(),
    valorUnitarioSolicitado: numeric('valor_unitario_solicitado', { precision: 18, scale: 2 }).notNull(),
    moneda: char('moneda', { length: 3 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.solicitudId, t.orden] })],
);

export const solicitudPasosAprobacion = pgTable(
  'solicitud_pasos_aprobacion',
  {
    solicitudId: uuid('solicitud_id')
      .notNull()
      .references(() => solicitudes.id, { onDelete: 'cascade' }),
    orden: integer('orden').notNull(),
    nivel: text('nivel').notNull(),
    aprobadorId: text('aprobador_id').notNull(),
    estado: text('estado').notNull(),
    decididoEn: timestamp('decidido_en', { withTimezone: true }),
    comentario: text('comentario'),
  },
  (t) => [
    primaryKey({ columns: [t.solicitudId, t.orden] }),
    index('pasos_aprobador_pendiente_idx').on(t.aprobadorId).where(sql`${t.estado} = 'PENDIENTE'`),
  ],
);
