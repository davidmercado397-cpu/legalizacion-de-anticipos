"""Presupuesto de viaje: calcula el valor sugerido del anticipo con las tarifas de la compañía.
No es un tope: el empleado puede pedir otro valor justificándolo y el aprobador ve ambos."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from app.domain.entities import TravelBudgetRate, TravelZone
from app.domain.enums import BudgetUnit
from app.domain.errors import ValidationError
from app.domain.text import normalize_line_text


@dataclass(frozen=True)
class BudgetLine:
    category: str
    unit: BudgetUnit
    units: int
    rate: Decimal
    amount: Decimal

    def as_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "unit": self.unit.value,
            "units": self.units,
            "rate": str(self.rate),
            "amount": str(self.amount),
        }


@dataclass(frozen=True)
class TravelBudget:
    zone_id: Any
    currency: str
    lines: list[BudgetLine]

    @property
    def total(self) -> Decimal:
        return sum((line.amount for line in self.lines), Decimal(0))


def trip_units(start: date, end: date) -> dict[BudgetUnit, int]:
    """Un viaje del lunes al miércoles son 3 días y 2 noches."""
    days = (end - start).days + 1
    return {BudgetUnit.PER_DAY: days, BudgetUnit.PER_NIGHT: max(days - 1, 0), BudgetUnit.PER_TRIP: 1}


def zone_for(destination: str | None, zones: list[TravelZone]) -> TravelZone | None:
    """La zona cuyo lugar coincide con el destino (sin tildes ni mayúsculas). Si coinciden varias, la
    más específica: la de lugar más largo ("bogota" gana a "co")."""
    wanted = normalize_line_text(destination or "")
    if not wanted:
        return None
    best: tuple[int, TravelZone] | None = None
    for zone in zones:
        for place in zone.places:
            normalized = normalize_line_text(place) or place.strip().lower()
            if normalized and f" {normalized} " in f" {wanted} " and (best is None or len(normalized) > best[0]):
                best = (len(normalized), zone)
    return best[1] if best else None


def calculate(zone_id: Any, rates: list[TravelBudgetRate], start: date, end: date) -> TravelBudget:
    """`rates` ya son las de la zona y el tipo de personal, vigentes en la fecha de salida. Si dos
    tarifas de la misma categoría se cruzan en vigencia, manda la más reciente."""
    if end < start:
        raise ValidationError("End date before start date", code="end_before_start")
    latest: dict[str, TravelBudgetRate] = {}
    for rate in sorted(rates, key=lambda r: r.valid_from):
        latest[rate.category_code] = rate
    rates = list(latest.values())
    currencies = {r.currency for r in rates}
    if len(currencies) != 1:
        raise ValidationError("No single-currency rates for this trip", code="budget_rates_missing")
    units = trip_units(start, end)
    lines = [
        BudgetLine(r.category_code, r.unit, units[r.unit], r.amount, (r.amount * units[r.unit]).quantize(Decimal("0.01")))
        for r in sorted(rates, key=lambda r: r.category_code)
    ]
    return TravelBudget(zone_id, currencies.pop(), lines)
