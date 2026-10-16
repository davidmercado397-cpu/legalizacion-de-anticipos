#!/usr/bin/env bash
# Respaldo lógico comprimido de PostgreSQL. Se programa a diario (Coolify o cron) y antes de cada
# despliegue con migraciones. Opcional: copia cifrada a R2 con BACKUP_R2_URI (s3://bucket/ruta).
#   DATABASE_URL=postgresql://... ./scripts/backup_db.sh /ruta/respaldos
set -euo pipefail
OUT_DIR=${1:-./backups}
URL=${DATABASE_URL/postgresql+asyncpg:/postgresql:}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/gastos-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges --file "$FILE" "$URL"
sha256sum "$FILE" > "$FILE.sha256"
echo "Respaldo: $FILE ($(du -h "$FILE" | cut -f1))"
if [[ -n "${BACKUP_R2_URI:-}" ]]; then
  # Se cifra antes de salir del servidor; la llave vive fuera de la BD (gestor de secretos).
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_ENCRYPTION_KEY
  aws s3 cp "$FILE.enc" "$BACKUP_R2_URI/" --endpoint-url "$R2_ENDPOINT_URL"
fi
