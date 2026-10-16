"""Todas las respuestas de error tienen la misma forma:

    {"error": {"code", "message", "details", "request_id"}}

`code` es estable (lo usa el frontend) y `message` sale del catálogo en español. Nunca se devuelven
stack traces ni textos internos."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.application.messages import VALIDATION_ISSUES, error_message
from app.domain.errors import (
    AccountLockedError,
    AuthenticationError,
    ConflictError,
    DomainError,
    ExternalServiceError,
    InvalidOperationError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitedError,
    ServiceNotConfiguredError,
    ValidationError,
)
from app.domain.settings import SettingMissingError
from app.logging_config import request_id_var

logger = logging.getLogger(__name__)

# Orden importa: las subclases van antes que su clase base.
_STATUS: list[tuple[type[DomainError], int]] = [
    (AccountLockedError, 423),
    (AuthenticationError, 401),
    (PermissionDeniedError, 403),
    (NotFoundError, 404),
    (ConflictError, 409),
    (InvalidOperationError, 409),
    (ValidationError, 422),
    (RateLimitedError, 429),
    (ServiceNotConfiguredError, 503),
    (SettingMissingError, 503),
    (ExternalServiceError, 502),
]


def error_body(code: str, message: str, details: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or [], "request_id": request_id_var.get()}}


def _status_for(exc: DomainError) -> int:
    return next((status for cls, status in _STATUS if isinstance(exc, cls)), 400)


def _field_issues(exc: RequestValidationError) -> list[dict[str, Any]]:
    issues = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path", "header")]
        template = VALIDATION_ISSUES.get(error.get("type", ""), VALIDATION_ISSUES["default"])
        context = {key: str(value) for key, value in (error.get("ctx") or {}).items()}
        try:
            issue = template.format(**context)
        except (KeyError, IndexError):
            issue = VALIDATION_ISSUES["default"]
        issues.append({"field": ".".join(location) or None, "issue": issue})
    return issues


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError) -> JSONResponse:
        status = _status_for(exc)
        headers: dict[str, str] = {}
        if isinstance(exc, RateLimitedError | AccountLockedError):
            headers["Retry-After"] = str(exc.retry_after_seconds)
        if status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        if status >= 500:
            logger.warning("Integration error: %s", exc)
        details = [{"service": exc.service}] if isinstance(exc, ServiceNotConfiguredError) else exc.details
        return JSONResponse(error_body(exc.code, error_message(exc.code, exc.params), details), status, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(error_body("validation_error", error_message("validation_error"), _field_issues(exc)), 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            body = error_body("not_found", error_message("not_found", {"entity": "route"}))
        elif exc.status_code == 405:
            body = error_body("method_not_allowed", error_message("method_not_allowed"))
        else:
            body = error_body("domain_error", error_message("domain_error"))
        return JSONResponse(body, exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error")
        request_id = request_id_var.get() or "-"
        return JSONResponse(error_body("internal_error", error_message("internal_error", {"request_id": request_id})), 500)
