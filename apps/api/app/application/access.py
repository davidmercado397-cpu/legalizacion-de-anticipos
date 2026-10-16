"""Autorización: permisos por rol más visibilidad por registro (anti-IDOR).

Regla acordada de códigos: si al rol le falta el permiso o la acción está prohibida sobre un registro
visible -> PermissionDeniedError (403); si el registro está fuera de la visibilidad del actor ->
NotFoundError (404), para nunca confirmar que existe.

Un aprobador suplente ve y aprueba, mientras la suplencia esté vigente, al equipo de quien lo dejó."""

from __future__ import annotations

import uuid

from app.domain.entities import Employee
from app.domain.enums import Role
from app.domain.errors import NotFoundError, PermissionDeniedError
from app.domain.permissions import Permission, has_permission
from app.domain.ports import Clock, ScopeFilter, UnitOfWork

NoDelegation: frozenset[uuid.UUID] = frozenset()


class AccessPolicy:
    def __init__(self, clock: Clock) -> None:
        self._clock = clock

    @staticmethod
    def require(actor: Employee, permission: Permission) -> None:
        if not has_permission(actor.role, permission):
            raise PermissionDeniedError()

    async def delegated_from(self, uow: UnitOfWork, actor: Employee) -> frozenset[uuid.UUID]:
        """Aprobadores por los que `actor` responde hoy como suplente."""
        if actor.role != Role.APPROVER:
            return NoDelegation
        return frozenset(await uow.delegations.delegators_of(actor.id, self._clock.now()))

    async def scope_for(self, uow: UnitOfWork, actor: Employee) -> ScopeFilter:
        if actor.role == Role.ADMIN:
            return ScopeFilter()
        if actor.role == Role.ACCOUNTANT:
            return ScopeFilter(company_ids=list(actor.company_ids))
        if actor.role == Role.APPROVER:
            team = [actor.id, *await uow.employees.list_reports_of(actor.id)]
            for approver_id in await self.delegated_from(uow, actor):
                team.extend(await uow.employees.list_reports_of(approver_id))
            return ScopeFilter(employee_ids=list(dict.fromkeys(team)))
        return ScopeFilter(employee_ids=[actor.id])

    @staticmethod
    def can_view(
        actor: Employee, owner: Employee, company_id: uuid.UUID | None, delegated_from: frozenset[uuid.UUID] = NoDelegation
    ) -> bool:
        if actor.role == Role.ADMIN or actor.id == owner.id:
            return True
        if actor.role == Role.ACCOUNTANT:
            return actor.works_for(company_id) if company_id else actor.shares_company_with(owner)
        return actor.role == Role.APPROVER and (owner.approver_id == actor.id or owner.approver_id in delegated_from)

    def ensure_view(
        self,
        actor: Employee,
        owner: Employee,
        company_id: uuid.UUID | None,
        entity: str,
        delegated_from: frozenset[uuid.UUID] = NoDelegation,
    ) -> None:
        if not self.can_view(actor, owner, company_id, delegated_from):
            raise NotFoundError(entity)
