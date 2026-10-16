"""Lo que comparten los scripts de lectura: la configuración del sistema desde la BD, sin Redis."""

from __future__ import annotations

import dataclasses

from sqlalchemy.ext.asyncio import AsyncEngine

from app.adapters.outbound.infra import SystemClock
from app.adapters.outbound.persistence.uow import UnitOfWorkFactory, create_engine
from app.application.access import AccessPolicy
from app.application.reading import ConfigProvider, ReadingConfig
from app.application.settings import SettingsService
from app.config import Settings


class _NoSharedCache:
    """Sin Redis: cada lectura de la configuración va a la BD (para scripts basta)."""

    async def current(self, namespace: str) -> int | None:
        return None

    async def bump(self, namespace: str) -> None:
        return None


def reading_config(
    settings: Settings, routing: str | None = None, prompt_version: str | None = None
) -> tuple[AsyncEngine, ConfigProvider]:
    engine = create_engine(settings.DATABASE_URL, 2)
    clock = SystemClock()
    runtime = SettingsService(UnitOfWorkFactory(engine), AccessPolicy(clock), clock, _NoSharedCache())

    async def config() -> ReadingConfig:
        current = ReadingConfig.from_settings(await runtime.current())
        if routing:
            current = dataclasses.replace(current, routing=routing)
        if prompt_version:
            current = dataclasses.replace(
                current, extraction=dataclasses.replace(current.extraction, prompt_version=prompt_version)
            )
        return current

    return engine, config
