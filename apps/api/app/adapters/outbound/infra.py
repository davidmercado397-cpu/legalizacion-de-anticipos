from __future__ import annotations

import asyncio
import logging
import math
import time
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from typing import Any

from limits import parse
from limits.aio.strategies import MovingWindowRateLimiter
from limits.storage import storage_from_string
from redis.asyncio import Redis

logger = logging.getLogger(__name__)


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class LimitsRateLimiter:
    """Con `memory://` el límite es por proceso (aproximado si hay varios workers); con `redis://` es
    exacto sin cambiar código."""

    def __init__(self, storage_uri: str) -> None:
        options = {"implementation": "redispy"} if storage_uri.startswith("async+redis") else {}
        self._limiter = MovingWindowRateLimiter(storage_from_string(storage_uri, **options))

    async def hit(self, scope: str, key: str, limit: str) -> int | None:
        item = parse(limit)
        try:
            if await self._limiter.hit(item, scope, key):
                return None
            stats = await self._limiter.get_window_stats(item, scope, key)
        except Exception:  # noqa: BLE001 - si Redis falla se deja pasar (fail-open) en vez de tumbar la API
            logger.warning("Rate limiter unavailable, request allowed", exc_info=True)
            return None
        return max(1, math.ceil(stats.reset_time - time.time()))


class AsyncTaskRunner:
    """Las tareas quedan referenciadas hasta terminar (asyncio solo guarda referencias débiles) y los
    fallos se loguean en vez de perderse. `drain()` deja que los tests y el apagado esperen lo pendiente."""

    def __init__(self, concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(concurrency)
        self._tasks: set[asyncio.Task[Any]] = set()

    def spawn(self, factory: Callable[[], Coroutine[Any, Any, Any]]) -> None:
        task = asyncio.get_running_loop().create_task(self._run(factory))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, factory: Callable[[], Coroutine[Any, Any, Any]]) -> None:
        async with self._semaphore:
            try:
                await factory()
            except Exception:  # noqa: BLE001 - el trabajo en background nunca debe tumbar el loop
                logger.exception("Background task failed")

    async def drain(self, max_wait: float = 30.0) -> None:
        deadline = time.monotonic() + max_wait
        while self._tasks and time.monotonic() < deadline:
            await asyncio.wait(set(self._tasks), timeout=max(0.0, deadline - time.monotonic()))


class RedisCacheVersions:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def current(self, namespace: str) -> int | None:
        try:
            return int(await self._redis.get(f"cache:version:{namespace}") or 0)
        except Exception:  # noqa: BLE001 - sin Redis no se usa la caché (se lee de la BD)
            logger.warning("Cache versions unavailable", exc_info=True)
            return None

    async def bump(self, namespace: str) -> None:
        try:
            await self._redis.incr(f"cache:version:{namespace}")
        except Exception:  # noqa: BLE001 - quien falla aquí es Redis; los demás workers usarán la BD
            logger.warning("Could not invalidate cache %s", namespace, exc_info=True)


class RedisLock:
    """Candado entre workers con SET NX PX: una tarea periódica corre en un solo proceso por ronda."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def acquire(self, name: str, ttl_seconds: float) -> bool:
        try:
            return bool(await self._redis.set(f"lock:{name}", "1", nx=True, px=int(ttl_seconds * 1000)))
        except Exception:  # noqa: BLE001 - sin Redis se corre igual: las tareas son idempotentes
            logger.warning("Lock %s unavailable, running anyway", name, exc_info=True)
            return True
