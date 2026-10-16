"""Errores de negocio. La capa HTTP los traduce a códigos de estado; el dominio no sabe de HTTP.

Cada error lleva un `code` estable (lo usa el frontend) y sus parámetros; el texto en español para el
usuario sale del catálogo de `app/application/messages.py`. El mensaje en inglés es solo para el log."""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    code = "domain_error"

    def __init__(self, message: str = "", *, code: str | None = None, **params: Any) -> None:
        super().__init__(message or code or self.code)
        if code is not None:
            self.code = code
        self.params = params
        self.details: list[dict[str, Any]] = []  # problemas puntuales (p. ej. filas de un archivo importado)


class NotFoundError(DomainError):
    """Se responde 404 también cuando el registro existe pero está fuera de la visibilidad del actor:
    nunca se confirma que existe algo que no puede ver."""

    code = "not_found"

    def __init__(self, entity: str) -> None:
        super().__init__(f"{entity} not found", entity=entity)
        self.entity = entity


class PermissionDeniedError(DomainError):
    """El rol no tiene el permiso, o la acción está prohibida sobre algo que sí ve (p. ej. aprobar
    su propio anticipo)."""

    code = "forbidden"


class InvalidOperationError(DomainError):
    code = "invalid_state"


class JustificationRequiredError(InvalidOperationError):
    code = "justification_required"


class PolicyBlockedError(InvalidOperationError):
    code = "policy_blocked"


class ConflictError(DomainError):
    code = "conflict"


class ValidationError(DomainError):
    code = "validation_error"


class AuthenticationError(DomainError):
    code = "session_expired"


class AccountLockedError(AuthenticationError):
    code = "account_locked"

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Account temporarily locked", minutes=max(1, -(-retry_after_seconds // 60)))
        self.retry_after_seconds = retry_after_seconds


class RateLimitedError(DomainError):
    code = "rate_limited"

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Too many requests", seconds=retry_after_seconds)
        self.retry_after_seconds = retry_after_seconds


class ExternalServiceError(DomainError):
    """Falló un tercero (Meta, OpenRouter, R2); quien llama puede reintentar."""

    code = "external_service_error"


class ServiceNotConfiguredError(ExternalServiceError):
    code = "service_not_configured"

    def __init__(self, service: str) -> None:
        super().__init__(f"{service} is not configured", service=service)
        self.service = service
