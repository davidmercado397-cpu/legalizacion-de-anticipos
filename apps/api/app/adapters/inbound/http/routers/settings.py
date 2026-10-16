"""Parámetros del sistema (tabla llave-valor). Solo el superadmin (NextByte) los ve y los cambia."""

from __future__ import annotations

from fastapi import APIRouter

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee
from app.adapters.inbound.http.schemas import ListOut, SettingOut, SettingsPatch

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=ListOut[SettingOut], summary="System settings with type, range and description")
async def list_settings(actor: CurrentEmployee, container: ContainerDep) -> ListOut[SettingOut]:
    rows = await container.runtime.describe(actor)
    return ListOut[SettingOut](data=[SettingOut.model_validate(row) for row in rows])


@router.patch("", response_model=ListOut[SettingOut], summary="Change settings (applied without restarting)")
async def update_settings(body: SettingsPatch, actor: CurrentEmployee, container: ContainerDep) -> ListOut[SettingOut]:
    rows = await container.runtime.update(actor, body.values)
    return ListOut[SettingOut](data=[SettingOut.model_validate(row) for row in rows])
