from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.domain.budgets import calculate, trip_units, zone_for
from app.domain.entities import TravelBudgetRate, TravelZone
from app.domain.enums import BudgetUnit, StaffType
from app.domain.errors import ValidationError

COMPANY = uuid.uuid4()


def _rate(category: str, amount: str, unit: BudgetUnit, valid_from: date = date(2026, 1, 1), currency: str = "COP"):  # type: ignore[no-untyped-def]
    return TravelBudgetRate(COMPANY, uuid.uuid4(), StaffType.OPERATIONAL, category, Decimal(amount), currency, unit, valid_from)


def test_a_three_day_trip_has_two_nights() -> None:
    assert trip_units(date(2026, 10, 12), date(2026, 10, 14)) == {
        BudgetUnit.PER_DAY: 3,
        BudgetUnit.PER_NIGHT: 2,
        BudgetUnit.PER_TRIP: 1,
    }
    assert trip_units(date(2026, 10, 12), date(2026, 10, 12))[BudgetUnit.PER_NIGHT] == 0


def test_budget_by_category_and_the_newest_rate_wins() -> None:
    rates = [
        _rate("meals", "60000", BudgetUnit.PER_DAY),
        _rate("lodging", "180000", BudgetUnit.PER_NIGHT),
        _rate("lodging", "200000", BudgetUnit.PER_NIGHT, valid_from=date(2026, 7, 1)),
        _rate("transport", "90000", BudgetUnit.PER_TRIP),
    ]
    budget = calculate("zone", rates, date(2026, 10, 12), date(2026, 10, 14))
    assert [(line.category, line.units, line.amount) for line in budget.lines] == [
        ("lodging", 2, Decimal("400000.00")),
        ("meals", 3, Decimal("180000.00")),
        ("transport", 1, Decimal("90000.00")),
    ]
    assert budget.total == Decimal("670000.00") and budget.currency == "COP"


def test_rates_in_two_currencies_cannot_be_added_up() -> None:
    with pytest.raises(ValidationError) as error:
        calculate(
            "zone",
            [_rate("meals", "60", BudgetUnit.PER_DAY, currency="USD"), _rate("lodging", "1", BudgetUnit.PER_NIGHT)],
            date(2026, 10, 12),
            date(2026, 10, 13),
        )
    assert error.value.code == "budget_rates_missing"


def test_destination_resolves_to_the_most_specific_zone() -> None:
    main = TravelZone(COMPANY, "Ciudades principales", ["Bogotá", "Medellín", "San Andrés"])
    abroad = TravelZone(COMPANY, "Exterior", ["US", "MX", "Miami"])
    zones = [main, abroad]
    assert zone_for("Medellin, Antioquia", zones) is main
    assert zone_for("San Andrés isla", zones) is main
    assert zone_for("Miami, US", zones) is abroad
    assert zone_for("Pasto", zones) is None and zone_for(None, zones) is None
