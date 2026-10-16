from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from app.domain.ports import CacheVersions


class TtlCache[K, V]:
    """Caché en proceso para lookups frecuentes que casi no cambian (identidad, contexto de compañía)."""

    def __init__(self, ttl_seconds: float, max_items: int = 5000) -> None:
        self._ttl = ttl_seconds
        self._max = max_items
        self._data: dict[K, tuple[float, V]] = {}

    def get(self, key: K) -> V | None:
        hit = self._data.get(key)
        if hit is None or hit[0] < time.monotonic():
            self._data.pop(key, None)
            return None
        return hit[1]

    def set(self, key: K, value: V) -> None:
        if len(self._data) >= self._max:
            self._data.clear()
        self._data[key] = (time.monotonic() + self._ttl, value)

    def invalidate(self, key: K | None = None) -> None:
        if key is None:
            self._data.clear()
        else:
            self._data.pop(key, None)


class SharedCache[K, V]:
    """Caché local por worker que se invalida en todos a la vez: Redis guarda un número de versión
    por espacio de nombres y cada lectura lo compara. Si Redis no responde, se lee de la BD (nunca se
    sirve un dato posiblemente viejo)."""

    def __init__(self, namespace: str, versions: CacheVersions, ttl_seconds: float) -> None:
        self._namespace = namespace
        self._versions = versions
        self._local: TtlCache[K, tuple[int, V]] = TtlCache(ttl_seconds)

    async def get_or_load(self, key: K, load: Callable[[], Awaitable[V]]) -> V:
        # La versión se lee ANTES de cargar: si alguien escribe entretanto, lo guardado queda con la
        # versión vieja y la siguiente lectura lo descarta.
        version = await self._versions.current(self._namespace)
        hit = self._local.get(key)
        if version is not None and hit is not None and hit[0] == version:
            return hit[1]
        value = await load()
        if version is not None:
            self._local.set(key, (version, value))
        return value

    async def invalidate(self) -> None:
        self._local.invalidate()
        await self._versions.bump(self._namespace)
