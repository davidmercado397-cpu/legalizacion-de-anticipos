"""Cada rol tiene un set fijo de permisos definido en código (KISS); volver los roles configurables
desde la BD queda para la fase 2."""

from __future__ import annotations

from enum import StrEnum

from app.domain.enums import Role


class Permission(StrEnum):
    EXPENSES_READ_OWN = "expenses:read_own"
    EXPENSES_READ_TEAM = "expenses:read_team"
    EXPENSES_READ_COMPANY = "expenses:read_company"
    EXPENSES_CREATE = "expenses:create"
    EXPENSES_REVIEW = "expenses:review"
    ADVANCES_REQUEST = "advances:request"
    ADVANCES_APPROVE = "advances:approve"
    ADVANCES_CLOSE = "advances:close"
    ADVANCES_ADMINISTER = "advances:administer"  # anular, reabrir, suplencias
    TREASURY_MANAGE = "treasury:manage"  # desembolsar y liquidar la diferencia (reintegro o reembolso)
    USERS_MANAGE = "users:manage"
    COMPANIES_MANAGE = "companies:manage"
    POLICIES_MANAGE = "policies:manage"
    EXAMPLES_MANAGE = "examples:manage"
    REPORTS_EXPORT = "reports:export"
    USAGE_READ = "usage:read"
    PLATFORM_COSTS_READ = "platform_costs:read"  # costo de la IA: solo el operador de la plataforma
    AUDIT_READ = "audit:read"
    SETTINGS_MANAGE = "settings:manage"


_EMPLOYEE = {
    Permission.EXPENSES_READ_OWN,
    Permission.EXPENSES_CREATE,
    Permission.ADVANCES_REQUEST,
}
# El jefe aprueba la solicitud; la legalización la revisa y la cierra contabilidad (decisión 8 del negocio).
_APPROVER = _EMPLOYEE | {
    Permission.EXPENSES_READ_TEAM,
    Permission.ADVANCES_APPROVE,
}
_ACCOUNTANT = _APPROVER | {
    Permission.EXPENSES_READ_COMPANY,
    Permission.EXPENSES_REVIEW,
    Permission.ADVANCES_CLOSE,
    Permission.ADVANCES_ADMINISTER,
    Permission.POLICIES_MANAGE,
    Permission.EXAMPLES_MANAGE,
    Permission.REPORTS_EXPORT,
    Permission.USAGE_READ,
}
# Tesorería ve los anticipos de sus compañías para desembolsar y liquidar; no aprueba ni revisa.
_TREASURY = _EMPLOYEE | {
    Permission.EXPENSES_READ_COMPANY,
    Permission.TREASURY_MANAGE,
}
# Gerencia aprueba los viajes de los directivos y ve lo de sus compañías.
_MANAGEMENT = _EMPLOYEE | {
    Permission.EXPENSES_READ_COMPANY,
    Permission.ADVANCES_APPROVE,
}
_ADMIN = (
    _ACCOUNTANT
    | _TREASURY
    | {
        Permission.USERS_MANAGE,
        Permission.COMPANIES_MANAGE,
        Permission.AUDIT_READ,
    }
)

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.EMPLOYEE: frozenset(_EMPLOYEE),
    Role.APPROVER: frozenset(_APPROVER),
    Role.ACCOUNTANT: frozenset(_ACCOUNTANT),
    Role.TREASURY: frozenset(_TREASURY),
    Role.MANAGEMENT: frozenset(_MANAGEMENT),
    Role.ADMIN: frozenset(_ADMIN),
    Role.SUPERADMIN: frozenset({Permission.SETTINGS_MANAGE, Permission.USAGE_READ, Permission.PLATFORM_COSTS_READ}),
}


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]
