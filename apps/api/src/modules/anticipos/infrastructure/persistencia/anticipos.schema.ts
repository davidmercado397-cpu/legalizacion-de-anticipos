import { sql } from 'drizzle-orm';
import { char, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ViajeAnticipo } from '../../domain/anticipo';

export const anticipos = pgTable(
  'anticipos',
  {
    id: uuid('id').primaryKey(),
    /** Único: una solicitud aprobada genera un solo anticipo (idempotencia del evento). */
    solicitudId: uuid('solicitud_id').notNull().unique(),
    viajeroId: text('viajero_id').notNull(),
    monto: numeric('monto', { precision: 18, scale: 2 }).notNull(),
    moneda: char('moneda', { length: 3 }).notNull(),
    viaje: jsonb('viaje').$type<ViajeAnticipo>().notNull(),
    estado: text('estado').notNull(),
    erpReferencia: text('erp_referencia'),
    erpUltimoError: text('erp_ultimo_error'),
    erpIntentos: integer('erp_intentos').notNull().default(0),
    desembolsoFecha: date('desembolso_fecha', { mode: 'string' }),
    desembolsoMedio: text('desembolso_medio'),
    desembolsoReferencia: text('desembolso_referencia'),
    desembolsadoPor: text('desembolsado_por'),
    desembolsadoEn: timestamp('desembolsado_en', { withTimezone: true }),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    index('anticipos_viajero_idx').on(t.viajeroId),
    index('anticipos_estado_idx').on(t.estado),
    check('anticipos_estado_ck', sql`${t.estado} IN ('PENDIENTE_ERP', 'POR_DESEMBOLSAR', 'DESEMBOLSADO', 'LEGALIZADO')`),
    check('anticipos_monto_ck', sql`${t.monto} > 0`),
  ],
);
