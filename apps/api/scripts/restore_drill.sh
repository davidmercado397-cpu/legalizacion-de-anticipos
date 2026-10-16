#!/usr/bin/env bash
# Simulacro de restauración: restaura el último respaldo en una base temporal, verifica que tenga
# datos y registra el resultado (tiempo de restauración = RTO medido). No toca la base de producción.
#   ADMIN_URL=postgresql://postgres@host/postgres ./scripts/restore_drill.sh /ruta/respaldos
set -euo pipefail
BACKUP_DIR=${1:-./backups}
ADMIN_URL=${ADMIN_URL:?Falta ADMIN_URL (usuario con permiso para crear bases)}
LATEST=$(ls -1t "$BACKUP_DIR"/gastos-*.dump | head -1)
sha256sum -c "$LATEST.sha256"
DRILL_DB="gastos_restore_drill_$(date -u +%Y%m%d%H%M%S)"
START=$(date +%s)
psql "$ADMIN_URL" -qc "CREATE DATABASE $DRILL_DB"
DRILL_URL="${ADMIN_URL%/*}/$DRILL_DB"
pg_restore --no-owner --no-privileges --dbname "$DRILL_URL" "$LATEST"
END=$(date +%s)
echo "Respaldo:         $LATEST"
echo "Restaurado en:    $((END - START)) s"
for table in companies employees advances expenses audit_log system_settings; do
  echo "Filas $table: $(psql "$DRILL_URL" -tAc "SELECT count(*) FROM $table")"
done
echo "Versión del esquema: $(psql "$DRILL_URL" -tAc 'SELECT version_num FROM alembic_version')"
psql "$ADMIN_URL" -qc "DROP DATABASE $DRILL_DB"
echo "Simulacro OK ($(date -u +%FT%TZ))"
