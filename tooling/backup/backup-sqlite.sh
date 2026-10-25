#!/bin/bash
# backup genérico de sqlite para las apps de la plataforma.
# copia segura (sqlite backup api, compatible con wal) + rotación recent/weekly.
#
# modos:
#   docker  → ejecuta better-sqlite3 .backup() DENTRO del contenedor y copia fuera
#   local   → usa python3 stdlib sqlite3.backup() sobre un fichero local
#
# opcionales:
#   --exclude-table <t>  (repetible) vacía la tabla en la copia + VACUUM. el esquema se
#                        conserva para que las migraciones no se rompan al restaurar.
#                        pensado para cachés regenerables que inflan la db.
#   --compress           comprime la copia con zstd → <name>.db.zst
#                        (restaurar: zstd -d <name>.db.zst)
#
# uso:
#   backup-sqlite.sh --app sis --mode docker --container sis-sis-1 \
#       --db /app/data/sis.db --dest ~/dev/sis/data/backups
#   backup-sqlite.sh --app duckhunt --mode local \
#       --db ./packages/api/data/duckhunt.db --dest ./data/backups
#   backup-sqlite.sh --app carreterinas --mode docker --container carreterinas-carreterinas-1 \
#       --db /app/data/app.db --dest ./data/backups --exclude-table discovered_roads --compress
#
# rotación (igual que el esquema histórico de sis):
#   <dest>/recent/  → últimas N copias (default 4, cada 6h = 24h)
#   <dest>/weekly/  → 1 por semana iso, últimas N (default 4 = 1 mes)

set -euo pipefail

APP="" MODE="" CONTAINER="" DB_PATH="" DEST=""
KEEP_RECENT=4
KEEP_WEEKLY=4
EXCLUDE_TABLES=()
COMPRESS=0
# nivel alto: las copias son pequeñas tras excluir cachés y el cron no tiene prisa
ZSTD_LEVEL=19
TABLE_NAME_RE='^[A-Za-z_][A-Za-z0-9_]*$'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --keep-recent) KEEP_RECENT="$2"; shift 2 ;;
    --keep-weekly) KEEP_WEEKLY="$2"; shift 2 ;;
    --exclude-table) EXCLUDE_TABLES+=("$2"); shift 2 ;;
    --compress) COMPRESS=1; shift ;;
    *) echo "[backup] flag desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$APP" && -n "$MODE" && -n "$DB_PATH" && -n "$DEST" ]] || {
  echo "[backup] uso: --app <name> --mode docker|local --db <path> --dest <dir> [--container <name>] [--keep-recent N] [--keep-weekly N] [--exclude-table <t>]... [--compress]" >&2
  exit 1
}
[[ "$MODE" == "docker" && -z "$CONTAINER" ]] && { echo "[backup] --container requerido en modo docker" >&2; exit 1; }
for t in "${EXCLUDE_TABLES[@]}"; do
  [[ "$t" =~ $TABLE_NAME_RE ]] || { echo "[backup] nombre de tabla inválido: $t" >&2; exit 1; }
done
(( COMPRESS )) && ! command -v zstd &>/dev/null && { echo "[backup] --compress requiere zstd" >&2; exit 1; }

# sql de vaciado de la copia: viaja por env (BKP_STRIP_SQL), nunca interpolado en el código
STRIP_SQL=""
(( ${#EXCLUDE_TABLES[@]} )) && STRIP_SQL="$(printf 'DELETE FROM "%s";' "${EXCLUDE_TABLES[@]}") VACUUM;"

RECENT_DIR="$DEST/recent"
WEEKLY_DIR="$DEST/weekly"
mkdir -p "$RECENT_DIR" "$WEEKLY_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="${APP}-${TIMESTAMP}.db"

case "$MODE" in
  docker)
    # backup api dentro del contenedor (node + better-sqlite3 ya presentes)
    CONTAINER_BACKUP="$(dirname "$DB_PATH")/_backup.db"
    echo "[backup] ($APP) creando backup seguro dentro del contenedor $CONTAINER..."
    docker exec -e BKP_STRIP_SQL="$STRIP_SQL" "$CONTAINER" node -e "
      const Database = require('better-sqlite3');
      const db = new Database('$DB_PATH', { readonly: true });
      db.backup('$CONTAINER_BACKUP').then(() => {
        db.close();
        // vaciado de tablas excluidas sobre la copia, nunca sobre la db viva
        if (process.env.BKP_STRIP_SQL) {
          const copy = new Database('$CONTAINER_BACKUP');
          copy.exec(process.env.BKP_STRIP_SQL);
          copy.close();
        }
        console.log('backup ok');
      }).catch(err => {
        console.error(err);
        process.exit(1);
      });
    "
    echo "[backup] ($APP) copiando a recent/$BACKUP_NAME..."
    docker cp "$CONTAINER:$CONTAINER_BACKUP" "$RECENT_DIR/$BACKUP_NAME"
    docker exec "$CONTAINER" rm -f "$CONTAINER_BACKUP"
    ;;
  local)
    echo "[backup] ($APP) creando backup seguro de $DB_PATH..."
    BKP_STRIP_SQL="$STRIP_SQL" python3 - "$DB_PATH" "$RECENT_DIR/$BACKUP_NAME" <<'PYEOF'
import os, sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
d = sqlite3.connect(dst)
s.backup(d)
s.close()
# vaciado de tablas excluidas sobre la copia, nunca sobre la db viva
if sql := os.environ.get('BKP_STRIP_SQL'):
    d.executescript(sql)
d.close()
print('backup ok')
PYEOF
    ;;
  *)
    echo "[backup] modo desconocido: $MODE (docker|local)" >&2; exit 1 ;;
esac

# compresión multihilo; --rm borra el .db plano al terminar
if (( COMPRESS )); then
  zstd -q -T0 -"$ZSTD_LEVEL" --rm "$RECENT_DIR/$BACKUP_NAME"
  BACKUP_NAME+=".zst"
fi

# promover a weekly si no hay backup de esta semana iso (plano o comprimido)
WEEK_TAG=$(date +%Yw%V)
if ! ls "$WEEKLY_DIR/${APP}-"*."$WEEK_TAG".db* &>/dev/null; then
  WEEKLY_NAME="${APP}-${TIMESTAMP}.${WEEK_TAG}.${BACKUP_NAME#"${APP}-${TIMESTAMP}."}"
  cp "$RECENT_DIR/$BACKUP_NAME" "$WEEKLY_DIR/$WEEKLY_NAME"
  echo "[backup] ($APP) promovido a weekly/$WEEKLY_NAME"
fi

# rotar: conservar las N más recientes por directorio (planas y .zst conviven al activar --compress)
rotate() {
  local dir=$1 keep=$2
  local files
  mapfile -t files < <(ls -1t "$dir/$APP"-*.db "$dir/$APP"-*.db.zst 2>/dev/null)
  if (( ${#files[@]} > keep )); then
    rm -f "${files[@]:keep}"
    echo "[backup] ($APP) rotados $(( ${#files[@]} - keep )) en $dir"
  fi
}
rotate "$RECENT_DIR" "$KEEP_RECENT"
rotate "$WEEKLY_DIR" "$KEEP_WEEKLY"

SIZE=$(du -h "$RECENT_DIR/$BACKUP_NAME" | cut -f1)
echo "[backup] ($APP) completado: $BACKUP_NAME ($SIZE)"
