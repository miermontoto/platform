// definición canónica de la tabla de sesiones de la plataforma. cada app la
// instancia en su schema (drizzle-kit la ve allí) referenciando su tabla de users.
// dos variantes según el tipo de id de user de la app: integer (sis, duckhunt)
// o text/uuid (carreterinas).
import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// las dos factorías duplican las columnas a propósito: el tipado de drizzle
// infiere el shape exacto de la tabla solo con literales en sqliteTable().
const sessionIndexes = (t: { expiresAt: AnySQLiteColumn; userId: AnySQLiteColumn }) => [
  index('idx_session_expires').on(t.expiresAt),
  index('idx_session_user').on(t.userId),
];

/** tabla de sesiones para apps con user id integer (autoincrement). */
export function defineSessionTable(userIdRef: () => AnySQLiteColumn, name = 'auth_session') {
  return sqliteTable(
    name,
    {
      token: text('token').primaryKey(),
      userId: integer('user_id').notNull().references(userIdRef, { onDelete: 'cascade' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
      userAgent: text('user_agent'),
    },
    sessionIndexes,
  );
}

/** tabla de sesiones para apps con user id text (uuid). */
export function defineSessionTableText(userIdRef: () => AnySQLiteColumn, name = 'auth_session') {
  return sqliteTable(
    name,
    {
      token: text('token').primaryKey(),
      userId: text('user_id').notNull().references(userIdRef, { onDelete: 'cascade' }),
      createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
      userAgent: text('user_agent'),
    },
    sessionIndexes,
  );
}

export type SessionTable = ReturnType<typeof defineSessionTable>;
export type SessionTableText = ReturnType<typeof defineSessionTableText>;
export type AnySessionTable = SessionTable | SessionTableText;
