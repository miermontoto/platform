// definición canónica de la tabla de sesiones de la plataforma. cada app la
// instancia en su schema (drizzle-kit la ve allí) referenciando su tabla de users.
import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

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
    (t) => [index('idx_session_expires').on(t.expiresAt), index('idx_session_user').on(t.userId)],
  );
}

export type SessionTable = ReturnType<typeof defineSessionTable>;
