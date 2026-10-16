"""Ciclo de reintentos: toma gastos atascados en RECEIVED (intento fallido, reinicio) o en PROCESSING
por demasiado tiempo (worker caído) y los vuelve a programar. Postgres hace de cola: cero infraestructura extra."""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from uuid import UUID

from app.domain.ports import Clock, UnitOfWorkFactory


class ExpenseSweeper:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        schedule: Callable[[UUID], None],
        clock: Clock,
        stale_seconds: int,
        batch_size: int = 50,
    ) -> None:
        self._uow = uow
        self._schedule = schedule
        self._clock = clock
        self._stale = timedelta(seconds=stale_seconds)
        self._batch = batch_size

    async def run_once(self) -> int:
        async with self._uow() as uow:
            ids = await uow.expenses.list_retryable(self._clock.now() - self._stale, self._batch)
        for expense_id in ids:
            self._schedule(expense_id)
        return len(ids)
