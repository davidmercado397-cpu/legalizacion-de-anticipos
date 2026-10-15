import { sql } from 'drizzle-orm';
import { boolean, char, date, index, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Huellas de comprobantes para detectar duplicados (ADR-0007). Los índices únicos
 * parciales son la garantía final ante peticiones concurrentes.
 */
export const huellasComprobante = pgTable(
  'huellas_comprobante',
  {
    comprobanteId: text('comprobante_id').primaryKey(),
    viajeroId: text('viajero_id').notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    hashPerceptual: char('hash_perceptual', { length: 16 }),
    claveFiscalTipo: text('clave_fiscal_tipo'),
    claveFiscal: text('clave_fiscal'),
    emisorId: text('emisor_id'),
    numeroDocumento: text('numero_documento'),
    fecha: date('fecha', { mode: 'string' }),
    total: numeric('total', { precision: 18, scale: 2 }),
    moneda: char('moneda', { length: 3 }),
    vigente: boolean('vigente').notNull().default(true),
    registradoEn: timestamp('registrado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('huellas_sha256_vigente_uq').on(t.sha256).where(sql`${t.vigente}`),
    uniqueIndex('huellas_clave_fiscal_vigente_uq')
      .on(t.claveFiscal)
      .where(sql`${t.vigente} AND ${t.claveFiscal} IS NOT NULL`),
    uniqueIndex('huellas_emisor_numero_vigente_uq')
      .on(t.emisorId, t.numeroDocumento)
      .where(sql`${t.vigente} AND ${t.emisorId} IS NOT NULL AND ${t.numeroDocumento} IS NOT NULL`),
    index('huellas_emisor_fecha_idx').on(t.emisorId, t.fecha).where(sql`${t.vigente}`),
  ],
);
