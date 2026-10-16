"""Fuentes públicas de tasas de cambio (sin llave de API).

- TRM oficial USD/COP de la Superintendencia Financiera, publicada en datos.gov.co. Cada registro trae
  su vigencia (un viernes vale hasta el lunes festivo), así que se expande a un registro por día.
- Tasas de referencia del Banco Central Europeo vía Frankfurter, con el dólar como base. Solo hay
  tasa en días hábiles; el servicio usa la última disponible para fines de semana y festivos."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.domain.entities import ExchangeRate
from app.domain.enums import ExchangeRateSource
from app.domain.errors import ExternalServiceError
from app.domain.exchange import PIVOT

_TIMEOUT = 15.0


async def _get(client: httpx.AsyncClient, url: str, params: dict[str, str]) -> Any:
    try:
        response = await client.get(url, params=params, timeout=_TIMEOUT)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ExternalServiceError(
            f"Exchange rate source failed ({type(exc).__name__})", code="exchange_rates_unavailable"
        ) from exc


def _decimal(value: Any) -> Decimal | None:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and number > 0 else None


class TrmProvider:
    def __init__(self, client: httpx.AsyncClient, url: str) -> None:
        self._client = client
        self._url = url

    async def fetch(self, start: date, end: date, quotes: list[str]) -> list[ExchangeRate]:
        if "COP" not in quotes:
            return []
        where = f"vigenciahasta >= '{start.isoformat()}T00:00:00' AND vigenciadesde <= '{end.isoformat()}T00:00:00'"
        rows = await _get(self._client, self._url, {"$where": where, "$order": "vigenciadesde", "$limit": "1000"})
        rates: list[ExchangeRate] = []
        for row in rows if isinstance(rows, list) else []:
            value = _decimal(row.get("valor"))
            try:
                since = datetime.fromisoformat(row["vigenciadesde"]).date()
                until = datetime.fromisoformat(row["vigenciahasta"]).date()
            except (KeyError, TypeError, ValueError):
                continue
            if value is None:
                continue
            day = max(since, start)
            while day <= min(until, end):
                rates.append(ExchangeRate(day, PIVOT, "COP", value, ExchangeRateSource.TRM))
                day += timedelta(days=1)
        return rates


class EcbProvider:
    def __init__(self, client: httpx.AsyncClient, url: str) -> None:
        self._client = client
        self._url = url.rstrip("/")

    async def fetch(self, start: date, end: date, quotes: list[str]) -> list[ExchangeRate]:
        symbols = sorted({q for q in quotes if q not in (PIVOT, "COP")})
        if not symbols:
            return []
        data = await _get(
            self._client, f"{self._url}/{start.isoformat()}..{end.isoformat()}", {"base": PIVOT, "symbols": ",".join(symbols)}
        )
        rates: list[ExchangeRate] = []
        for day_text, values in (data.get("rates") or {}).items() if isinstance(data, dict) else []:
            try:
                day = date.fromisoformat(day_text)
            except ValueError:
                continue
            for quote, raw in (values or {}).items():
                value = _decimal(raw)
                if value is not None and quote in symbols:
                    rates.append(ExchangeRate(day, PIVOT, quote, value, ExchangeRateSource.ECB))
        return rates
