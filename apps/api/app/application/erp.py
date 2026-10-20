"""Integración con Siesa (decisiones 8.1 y 8.2): el anticipo se crea en el ERP cuando termina su ruta de
aprobación (en segundo plano) y la legalización, un documento por anticipo, cuando contabilidad la cierra
y la envía. Si Siesa falla o no está conectado, el anticipo guarda el estado y el error, y contabilidad
lo reintenta; la aplicación nunca se frena por el ERP."""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from app.application import messages as msg
from app.application.access import AccessPolicy
from app.domain.entities import Advance, AuditEntry, Category, Employee, Expense
from app.domain.enums import AdvanceStatus, ErpStatus, ExpenseStatus
from app.domain.erp import ErpAdvance, ErpLegalization, ErpLegalizationLine
from app.domain.errors import DomainError, InvalidOperationError, NotFoundError, ServiceNotConfiguredError
from app.domain.permissions import Permission
from app.domain.ports import ErpGateway, UnitOfWork, UnitOfWorkFactory

logger = logging.getLogger(__name__)

# Desde aprobado en adelante el anticipo existe para el ERP; cancelado, rechazado o anulado, no.
_IN_ERP = (AdvanceStatus.APPROVED, AdvanceStatus.IN_REVIEW, AdvanceStatus.CLOSED)


class ErpService:
    def __init__(self, uow: UnitOfWorkFactory, access: AccessPolicy, gateway: ErpGateway) -> None:
        self._uow = uow
        self._access = access
        self._gateway = gateway

    async def advance_approved(self, advance_id: uuid.UUID) -> None:
        """Al terminar la aprobación. Corre en segundo plano: los errores quedan en el anticipo."""
        async with self._uow() as uow:
            advance = await uow.advances.get(advance_id)
            if advance is None or advance.status not in _IN_ERP or advance.erp_advance_status == ErpStatus.SENT:
                return
            await self._send_advance(uow, advance, None)
            await uow.commit()

    async def retry_advance(self, actor: Employee, advance_id: uuid.UUID) -> Advance:
        async with self._uow() as uow:
            advance = await self._for_accounting(uow, actor, advance_id)
            if advance.status not in _IN_ERP:
                raise InvalidOperationError("Advance not approved", code="erp_advance_not_approved")
            if advance.erp_advance_status == ErpStatus.SENT:
                raise InvalidOperationError("Already in the ERP", code="erp_already_sent")
            error = await self._send_advance(uow, advance, actor.id)
            await uow.commit()
        if error is not None:
            raise error
        return advance

    async def send_legalization(self, actor: Employee, advance_id: uuid.UUID) -> Advance:
        """El botón «Crear legalización en Siesa». Si el anticipo aún no está en el ERP, lo crea primero."""
        async with self._uow() as uow:
            advance = await self._for_accounting(uow, actor, advance_id)
            if advance.status != AdvanceStatus.CLOSED:
                raise InvalidOperationError("Legalization not closed", code="erp_legalization_not_closed")
            if advance.erp_legalization_status == ErpStatus.SENT:
                raise InvalidOperationError("Already in the ERP", code="erp_already_sent")
            error = None
            if advance.erp_advance_status != ErpStatus.SENT:
                error = await self._send_advance(uow, advance, actor.id)
            if error is None:
                error = await self._send_legalization(uow, advance, actor.id)
            await uow.commit()
        if error is not None:
            raise error
        return advance

    async def _for_accounting(self, uow: UnitOfWork, actor: Employee, advance_id: uuid.UUID) -> Advance:
        self._access.require(actor, Permission.ADVANCES_CLOSE)
        advance = await uow.advances.get(advance_id)
        if advance is None or not (actor.is_admin or actor.works_for(advance.company_id)):
            raise NotFoundError("advance")
        return advance

    async def _send_advance(self, uow: UnitOfWork, advance: Advance, actor_id: uuid.UUID | None) -> DomainError | None:
        owner = await uow.employees.get(advance.employee_id)
        company = await uow.companies.get(advance.company_id)
        assert owner is not None and company is not None
        document = ErpAdvance(
            advance.id,
            company.tax_id,
            company.legal_name or company.name,
            owner.full_name,
            owner.email,
            str(advance.kind),
            advance.ledger_currency,
            advance.ledger_amount,
            advance.purpose,
            advance.destination,
            advance.start_date,
            advance.end_date,
        )
        try:
            ref = await self._gateway.create_advance(document)
        except DomainError as exc:
            self._failed(advance, "erp_advance_status", exc)
            await uow.audit.add(AuditEntry("erp_advance_failed", "advance", str(advance.id), actor_id, data={"error": exc.code}))
            return exc
        advance.erp_advance_status, advance.erp_advance_ref, advance.erp_error = ErpStatus.SENT, ref, None
        await uow.audit.add(AuditEntry("erp_advance_created", "advance", str(advance.id), actor_id, data={"ref": ref}))
        return None

    async def _send_legalization(self, uow: UnitOfWork, advance: Advance, actor_id: uuid.UUID) -> DomainError | None:
        assert advance.erp_advance_ref is not None
        company = await uow.companies.get(advance.company_id)
        owner = await uow.employees.get(advance.employee_id)
        assert company is not None and owner is not None
        expenses = await uow.expenses.list_for_advance(advance.id)
        categories = {c.code: c for c in await uow.categories.list_for_company(advance.company_id, active_only=False)}
        balance = advance.balance(expenses)
        delivered = balance.disbursed or balance.amount
        lines = tuple(
            _line(e, company.generic_tax_id, categories.get(e.category or ""))
            for e in expenses
            if e.status == ExpenseStatus.CONFIRMED and e.counts_against(advance.id)
        )
        legalized = sum((line.legalized for line in lines), Decimal(0))
        document = ErpLegalization(
            advance.id,
            advance.erp_advance_ref,
            company.tax_id,
            owner.email,
            advance.ledger_currency,
            delivered,
            legalized,
            delivered - legalized,
            lines,
        )
        try:
            ref = await self._gateway.create_legalization(document)
        except DomainError as exc:
            self._failed(advance, "erp_legalization_status", exc)
            await uow.audit.add(
                AuditEntry("erp_legalization_failed", "advance", str(advance.id), actor_id, data={"error": exc.code})
            )
            return exc
        advance.erp_legalization_status, advance.erp_legalization_ref, advance.erp_error = ErpStatus.SENT, ref, None
        await uow.audit.add(AuditEntry("erp_legalization_created", "advance", str(advance.id), actor_id, data={"ref": ref}))
        return None

    @staticmethod
    def _failed(advance: Advance, field: str, exc: DomainError) -> None:
        # Sin conexión configurada queda pendiente (no es un error de Siesa); lo demás, fallido.
        status = ErpStatus.PENDING if isinstance(exc, ServiceNotConfiguredError) else ErpStatus.FAILED
        setattr(advance, field, status)
        advance.erp_error = msg.error_message(exc.code, exc.params)[:500]
        logger.warning("ERP %s for advance %s: %s", field, advance.id, exc.code)


def _line(expense: Expense, generic_tax_id: str | None, category: Category | None) -> ErpLegalizationLine:
    return ErpLegalizationLine(
        expense.id,
        expense.invoice_date,
        expense.vendor_name,
        expense.vendor_tax_id or generic_tax_id,
        expense.invoice_number,
        expense.fiscal_id,
        expense.category,
        category.accounting_account if category else None,
        expense.currency,
        expense.total,
        expense.applied_net,
        expense.non_reimbursable_amount or Decimal(0),
        str(expense.deductibility) if expense.deductibility else None,
    )
