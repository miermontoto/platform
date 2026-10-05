#!/bin/bash
# consulta las trazas y logs de las apps de la plataforma en openobserve.
# pensado para que un agente (o un humano) investigue errores, endpoints o queries
# lentas, o una request concreta, sin abrir la ui: devuelve json compacto (jq).
#
# credenciales: O2_URL / O2_ORG / O2_USER / O2_PASSWORD en el entorno o, si faltan,
# el .env de este directorio (ZO_ROOT_USER_EMAIL / ZO_ROOT_USER_PASSWORD del compose).
#
# comandos:
#   errors              logs de nivel error (con trace_id para saltar a la traza)
#   slow                spans más lentos: requests http, queries sqlite, fetch salientes
#   queries             sql agrupado por sentencia (con placeholders ?) por tiempo
#                       total: hotspots y patrones n+1 (muchas llamadas baratas)
#   trace <trace_id>    árbol de spans de una traza (todos los servicios) + sus logs
#   logs                logs filtrados por --level/--scope/--grep/--trace
#   services            requests por servicio en la ventana: volumen, errores 5xx, p95
#   sql "<sql>"         sql libre sobre el stream "default" (--type logs|traces).
#                       "-" lee el sql de stdin. columnas: los atributos otel con los
#                       puntos como guiones bajos (http.route → http_route); duration
#                       en µs, _timestamp en µs, start_time en ns
#
# uso:
#   obs.sh errors --service duckhunt --since 6h
#   obs.sh slow --kind db --min-ms 100
#   obs.sh queries --service sis --since 6h
#   obs.sh trace 756325d7eadf18bfb9d4d44c4470042e
#   obs.sh logs --service sis --scope poll --grep spotify --since 30m
#   obs.sh sql --type traces 'SELECT http_route, count(*) AS n FROM "default" GROUP BY http_route ORDER BY n DESC'
#
# flags:
#   --since DUR       ventana hacia atrás: 45s, 30m, 6h, 2d (default 1h; trace: 7d)
#   --service NAME    filtra por service.name (sis, duckhunt, carreterinas, mier.info, fantasy)
#   --limit N         máximo de filas (default 50)
#   --level LVL       logs: debug|info|warn|error
#   --scope NAME      logs: scope del logger (el [scope] de la línea)
#   --grep TEXT       logs: substring del mensaje
#   --trace ID        logs: solo los de esa traza
#   --kind K          slow: http|db|fetch|all (default all)
#   --min-ms N        slow: duración mínima en ms (default 0)
#   --type T          sql: logs|traces (default logs)
#   --raw             sql/trace/logs: hits tal cual, sin compactar
#   -h|--help

set -euo pipefail

SINCE=""
SERVICE=""
LIMIT=50
LEVEL=""
SCOPE=""
GREP=""
TRACE=""
KIND="all"
MIN_MS=0
TYPE="logs"
RAW=0
# líneas de stack que se conservan en la salida compacta
STACK_LINES=10
STREAM="default"
ENV_FILE="$(dirname "$0")/.env"

usage() {
  sed -n '2,43p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() {
  echo "[obs] $*" >&2
  exit 1
}

# --- parseo de flags (posicionales = comando y su argumento) ---
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --level) LEVEL="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --grep) GREP="$2"; shift 2 ;;
    --trace) TRACE="$2"; shift 2 ;;
    --kind) KIND="$2"; shift 2 ;;
    --min-ms) MIN_MS="$2"; shift 2 ;;
    --type) TYPE="$2"; shift 2 ;;
    --raw) RAW=1; shift ;;
    -h|--help) usage 0 ;;
    -) POSITIONAL+=("$1"); shift ;;
    -*) die "flag desconocida: $1" ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"
COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || { echo "[obs] falta el comando" >&2; usage 1; }
shift

command -v jq >/dev/null || die "falta jq"
[[ "$LIMIT" =~ ^[0-9]+$ ]] || die "--limit debe ser un entero"
[[ "$MIN_MS" =~ ^[0-9]+$ ]] || die "--min-ms debe ser un entero"

# --- credenciales: entorno o .env del compose (parseado, no `source`: la password
# lleva caracteres especiales por política de openobserve) ---
env_value() {
  [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
O2_URL="${O2_URL:-$(env_value O2_URL || true)}"
O2_URL="${O2_URL:-http://172.17.0.1:5080}"
O2_ORG="${O2_ORG:-default}"
O2_USER="${O2_USER:-$(env_value ZO_ROOT_USER_EMAIL || true)}"
O2_PASSWORD="${O2_PASSWORD:-$(env_value ZO_ROOT_USER_PASSWORD || true)}"
[[ -n "$O2_USER" && -n "$O2_PASSWORD" ]] || die "sin credenciales: exporta O2_USER/O2_PASSWORD o crea $ENV_FILE"

# --- ventana temporal en µs ---
to_seconds() {
  [[ "$1" =~ ^([0-9]+)([smhd])$ ]] || die "duración inválida: $1 (usa 45s, 30m, 6h, 2d)"
  local n="${BASH_REMATCH[1]}"
  case "${BASH_REMATCH[2]}" in
    s) echo "$n" ;;
    m) echo $((n * 60)) ;;
    h) echo $((n * 3600)) ;;
    d) echo $((n * 86400)) ;;
  esac
}
window() {
  local now
  now=$(date +%s)
  END_US=$((now * 1000000))
  START_US=$(((now - $(to_seconds "${SINCE:-$1}")) * 1000000))
}

