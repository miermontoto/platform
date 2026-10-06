// factoría de conexiones sqlite (better-sqlite3 + drizzle) con los defaults de la
// plataforma: wal, tuning de pragmas, unaccent(), instrumentación (spans + queries
// lentas), migraciones de drizzle y estadísticas del planner (pragma optimize) al abrir.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { createLogger } from '@platform/observability';
import { instrumentSqlite } from './instrument.js';

export { DEFAULT_SLOW_QUERY_MS, instrumentSqlite } from './instrument.js';

// optimize al abrir: 0x02 (analyze de lo que lo necesite) + 0x10000 (todas las tablas, no solo
// las consultadas por esta conexión). ver el comentario de createSqliteDb
const PRAGMA_OPTIMIZE_AT_OPEN = 'optimize=0x10002';

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
  // umbral de query lenta en ms (default: env DB_SLOW_QUERY_MS o 100)
  slowQueryMs?: number;
}

export interface SqliteDbHandle<TSchema extends Record<string, unknown>> {
  db: BetterSQLite3Database<TSchema>;
  sqlite: Database.Database;
  close: () => void;
}

export function createSqliteDb<TSchema extends Record<string, unknown>>(
  opts: SqliteDbOptions<TSchema>,
): SqliteDbHandle<TSchema> {
  const log = createLogger(opts.logTag ?? 'db');

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

  // antes de migrar: las migraciones lentas también salen en el log
  instrumentSqlite(sqlite, { slowQueryMs: opts.slowQueryMs });

  const db = drizzle(sqlite, { schema: opts.schema });

  // migrate() es idempotente; en modo throw el error sube al borde del boot
  const migrationsFolder = (opts.migrationsCandidates ?? []).find(existsSync);
  if (migrationsFolder) {
    if (opts.migrationErrorMode === 'warn') {
      try {
        migrate(db, { migrationsFolder });
        log.info('migraciones aplicadas');
      } catch {
        log.info('sin migraciones pendientes');
      }
    } else {
      migrate(db, { migrationsFolder });
      log.info('migraciones aplicadas');
    }
  }

  opts.afterOpen?.(sqlite);

  // estadísticas del planner (sqlite_stat1): sin ellas elige mal el índice de partida en joins
  // con filtro por columna poco selectiva (p.ej. entry.provider) y un join de 0.2ms tarda 30ms+.
  // 0x10002 es la llamada que recomienda sqlite al abrir una conexión de larga vida: analiza
  // solo las tablas sin stats o con stats caducadas (cambio > 10x), con analysis_limit
  // temporal (sqlite >= 3.46), así que tras la primera vez es casi gratis. va después de
  // afterOpen para cubrir también las tablas del ddl legacy.
  sqlite.pragma(PRAGMA_OPTIMIZE_AT_OPEN);

  log.info(`conectado a ${dbPath} (wal)`);
  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
      log.info('cerrado');
    },
  };
}
