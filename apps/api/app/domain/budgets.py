"""Presupuesto de viaje: calcula el valor sugerido del anticipo con las tarifas de la compañía.
No es un tope: el empleado puede pedir otro valor justificándolo y el aprobador ve ambos.

Un viaje puede tener varios tramos (Medellín y luego Cali). El día de traslado se cuenta una sola vez,
con la tarifa de la ciudad de llegada (decisión 2.4). Si los tramos tienen tarifas en monedas
distintas, el anticipo va en dólares (decisión 4.8)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from app.domain.entities import TravelBudgetRate, TravelZone
from app.domain.enums import BudgetUnit
from app.domain.errors import ValidationError
from app.domain.text import normalize_line_text

MIXED_CURRENCY = "USD"


@dataclass(frozen=True)
class BudgetLine:
    category: str
    unit: BudgetUnit
    units: int
    rate: Decimal
    amount: Decimal
    destination: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "unit": self.unit.value,
            "units": self.units,
            "rate": str(self.rate),
            "amount": str(self.amount),
            "destination": self.destination,
        }


@dataclass(frozen=True)
class TravelBudget:
    zone_id: Any
    currency: str
    lines: list[BudgetLine]

    @property
    def total(self) -> Decimal:
        return sum((line.amount for line in self.lines), Decimal(0))


@dataclass(frozen=True)
class TripLeg:
    """Un tramo del viaje: la ciudad y las fechas en que se está allí. El tramo siguiente puede empezar el
    mismo día en que termina este (día de traslado)."""

    destination: str
    start: date
    end: date

    def as_dict(self) -> dict[str, Any]:
        return {"destination": self.destination, "start_date": self.start.isoformat(), "end_date": self.end.isoformat()}


@dataclass(frozen=True)
class LegRates:
    """Las tarifas de un tramo: las de su zona y el tipo de personal, vigentes en la fecha de salida."""

    leg: TripLeg
    zone_id: Any
    rates: list[TravelBudgetRate]


def trip_units(start: date, end: date) -> dict[BudgetUnit, int]:
    """Un viaje del lunes al miércoles son 3 días y 2 noches."""
    days = (end - start).days + 1
    return {BudgetUnit.PER_DAY: days, BudgetUnit.PER_NIGHT: max(days - 1, 0), BudgetUnit.PER_TRIP: 1}


def ordered_legs(legs: list[TripLeg]) -> list[TripLeg]:
    """Los tramos por fecha. Pueden compartir el día de traslado, pero no solaparse más."""
    if not legs:
        raise ValidationError("Trip without legs", code="trip_without_legs")
    ordered = sorted(legs, key=lambda leg: (leg.start, leg.end))
    for leg in ordered:
        if leg.end < leg.start:
            raise ValidationError("End date before start date", code="end_before_start")
    for previous, leg in zip(ordered, ordered[1:], strict=False):
        if leg.start < previous.end:
            raise ValidationError("Trip legs overlap", code="legs_overlap", first=previous.destination, second=leg.destination)
    return ordered


def legs_units(legs: list[TripLeg]) -> list[dict[BudgetUnit, int]]:
    """Unidades de cada tramo (ya ordenados): el día de traslado lo paga el tramo de llegada. Cada tramo
    cuenta sus noches y sus cargos por viaje (p. ej. el transporte al aeropuerto de cada ciudad)."""
    units = [trip_units(leg.start, leg.end) for leg in legs]
    for i in range(1, len(legs)):
        if legs[i].start == legs[i - 1].end:
            units[i - 1][BudgetUnit.PER_DAY] -= 1
    return units


def advance_currency(legs: list[LegRates]) -> str:
    """La moneda de las tarifas si todos los tramos coinciden; si se mezclan, dólares."""
    currencies = {rate.currency for leg in legs for rate in _latest(leg.rates)}
    return currencies.pop() if len(currencies) == 1 else MIXED_CURRENCY


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


def _latest(rates: list[TravelBudgetRate]) -> list[TravelBudgetRate]:
    """Si dos tarifas de la misma categoría se cruzan en vigencia, manda la más reciente."""
    latest: dict[str, TravelBudgetRate] = {}
    for rate in sorted(rates, key=lambda r: r.valid_from):
        latest[rate.category_code] = rate
    return sorted(latest.values(), key=lambda r: r.category_code)


def calculate(zone_id: Any, rates: list[TravelBudgetRate], start: date, end: date) -> TravelBudget:
    """Viaje de un solo destino. `rates` ya son las de la zona y el tipo de personal, vigentes en la
    fecha de salida."""
    return calculate_legs([LegRates(TripLeg("", start, end), zone_id, rates)], {})


def calculate_legs(legs: list[LegRates], to_currency: dict[str, Decimal]) -> TravelBudget:
    """Presupuesto de un viaje con uno o más tramos. `to_currency` trae, para cada moneda de tarifa
    distinta de la del anticipo, cuánto vale una unidad en la moneda del anticipo."""
    by_leg = {id(item.leg): item for item in legs}
    ordered = ordered_legs([item.leg for item in legs])
    currency = advance_currency(legs)
    named = len(ordered) > 1
    lines: list[BudgetLine] = []
    for leg, units in zip(ordered, legs_units(ordered), strict=True):
        rates = _latest(by_leg[id(leg)].rates)
        if not rates:
            raise ValidationError("No rates for this trip", code="budget_rates_missing")
        if len({r.currency for r in rates}) != 1:
            raise ValidationError("No single-currency rates for this trip", code="budget_rates_missing")
        for r in rates:
            factor = Decimal(1) if r.currency == currency else to_currency.get(r.currency)
            if factor is None:
                raise ValidationError("Missing exchange rate", code="budget_rate_unavailable", currency=r.currency)
            rate = (r.amount * factor).quantize(Decimal("0.01"))
            amount = (rate * units[r.unit]).quantize(Decimal("0.01"))
            lines.append(BudgetLine(r.category_code, r.unit, units[r.unit], rate, amount, leg.destination if named else None))
    return TravelBudget(by_leg[id(ordered[0])].zone_id, currency, lines)
