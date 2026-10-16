"""Fechas de negocio. En la BD todo se guarda en UTC; el "día" de un gasto o el "mes" de un tope se
calcula en la zona horaria de la compañía: a las 9 p. m. del 31 en Bogotá ya es el 1 en UTC."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def is_valid_timezone(name: str | None) -> bool:
    if not name:
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def local_datetime(instant: datetime, tz: str) -> datetime:
    return instant.astimezone(ZoneInfo(tz))


def local_date(instant: datetime, tz: str) -> date:
    """Única forma permitida de obtener la fecha de negocio a partir de un instante."""
    return local_datetime(instant, tz).date()
