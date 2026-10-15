import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Credencial local (contraseña argon2id). Separada del usuario para enlazar luego Microsoft 365 (ADR-0006). */
export const credenciales = pgTable('credenciales', {
  usuarioId: text('usuario_id').primaryKey(),
  hashContrasena: text('hash_contrasena').notNull(),
  actualizadaEn: timestamp('actualizada_en', { withTimezone: true }).notNull().defaultNow(),
});

/** Sesiones con refresh token rotativo: solo se guarda el hash del token. */
export const sesiones = pgTable(
  'sesiones',
  {
    id: uuid('id').primaryKey(),
    usuarioId: text('usuario_id').notNull(),
    /** Agrupa las rotaciones de un mismo inicio de sesión para revocarlas juntas si hay reutilización. */
    familiaId: uuid('familia_id').notNull(),
    hashToken: text('hash_token').notNull().unique(),
    expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
    revocadaEn: timestamp('revocada_en', { withTimezone: true }),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sesiones_usuario_idx').on(t.usuarioId), index('sesiones_familia_idx').on(t.familiaId)],
);
