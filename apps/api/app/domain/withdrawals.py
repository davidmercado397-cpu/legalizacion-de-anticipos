"""Bolsas de efectivo: las facturas pagadas en efectivo en otra moneda gastan los retiros en orden (FIFO).

Cada retiro es una bolsa con su propia tasa (la oficial del día del retiro, o la que cobró el banco). Las
facturas, en el orden en que se pagaron, toman de los retiros hechos hasta ese día, empezando por el más antiguo;
una factura puede salir de dos retiros. Lo que no alcanza a cubrirse con retiros se valora con la tasa del día de
la factura y queda para que contabilidad lo revise. Todo se recalcula completo cada vez: así no importa en qué
orden se registren los retiros y las facturas."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal

CENT = Decimal("0.01")


@dataclass(frozen=True)
class Pool:
    id: uuid.UUID
    currency: str
    day: date
    amount: Decimal
    rate: Decimal  # 1 unidad del retiro = esta cantidad en la moneda de legalización
    created_at: datetime


@dataclass(frozen=True)
class CashSpend:
    expense_id: uuid.UUID
    currency: str
    total: Decimal
    day: date | None
    at: time | None
    created_at: datetime


@dataclass(frozen=True)
class Draw:
    withdrawal_id: uuid.UUID
    amount: Decimal  # en la moneda del retiro
    rate: Decimal

    def as_dict(self) -> dict[str, str]:
        return {"withdrawal_id": str(self.withdrawal_id), "amount": str(self.amount), "rate": str(self.rate)}


@dataclass(frozen=True)
class Coverage:
    draws: tuple[Draw, ...]
    uncovered: Decimal  # en la moneda de la factura

    def value(self, uncovered_rate: Decimal | None) -> Decimal | None:
        """Valor en la moneda de legalización; None si falta la tasa del día para la parte sin retiro."""
        covered = sum((d.amount * d.rate for d in self.draws), Decimal(0))
        if self.uncovered > 0:
            if uncovered_rate is None:
                return None
            covered += self.uncovered * uncovered_rate
        return covered.quantize(CENT)

    def rate(self, total: Decimal, uncovered_rate: Decimal | None) -> Decimal | None:
        value = self.value(uncovered_rate)
        return None if value is None or total <= 0 else (value / total).quantize(Decimal("0.00000001"))


def allocate(pools: list[Pool], spends: list[CashSpend]) -> dict[uuid.UUID, Coverage]:
    remaining = {p.id: p.amount for p in pools}
    ordered_pools = sorted(pools, key=lambda p: (p.day, p.created_at))
    # Sin fecha de factura va al final: no se sabe cuándo se pagó.
    ordered_spends = sorted(spends, key=lambda s: (s.day is None, s.day or date.max, s.at or time.min, s.created_at))
    result: dict[uuid.UUID, Coverage] = {}
    for spend in ordered_spends:
        need = spend.total
        draws: list[Draw] = []
        for pool in ordered_pools:
            if need <= 0:
                break
            if pool.currency != spend.currency or remaining[pool.id] <= 0:
                continue
            if spend.day is not None and pool.day > spend.day:
                continue  # con plata retirada después no se pudo pagar
            taken = min(need, remaining[pool.id])
            remaining[pool.id] -= taken
            need -= taken
            draws.append(Draw(pool.id, taken, pool.rate))
        result[spend.expense_id] = Coverage(tuple(draws), need)
    return result


def remaining_by_pool(pools: list[Pool], coverage: dict[uuid.UUID, Coverage]) -> dict[uuid.UUID, Decimal]:
    """Lo que queda sin gastar de cada retiro."""
    used: dict[uuid.UUID, Decimal] = {p.id: Decimal(0) for p in pools}
    for c in coverage.values():
        for d in c.draws:
            used[d.withdrawal_id] += d.amount
    return {p.id: p.amount - used[p.id] for p in pools}
