import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const empresas = pgTable(
  'empresas',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    nit: text('nit').notNull(),
    activa: boolean('activa').notNull().default(true),
  },
  (t) => [uniqueIndex('empresas_nit_uq').on(t.nit)],
);

export const cargos = pgTable('cargos', {
  codigo: text('codigo').primaryKey(),
  nombre: text('nombre').notNull(),
  activo: boolean('activo').notNull().default(true),
});

export const usuarios = pgTable(
  'usuarios',
  {
    id: text('id').primaryKey(),
    nombre: text('nombre').notNull(),
    email: text('email').notNull(),
    cargoId: text('cargo_id').notNull(),
    empresaId: text('empresa_id')
      .notNull()
      .default('emp-principal')
      .references(() => empresas.id),
    jefeInmediatoId: text('jefe_inmediato_id').references((): any => usuarios.id),
    jefeDirectivoId: text('jefe_directivo_id').references((): any => usuarios.id),
    roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usuarios_email_uq').on(sql`lower(${t.email})`),
    index('usuarios_jefe_inmediato_idx').on(t.jefeInmediatoId),
    check('usuarios_no_autojefe', sql`${t.jefeInmediatoId} IS DISTINCT FROM ${t.id}`),
  ],
);
