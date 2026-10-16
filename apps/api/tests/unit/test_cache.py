from __future__ import annotations

from fakeredis import FakeAsyncRedis

from app.adapters.outbound.infra import RedisCacheVersions
from app.application.cache import SharedCache


class _BrokenRedis:
    async def get(self, key: str) -> None:
        raise ConnectionError("redis down")

    async def incr(self, key: str) -> None:
        raise ConnectionError("redis down")


async def test_invalidating_in_one_worker_invalidates_all() -> None:
    redis = FakeAsyncRedis()
    worker_a = SharedCache[str, int]("ns", RedisCacheVersions(redis), ttl_seconds=60)
    worker_b = SharedCache[str, int]("ns", RedisCacheVersions(redis), ttl_seconds=60)
    loads = []

    async def load() -> int:
        loads.append(1)
        return len(loads)

    assert await worker_a.get_or_load("k", load) == 1
    assert await worker_a.get_or_load("k", load) == 1  # servido desde la caché
    assert await worker_b.get_or_load("k", load) == 2
    await worker_b.invalidate()
    assert await worker_a.get_or_load("k", load) == 3  # el otro worker ya no sirve el valor viejo


async def test_without_redis_the_cache_is_bypassed_instead_of_serving_stale_data() -> None:
    cache = SharedCache[str, int]("ns", RedisCacheVersions(_BrokenRedis()), ttl_seconds=60)  # type: ignore[arg-type]
    calls = []

    async def load() -> int:
        calls.append(1)
        return 7

    assert await cache.get_or_load("k", load) == 7
    assert await cache.get_or_load("k", load) == 7
    assert len(calls) == 2
    await cache.invalidate()  # no lanza aunque Redis no responda
