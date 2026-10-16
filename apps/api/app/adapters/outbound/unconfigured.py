"""Reemplazo de una integración sin credenciales: la app arranca igual y cada llamada falla con un
error claro (503 en la API) en vez de degradarse en silencio."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from app.domain.errors import ServiceNotConfiguredError


class UnconfiguredService:
    def __init__(self, service: str) -> None:
        self.service = service

    def __getattr__(self, name: str) -> Callable[..., Coroutine[Any, Any, Any]]:
        async def fail(*args: Any, **kwargs: Any) -> Any:
            raise ServiceNotConfiguredError(self.service)

        return fail
