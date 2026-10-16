from __future__ import annotations

import sqlalchemy as sa
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.adapters.inbound.http.deps import ContainerDep

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready(container: ContainerDep) -> JSONResponse:
    settings = container.settings
    services = {
        "database": "ok",
        "r2": "ok" if settings.r2_configured else "not_configured",
        "whatsapp": "ok" if settings.whatsapp_configured and settings.WHATSAPP_APP_SECRET else "not_configured",
        "openrouter": "ok" if settings.openrouter_configured else "not_configured",
    }
    try:
        async with container.engine.connect() as conn:
            await conn.execute(sa.text("SELECT 1"))
        services["settings"] = "ok" if not await container.runtime.missing_keys() else "missing_keys"
    except Exception:  # noqa: BLE001
        services["database"] = "down"
        services["settings"] = "unknown"
    try:
        await container.redis.ping()
        services["redis"] = "ok"
    except Exception:  # noqa: BLE001
        services["redis"] = "down"
    ready_ = all(state == "ok" for state in services.values())
    return JSONResponse({"status": "ok" if ready_ else "degraded", "services": services}, status_code=200 if ready_ else 503)
