-- Mínimo privilegio en PostgreSQL. Se ejecuta como administrador de la BD, en dos pasos:
--   1) Antes de la primera migración: todo hasta la línea "PASO 2".
--   2) Después de `alembic upgrade head` (cuando ya existe audit_log): el bloque "PASO 2".
--   gastos_migrator: dueño del esquema; aplica las migraciones (MIGRATION_DATABASE_URL).
--   gastos_app:      lo usa la API (DATABASE_URL); solo lee y escribe datos, sin DDL, y sobre la
--                    auditoría solo puede insertar y leer.
-- Reemplaza las contraseñas por valores aleatorios largos antes de ejecutarlo.

CREATE ROLE gastos_migrator LOGIN PASSWORD 'CAMBIAR-migrator';
CREATE ROLE gastos_app LOGIN PASSWORD 'CAMBIAR-app';

ALTER DATABASE gastos OWNER TO gastos_migrator;
ALTER SCHEMA public OWNER TO gastos_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gastos_app;

-- Tablas presentes y futuras creadas por el rol de migraciones.
SET ROLE gastos_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gastos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gastos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gastos_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gastos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gastos_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO gastos_app;

RESET ROLE;

-- PASO 2 (después de la primera migración)
-- Auditoría: además del trigger que bloquea UPDATE/DELETE/TRUNCATE, la app no tiene esos permisos.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM gastos_app;