# literal sql seguro: comillas simples duplicadas
lit() { printf "'%s'" "${1//\'/\'\'}"; }

# where con los filtros comunes (--service) sumados a las condiciones del comando
where() {
  local conds=("$@") out c
  if [[ -n "$SERVICE" ]]; then conds+=("service_name = $(lit "$SERVICE")"); fi
  [[ ${#conds[@]} -gt 0 ]] || return 0
  out="WHERE ${conds[0]}"
  for c in "${conds[@]:1}"; do out+=" AND $c"; done
  printf '%s' "$out"
}

# POST /_search; la auth viaja por un fd (fuera de la línea de comandos)
search() {
  local type="$1" sql="$2" size="${3:-$LIMIT}" body res
  body=$(jq -n --arg sql "$sql" --argjson s "$START_US" --argjson e "$END_US" --argjson n "$size" \
    '{query: {sql: $sql, start_time: $s, end_time: $e, from: 0, size: $n}}')
  res=$(curl -sS --max-time 30 -X POST "$O2_URL/api/$O2_ORG/_search?type=$type" \
    -H 'content-type: application/json' \
    -H @<(printf 'Authorization: Basic %s' "$(printf '%s:%s' "$O2_USER" "$O2_PASSWORD" | base64 -w0)") \
    -d "$body") || die "openobserve no responde en $O2_URL"
  if jq -e 'has("hits") | not' >/dev/null 2>&1 <<<"$res"; then
    jq -c '{error: (.message // .error // .)}' <<<"$res" 2>/dev/null || echo "{\"error\": $(jq -Rs . <<<"$res")}"
    exit 1
  fi
  jq -c '.hits' <<<"$res"
}

# --- formas compactas (jq) ---
JQ_COMMON='
def ts: (. / 1000000 | floor | todate);
def kind: {"0":"unspecified","1":"internal","2":"server","3":"client","4":"producer","5":"consumer"}[tostring] // .;
def stack($n): if . == null then null else (split("\n") | .[0:$n] | join("\n")) end;
def ms: (. / 1000 * 100 | round / 100);
# columnas de infraestructura que no aportan al leer un registro
def noise: test("^(_timestamp|_o2_ingest_ts|infer_.*|o2_.*|body|severity|scope|service_name|trace_id|span_id|flags|dropped_attributes_count|instrumentation_library_.*|deployment_environment_name|service_.*|exception_.*|duration|start_time|end_time|operation_name|span_kind|span_status|status_code|status_message|reference_.*|links|events)$");
def extra: with_entries(select((.key | noise | not) and .value != null and .value != ""));
def log_shape: {
  time: (._timestamp | ts), level: .severity, service: .service_name, scope, msg: .body, trace_id
}
+ (if .exception_type then {exception: {type: .exception_type, message: .exception_message, stack: (.exception_stacktrace | stack($sl))}} else {} end)
+ (extra | if length > 0 then {attrs: .} else {} end)
| with_entries(select(.value != null));
def span_shape: {
  time: (._timestamp | ts), service: .service_name, name: .operation_name, kind: (.span_kind | kind),
  ms: (.duration | ms), status: .span_status, trace_id,
  detail: (.http_route // .url_path // .db_query_text // .url_full)
} + (if .http_response_status_code then {http_status: .http_response_status_code} else {} end)
  + (if .user_id then {user_id} else {} end)
| with_entries(select(.value != null));
'

compact() { jq -c --argjson sl "$STACK_LINES" "$JQ_COMMON $1"; }

case "$COMMAND" in
  errors)
    window 1h
    search logs "SELECT * FROM \"$STREAM\" $(where "severity = 'ERROR'") ORDER BY _timestamp DESC" |
      compact 'map(log_shape)'
    ;;

  logs)
    window 1h
    conds=()
    [[ -n "$LEVEL" ]] && conds+=("severity = $(lit "$(tr '[:lower:]' '[:upper:]' <<<"$LEVEL")")")
    [[ -n "$SCOPE" ]] && conds+=("scope = $(lit "$SCOPE")")
    [[ -n "$GREP" ]] && conds+=("body LIKE $(lit "%$GREP%")")
    [[ -n "$TRACE" ]] && conds+=("trace_id = $(lit "$TRACE")")
    hits=$(search logs "SELECT * FROM \"$STREAM\" $(where "${conds[@]+"${conds[@]}"}") ORDER BY _timestamp DESC")
    [[ $RAW -eq 1 ]] && echo "$hits" || compact 'map(log_shape)' <<<"$hits"
    ;;

  slow)
    window 1h
    conds=("duration >= $((MIN_MS * 1000))")
    case "$KIND" in
      http) conds+=("span_kind = '2'") ;;
      db) conds+=("db_system_name = 'sqlite'") ;;
      fetch) conds+=("span_kind = '3'" "url_full IS NOT NULL") ;;
      all) ;;
      *) die "--kind inválido: $KIND (http|db|fetch|all)" ;;
    esac
    search traces "SELECT * FROM \"$STREAM\" $(where "${conds[@]}") ORDER BY duration DESC" |
      compact 'map(span_shape)'
    ;;

  trace)
    id="${1:-}"
    [[ "$id" =~ ^[0-9a-f]{32}$ ]] || die "trace id inválido (32 hex): '${id}'"
    window 7d
    spans=$(search traces "SELECT * FROM \"$STREAM\" WHERE trace_id = '$id' ORDER BY start_time" 1000)
    logs=$(search logs "SELECT * FROM \"$STREAM\" WHERE trace_id = '$id' ORDER BY _timestamp" 500)
    [[ $RAW -eq 1 ]] && { jq -nc --argjson s "$spans" --argjson l "$logs" '{spans: $s, logs: $l}'; exit 0; }
    # árbol en profundidad ordenado por inicio; start_ms relativo al primer span
    jq -nc --argjson s "$spans" --argjson l "$logs" --argjson sl "$STACK_LINES" "$JQ_COMMON"'
      ($s | map({key: .span_id, value: .}) | from_entries) as $by
      | ($s | group_by(.reference_parent_span_id // "") | map({key: (.[0].reference_parent_span_id // ""), value: (sort_by(.start_time) | map(.span_id))}) | from_entries) as $kids
      | ($s | map(.start_time) | min) as $t0
      | ($s | map(select((.reference_parent_span_id // "") as $p | $p == "" or $by[$p] == null)) | sort_by(.start_time) | map(.span_id)) as $roots
      | def node($id; $d): $by[$id] as $x
          | ({depth: $d, start_ms: (($x.start_time - $t0) / 1000000 * 100 | round / 100)}
             + ($x | span_shape | del(.time, .trace_id))
             + ($x | extra | del(.http_route, .url_path, .db_query_text, .url_full, .http_response_status_code, .user_id) | if length > 0 then {attrs: .} else {} end)
             + ($x.events | fromjson? // [] | map(select(.name == "exception") | {type: .["exception.type"], message: .["exception.message"], stack: (.["exception.stacktrace"] | stack($sl))}) | if length > 0 then {exceptions: .} else {} end)),
            (($kids[$id] // [])[] | node(.; $d + 1));
      {
        trace_id: ($s[0].trace_id // null),
        services: ($s | map(.service_name) | unique),
        duration_ms: (if ($s | length) > 0 then (($s | map(.end_time) | max) - $t0) / 1000000 | . * 100 | round / 100 else null end),
        spans: [$roots[] | node(.; 0)],
        logs: ($l | map(log_shape | del(.trace_id)))
      }'
    ;;

  queries)
    window 1h
    search traces "SELECT db_query_text, count(*) AS calls, sum(duration) AS total, avg(duration) AS avg, max(duration) AS max FROM \"$STREAM\" $(where "db_system_name = 'sqlite'") GROUP BY db_query_text ORDER BY total DESC" |
      compact 'map({sql: .db_query_text, calls, total_ms: (.total | ms), avg_ms: (.avg | ms), max_ms: (.max | ms)})'
    ;;

  services)
    window 1h
    search traces "SELECT service_name, count(*) AS requests, sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors, approx_percentile_cont(duration, 0.5) AS p50, approx_percentile_cont(duration, 0.95) AS p95 FROM \"$STREAM\" $(where "span_kind = '2'") GROUP BY service_name ORDER BY requests DESC" |
      compact 'map({service: .service_name, requests, errors, p50_ms: (.p50 | ms), p95_ms: (.p95 | ms)})'
    ;;

  sql)
    sql="${1:-}"
    [[ "$sql" == "-" ]] && sql=$(cat)
    [[ -n "$sql" ]] || die "falta el sql"
    [[ "$TYPE" == "logs" || "$TYPE" == "traces" ]] || die "--type inválido: $TYPE (logs|traces)"
    window 1h
    search "$TYPE" "$sql"
    ;;

  *) die "comando desconocido: $COMMAND (errors|logs|slow|queries|trace|services|sql)" ;;
esac
