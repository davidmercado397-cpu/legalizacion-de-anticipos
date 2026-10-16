from __future__ import annotations

from datetime import date
from decimal import Decimal

import httpx
import pytest
import respx

from app.adapters.outbound.exchange_rates import EcbProvider, TrmProvider
from app.domain.enums import ExchangeRatePolicy, ExchangeRateSource
from app.domain.errors import ExternalServiceError
from app.domain.exchange import Leg, combine, rate_day

TRM = "https://trm.test/resource.json"
ECB = "https://ecb.test/v1"


def test_cross_rates_go_through_the_dollar() -> None:
    usd_cop = Leg(Decimal("4000"), date(2026, 10, 9), ExchangeRateSource.TRM)
    usd_eur = Leg(Decimal("0.8"), date(2026, 10, 8), ExchangeRateSource.ECB)
    eur_to_cop = combine(usd_eur, usd_cop)
    assert eur_to_cop is not None
    assert eur_to_cop.rate == Decimal("5000") and eur_to_cop.source == ExchangeRateSource.ECB_CROSS
    assert eur_to_cop.day == date(2026, 10, 8)  # la tasa más vieja usada
    assert eur_to_cop.apply(Decimal("12.5")) == Decimal("62500.00")
    usd_to_cop = combine(None, usd_cop)
    assert usd_to_cop is not None and usd_to_cop.rate == Decimal("4000") and usd_to_cop.source == ExchangeRateSource.TRM
    cop_to_usd = combine(usd_cop, None)
    assert cop_to_usd is not None and cop_to_usd.rate == Decimal("0.00025")
    assert combine(None, None) is None


def test_previous_month_close_uses_the_last_day_of_the_month_before() -> None:
    assert rate_day(date(2026, 10, 13), ExchangeRatePolicy.DAILY) == date(2026, 10, 13)
    assert rate_day(date(2026, 10, 13), ExchangeRatePolicy.PREVIOUS_MONTH_CLOSE) == date(2026, 9, 30)
    assert rate_day(date(2026, 3, 1), ExchangeRatePolicy.PREVIOUS_MONTH_CLOSE) == date(2026, 2, 28)


@respx.mock
async def test_trm_ranges_are_expanded_to_one_rate_per_day() -> None:
    route = respx.get(TRM).mock(
        return_value=httpx.Response(
            200,
            json=[
                {"valor": "3218.75", "vigenciadesde": "2026-10-09T00:00:00.000", "vigenciahasta": "2026-10-09T00:00:00.000"},
                # Un viernes con lunes festivo vale hasta el martes.
                {"valor": "3194.44", "vigenciadesde": "2026-10-10T00:00:00.000", "vigenciahasta": "2026-10-13T00:00:00.000"},
                {"valor": "basura", "vigenciadesde": "2026-10-14T00:00:00.000", "vigenciahasta": "2026-10-14T00:00:00.000"},
            ],
        )
    )
    async with httpx.AsyncClient() as client:
        rates = await TrmProvider(client, TRM).fetch(date(2026, 10, 9), date(2026, 10, 12), ["COP", "EUR"])
        assert await TrmProvider(client, TRM).fetch(date(2026, 10, 9), date(2026, 10, 12), ["EUR"]) == []
    assert [(r.day.day, r.rate) for r in rates] == [
        (9, Decimal("3218.75")),
        (10, Decimal("3194.44")),
        (11, Decimal("3194.44")),
        (12, Decimal("3194.44")),
    ]
    assert all(r.base == "USD" and r.quote == "COP" for r in rates)
    assert "vigenciahasta >= '2026-10-09" in route.calls[0].request.url.params["$where"]


@respx.mock
async def test_ecb_rates_only_for_currencies_it_covers() -> None:
    route = respx.get(f"{ECB}/2026-10-08..2026-10-13").mock(
        return_value=httpx.Response(
            200, json={"base": "USD", "rates": {"2026-10-08": {"EUR": 0.89397, "MXN": 18.0127}, "2026-10-09": {"EUR": 0.89238}}}
        )
    )
    async with httpx.AsyncClient() as client:
        rates = await EcbProvider(client, ECB).fetch(date(2026, 10, 8), date(2026, 10, 13), ["COP", "USD", "EUR", "MXN"])
    assert route.calls[0].request.url.params["symbols"] == "EUR,MXN"
    assert {(r.day.day, r.quote) for r in rates} == {(8, "EUR"), (8, "MXN"), (9, "EUR")}
    assert all(r.source == ExchangeRateSource.ECB for r in rates)


@respx.mock
async def test_a_failing_source_raises_a_clear_error() -> None:
    respx.get(TRM).mock(return_value=httpx.Response(503))
    async with httpx.AsyncClient() as client:
        with pytest.raises(ExternalServiceError) as error:
            await TrmProvider(client, TRM).fetch(date(2026, 10, 9), date(2026, 10, 9), ["COP"])
    assert error.value.code == "exchange_rates_unavailable"
