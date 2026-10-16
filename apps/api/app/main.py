from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.adapters.inbound.http.errors import install_error_handlers
from app.adapters.inbound.http.routers import (
    admin,
    advances,
    auth,
    budgets,
    examples,
    exchange_rates,
    expenses,
    health,
    policies,
    reports,
    webhook,
)
from app.adapters.inbound.http.routers import settings as settings_router
from app.config import Settings, get_settings
from app.container import Overrides, build_container
from app.logging_config import configure_logging, request_id_var

_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,64}")

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


def create_app(settings: Settings | None = None, overrides: Overrides | None = None, run_jobs: bool = True) -> FastAPI:
    settings = settings or get_settings()
    settings.validate_for_startup()
    configure_logging(settings.LOG_LEVEL)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        container = build_container(settings, overrides)
        app.state.container = container
        jobs = asyncio.create_task(container.jobs.run_forever()) if run_jobs else None
        try:
            yield
        finally:
            if jobs:
                jobs.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await jobs
            await container.close()

    docs = settings.ENABLE_DOCS
    app = FastAPI(
        title="Anticipos y Gastos API",
        version="0.1.0",
        description="Advances and travel expenses with WhatsApp capture and AI invoice reading.",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
            expose_headers=["X-Request-ID", "Retry-After"],
        )

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        # El id viaja a los logs (y a las tareas en background, que heredan el contexto) y vuelve en la
        # respuesta: con él se encuentra una petición puntual en los logs.
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        for name, value in _SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if settings.is_production:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(webhook.router)
    prefix = settings.API_PREFIX
    # budgets va antes que advances: /advances/budget-preview no debe caer en /advances/{advance_id}.
    routers = (auth, admin, policies, budgets, advances, expenses, examples, exchange_rates, reports, settings_router)
    for router in (r.router for r in routers):
        app.include_router(router, prefix=prefix)
    logging.getLogger(__name__).info("API ready (env=%s)", settings.APP_ENV)
    return app
