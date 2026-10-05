// instrumentación de better-sqlite3: cronometra cada sentencia (run/get/all) y abre un
// span CLIENT hijo cuando hay una traza activa (request http, tick de un poller). las que
// superan el umbral se loguean siempre, haya traza o no: better-sqlite3 es síncrono, así
// que una query lenta bloquea el event loop entero y es lo primero que hay que ver.
//
// se parchea el prototipo de Statement (compartido por todas las conexiones del proceso)
// en vez de envolver cada statement en un proxy: cero asignaciones extra por query.
// iterate() no se cronometra (su coste se reparte entre las iteraciones del caller).
import type Database from 'better-sqlite3';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { createLogger, tracer } from '@platform/observability';

/** umbral por defecto de query lenta en ms (DB_SLOW_QUERY_MS lo sobrescribe). */
export const DEFAULT_SLOW_QUERY_MS = 100;

const EXEC_METHODS = ['run', 'get', 'all'] as const;
// marca en el prototipo para parchearlo una sola vez por proceso (o worker thread)
const PATCHED = Symbol.for('platform.db.instrumented');
const DB_SYSTEM = 'sqlite';
// primera palabra (operación) y tabla objetivo, para nombrar el span `SELECT albums`
const OPERATION_RE = /^\s*(\w+)/;
const TABLE_RE = /\b(?:from|into|update|join)\s+["`[]?(\w+)/i;

type Method = (typeof EXEC_METHODS)[number];
type Exec = (this: Database.Statement, ...params: unknown[]) => unknown;
type StatementProto = Record<Method, Exec> & { [PATCHED]?: boolean };

// filas devueltas (get/all) o afectadas (run): distingue una query lenta por volumen
const ROWS: Record<Method, readonly [string, (result: unknown) => number]> = {
  run: ['db.response.affected_rows', (r) => (r as Database.RunResult).changes],
  get: ['db.response.returned_rows', (r) => (r === undefined ? 0 : 1)],
  all: ['db.response.returned_rows', (r) => (r as unknown[]).length],
};

const log = createLogger('db');
// umbral global del proceso: el prototipo es compartido, así que manda la última conexión
let slowMs = DEFAULT_SLOW_QUERY_MS;

const describe = (sql: string) => {
  const operation = OPERATION_RE.exec(sql)?.[1]?.toUpperCase() ?? 'SQL';
  const table = TABLE_RE.exec(sql)?.[1];
  return { name: table ? `${operation} ${table}` : operation, operation, table };
};

const startQuerySpan = (sql: string) => {
  const { name, operation, table } = describe(sql);
  return tracer.startSpan(name, {
    kind: SpanKind.CLIENT,
    attributes: {
      'db.system.name': DB_SYSTEM,
      'db.operation.name': operation,
      'db.query.text': sql,
      ...(table && { 'db.collection.name': table }),
    },
  });
};

function timed(method: Method, original: Exec): Exec {
  const [rowsAttr, countRows] = ROWS[method];
  return function (this: Database.Statement, ...params: unknown[]) {
    const sql = this.source;
    const span = trace.getActiveSpan() ? startQuerySpan(sql) : undefined;
    const start = performance.now();
    let rows: number | undefined;
    try {
      const result = original.apply(this, params);
      rows = countRows(result);
      span?.setAttribute(rowsAttr, rows);
      return result;
    } catch (err) {
      span?.recordException(err as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span?.end();
      const ms = Math.round(performance.now() - start);
      if (ms >= slowMs) {
        log.warn(`query lenta (${ms}ms): ${describe(sql).name}`, {
          'db.query.text': sql,
          duration_ms: ms,
          ...(rows !== undefined && { [rowsAttr]: rows }),
        });
      }
    }
  };
}

/** instrumenta las sentencias de la conexión (y de cualquier otra del mismo proceso). */
export function instrumentSqlite(sqlite: Database.Database, { slowQueryMs }: { slowQueryMs?: number } = {}): void {
  slowMs = slowQueryMs ?? (Number(process.env.DB_SLOW_QUERY_MS) || DEFAULT_SLOW_QUERY_MS);
  const proto = Object.getPrototypeOf(sqlite.prepare('SELECT 1')) as StatementProto;
  if (proto[PATCHED]) return;
  proto[PATCHED] = true;
  EXEC_METHODS.forEach((method) => {
    proto[method] = timed(method, proto[method]);
  });
}
