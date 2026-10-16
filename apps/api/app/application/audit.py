from __future__ import annotations

from app.application.access import AccessPolicy
from app.domain.entities import AuditEntry, Employee
from app.domain.permissions import Permission
from app.domain.ports import AuditFilter, Page, Paged, UnitOfWorkFactory


class AuditService:
    def __init__(self, uow: UnitOfWorkFactory, access: AccessPolicy) -> None:
        self._uow = uow
        self._access = access

    async def search(self, actor: Employee, flt: AuditFilter, page: Page) -> Paged[AuditEntry]:
        self._access.require(actor, Permission.AUDIT_READ)
        async with self._uow() as uow:
            return await uow.audit.find(flt, page)
