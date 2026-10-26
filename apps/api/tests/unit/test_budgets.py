from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.domain.budgets import LegRates, TripLeg, calculate, calculate_legs, legs_units, ordered_legs, trip_units, zone_for
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
        BudgetUnit.PER_15_DAYS: 1,
    }
    assert trip_units(date(2026, 10, 12), date(2026, 10, 12))[BudgetUnit.PER_NIGHT] == 0


def test_internet_is_one_plan_every_fifteen_days() -> None:
    assert trip_units(date(2026, 10, 1), date(2026, 10, 15))[BudgetUnit.PER_15_DAYS] == 1
    assert trip_units(date(2026, 10, 1), date(2026, 10, 16))[BudgetUnit.PER_15_DAYS] == 2


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


def test_the_transfer_day_is_paid_once_with_the_arrival_city_rate() -> None:
    medellin = TripLeg("Medellín", date(2026, 10, 12), date(2026, 10, 14))
    cali = TripLeg("Cali", date(2026, 10, 14), date(2026, 10, 16))
    units = legs_units(ordered_legs([cali, medellin]))
    assert [(u[BudgetUnit.PER_DAY], u[BudgetUnit.PER_NIGHT]) for u in units] == [(2, 2), (3, 2)]
    meals = [_rate("meals", "60000", BudgetUnit.PER_DAY)]
    budget = calculate_legs(
        [LegRates(medellin, "zona-a", meals), LegRates(cali, "zona-b", [_rate("meals", "50000", BudgetUnit.PER_DAY)])], {}
    )
    assert [(line.destination, line.units, line.amount) for line in budget.lines] == [
        ("Medellín", 2, Decimal("120000.00")),
        ("Cali", 3, Decimal("150000.00")),
    ]
    assert budget.zone_id == "zona-a" and budget.currency == "COP" and budget.total == Decimal("270000.00")


def test_overlapping_legs_are_rejected() -> None:
    with pytest.raises(ValidationError) as error:
        ordered_legs(
            [TripLeg("Medellín", date(2026, 10, 12), date(2026, 10, 15)), TripLeg("Cali", date(2026, 10, 14), date(2026, 10, 16))]
        )
    assert error.value.code == "legs_overlap" and error.value.params == {"first": "Medellín", "second": "Cali"}
    with pytest.raises(ValidationError) as empty:
        ordered_legs([])
    assert empty.value.code == "trip_without_legs"


def test_mixed_currencies_go_in_dollars() -> None:
    bogota = TripLeg("Bogotá", date(2026, 10, 12), date(2026, 10, 13))
    sao_paulo = TripLeg("São Paulo", date(2026, 10, 13), date(2026, 10, 15))
    legs = [
        LegRates(bogota, "co", [_rate("meals", "80000", BudgetUnit.PER_DAY)]),
        LegRates(sao_paulo, "br", [_rate("meals", "50", BudgetUnit.PER_DAY, currency="USD")]),
    ]
    budget = calculate_legs(legs, {"COP": Decimal("0.00025")})
    assert budget.currency == "USD"
    assert [(line.rate, line.units, line.amount) for line in budget.lines] == [
        (Decimal("20.00"), 1, Decimal("20.00")),
        (Decimal("50"), 3, Decimal("150")),
    ]
    with pytest.raises(ValidationError) as error:
        calculate_legs(legs, {})
    assert error.value.code == "budget_rate_unavailable" and error.value.params == {"currency": "COP"}
