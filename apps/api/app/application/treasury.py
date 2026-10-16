"""Tesorería y suplencias: entrega del anticipo, liquidación de la diferencia al cerrar y aprobadores
suplentes. Lo maneja contabilidad o administración (`advances:administer`)."""

from __future__ import annotations

import uuid
from datetime import datetime

from app.application.access import AccessPolicy
from app.application.advances import AdvanceEvents, AdvanceEventType
from app.domain.entities import Advance, ApproverDelegation, AuditEntry, Employee
from app.domain.enums import DisbursementMethod, Role, SettlementMethod
from app.domain.errors import NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import Clock, UnitOfWork, UnitOfWorkFactory


class TreasuryService:
    def __init__(self, uow: UnitOfWorkFactory, access: AccessPolicy, clock: Clock, events: AdvanceEvents) -> None:
        self._events = events
        self._uow = uow
        self._access = access
        self._clock = clock

    async def disburse(
        self, actor: Employee, advance_id: uuid.UUID, method: DisbursementMethod, reference: str | None, when: datetime | None
    ) -> Advance:
        async with self._uow() as uow:
            advance = await self._advance(uow, actor, advance_id)
            advance.disburse(actor.id, method, _ref(reference), when or self._clock.now())
            await uow.audit.add(
                AuditEntry("advance_disburse", "advance", str(advance.id), actor.id, data={"method": method, "ref": reference})
            )
            await uow.commit()
        await self._events.emit(AdvanceEventType.DISBURSED, advance.id, actor.id)
        return advance

    async def settle(
        self, actor: Employee, advance_id: uuid.UUID, method: SettlementMethod, reference: str | None, when: datetime | None
    ) -> Advance:
        async with self._uow() as uow:
            advance = await self._advance(uow, actor, advance_id)
            advance.settle(actor.id, method, _ref(reference), when or self._clock.now())
            await uow.audit.add(
                AuditEntry("advance_settle", "advance", str(advance.id), actor.id, data={"method": method, "ref": reference})
            )
            await uow.commit()
        return advance

    async def delegations(self, actor: Employee, approver_id: uuid.UUID) -> list[ApproverDelegation]:
        async with self._uow() as uow:
            await self._employee(uow, actor, approver_id)
            return await uow.delegations.list_for_approver(approver_id)

    async def delegate(
        self, actor: Employee, approver_id: uuid.UUID, delegate_id: uuid.UUID, starts_at: datetime, ends_at: datetime
    ) -> ApproverDelegation:
        if ends_at <= starts_at or delegate_id == approver_id:
            raise ValidationError("Invalid delegation", code="invalid_delegation")
        async with self._uow() as uow:
            await self._employee(uow, actor, approver_id)
            delegate = await self._employee(uow, actor, delegate_id)
            # El suplente debe ser aprobador: contabilidad y admins ya aprueban dentro de su alcance.
            if delegate.role != Role.APPROVER or not delegate.active:
                raise ValidationError("The delegate must be an active approver", code="invalid_delegation")
            delegation = ApproverDelegation(approver_id, delegate_id, starts_at, ends_at, actor.id)
            await uow.delegations.add(delegation)
            await uow.audit.add(
                AuditEntry(
                    "delegation_created",
                    "employee",
                    str(approver_id),
                    actor.id,
                    data={"delegate": delegate_id, "from": starts_at, "to": ends_at},
                )
            )
            await uow.commit()
        return delegation

    async def revoke(self, actor: Employee, approver_id: uuid.UUID, delegation_id: uuid.UUID) -> None:
        async with self._uow() as uow:
            await self._employee(uow, actor, approver_id)
            delegation = await uow.delegations.get(delegation_id)
            if delegation is None or delegation.approver_id != approver_id:
                raise NotFoundError("delegation")
            delegation.revoked_at = delegation.revoked_at or self._clock.now()
            await uow.audit.add(
                AuditEntry("delegation_revoked", "employee", str(approver_id), actor.id, data={"delegation": delegation_id})
            )
            await uow.commit()

    async def _advance(self, uow: UnitOfWork, actor: Employee, advance_id: uuid.UUID) -> Advance:
        self._access.require(actor, Permission.ADVANCES_ADMINISTER)
        advance = await uow.advances.get(advance_id)
        owner = await uow.employees.get(advance.employee_id) if advance else None
        if advance is None or owner is None:
            raise NotFoundError("advance")
        self._access.ensure_view(actor, owner, advance.company_id, "advance")
        return advance

    async def _employee(self, uow: UnitOfWork, actor: Employee, employee_id: uuid.UUID) -> Employee:
        self._access.require(actor, Permission.ADVANCES_ADMINISTER)
        employee = await uow.employees.get(employee_id)
        if employee is None or employee.role == Role.SUPERADMIN or not self._access.can_view(actor, employee, None):
            raise NotFoundError("employee")
        return employee


def _ref(reference: str | None) -> str | None:
    return (reference or "").strip()[:120] or None
