#!/bin/bash
# backup genérico de sqlite para las apps de la plataforma.
# copia segura (sqlite backup api, compatible con wal) + rotación recent/weekly.
#
# modos:
#   docker  → ejecuta better-sqlite3 .backup() DENTRO del contenedor y copia fuera
#   local   → usa python3 stdlib sqlite3.backup() sobre un fichero local
#
# uso:
#   backup-sqlite.sh --app sis --mode docker --container sis-sis-1 \
#       --db /app/data/sis.db --dest /home/mier/dev/sis/data/backups
#   backup-sqlite.sh --app duckhunt --mode local \
#       --db ./packages/api/data/duckhunt.db --dest ./data/backups
#
# rotación (igual que el esquema histórico de sis):
#   <dest>/recent/  → últimas N copias (default 4, cada 6h = 24h)
#   <dest>/weekly/  → 1 por semana iso, últimas N (default 4 = 1 mes)

set -euo pipefail

APP="" MODE="" CONTAINER="" DB_PATH="" DEST=""
KEEP_RECENT=4
KEEP_WEEKLY=4

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) APP="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --keep-recent) KEEP_RECENT="$2"; shift 2 ;;
    --keep-weekly) KEEP_WEEKLY="$2"; shift 2 ;;
    *) echo "[backup] flag desconocida: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$APP" && -n "$MODE" && -n "$DB_PATH" && -n "$DEST" ]] || {
  echo "[backup] uso: --app <name> --mode docker|local --db <path> --dest <dir> [--container <name>] [--keep-recent N] [--keep-weekly N]" >&2
  exit 1
}
[[ "$MODE" == "docker" && -z "$CONTAINER" ]] && { echo "[backup] --container requerido en modo docker" >&2; exit 1; }

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
    docker exec "$CONTAINER" node -e "
      const Database = require('better-sqlite3');
      const db = new Database('$DB_PATH', { readonly: true });
      db.backup('$CONTAINER_BACKUP').then(() => {
        db.close();
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
    python3 - "$DB_PATH" "$RECENT_DIR/$BACKUP_NAME" <<'PYEOF'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(f'file:{src}?mode=ro', uri=True)
d = sqlite3.connect(dst)
s.backup(d)
d.close(); s.close()
print('backup ok')
PYEOF
    ;;
  *)
    echo "[backup] modo desconocido: $MODE (docker|local)" >&2; exit 1 ;;
esac

# promover a weekly si no hay backup de esta semana iso
WEEK_TAG=$(date +%Yw%V)
if ! ls "$WEEKLY_DIR/${APP}-"*."$WEEK_TAG".db &>/dev/null; then
  WEEKLY_NAME="${APP}-${TIMESTAMP}.${WEEK_TAG}.db"
  cp "$RECENT_DIR/$BACKUP_NAME" "$WEEKLY_DIR/$WEEKLY_NAME"
  echo "[backup] ($APP) promovido a weekly/$WEEKLY_NAME"
fi

# rotar: conservar las N más recientes por directorio
rotate() {
  local dir=$1 pattern=$2 keep=$3
  local total
  total=$(ls -1t "$dir"/$pattern 2>/dev/null | wc -l)
  if [ "$total" -gt "$keep" ]; then
    ls -1t "$dir"/$pattern | tail -n +"$((keep + 1))" | xargs rm -f
    echo "[backup] ($APP) rotados $((total - keep)) en $dir"
  fi
}
rotate "$RECENT_DIR" "${APP}-*.db" "$KEEP_RECENT"
rotate "$WEEKLY_DIR" "${APP}-*.db" "$KEEP_WEEKLY"

SIZE=$(du -h "$RECENT_DIR/$BACKUP_NAME" | cut -f1)
echo "[backup] ($APP) completado: $BACKUP_NAME ($SIZE)"
