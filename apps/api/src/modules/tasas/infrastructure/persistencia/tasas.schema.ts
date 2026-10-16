import { char, date, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Caché de cotizaciones oficiales contra el dólar (auditoría: qué tasa se usó y de qué fuente). */
export const cotizacionesDolar = pgTable(
  'cotizaciones_dolar',
  {
    moneda: char('moneda', { length: 3 }).notNull(),
    fecha: date('fecha', { mode: 'string' }).notNull(),
    porDolar: numeric('por_dolar', { precision: 20, scale: 8 }).notNull(),
    fechaPublicada: date('fecha_publicada', { mode: 'string' }).notNull(),
    fuente: text('fuente').notNull(),
    consultadaEn: timestamp('consultada_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.moneda, t.fecha] })],
);
