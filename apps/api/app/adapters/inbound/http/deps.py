from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.application.access import AccessPolicy
from app.container import Container
from app.domain.entities import Employee
from app.domain.errors import AuthenticationError, PermissionDeniedError, RateLimitedError
from app.domain.permissions import Permission
from app.domain.ports import Page

_bearer = HTTPBearer(auto_error=False)


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def client_ip(request: Request) -> str:
    # Detrás de Coolify/Cloudflare la IP real del cliente llega en un header de reenvío.
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


async def enforce_limit(container: Container, scope: str, key: str, limit: str) -> None:
    retry_after = await container.rate_limiter.hit(scope, key, limit)
    if retry_after is not None:
        raise RateLimitedError(retry_after)


async def _authenticate(container: Container, credentials: HTTPAuthorizationCredentials | None) -> Employee:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError("Missing bearer token", code="login_required")
    employee = await container.auth.authenticate(credentials.credentials)
    await enforce_limit(container, "api", str(employee.id), container.settings.RATE_LIMIT_API)
    return employee


async def current_employee_any(
    container: ContainerDep, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> Employee:
    """Usuario autenticado, aunque todavía deba cambiar una contraseña temporal o activar el MFA."""
    return await _authenticate(container, credentials)


async def current_employee(
    container: ContainerDep, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> Employee:
    employee = await _authenticate(container, credentials)
    if employee.must_change_password:
        raise PermissionDeniedError("Temporary password must be changed", code="password_change_required")
    if employee.role in container.settings.mfa_required_roles and not employee.mfa_enabled:
        raise PermissionDeniedError("MFA must be enabled for this role", code="mfa_setup_required")
    return employee


CurrentEmployee = Annotated[Employee, Depends(current_employee)]
CurrentEmployeeAny = Annotated[Employee, Depends(current_employee_any)]


def require(permission: Permission) -> Callable[[Employee], Awaitable[Employee]]:
    async def dependency(employee: CurrentEmployee) -> Employee:
        AccessPolicy.require(employee, permission)
        return employee

    return dependency


def page_params(limit: Annotated[int, Query(ge=1, le=200)] = 50, offset: Annotated[int, Query(ge=0, le=100_000)] = 0) -> Page:
    return Page(limit, offset)


PageDep = Annotated[Page, Depends(page_params)]
