"""Retiros de efectivo en el exterior: cada uno es una bolsa con la tasa del día del retiro (o la que cobró el
banco), y las facturas pagadas en efectivo en esa moneda la gastan en orden (domain/withdrawals.py).

El viajero registra el retiro mientras el anticipo está abierto. La comisión y lo que debitó el banco casi nunca
se conocen ese día: el viajero o tesorería (que ve los extractos) los completan después, hasta que se cierra la
legalización. Cada cambio vuelve a repartir todas las facturas en efectivo del anticipo."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from app.application.access import AccessPolicy
from app.application.exchange import ExchangeRateService
from app.application.policies import PolicyEvaluator
from app.application.settings import SettingsService, check_currency
from app.domain.entities import Advance, AuditEntry, CashWithdrawal, Employee, Expense
from app.domain.enums import (
    AdvanceKind,
    AdvanceStatus,
    Deductibility,
    DocumentType,
    ExchangeRateSource,
    ExpenseSource,
    ExpenseStatus,
    PaymentMethod,
)
from app.domain.errors import InvalidOperationError, NotFoundError, PermissionDeniedError, ValidationError
from app.domain.exchange import rate_day
from app.domain.permissions import Permission, has_permission
from app.domain.ports import Clock, UnitOfWork, UnitOfWorkFactory
from app.domain.withdrawals import CashSpend, Pool, allocate, remaining_by_pool

FEE_VENDOR = "Comisión del retiro"


@dataclass(frozen=True)
class WithdrawalData:
    withdrawn_on: date
    currency: str
    amount: Decimal
    debited_amount: Decimal | None = None
    fee_amount: Decimal | None = None
    note: str | None = None


@dataclass(frozen=True)
class WithdrawalView:
    withdrawal: CashWithdrawal
    remaining: Decimal  # lo que queda sin gastar, en la moneda del retiro


def pays_cash(expense: Expense, advance: Advance) -> bool:
    method = expense.payment_method
    if method is None:  # «según el anticipo»: un anticipo en efectivo se gasta en efectivo
        return advance.kind == AdvanceKind.CASH
    return method == PaymentMethod.CASH


class WithdrawalService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        clock: Clock,
        settings: SettingsService,
        rates: ExchangeRateService,
        evaluator: PolicyEvaluator,
    ) -> None:
        self._uow = uow
        self._access = access
        self._clock = clock
        self._settings = settings
        self._rates = rates
        self._evaluator = evaluator

    async def views(self, uow: UnitOfWork, advance: Advance, expenses: list[Expense]) -> list[WithdrawalView]:
        withdrawals = await uow.withdrawals.list_for_advance(advance.id)
        pools = [p for p in (_pool(w) for w in withdrawals) if p is not None]
        remaining = remaining_by_pool(pools, allocate(pools, self._spends(advance, expenses)))
        return [WithdrawalView(w, remaining.get(w.id, w.amount)) for w in withdrawals]

    async def create(self, actor: Employee, advance_id: uuid.UUID, data: WithdrawalData) -> CashWithdrawal:
        check_currency(data.currency, (await self._settings.current()).supported_currencies)
        async with self._uow() as uow:
            advance = await self._own_open(uow, actor, advance_id)
            withdrawal = CashWithdrawal(
                advance_id=advance.id,
                employee_id=actor.id,
                withdrawn_on=data.withdrawn_on,
                currency=data.currency,
                amount=data.amount,
                debited_amount=data.debited_amount,
                fee_amount=data.fee_amount or None,
                note=(data.note or "").strip()[:300] or None,
                updated_by=actor.id,
            )
            if withdrawal.currency == advance.ledger_currency:
                raise ValidationError("Withdrawal in the advance currency", code="withdrawal_same_currency")
            await self._price(uow, advance, withdrawal)
            await uow.withdrawals.add(withdrawal)
            await self._sync_fee(uow, advance, withdrawal, actor)
            await self.reallocate(uow, advance)
            await uow.audit.add(AuditEntry("withdrawal_created", "advance", str(advance.id), actor.id, data=_audit(withdrawal)))
            await uow.commit()
        return withdrawal

    async def update(self, actor: Employee, withdrawal_id: uuid.UUID, changes: dict[str, Any]) -> CashWithdrawal:
        async with self._uow() as uow:
            withdrawal, advance, as_treasury = await self._editable(uow, actor, withdrawal_id)
            if as_treasury:
                # Tesorería ve el extracto: completa lo que cobró el banco y la comisión (y una nota).
                changes = {k: v for k, v in changes.items() if k in ("debited_amount", "fee_amount", "note")}
            if "currency" in changes:
                check_currency(changes["currency"], (await self._settings.current()).supported_currencies)
                changes["currency"] = str(changes["currency"]).upper()
                if changes["currency"] == advance.ledger_currency:
                    raise ValidationError("Withdrawal in the advance currency", code="withdrawal_same_currency")
            for name, value in changes.items():
                if name == "amount" and (value is None or value <= 0):
                    raise ValidationError("Withdrawal amount must be positive", code="negative_amount")
                if name == "note":
                    value = (value or "").strip()[:300] or None
                if name == "fee_amount":
                    value = value or None
                setattr(withdrawal, name, value)
            withdrawal.updated_by, withdrawal.updated_at = actor.id, self._clock.now()
            await self._price(uow, advance, withdrawal)
            await self._sync_fee(uow, advance, withdrawal, actor)
            await self.reallocate(uow, advance)
            await uow.audit.add(
                AuditEntry(
                    "withdrawal_updated", "advance", str(advance.id), actor.id, data={**_audit(withdrawal), "changes": changes}
                )
            )
            await uow.commit()
        return withdrawal

    async def delete(self, actor: Employee, withdrawal_id: uuid.UUID) -> None:
        async with self._uow() as uow:
            withdrawal, advance, as_treasury = await self._editable(uow, actor, withdrawal_id)
            if as_treasury:
                raise PermissionDeniedError("Only the traveler deletes a withdrawal", code="owner_only")
            withdrawal.fee_amount = None
            await self._sync_fee(uow, advance, withdrawal, actor)
            await uow.withdrawals.delete(withdrawal)
            await uow.flush()
            await self.reallocate(uow, advance)
            await uow.audit.add(AuditEntry("withdrawal_deleted", "advance", str(advance.id), actor.id, data=_audit(withdrawal)))
            await uow.commit()

    async def reallocate(self, uow: UnitOfWork, advance: Advance) -> None:
        """Reparte de nuevo todas las facturas en efectivo del anticipo entre sus retiros. Las que cambian de valor
        o de cobertura se reevalúan (la regla de efectivo sin retiro depende de esto)."""
        company = await uow.companies.get(advance.company_id)
        assert company is not None
        expenses = await uow.expenses.list_for_advances([advance.id])
        withdrawals = await uow.withdrawals.list_for_advance(advance.id)
        pools = [p for p in (_pool(w) for w in withdrawals) if p is not None]
        coverage = allocate(pools, self._spends(advance, expenses))
        now = self._clock.now()
        for expense in expenses:
            cov = coverage.get(expense.id)
            if cov is None:
                if expense.cash_allocations or expense.cash_uncovered:
                    expense.apply_cash([], Decimal(0), None, now)
                    await self._evaluator.apply(uow, expense, await uow.lines.list_for_expense(expense.id), now)
                continue
            assert expense.total is not None and expense.currency is not None
            applied: tuple[Decimal, Decimal, ExchangeRateSource, date] | None = None
            # Si el viajero escribió lo que le costó, ese valor manda; igual gasta el efectivo del retiro.
            if expense.exchange_rate_source != ExchangeRateSource.MANUAL:
                day = rate_day(expense.invoice_date or now.date(), company.exchange_rate_policy)
                conversion = (
                    await self._rates.conversion(uow, expense.currency, advance.ledger_currency, day)
                    if cov.uncovered > 0
                    else None
                )
                day_rate = conversion.rate if conversion else None
                value, rate = cov.value(day_rate), cov.rate(expense.total, day_rate)
                if value is not None and rate is not None:
                    if cov.draws:
                        first = next(w for w in withdrawals if w.id == cov.draws[0].withdrawal_id)
                        applied = (value, rate, ExchangeRateSource.WITHDRAWAL, first.withdrawn_on)
                    elif conversion is not None:
                        applied = (value, rate, conversion.source, conversion.day)
            if expense.apply_cash([d.as_dict() for d in cov.draws], cov.uncovered, applied, now):
                await self._evaluator.apply(uow, expense, await uow.lines.list_for_expense(expense.id), now)

    @staticmethod
    def _spends(advance: Advance, expenses: list[Expense]) -> list[CashSpend]:
        return [
            CashSpend(e.id, e.currency, e.total, e.invoice_date, e.invoice_time, e.created_at)
            for e in expenses
            if e.counts_against(advance.id)
            and e.source != ExpenseSource.WITHDRAWAL_FEE
            and e.currency is not None
            and e.total is not None
            and e.total > 0
            and e.currency != advance.ledger_currency
            and pays_cash(e, advance)
        ]

    async def _price(self, uow: UnitOfWork, advance: Advance, withdrawal: CashWithdrawal) -> None:
        """Tasa oficial del día del retiro hacia la moneda de legalización. Si no hay, hace falta lo debitado."""
        conversion = await self._rates.conversion(uow, withdrawal.currency, advance.ledger_currency, withdrawal.withdrawn_on)
        if conversion is None:
            withdrawal.official_rate = withdrawal.official_rate_date = withdrawal.official_source = None
        else:
            withdrawal.official_rate = conversion.rate
            withdrawal.official_rate_date, withdrawal.official_source = conversion.day, conversion.source
        if withdrawal.rate is None:
            raise ValidationError("No rate for the withdrawal", code="withdrawal_rate_missing", currency=advance.ledger_currency)

    async def _sync_fee(self, uow: UnitOfWork, advance: Advance, withdrawal: CashWithdrawal, actor: Employee) -> None:
        """La comisión cuenta como un gasto confirmado más: así suma en el saldo, el Excel y los reportes."""
        now = self._clock.now()
        existing = await uow.expenses.get(withdrawal.fee_expense_id) if withdrawal.fee_expense_id else None
        fee = withdrawal.fee_amount
        if not fee or fee <= 0:
            if existing is not None:
                existing.discard(now)
            withdrawal.fee_expense_id = None
            return
        description = f"Comisión del retiro de {withdrawal.amount} {withdrawal.currency} del {withdrawal.withdrawn_on}"
        if existing is not None and existing.status != ExpenseStatus.DISCARDED:
            existing.total = existing.amount_applied = fee
            existing.currency, existing.invoice_date, existing.description = (
                advance.ledger_currency,
                withdrawal.withdrawn_on,
                description,
            )
            existing.touch(now)
            return
        expense = Expense(
            employee_id=advance.employee_id,
            source=ExpenseSource.WITHDRAWAL_FEE,
            company_id=advance.company_id,
            advance_id=advance.id,
            status=ExpenseStatus.CONFIRMED,
            document_type=DocumentType.OTHER,
            vendor_name=FEE_VENDOR,
            invoice_date=withdrawal.withdrawn_on,
            currency=advance.ledger_currency,
            total=fee,
            amount_applied=fee,
            description=description,
            deductibility=Deductibility.NON_DEDUCTIBLE,
            confirmed_at=now,
            confirmed_by=actor.id,
        )
        await uow.expenses.add(expense)
        await uow.flush()  # sin relaciones ORM: el gasto debe existir antes de que el retiro lo referencie
        withdrawal.fee_expense_id = expense.id

    async def _own_open(self, uow: UnitOfWork, actor: Employee, advance_id: uuid.UUID) -> Advance:
        self._access.require(actor, Permission.EXPENSES_CREATE)
        advance = await uow.advances.get(advance_id)
        if advance is None or advance.employee_id != actor.id:
            raise NotFoundError("advance")
        if not advance.accepts_expenses:
            raise InvalidOperationError("The advance is not receiving expenses", code="advance_not_open")
        return advance

    async def _editable(self, uow: UnitOfWork, actor: Employee, withdrawal_id: uuid.UUID) -> tuple[CashWithdrawal, Advance, bool]:
        """El viajero cambia su retiro mientras el anticipo está abierto; tesorería, hasta que se cierra."""
        withdrawal = await uow.withdrawals.get(withdrawal_id)
        advance = await uow.advances.get(withdrawal.advance_id) if withdrawal else None
        if withdrawal is None or advance is None:
            raise NotFoundError("withdrawal")
        if advance.employee_id == actor.id and advance.accepts_expenses:
            return withdrawal, advance, False
        if has_permission(actor.role, Permission.TREASURY_MANAGE):
            owner = await uow.employees.get(advance.employee_id)
            if owner is None:
                raise NotFoundError("withdrawal")
            self._access.ensure_view(actor, owner, advance.company_id, "withdrawal")
            if advance.status not in (AdvanceStatus.APPROVED, AdvanceStatus.IN_REVIEW):
                raise InvalidOperationError("The legalization is closed", code="legalization_locked")
            return withdrawal, advance, True
        if advance.employee_id == actor.id:
            raise InvalidOperationError("The advance is already in review or closed", code="legalization_locked")
        raise NotFoundError("withdrawal")


def _pool(w: CashWithdrawal) -> Pool | None:
    rate = w.rate
    return None if rate is None else Pool(w.id, w.currency, w.withdrawn_on, w.amount, rate, w.created_at)


def _audit(w: CashWithdrawal) -> dict[str, Any]:
    return {
        "withdrawal": str(w.id),
        "on": w.withdrawn_on,
        "amount": w.amount,
        "currency": w.currency,
        "debited": w.debited_amount,
        "fee": w.fee_amount,
    }
