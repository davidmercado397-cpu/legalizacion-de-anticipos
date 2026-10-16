"""Logs JSON a stdout (Coolify los recoge). Nunca se loguean tokens, contraseñas ni teléfonos completos."""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

# Correlación: cada línea de log lleva el id de la petición (o del gasto procesado en background).
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_QUIET_PATHS = ('"GET /health', '"GET /ready')


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class _QuietProbes(logging.Filter):
    """Los chequeos de salud se repiten cada pocos segundos y solo ensucian los logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not any(path in record.getMessage() for path in _QUIET_PATHS)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if getattr(root, "_configured_by_app", False):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(level.upper())
    logging.getLogger("httpx").setLevel(logging.WARNING)  # sus logs incluyen URLs que pueden llevar tokens
    logging.getLogger("uvicorn.access").addFilter(_QuietProbes())
    root._configured_by_app = True  # type: ignore[attr-defined]
