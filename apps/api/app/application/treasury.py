"""Tesorería y suplencias. La entrega del anticipo y la liquidación de la diferencia las registra
tesorería (`treasury:manage`); las suplencias de aprobadores, contabilidad o administración
(`advances:administer`)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from app.application.access import AccessPolicy
from app.application.advances import AdvanceEvents, AdvanceEventType
from app.application.exchange import ExchangeRateService
from app.domain.entities import Advance, ApproverDelegation, AuditEntry, Employee
from app.domain.enums import DisbursementMethod, Role, SettlementMethod
from app.domain.errors import NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import Clock, UnitOfWork, UnitOfWorkFactory
from app.domain.time import local_date


class TreasuryService:
    def __init__(
        self, uow: UnitOfWorkFactory, access: AccessPolicy, clock: Clock, events: AdvanceEvents, rates: ExchangeRateService
    ) -> None:
        self._events = events
        self._rates = rates
        self._uow = uow
        self._access = access
        self._clock = clock

    async def disburse(
        self,
        actor: Employee,
        advance_id: uuid.UUID,
        method: DisbursementMethod,
        reference: str | None,
        when: datetime | None,
        amount: Decimal | None = None,
    ) -> Advance:
        """`amount`: lo entregado en la moneda de la compañía cuando el anticipo se calculó en otra. Sin él, se
        calcula con la tasa del día del desembolso (decisión: calculado y editable por tesorería)."""
        when = when or self._clock.now()
        async with self._uow() as uow:
            advance = await self._advance(uow, actor, advance_id)
            if advance.settlement_currency is not None:
                await self._settle_in_company_currency(uow, advance, amount, when)
            advance.disburse(actor.id, method, _ref(reference), when)
            data = {"method": method, "ref": reference, "amount": advance.ledger_amount, "currency": advance.ledger_currency}
            await uow.audit.add(AuditEntry("advance_disburse", "advance", str(advance.id), actor.id, data=data))
            await uow.commit()
        await self._events.emit(AdvanceEventType.DISBURSED, advance.id, actor.id)
        return advance

    async def _settle_in_company_currency(
        self, uow: UnitOfWork, advance: Advance, amount: Decimal | None, when: datetime
    ) -> None:
        company = await uow.companies.get(advance.company_id)
        assert company is not None and advance.settlement_currency is not None
        day = local_date(when, company.timezone)
        if amount is not None:
            advance.set_settlement(amount, (amount / advance.amount).quantize(Decimal("0.00000001")), day)
            return
        conversion = await self._rates.conversion(uow, advance.currency, advance.settlement_currency, day)
        if conversion is not None:
            advance.set_settlement(conversion.apply(advance.amount), conversion.rate, conversion.day)

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
        self._access.require(actor, Permission.TREASURY_MANAGE)
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
