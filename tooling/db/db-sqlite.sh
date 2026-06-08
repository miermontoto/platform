#!/bin/bash
# acceso genérico a la sqlite EN CALIENTE de las apps de la plataforma.
# pensado para que un agente (o un humano) consulte/modifique los datos de una
# app en marcha sin pararla: lee el wal en su sitio y devuelve json estructurado.
#
# modos (igual que backup-sqlite.sh):
#   docker  → ejecuta better-sqlite3 DENTRO del contenedor (node + better-sqlite3
#             ya presentes); ve los datos vivos respetando el wal.
#   local   → usa python3 stdlib sqlite3 sobre un fichero local.
#
# el sql NUNCA se interpola en el script: viaja por variables de entorno (DBQ_*),
# así que comillas, $, backticks, etc. en la consulta son seguros.
#
# comandos:
#   query "<sql>"     una sola sentencia. select → {rows,rowCount};
#                     insert/update/delete → {changes,lastInsertRowid}.
#                     usar "-" para leer el sql de stdin.
#   exec  "<sql>"     script multi-sentencia (migraciones/seeds). → {ok:true}.
#                     usar "-" para leer de stdin.
#   tables            lista tablas y vistas (sin las internas sqlite_*).
#   schema [tabla]    ddl de todas las tablas/índices, o de una sola.
#   count <tabla>     número de filas de una tabla.
#
# uso:
#   db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db tables
#   db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db \
#       query "select id,name from users where active = 1 limit 20"
#   db-sqlite.sh --mode local --db ./packages/api/data/duckhunt.db \
#       --format table schema
#   echo "update flags set on=1 where k='beta'" | \
#       db-sqlite.sh --container sis-sis-1 --db /app/data/sis.db query -
#
# flags:
#   --app NAME        etiqueta de logs/errores (default 'db')
#   --mode docker|local   (default: docker si hay --container, si no local)
#   --container NAME   contenedor docker (requerido en modo docker)
#   --db PATH          ruta de la db (dentro del contenedor en docker, local en local)
#   --format json|table|csv   formato de salida (default json)
#   --pretty           json indentado (requiere python3 en el host)
#   --readonly         abre la conexión en solo lectura (seguridad opt-in)
#   --timeout MS       busy_timeout en ms (default 5000)
#   -h|--help

set -euo pipefail

APP="db"
MODE=""
CONTAINER=""
DB_PATH=""
FORMAT="json"
PRETTY=0
READONLY=0
TIMEOUT=5000

usage() {
  sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# --- parseo de flags (se detienen en el primer no-flag = comando) ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    --pretty) PRETTY=1; shift ;;
    --readonly) READONLY=1; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    --) shift; break ;;
    -*) echo "[$APP] flag desconocida: $1" >&2; usage 1 ;;
    *) break ;;
  esac
done

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || { echo "[$APP] falta el comando (query|exec|tables|schema|count)" >&2; usage 1; }
shift || true

# modo por defecto: docker si hay contenedor
[[ -z "$MODE" ]] && { [[ -n "$CONTAINER" ]] && MODE="docker" || MODE="local"; }
[[ -n "$DB_PATH" ]] || { echo "[$APP] --db requerido" >&2; exit 1; }
[[ "$MODE" == "docker" && -z "$CONTAINER" ]] && { echo "[$APP] --container requerido en modo docker" >&2; exit 1; }
case "$FORMAT" in json|table|csv) ;; *) echo "[$APP] --format inválido: $FORMAT (json|table|csv)" >&2; exit 1 ;; esac

valid_ident() { [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; }

# --- comando → (DBQ_MODE, DBQ_SQL) ---
DBQ_MODE="query"
DBQ_SQL=""
case "$COMMAND" in
  query|exec)
    SQL="${1:-}"
    [[ -n "$SQL" ]] || { echo "[$APP] '$COMMAND' requiere sql (o '-' para stdin)" >&2; exit 1; }
    [[ "$SQL" == "-" ]] && SQL="$(cat)"
    DBQ_MODE="$COMMAND"
    DBQ_SQL="$SQL"
    ;;
  tables)
    DBQ_SQL="select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by type, name"
    ;;
  schema)
    TBL="${1:-}"
    if [[ -n "$TBL" ]]; then
      valid_ident "$TBL" || { echo "[$APP] nombre de tabla inválido: $TBL" >&2; exit 1; }
      DBQ_SQL="select type, name, sql from sqlite_master where sql is not null and tbl_name = '$TBL' order by type, name"
    else
      DBQ_SQL="select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by type, name"
    fi
    ;;
  count)
    TBL="${1:-}"
    [[ -n "$TBL" ]] || { echo "[$APP] 'count' requiere el nombre de la tabla" >&2; exit 1; }
    valid_ident "$TBL" || { echo "[$APP] nombre de tabla inválido: $TBL" >&2; exit 1; }
    DBQ_SQL="select count(*) as n from \"$TBL\""
    ;;
  *)
    echo "[$APP] comando desconocido: $COMMAND (query|exec|tables|schema|count)" >&2; usage 1 ;;
