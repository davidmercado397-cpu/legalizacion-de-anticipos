import { sql } from 'drizzle-orm';
import { boolean, char, check, date, index, numeric, pgTable, text } from 'drizzle-orm/pg-core';

export const conceptosViatico = pgTable(
  'conceptos_viatico',
  {
    codigo: text('codigo').primaryKey(),
    nombre: text('nombre').notNull(),
    unidad: text('unidad').notNull(),
    activo: boolean('activo').notNull().default(true),
  },
  (t) => [check('conceptos_unidad_ck', sql`${t.unidad} IN ('NOCHE', 'DIA')`)],
);

export const tarifas = pgTable(
  'tarifas',
  {
    id: text('id').primaryKey(),
    cargoId: text('cargo_id').notNull(),
    paisCodigo: char('pais_codigo', { length: 2 }).notNull(),
    conceptoCodigo: text('concepto_codigo')
      .notNull()
      .references(() => conceptosViatico.codigo),
    valor: numeric('valor', { precision: 18, scale: 2 }).notNull(),
    moneda: char('moneda', { length: 3 }).notNull(),
    vigenteDesde: date('vigente_desde', { mode: 'string' }).notNull(),
    vigenteHasta: date('vigente_hasta', { mode: 'string' }),
  },
  (t) => [
    index('tarifas_cargo_pais_idx').on(t.cargoId, t.paisCodigo),
    check('tarifas_valor_ck', sql`${t.valor} >= 0`),
    check('tarifas_vigencia_ck', sql`${t.vigenteHasta} IS NULL OR ${t.vigenteHasta} >= ${t.vigenteDesde}`),
  ],
);
