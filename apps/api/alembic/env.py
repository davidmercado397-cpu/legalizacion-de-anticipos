"""Entorno async de Alembic. PostgreSQL es la única base de datos soportada."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.adapters.outbound.persistence.tables import metadata
from app.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = metadata


def _url() -> str:
    # Las migraciones corren con un rol con permisos de DDL (MIGRATION_DATABASE_URL); la app, con uno
    # que solo lee y escribe datos (DATABASE_URL). Sin la variable, se usa la misma conexión.
    settings = get_settings()
    return config.get_main_option("sqlalchemy.url") or settings.MIGRATION_DATABASE_URL or settings.DATABASE_URL


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:  # type: ignore[no-untyped-def]
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
