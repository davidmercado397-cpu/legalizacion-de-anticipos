"""Anticipos ("bolsas"): solicitud, aprobación, envío a legalización, cierre y saldos en vivo."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any

from app.application import messages as msg
from app.application.access import AccessPolicy
from app.application.budgets import TravelBudgetService, TripQuery
from app.application.exchange import ExchangeRateService
from app.application.learning import LearningService
from app.application.settings import SettingsService, check_currency
from app.domain.approvals import Approver, build_route, escalation_reasons
from app.domain.budgets import TripLeg
from app.domain.entities import Advance, AdvanceBalance, AuditEntry, Company, Employee, Expense
from app.domain.enums import AdvanceKind, AdvanceStatus, ApprovalLevel, Channel, ExpenseStatus, ReviewStatus, Role, StepStatus
from app.domain.errors import InvalidOperationError, NotFoundError, PermissionDeniedError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import AdvanceFilter, Clock, EmployeeFilter, Page, Paged, ScopeFilter, UnitOfWork, UnitOfWorkFactory
from app.domain.time import add_months, local_date


@dataclass(frozen=True)
class AdvanceRequest:
    company_id: uuid.UUID
    kind: AdvanceKind
    currency: str
    amount: Decimal | None  # None = el valor calculado con las tarifas de viaje
    purpose: str
    destination: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    travel_zone_id: uuid.UUID | None = None
    justification: str | None = None  # obligatoria si el valor difiere del presupuesto calculado
    legs: tuple[TripLeg, ...] = ()  # varios destinos; reemplazan destination y las fechas


@dataclass(frozen=True)
class ReturnMark:
    """Un gasto que el aprobador señala al devolver la legalización, con lo que debe corregirse."""

    expense_id: uuid.UUID
    note: str


@dataclass(frozen=True)
class FunctionalBalance:
    """El saldo de un anticipo en otra moneda, expresado también en la moneda de la compañía."""

    currency: str
    rate: Decimal
    rate_date: date
    amount: Decimal
    applied: Decimal
    pending: Decimal


@dataclass(frozen=True)
class AdvanceDetail:
    advance: Advance
    balance: AdvanceBalance
    expenses: list[Expense]
    functional: FunctionalBalance | None = None


@dataclass(frozen=True)
class OpenBalance:
    advance: Advance
    balance: AdvanceBalance
    functional: FunctionalBalance | None = None


@dataclass(frozen=True)
class DecisionQueue:
    """Las solicitudes de su equipo (o de quien suple) que esperan la decisión de un aprobador."""

    requested: list[tuple[Advance, Employee]]
    requested_total: int


class AdvanceEventType(StrEnum):
    REQUESTED = "requested"
    APPROVED = "approved"
    REJECTED = "rejected"
    VOIDED = "voided"
    SUBMITTED = "submitted"
    RETURNED = "returned"
    CLOSED = "closed"
    DISBURSED = "disbursed"


@dataclass(frozen=True)
class AdvanceEvent:
    type: AdvanceEventType
    advance_id: uuid.UUID
    actor_id: uuid.UUID


AdvanceHook = Callable[[AdvanceEvent], Awaitable[None]]


class AdvanceEvents:
    """Observer mínimo: se emite después del commit, así un aviso nunca ve un cambio que no quedó.
    Los hooks deben ser rápidos (el container los manda a segundo plano)."""

    def __init__(self) -> None:
        self._hooks: dict[AdvanceEventType, list[AdvanceHook]] = defaultdict(list)

    def on(self, types: list[AdvanceEventType], hook: AdvanceHook) -> None:
        for event_type in types:
            self._hooks[event_type].append(hook)

    async def emit(self, event_type: AdvanceEventType, advance_id: uuid.UUID, actor_id: uuid.UUID) -> None:
        for hook in self._hooks[event_type]:
            await hook(AdvanceEvent(event_type, advance_id, actor_id))


class AdvanceService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        settings: SettingsService,
        rates: ExchangeRateService,
        budgets: TravelBudgetService,
        clock: Clock,
        learning: LearningService,
        events: AdvanceEvents,
    ) -> None:
        self._events = events
        self._uow = uow
        self._clock = clock
        self._learning = learning
        self._access = access
        self._settings = settings
        self._rates = rates
        self._budgets = budgets

    async def request(self, actor: Employee, data: AdvanceRequest) -> Advance:
        self._access.require(actor, Permission.ADVANCES_REQUEST)
        if not actor.works_for(data.company_id):
            raise ValidationError("Advance for a foreign company", code="foreign_company")
        check_currency(data.currency, (await self._settings.current()).supported_currencies)
        currency = data.currency.upper()
        async with self._uow() as uow:
            company = await uow.companies.get(data.company_id)
            assert company is not None
            query = TripQuery(data.company_id, data.destination, data.start_date, data.end_date, data.travel_zone_id, data.legs)
            legs = query.trip_legs() if data.legs else []
            destination, start_date, end_date = data.destination, data.start_date, data.end_date
            if legs:
                destination = " → ".join(leg.destination for leg in legs)[:200]
                start_date, end_date = legs[0].start, max(leg.end for leg in legs)
            budget = await self._budgets.for_trip(uow, actor.staff_type, query)
            if budget is not None and budget.currency != currency:
                raise ValidationError(
                    "Budget in another currency", code="budget_currency_mismatch", budget_currency=budget.currency
                )
            amount = data.amount if data.amount is not None else (budget.total if budget else None)
            if amount is None:
                raise ValidationError("Amount required", code="amount_required")
            if data.kind != AdvanceKind.CORPORATE_CARD and amount <= 0:
                raise ValidationError("The amount must be positive", code="amount_not_positive")
            justification = (data.justification or "").strip() or None
            if budget is not None and amount != budget.total and justification is None:
                raise ValidationError(
                    "Justification required", code="budget_justification_required", budget=msg.money(budget.total, currency)
                )
            reasons = escalation_reasons(
                amount,
                currency,
                budget.total if budget else None,
                company.approval_tolerance_pct,
                company.approval_thresholds,
            )
            if reasons and justification is None:
                raise ValidationError("Justification required", code="escalation_justification_required")
            if data.kind == AdvanceKind.CASH and currency != company.currency:
                await self._check_cash_cap(uow, company, currency, amount)
            steps = await self._route(uow, actor, company.id, bool(reasons))
            advance = Advance(
                employee_id=actor.id,
                company_id=data.company_id,
                kind=data.kind,
                currency=currency,
                amount=amount,
                purpose=data.purpose.strip(),
                destination=destination,
                start_date=start_date,
                end_date=end_date,
                legs=[leg.as_dict() for leg in legs],
                budget_zone_id=budget.zone_id if budget else None,
                budget_amount=budget.total if budget else None,
                budget_breakdown=[line.as_dict() for line in budget.lines] if budget else [],
                budget_justification=justification,
                approval_steps=steps,
                escalation_reasons=reasons,
            )
            await uow.advances.add(advance)
            await uow.audit.add(
                AuditEntry(
                    "advance_requested",
                    "advance",
                    str(advance.id),
                    actor.id,
                    data={"amount": advance.amount, "budget": advance.budget_amount},
                )
            )
            await uow.commit()
        await self._events.emit(AdvanceEventType.REQUESTED, advance.id, actor.id)
        return advance

    async def _route(self, uow: UnitOfWork, requester: Employee, company_id: uuid.UUID, escalated: bool) -> list[dict[str, Any]]:
        """Jefe inmediato; si escala, también el jefe directivo (el jefe del jefe). Sin jefe, la gerencia."""
        boss = await uow.employees.get(requester.approver_id) if requester.approver_id else None
        director = await uow.employees.get(boss.approver_id) if boss and boss.approver_id else None
        steps = build_route(requester.id, _approver(boss), _approver(director), escalated)
        if any(s["level"] == ApprovalLevel.MANAGEMENT for s in steps):
            flt = EmployeeFilter(company_id=company_id, role=Role.MANAGEMENT, active=True)
            if (await uow.employees.find(flt, Page(1, 0))).total == 0:
                raise ValidationError("Nobody can approve this trip", code="no_approver_available")
        return steps

    async def _check_cash_cap(self, uow: UnitOfWork, company: Company, currency: str, amount: Decimal) -> None:
        """El efectivo en moneda extranjera tiene un tope por compañía (p. ej. USD 200)."""
        cap = company.cash_international_cap
        if not cap:
            return
        cap_amount, cap_currency = Decimal(cap["amount"]), cap["currency"]
        if currency == cap_currency:
            in_cap_currency = amount
        else:
            today = local_date(self._clock.now(), company.timezone)
            conversion = await self._rates.conversion(uow, currency, cap_currency, today)
            if conversion is None:
                raise ValidationError("No rate to verify the cash cap", code="cash_cap_unverifiable")
            in_cap_currency = conversion.apply(amount)
        if in_cap_currency > cap_amount:
            raise ValidationError("Cash cap exceeded", code="cash_cap_exceeded", cap=msg.money(cap_amount, cap_currency))

    async def search(
        self,
        actor: Employee,
        status: AdvanceStatus | None,
        page: Page,
        disbursed: bool | None = None,
        settlement_pending: bool | None = None,
    ) -> Paged[Advance]:
        async with self._uow() as uow:
            scope = await self._access.scope_for(uow, actor)
            flt = AdvanceFilter(scope=scope, status=status, disbursed=disbursed, settlement_pending=settlement_pending)
            return await uow.advances.find(flt, page)

    async def owner_names(self, advances: list[Advance]) -> dict[uuid.UUID, str]:
        """Nombre de quien pidió cada anticipo, para los listados (las búsquedas ya filtraron la visibilidad)."""
        async with self._uow() as uow:
            names: dict[uuid.UUID, str] = {}
            for employee_id in dict.fromkeys(a.employee_id for a in advances):
                employee = await uow.employees.get(employee_id)
                names[employee_id] = employee.full_name if employee else ""
        return names

    async def decision_queue(self, actor: Employee, limit: int) -> DecisionQueue:
        """Las solicitudes en las que le toca decidir ahora: su paso de la ruta (o el de quien suple), o el de
        nivel superior que puede aprobar sin esperar."""
        self._access.require(actor, Permission.ADVANCES_APPROVE)
        async with self._uow() as uow:
            delegated = await self._access.delegated_from(uow, actor)
            scope = ScopeFilter(company_ids=list(actor.company_ids))
            requested = await uow.advances.find(AdvanceFilter(scope=scope, status=AdvanceStatus.REQUESTED), Page(500, 0))
            items = []
            for advance in requested.items:
                owner = await uow.employees.get(advance.employee_id)
                if owner is None or owner.id == actor.id:
                    continue
                # Las solicitudes anteriores a la ruta las decide el aprobador del empleado, como antes.
                mine = advance.can_decide(actor, delegated) if advance.approval_steps else actor.can_approve_for(owner, delegated)
                if mine:
                    items.append((advance, owner))
        return DecisionQueue(items[:limit], len(items))

    async def mine(self, actor: Employee, limit: int) -> list[Advance]:
        async with self._uow() as uow:
            return (await uow.advances.find(AdvanceFilter(employee_id=actor.id), Page(limit, 0))).items

    async def get(self, actor: Employee, advance_id: uuid.UUID) -> AdvanceDetail:
        async with self._uow() as uow:
            advance, _, _ = await self._visible(uow, actor, advance_id)
            expenses = await uow.expenses.list_for_advance(advance_id)
            balance = advance.balance(expenses)
            functional = await self._functional(uow, advance, balance)
        return AdvanceDetail(advance, balance, expenses, functional)

    async def open_balances(self, employee_id: uuid.UUID) -> list[OpenBalance]:
        async with self._uow() as uow:
            advances = await uow.advances.list_open_for(employee_id)
            expenses = await uow.expenses.list_for_advances([a.id for a in advances])
            result = []
            for advance in advances:
                balance = advance.balance(expenses)
                result.append(OpenBalance(advance, balance, await self._functional(uow, advance, balance)))
        return result

    async def _functional(self, uow: UnitOfWork, advance: Advance, balance: AdvanceBalance) -> FunctionalBalance | None:
        company: Company | None = await uow.companies.get(advance.company_id)
        if company is None or company.currency == advance.currency:
            return None
        conversion = await self._rates.to_functional(uow, advance, company)
        if conversion is None:
            return None
        return FunctionalBalance(
            company.currency,
            conversion.rate,
            conversion.day,
            conversion.apply(balance.amount),
            conversion.apply(balance.applied),
            conversion.apply(balance.pending),
        )

    async def approve(self, actor: Employee, advance_id: uuid.UUID, channel: Channel = Channel.API) -> Advance:
        return await self._decide(actor, advance_id, "approve", None, channel)

    async def reject(self, actor: Employee, advance_id: uuid.UUID, note: str | None, channel: Channel = Channel.API) -> Advance:
        return await self._decide(actor, advance_id, "reject", note, channel)

    async def close(self, actor: Employee, advance_id: uuid.UUID) -> Advance:
        return await self._decide(actor, advance_id, "close", None, Channel.API)

    async def return_for_changes(
        self, actor: Employee, advance_id: uuid.UUID, note: str | None, marks: list[ReturnMark] | None = None
    ) -> Advance:
        return await self._decide(actor, advance_id, "return", note, Channel.API, marks or [])

    async def submit(self, actor: Employee, advance_id: uuid.UUID) -> Advance:
        async with self._uow() as uow:
            advance, owner, _ = await self._visible(uow, actor, advance_id)
            if owner.id != actor.id:
                raise PermissionDeniedError("Only the owner submits the legalization", code="owner_submits")
            expenses = await uow.expenses.list_for_advance(advance.id)
            open_items = [
                e for e in expenses if e.status in (ExpenseStatus.RECEIVED, ExpenseStatus.PROCESSING, ExpenseStatus.EXTRACTED)
            ]
            if open_items:
                raise InvalidOperationError("Pending expenses", code="pending_expenses", count=len(open_items))
            advance.submit_for_review(self._clock.now())
            # Reenviar sin resolver todas las marcas se permite (puede responder con una justificación),
            # pero el aprobador ve cuántas quedaron abiertas.
            unresolved = sum(1 for e in expenses if e.return_note and e.return_resolved_at is None)
            await uow.audit.add(
                AuditEntry("advance_submitted", "advance", str(advance.id), actor.id, data={"unresolved_marks": unresolved})
            )
            await uow.commit()
        await self._events.emit(AdvanceEventType.SUBMITTED, advance.id, actor.id)
        return advance

    async def cancel(self, actor: Employee, advance_id: uuid.UUID, channel: Channel = Channel.API) -> Advance:
        """El dueño retira su solicitud; contabilidad también puede hacerlo. Solo antes de aprobarse."""
        async with self._uow() as uow:
            advance, owner, _ = await self._visible(uow, actor, advance_id)
            if owner.id != actor.id:
                self._access.require(actor, Permission.ADVANCES_ADMINISTER)
            advance.cancel(self._clock.now())
            await uow.audit.add(AuditEntry("advance_cancel", "advance", str(advance.id), actor.id, channel))
            await uow.commit()
        return advance

    async def void(self, actor: Employee, advance_id: uuid.UUID, note: str) -> Advance:
        """Los gastos sin confirmar del anticipo quedan sin anticipo: no se pierden."""
        self._access.require(actor, Permission.ADVANCES_ADMINISTER)
        note = _required_note(note)
        now = self._clock.now()
        async with self._uow() as uow:
            advance, _, _ = await self._visible(uow, actor, advance_id)
            expenses = await uow.expenses.list_for_advance(advance.id)
            advance.void(actor.id, note, advance.balance(expenses).applied, now)
            for expense in expenses:
                if expense.status != ExpenseStatus.CONFIRMED:
                    expense.assign_to(None)
                    expense.clear_conversion()
                    expense.touch(now)
            await uow.audit.add(AuditEntry("advance_void", "advance", str(advance.id), actor.id, data={"note": note}))
            await uow.commit()
        await self._events.emit(AdvanceEventType.VOIDED, advance.id, actor.id)
        return advance

    async def reopen(self, actor: Employee, advance_id: uuid.UUID, note: str) -> Advance:
        self._access.require(actor, Permission.ADVANCES_ADMINISTER)
        note = _required_note(note)
        async with self._uow() as uow:
            advance, _, _ = await self._visible(uow, actor, advance_id)
            advance.reopen(actor.id, note, self._clock.now())
            await uow.audit.add(AuditEntry("advance_reopen", "advance", str(advance.id), actor.id, data={"note": note}))
            await uow.commit()
        return advance

    async def _decide(
        self,
        actor: Employee,
        advance_id: uuid.UUID,
        action: str,
        note: str | None,
        channel: Channel,
        marks: list[ReturnMark] | None = None,
    ) -> Advance:
        permission = Permission.ADVANCES_APPROVE if action in ("approve", "reject") else Permission.ADVANCES_CLOSE
        self._access.require(actor, permission)
        now = self._clock.now()
        completed = True
        async with self._uow() as uow:
            advance, owner, delegated = await self._visible(uow, actor, advance_id)
            expenses = await uow.expenses.list_for_advance(advance.id)
            match action:
                case "approve":
                    completed = advance.approve(actor, owner, delegated)
                    if completed:
                        # Decisión 2.5: un mes después del regreso (o de la aprobación si el viaje no tiene fechas).
                        months = (await self._settings.current()).legalization_deadline_months
                        advance.legalization_due = add_months(advance.end_date or local_date(now, "UTC"), months)
                case "reject":
                    advance.reject(actor, owner, note, delegated)
                case "close":
                    pending = [
                        e for e in expenses if e.status == ExpenseStatus.CONFIRMED and e.review_status == ReviewStatus.PENDING
                    ]
                    if pending:
                        raise InvalidOperationError("Unreviewed findings", code="unreviewed_findings", count=len(pending))
                    advance.close(actor, owner, advance.balance(expenses).pending, delegated)
                    await self._learning.activate_closed(uow, actor, [e.id for e in expenses])
                case "return":
                    advance.return_for_changes(actor, owner, note, delegated)
                    by_id = {e.id: e for e in expenses}
                    for mark in marks or []:
                        expense = by_id.get(mark.expense_id)
                        if expense is None:
                            raise NotFoundError("expense")
                        expense.mark_for_return(mark.note, now)
            data: dict[str, object] = {"note": note}
            if owner.approver_id in delegated and owner.approver_id != actor.id:
                data["on_behalf_of"] = owner.approver_id  # decidió como suplente
            if marks:
                data["marked_expenses"] = [str(m.expense_id) for m in marks]
            if action == "approve" and not completed:
                data["pending_steps"] = sum(1 for s in advance.approval_steps if s["status"] == StepStatus.PENDING)
            await uow.audit.add(AuditEntry(f"advance_{action}", "advance", str(advance.id), actor.id, channel, data))
            await uow.commit()
        # Aprobar un paso intermedio no es todavía la aprobación de la solicitud.
        if completed:
            await self._events.emit(_DECISION_EVENTS[action], advance.id, actor.id)
        return advance

    async def _visible(
        self, uow: UnitOfWork, actor: Employee, advance_id: uuid.UUID
    ) -> tuple[Advance, Employee, frozenset[uuid.UUID]]:
        advance = await uow.advances.get(advance_id)
        owner = await uow.employees.get(advance.employee_id) if advance else None
        if advance is None or owner is None:
            raise NotFoundError("advance")
        delegated = await self._access.delegated_from(uow, actor)
        # Quien está en la ruta de aprobación la ve aunque el empleado no le reporte directo (jefe directivo).
        if not advance.involves(actor, delegated):
            self._access.ensure_view(actor, owner, advance.company_id, "advance", delegated)
        return advance, owner, delegated


_DECISION_EVENTS = {
    "approve": AdvanceEventType.APPROVED,
    "reject": AdvanceEventType.REJECTED,
    "close": AdvanceEventType.CLOSED,
    "return": AdvanceEventType.RETURNED,
}


def _required_note(note: str | None) -> str:
    cleaned = (note or "").strip()
    if not cleaned:
        raise ValidationError("A note is required", code="note_required")
    return cleaned[:1000]


def _approver(employee: Employee | None) -> Approver | None:
    return Approver(employee.id, employee.full_name) if employee is not None and employee.active else None
