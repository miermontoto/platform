// factoría de conexiones sqlite (better-sqlite3 + drizzle) con los defaults de la
// plataforma: wal, tuning de pragmas, unaccent() y migraciones de drizzle al abrir.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface SqliteDbOptions<TSchema extends Record<string, unknown>> {
  schema: TSchema;
  // ruta por defecto si no hay DATABASE_PATH (relativa a cwd)
  defaultPath: string;
  // carpetas candidatas de migraciones (dev: src/db/migrations, prod: dist/db/migrations)
  migrationsCandidates?: string[];
  // 'throw' (default): un fallo de migración tira el boot. 'warn': se loguea y sigue
  // (solo para apps legacy cuyo journal no está saneado).
  migrationErrorMode?: 'throw' | 'warn';
  // funciones sql personalizadas además de unaccent (ej. regexp)
  functions?: Record<string, (...args: unknown[]) => unknown>;
  // ddl legacy fuera de drizzle, ejecutado tras las migraciones
  afterOpen?: (sqlite: Database.Database) => void;
  // tag de logs (default 'db')
  logTag?: string;
}

export interface SqliteDbHandle<TSchema extends Record<string, unknown>> {
  db: BetterSQLite3Database<TSchema>;
  sqlite: Database.Database;
  close: () => void;
}

export function createSqliteDb<TSchema extends Record<string, unknown>>(
  opts: SqliteDbOptions<TSchema>,
): SqliteDbHandle<TSchema> {
  const tag = opts.logTag ?? 'db';

  // ruta relativa a cwd (raíz de la app en dev, /app/packages/api en docker)
  const rawPath = process.env.DATABASE_PATH || opts.defaultPath;
  const dbPath = resolve(process.cwd(), rawPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);

  // wal: lecturas concurrentes con escrituras + tuning estándar
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('synchronous = NORMAL');

  // unaccent: búsqueda sin acentos, común a todas las apps
  sqlite.function('unaccent', (s: unknown) =>
    typeof s === 'string' ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : s,
  );
  for (const [name, fn] of Object.entries(opts.functions ?? {})) {
    sqlite.function(name, fn as (...params: unknown[]) => unknown);
  }

  const db = drizzle(sqlite, { schema: opts.schema });

  // migrate() es idempotente; en modo throw el error sube al borde del boot
  const migrationsFolder = (opts.migrationsCandidates ?? []).find(existsSync);
  if (migrationsFolder) {
    if (opts.migrationErrorMode === 'warn') {
      try {
        migrate(db, { migrationsFolder });
        console.log(`[${tag}] migraciones aplicadas`);
      } catch {
        console.log(`[${tag}] sin migraciones pendientes`);
      }
    } else {
      migrate(db, { migrationsFolder });
      console.log(`[${tag}] migraciones aplicadas`);
    }
  }

  opts.afterOpen?.(sqlite);

  console.log(`[${tag}] conectado a ${dbPath} (wal)`);
  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
      console.log(`[${tag}] cerrado`);
    },
  };
}
