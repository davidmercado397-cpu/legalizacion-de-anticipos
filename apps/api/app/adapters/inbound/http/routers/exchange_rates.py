"""Tasas de cambio: consulta de la tasa que se aplicaría y sincronización manual (operador)."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee
from app.adapters.inbound.http.schemas import ConversionOut, SyncOut
from app.domain.errors import NotFoundError

router = APIRouter(prefix="/exchange-rates", tags=["exchange rates"])


@router.get("/convert", response_model=ConversionOut, summary="Rate used to convert between two currencies on a date")
async def convert(
    actor: CurrentEmployee,
    container: ContainerDep,
    source: Annotated[str, Query(alias="from", min_length=3, max_length=3)],
    target: Annotated[str, Query(alias="to", min_length=3, max_length=3)],
    on: date,
) -> ConversionOut:
    conversion = await container.rates.quote(source, target, on)
    if conversion is None:
        raise NotFoundError("exchange rate")
    return ConversionOut(
        source=source.upper(), target=target.upper(), rate=conversion.rate, rate_date=conversion.day, origin=conversion.source
    )


@router.post("/sync", response_model=SyncOut, summary="Download the latest rates now (platform operator)")
async def sync(actor: CurrentEmployee, container: ContainerDep) -> SyncOut:
    return SyncOut(stored=await container.rates.sync_now(actor))