esac

# runner node (docker): script fijo, todo por env. solo comillas simples, sin $ ni
# backticks → seguro al ir entre comillas dobles de bash.
NODE_RUNNER="
const Database = require('better-sqlite3');
const ro = process.env.DBQ_READONLY === '1';
const to = parseInt(process.env.DBQ_TIMEOUT || '5000', 10);
try {
  const db = new Database(process.env.DBQ_PATH, { readonly: ro, timeout: to, fileMustExist: true });
  db.pragma('busy_timeout = ' + to);
  const sql = process.env.DBQ_SQL || '';
  let out;
  if (process.env.DBQ_MODE === 'exec') {
    db.exec(sql);
    out = { ok: true };
  } else {
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const rows = stmt.all();
      out = { rows: rows, rowCount: rows.length };
    } else {
      const info = stmt.run();
      out = { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    }
  }
  db.close();
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String((e && e.message) || e) }));
  process.exit(1);
}
"

run_docker() {
  docker exec \
    -e DBQ_PATH="$DB_PATH" \
    -e DBQ_SQL="$DBQ_SQL" \
    -e DBQ_MODE="$DBQ_MODE" \
    -e DBQ_READONLY="$READONLY" \
    -e DBQ_TIMEOUT="$TIMEOUT" \
    "$CONTAINER" node -e "$NODE_RUNNER"
}

run_local() {
  DBQ_PATH="$DB_PATH" DBQ_SQL="$DBQ_SQL" DBQ_MODE="$DBQ_MODE" \
  DBQ_READONLY="$READONLY" DBQ_TIMEOUT="$TIMEOUT" \
  python3 - <<'PYEOF'
import os, json, sqlite3, sys
path = os.environ['DBQ_PATH']
ro = os.environ.get('DBQ_READONLY') == '1'
to = float(os.environ.get('DBQ_TIMEOUT', '5000')) / 1000.0
mode = os.environ.get('DBQ_MODE', 'query')
sql = os.environ.get('DBQ_SQL', '')
try:
    if ro:
        con = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=to)
    else:
        con = sqlite3.connect(path, timeout=to)
    con.row_factory = sqlite3.Row
    if mode == 'exec':
        con.executescript(sql)
        con.commit()
        out = {'ok': True}
    else:
        cur = con.execute(sql)
        if cur.description:
            rows = [dict(r) for r in cur.fetchall()]
            out = {'rows': rows, 'rowCount': len(rows)}
        else:
            con.commit()
            out = {'changes': cur.rowcount, 'lastInsertRowid': cur.lastrowid}
    con.close()
    sys.stdout.write(json.dumps(out, default=str))
except Exception as e:
    sys.stdout.write(json.dumps({'error': str(e)}))
    sys.exit(1)
PYEOF
}

# --- ejecutar el runner, capturando json y código de salida ---
set +e
if [[ "$MODE" == "docker" ]]; then
  RESULT="$(run_docker)"
else
  RESULT="$(run_local)"
fi
CODE=$?
set -e

# --- formatear en el host (json passthrough; table/csv/pretty via python3) ---
if [[ "$FORMAT" == "json" && "$PRETTY" -eq 0 ]]; then
  printf '%s\n' "$RESULT"
else
  FMT="$FORMAT" PRETTY="$PRETTY" python3 - "$RESULT" <<'PYEOF'
import json, os, sys, csv, io
fmt = os.environ.get('FMT', 'json')
pretty = os.environ.get('PRETTY') == '1'
try:
    data = json.loads(sys.argv[1])
except Exception:
    # no era json (mensaje suelto): imprimir tal cual
    sys.stdout.write(sys.argv[1] + '\n'); sys.exit(0)

if fmt == 'json':
    sys.stdout.write(json.dumps(data, indent=2 if pretty else None, ensure_ascii=False) + '\n')
    sys.exit(0)

rows = data.get('rows')
if rows is None:
    # resultado escalar/no tabular: una línea json
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + '\n'); sys.exit(0)
if not rows:
    sys.stdout.write('(0 filas)\n'); sys.exit(0)

cols = list(rows[0].keys())
if fmt == 'csv':
    w = csv.writer(sys.stdout)
    w.writerow(cols)
    for r in rows:
        w.writerow(['' if r.get(c) is None else r.get(c) for c in cols])
else:  # table
    def s(v): return '' if v is None else str(v)
    widths = {c: max(len(c), *(len(s(r.get(c))) for r in rows)) for c in cols}
    line = '  '.join(c.ljust(widths[c]) for c in cols)
    sys.stdout.write(line + '\n')
    sys.stdout.write('  '.join('-' * widths[c] for c in cols) + '\n')
    for r in rows:
        sys.stdout.write('  '.join(s(r.get(c)).ljust(widths[c]) for c in cols) + '\n')
PYEOF
fi

exit "$CODE"
