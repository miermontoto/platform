// tablas canónicas del changelog. cada app las instancia en su schema (drizzle-kit
// las ve allí) y genera la migración. la tabla de entradas es agnóstica al usuario
// (changelog global de la app); la de "visto" referencia la tabla de users, con dos
// variantes según el tipo de id de la app: integer (sis, duckhunt) o text/uuid
// (carreterinas), igual que @platform/auth.
import { index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { ChangelogChange } from './changelog-types.js';

/** entradas del changelog, una por versión publicada. clave = version. */
export function defineChangelogTable(name = 'changelog_entry') {
  return sqliteTable(
    name,
    {
      version: text('version').primaryKey(),
      publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
      title: text('title'),
      // changes viaja como json: sqlite no tiene tipo array y el shape es estable
      changes: text('changes', { mode: 'json' }).$type<ChangelogChange[]>().notNull(),
    },
    (t) => [index('idx_changelog_published').on(t.publishedAt)],
  );
}

/** "visto" por usuario (id integer): una fila por usuario con el corte de lectura. */
export function defineChangelogSeenTable(userIdRef: () => AnySQLiteColumn, name = 'changelog_seen') {
  return sqliteTable(name, {
    userId: integer('user_id')
      .primaryKey()
      .references(userIdRef, { onDelete: 'cascade' }),
    seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
  });
}

/** "visto" por usuario (id text/uuid). */
export function defineChangelogSeenTableText(userIdRef: () => AnySQLiteColumn, name = 'changelog_seen') {
  return sqliteTable(name, {
    userId: text('user_id')
      .primaryKey()
      .references(userIdRef, { onDelete: 'cascade' }),
    seenAt: integer('seen_at', { mode: 'timestamp_ms' }).notNull(),
  });
}

export type ChangelogTable = ReturnType<typeof defineChangelogTable>;
export type ChangelogSeenTable = ReturnType<typeof defineChangelogSeenTable>;
export type ChangelogSeenTableText = ReturnType<typeof defineChangelogSeenTableText>;
export type AnyChangelogSeenTable = ChangelogSeenTable | ChangelogSeenTableText;
