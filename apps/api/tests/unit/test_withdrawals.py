from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time
from decimal import Decimal

from app.domain.withdrawals import CashSpend, Pool, allocate, remaining_by_pool

T0 = datetime(2026, 10, 1, tzinfo=UTC)


def _pool(day: int, amount: str, rate: str, currency: str = "BRL") -> Pool:
    return Pool(uuid.uuid4(), currency, date(2026, 10, day), Decimal(amount), Decimal(rate), T0)


def _spend(day: int | None, total: str, currency: str = "BRL", at: time | None = None) -> CashSpend:
    return CashSpend(uuid.uuid4(), currency, Decimal(total), date(2026, 10, day) if day else None, at, T0)


def test_invoices_spend_the_oldest_withdrawal_first_and_keep_its_rate() -> None:
    first, second = _pool(12, "500", "780"), _pool(15, "300", "800")
    lunch, dinner, taxi = _spend(13, "200"), _spend(14, "250"), _spend(16, "120")
    coverage = allocate([second, first], [taxi, dinner, lunch])

    # Almuerzo y cena salen del primer retiro (500 BRL a 780): 200 + 250, quedan 50.
    assert coverage[lunch.expense_id].value(None) == Decimal("156000.00")
    assert coverage[dinner.expense_id].value(None) == Decimal("195000.00")
    # El taxi toma los 50 que quedan del primero y 70 del segundo: 50 × 780 + 70 × 800.
    taxi_cov = coverage[taxi.expense_id]
    assert [d.amount for d in taxi_cov.draws] == [Decimal("50"), Decimal("70")]
    assert taxi_cov.value(None) == Decimal("95000.00")
    assert taxi_cov.rate(Decimal("120"), None) == Decimal("791.66666667")
    assert remaining_by_pool([first, second], coverage) == {first.id: Decimal(0), second.id: Decimal("230")}


def test_what_withdrawals_do_not_cover_goes_at_the_day_rate() -> None:
    pool = _pool(12, "100", "780")
    big = _spend(13, "150")
    coverage = allocate([pool], [big])[big.expense_id]
    assert coverage.uncovered == Decimal("50")
    assert coverage.value(Decimal("790")) == Decimal("117500.00")  # 100 × 780 + 50 × 790
    assert coverage.value(None) is None  # sin tasa del día no hay valor


def test_cash_withdrawn_after_the_purchase_or_in_another_currency_does_not_pay_it() -> None:
    later, usd = _pool(20, "500", "780"), _pool(10, "500", "4000", "USD")
    early = _spend(13, "100")
    coverage = allocate([later, usd], [early])[early.expense_id]
    assert coverage.draws == () and coverage.uncovered == Decimal("100")


def test_same_day_purchases_follow_the_time_and_undated_go_last() -> None:
    pool = _pool(12, "100", "780")
    evening, morning, undated = _spend(12, "80", at=time(20)), _spend(12, "80", at=time(9)), _spend(None, "10")
    coverage = allocate([pool], [undated, evening, morning])
    assert coverage[morning.expense_id].uncovered == 0
    assert coverage[evening.expense_id].uncovered == Decimal("60")
    assert coverage[undated.expense_id].uncovered == Decimal("10")
