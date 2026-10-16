"""Conversión de monedas. Todo cruza por el dólar: la TRM oficial da USD/COP y el BCE da USD contra
las demás (EUR, BRL, MXN). Así un gasto en euros de un anticipo en pesos usa EUR -> USD -> COP."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.domain.enums import ExchangeRatePolicy, ExchangeRateSource

PIVOT = "USD"
RATE_PLACES = Decimal("0.00000001")


@dataclass(frozen=True)
class Leg:
    """Tasa de un tramo contra el dólar: 1 USD = `rate` unidades de la moneda."""

    rate: Decimal
    day: date
    source: ExchangeRateSource


@dataclass(frozen=True)
class Conversion:
    rate: Decimal  # 1 unidad de origen = `rate` unidades de destino
    day: date  # fecha de la tasa más antigua usada
    source: ExchangeRateSource

    def apply(self, amount: Decimal) -> Decimal:
        return (amount * self.rate).quantize(Decimal("0.01"))


def rate_day(invoice_day: date, policy: ExchangeRatePolicy) -> date:
    """Día cuya tasa se usa según la política de la compañía."""
    if policy == ExchangeRatePolicy.PREVIOUS_MONTH_CLOSE:
        return invoice_day.replace(day=1) - timedelta(days=1)
    return invoice_day


def combine(origin: Leg | None, target: Leg | None) -> Conversion | None:
    """Une los tramos origen->USD->destino. Un tramo None es el dólar mismo (tasa 1)."""
    legs = [leg for leg in (origin, target) if leg is not None]
    if not legs:
        return None
    rate = (target.rate if target else Decimal(1)) / (origin.rate if origin else Decimal(1))
    sources = {leg.source for leg in legs}
    source = ExchangeRateSource.TRM if sources == {ExchangeRateSource.TRM} else ExchangeRateSource.ECB_CROSS
    if sources == {ExchangeRateSource.ECB}:
        source = ExchangeRateSource.ECB
    return Conversion(rate.quantize(RATE_PLACES), min(leg.day for leg in legs), source)
