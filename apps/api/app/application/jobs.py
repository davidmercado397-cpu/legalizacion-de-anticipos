"""Tareas periódicas en proceso (reintentos de lectura, tasas de cambio...). Con varios workers, un
candado en Redis hace que cada ronda la ejecute uno solo; las tareas igual son idempotentes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.domain.ports import DistributedLock

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Job:
    name: str
    interval_seconds: float
    run: Callable[[], Awaitable[object]]


class PeriodicJobs:
    def __init__(self, jobs: list[Job], lock: DistributedLock) -> None:
        self._jobs = jobs
        self._lock = lock

    async def run_forever(self) -> None:
        await asyncio.gather(*(self._loop(job) for job in self._jobs))

    async def run_once(self, job: Job) -> bool:
        # El candado dura casi todo el intervalo: otro worker no repite la ronda aunque su reloj vaya adelantado.
        if not await self._lock.acquire(f"job:{job.name}", job.interval_seconds * 0.9):
            return False
        try:
            result = await job.run()
            if result:
                logger.info("Job %s done: %s", job.name, result)
        except Exception:  # noqa: BLE001 - si una ronda falla, la siguiente vuelve a intentarlo
            logger.exception("Job %s failed", job.name)
        return True

    async def _loop(self, job: Job) -> None:
        while True:
            await self.run_once(job)
            await asyncio.sleep(job.interval_seconds)
