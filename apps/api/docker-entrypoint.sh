#!/bin/sh
# Aplica las migraciones (con MIGRATION_DATABASE_URL si existe) y arranca la API, que se conecta con
# DATABASE_URL (rol sin permisos de DDL). Respalda la BD de producción ANTES de desplegar una versión
# con migraciones (scripts/backup_db.sh o los respaldos programados de Coolify).
set -e
alembic upgrade head
exec uvicorn "app.main:create_app" --factory --host 0.0.0.0 --port 8000 \
  --workers "${WEB_CONCURRENCY:-2}" --loop uvloop --http httptools --proxy-headers --forwarded-allow-ips "*"
