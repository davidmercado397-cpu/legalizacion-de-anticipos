"""Conciliación con el extracto bancario (decisiones 7.1 a 7.9).

Tesorería carga el extracto de la tarjeta cuando la legalización ya está en revisión. Los cargos se
cruzan con los gastos pagados con tarjeta; cruzado, el gasto se legaliza por lo que cobró el banco.
Contabilidad confirma o descarta las sugerencias y decide los cargos sin factura: los asume la empresa
(quedan como un gasto confirmado de origen "bank") o se le descuentan al empleado (quedan en lo que
debe reintegrar). Una factura pagada con tarjeta sin cargo en el periodo del extracto queda en alerta."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from app.application.access import AccessPolicy
from app.application.exchange import ExchangeRateService
from app.application.settings import SettingsService
from app.domain.entities import Advance, AuditEntry, BankStatement, Employee, Expense, StatementMovement
from app.domain.enums import (
    AdvanceStatus,
    BankStatus,
    ChargeDecision,
    Deductibility,
    DocumentType,
    ExpenseSource,
    ExpenseStatus,
    PaymentMethod,
    ReviewStatus,
)
from app.domain.errors import ConflictError, InvalidOperationError, NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import (
    Clock,
    ExtractionOptions,
    FileStorage,
    StatementExtractor,
    TableReader,
    UnitOfWork,
    UnitOfWorkFactory,
)
from app.domain.reconciliation import (
    CardPayment,
    Charge,
    MatchParams,
    StatementProfile,
    TripWindow,
    match,
    read_movements,
    suggest_profile,
)

_PREVIEW_ROWS = 15
# El PDF lo lee la IA y lo entrega con columnas fijas: fecha ISO, descripción, referencia y valor (cargos en negativo).
_PDF_PROFILE = {"header_row": 1, "date_col": 0, "description_col": 1, "reference_col": 2, "amount_col": 3}


@dataclass(frozen=True)
class UploadedFile:
    name: str
    content: bytes

    @property
    def is_pdf(self) -> bool:
        return self.name.lower().endswith(".pdf") or self.content[:5] == b"%PDF-"


@dataclass(frozen=True)
class StatementPreview:
    rows: list[list[str]]
    total_rows: int
    profile: StatementProfile
    confident: bool
    charges: int
    credits: int
    skipped: list[tuple[int, str]]


@dataclass(frozen=True)
class StatementView:
    statement: BankStatement
    movements: list[StatementMovement]


class ReconciliationService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        storage: FileStorage,
        tables: TableReader,
        extractor: StatementExtractor,
        settings: SettingsService,
        rates: ExchangeRateService,
        clock: Clock,
    ) -> None:
        self._uow = uow
        self._access = access
        self._storage = storage
        self._tables = tables
        self._extractor = extractor
        self._settings = settings
        self._rates = rates
        self._clock = clock

    async def preview(
        self, actor: Employee, advance_id: uuid.UUID, file: UploadedFile, profile: dict[str, object] | None
    ) -> StatementPreview:
        """Cómo se leería un CSV o Excel, con el mapeo indicado o con uno sugerido (el PDF lo lee la IA al cargarlo)."""
        self._access.require(actor, Permission.TREASURY_MANAGE)
        async with self._uow() as uow:
            advance, company_currency = await self._advance(uow, actor, advance_id)
        await self._check_size(file)
        if file.is_pdf:
            raise ValidationError("PDF statements have no preview", code="statement_pdf_no_preview")
        rows = self._tables.read(file.content, file.name)
        suggestion = suggest_profile(rows, company_currency)
        chosen = StatementProfile.of(profile) if profile else suggestion.profile
        reading = read_movements(rows, chosen)
        return StatementPreview(
            rows=[[str(c) for c in r] for r in rows[:_PREVIEW_ROWS]],
            total_rows=len(rows),
            profile=chosen,
            confident=suggestion.confident if not profile else True,
            charges=sum(1 for m in reading.movements if m.is_charge),
            credits=sum(1 for m in reading.movements if not m.is_charge),
            skipped=reading.skipped[:20],
        )

    async def upload(
        self,
        actor: Employee,
        advance_id: uuid.UUID,
        file: UploadedFile,
        profile: dict[str, object] | None,
        card_last4: str | None,
    ) -> StatementView:
        self._access.require(actor, Permission.TREASURY_MANAGE)
        if card_last4 is not None and not (len(card_last4) == 4 and card_last4.isdigit()):
            raise ValidationError("Invalid card digits", code="invalid_card_last4")
        await self._check_size(file)
        sha256 = hashlib.sha256(file.content).hexdigest()
        async with self._uow() as uow:
            advance, company_currency = await self._advance(uow, actor, advance_id)
            if await uow.statements.file_exists(advance.company_id, sha256):
                raise ConflictError("Statement already loaded", code="statement_already_loaded")
        if file.is_pdf:
            runtime = await self._settings.current()
            options = ExtractionOptions(
                prompt_version=runtime.ai_statement_prompt_version,
                max_tokens=max(runtime.ai_max_tokens, 8000),
                reasoning_off=runtime.ai_reasoning_off,
                reasoning_on=runtime.ai_reasoning_on,
                zero_data_retention=runtime.ai_zero_data_retention,
                availability_fallbacks=tuple(runtime.ai_availability_fallbacks),
            )
            table = await self._extractor.extract(file.content, runtime.ai_primary_model, options)
            rows = table.rows
            currency = (table.currency or company_currency).upper()
            chosen = StatementProfile(
                **_PDF_PROFILE, currency=currency, date_format="YYYY-MM-DD", decimal_separator=".", charges_negative=True
            )
            card_last4 = card_last4 or table.card_last4
        else:
            rows = self._tables.read(file.content, file.name)
            chosen = StatementProfile.of(profile) if profile else suggest_profile(rows, company_currency).profile
        reading = read_movements(rows, chosen)
        if not any(m.is_charge for m in reading.movements):
            raise ValidationError("Statement without charges", code="statement_without_charges")

        params = await self._params()
        statement = BankStatement(
            advance_id=advance.id,
            company_id=advance.company_id,
            employee_id=advance.employee_id,
            currency=chosen.currency.upper(),
            file_name=file.name[:200],
            file_sha256=sha256,
            file_key="",
            profile=chosen.as_dict(),
            uploaded_by=actor.id,
            card_last4=card_last4,
        )
        extension = "pdf" if file.is_pdf else file.name.rsplit(".", 1)[-1].lower()[:5]
        statement.file_key = f"statements/{advance.id}/{statement.id}.{extension}"
        await self._storage.save(statement.file_key, file.content, "application/octet-stream")
        window = TripWindow(advance.start_date, advance.end_date, params.max_days)
        now = self._clock.now()
        async with self._uow() as uow:
            await uow.statements.add(statement)
            await uow.flush()
            for m in reading.movements:
                movement = StatementMovement(
                    statement.id, m.row, m.day, m.description, m.amount, m.is_charge, window.contains(m.day), m.reference
                )
                await uow.statements.add_movement(movement)
            await uow.flush()
            await self._reconcile(uow, advance, params, actor.id, now)
            await uow.audit.add(
                AuditEntry(
                    "statement_uploaded",
                    "advance",
                    str(advance.id),
                    actor.id,
                    data={"statement": str(statement.id), "movements": len(reading.movements), "file": statement.file_name},
                )
            )
            await uow.commit()
        return await self._view(statement.id)

    async def statements(self, actor: Employee, advance_id: uuid.UUID) -> list[StatementView]:
        async with self._uow() as uow:
            advance = await uow.advances.get(advance_id)
            owner = await uow.employees.get(advance.employee_id) if advance else None
            if advance is None or owner is None:
                raise NotFoundError("advance")
            self._access.ensure_view(actor, owner, advance.company_id, "advance")
            found = await uow.statements.list_for_advance(advance_id)
            movements = await uow.statements.movements_of([s.id for s in found])
        return [StatementView(s, [m for m in movements if m.statement_id == s.id]) for s in found]

    async def confirm(self, actor: Employee, statement_id: uuid.UUID, movement_id: uuid.UUID) -> StatementView:
        return await self._decide(actor, statement_id, movement_id, lambda m, now: m.confirm(actor.id, now))

    async def reject(self, actor: Employee, statement_id: uuid.UUID, movement_id: uuid.UUID) -> StatementView:
        return await self._decide(actor, statement_id, movement_id, lambda m, _now: m.reject())

    async def link(
        self, actor: Employee, statement_id: uuid.UUID, movement_id: uuid.UUID, expense_id: uuid.UUID
    ) -> StatementView:
        async def check(uow: UnitOfWork, advance: Advance, statement: BankStatement) -> None:
            expense = await uow.expenses.get(expense_id)
            if expense is None or expense.advance_id != advance.id or not _is_card_payment(expense):
                raise NotFoundError("expense")
            if await uow.statements.matched_elsewhere(statement.id, [expense_id]):
                raise ConflictError("Expense matched in another statement", code="expense_already_matched")

        return await self._decide(actor, statement_id, movement_id, lambda m, now: m.link(expense_id, actor.id, now), check)

    async def decide_charge(
        self, actor: Employee, statement_id: uuid.UUID, movement_id: uuid.UUID, decision: ChargeDecision
    ) -> StatementView:
        return await self._decide(actor, statement_id, movement_id, lambda m, now: m.decide(decision, actor.id, now))

    async def rematch(self, advance_id: uuid.UUID, actor_id: uuid.UUID) -> None:
        """Vuelve a cruzar cuando cambian los gastos (p. ej. el empleado reenvía la legalización corregida)."""
        params = await self._params()
        async with self._uow() as uow:
            advance = await uow.advances.get(advance_id)
            if advance is None or not await uow.statements.list_for_advance(advance_id):
                return
            await self._reconcile(uow, advance, params, actor_id, self._clock.now())
            await uow.commit()

    async def _decide(
        self,
        actor: Employee,
        statement_id: uuid.UUID,
        movement_id: uuid.UUID,
        action: Callable[[StatementMovement, datetime], object],
        check: Callable[[UnitOfWork, Advance, BankStatement], Awaitable[None]] | None = None,
    ) -> StatementView:
        """Contabilidad decide sobre el cruce (decisión 7.6); con la legalización cerrada ya no se cambia."""
        self._access.require(actor, Permission.ADVANCES_CLOSE)
        params = await self._params()
        now = self._clock.now()
        async with self._uow() as uow:
            statement = await uow.statements.get(statement_id)
            if statement is None:
                raise NotFoundError("statement")
            advance, _ = await self._advance(uow, actor, statement.advance_id, closing=True)
            movement = next((m for m in await uow.statements.movements_of([statement.id]) if m.id == movement_id), None)
            if movement is None:
                raise NotFoundError("movement")
            if check is not None:
                await check(uow, advance, statement)
            action(movement, now)
            await self._reconcile(uow, advance, params, actor.id, now)
            await uow.audit.add(
                AuditEntry(
                    "statement_movement_decided",
                    "advance",
                    str(advance.id),
                    actor.id,
                    data={
                        "movement": str(movement.id),
                        "expense": movement.expense_id,
                        "match": movement.match_status,
                        "decision": movement.charge_decision,
                    },
                )
            )
            await uow.commit()
        return await self._view(statement_id)

    async def _reconcile(
        self, uow: UnitOfWork, advance: Advance, params: MatchParams, actor_id: uuid.UUID, now: datetime
    ) -> None:
        """Recalcula los cruces de todos los extractos del anticipo y deja cada gasto con su estado bancario.
        Lo que decidió contabilidad (confirmado o enlazado a mano) se respeta."""
        statements = await uow.statements.list_for_advance(advance.id)
        movements = await uow.statements.movements_of([s.id for s in statements])
        expenses = [e for e in await uow.expenses.list_for_advance(advance.id) if _is_card_payment(e)]
        by_id = {e.id: e for e in expenses}
        live = {e.id for e in expenses}
        for m in movements:
            # Un cruce con un gasto que ya no cuenta (descartado, rechazado o cambiado a efectivo) se suelta.
            if m.expense_id is not None and (not m.is_fixed or m.expense_id not in live):
                m.unmatch()
        used = {m.expense_id for m in movements if m.expense_id is not None}
        for statement in statements:
            own = [m for m in movements if m.statement_id == statement.id]
            elsewhere = await uow.statements.matched_elsewhere(statement.id, list(by_id))
            payments = []
            for expense in expenses:
                if expense.id in used or expense.id in elsewhere or expense.invoice_date is None:
                    continue
                amount = await self._in_currency(uow, expense, advance, statement.currency)
                payments.append(
                    CardPayment(
                        expense.id,
                        expense.invoice_date,
                        expense.vendor_name or "",
                        expense.currency == statement.currency,
                        amount,
                    )
                )
            charges = [Charge(m.id, m.day, m.description, m.amount) for m in own if m.is_charge and m.expense_id is None]
            rejected = frozenset((m.id, uuid.UUID(e)) for m in own for e in m.rejected_expense_ids)
            proposals = match(charges, payments, params, rejected)
            movement_by_id = {m.id: m for m in own}
            for proposal in proposals:
                movement_by_id[proposal.movement_id].propose(proposal.expense_id, proposal.score, proposal.automatic)
                used.add(proposal.expense_id)

        currency_of = {s.id: s.currency for s in statements}
        periods = [_period(s, movements, params.max_days) for s in statements]
        applied = {m.expense_id: m for m in movements if m.applies}
        suggested = {m.expense_id for m in movements if m.expense_id is not None and not m.applies}
        for expense in expenses:
            movement = applied.get(expense.id)
            if movement is not None:
                currency = currency_of[movement.statement_id]
                converted = await self._to_advance(uow, movement.amount, currency, advance, movement.day)
                if converted is not None:
                    expense.apply_bank_charge(movement.amount, currency, converted, now)
                    continue
            in_period = expense.invoice_date is not None and any(p and p[0] <= expense.invoice_date <= p[1] for p in periods)
            no_charge = in_period and expense.id not in suggested and movement is None
            expense.mark_bank_status(BankStatus.NO_CHARGE if no_charge else None, now)
        for m in movements:
            await self._sync_absorbed(uow, advance, m, currency_of[m.statement_id], actor_id, now)

    async def _sync_absorbed(
        self, uow: UnitOfWork, advance: Advance, m: StatementMovement, currency: str, actor_id: uuid.UUID, now: datetime
    ) -> None:
        """El cargo sin factura que asume la empresa existe como gasto confirmado: así cuenta en el saldo, el
        Excel y los reportes como cualquier otro gasto. Si la decisión cambia, ese gasto se descarta."""
        if m.charge_decision == ChargeDecision.ABSORB and m.absorbed_expense_id is None:
            converted = await self._to_advance(uow, m.amount, currency, advance, m.day)
            if converted is None:
                raise InvalidOperationError("No rate to convert the charge", code="statement_rate_missing", currency=currency)
            expense = Expense(
                employee_id=advance.employee_id,
                source=ExpenseSource.BANK,
                company_id=advance.company_id,
                advance_id=advance.id,
                status=ExpenseStatus.CONFIRMED,
                document_type=DocumentType.OTHER,
                vendor_name=m.description,
                invoice_date=m.day,
                currency=currency,
                total=m.amount,
                amount_applied=converted,
                payment_method=PaymentMethod.CARD,
                bank_status=BankStatus.MATCHED,
                bank_amount=m.amount,
                bank_currency=currency,
                description="Cargo del extracto sin factura que asume la empresa",
                deductibility=Deductibility.NON_DEDUCTIBLE,
                confirmed_at=now,
                confirmed_by=actor_id,
            )
            await uow.expenses.add(expense)
            m.absorbed_expense_id = expense.id
        elif m.charge_decision != ChargeDecision.ABSORB and m.absorbed_expense_id is not None:
            absorbed = await uow.expenses.get(m.absorbed_expense_id)
            if absorbed is not None:
                absorbed.discard(now)
            m.absorbed_expense_id = None

    async def _in_currency(self, uow: UnitOfWork, expense: Expense, advance: Advance, currency: str) -> Decimal | None:
        """Total de la factura en la moneda del extracto."""
        if expense.currency == currency:
            return expense.total
        if currency == advance.currency:
            return expense.invoice_amount
        if expense.total is None or expense.currency is None or expense.invoice_date is None:
            return None
        conversion = await self._rates.conversion(uow, expense.currency, currency, expense.invoice_date)
        return conversion.apply(expense.total) if conversion else None

    async def _to_advance(self, uow: UnitOfWork, amount: Decimal, currency: str, advance: Advance, day: date) -> Decimal | None:
        if currency == advance.currency:
            return amount
        conversion = await self._rates.conversion(uow, currency, advance.currency, day)
        return conversion.apply(amount) if conversion else None

    async def _advance(
        self, uow: UnitOfWork, actor: Employee, advance_id: uuid.UUID, closing: bool = False
    ) -> tuple[Advance, str]:
        """El extracto se carga y se decide con la legalización enviada (en revisión o devuelta para corregir)."""
        advance = await uow.advances.get(advance_id)
        owner = await uow.employees.get(advance.employee_id) if advance else None
        company = await uow.companies.get(advance.company_id) if advance else None
        if advance is None or owner is None or company is None:
            raise NotFoundError("advance")
        self._access.ensure_view(actor, owner, advance.company_id, "advance")
        sent = advance.status == AdvanceStatus.IN_REVIEW or (
            advance.status == AdvanceStatus.APPROVED and advance.submitted_at is not None
        )
        if not sent:
            code = "statement_legalization_closed" if closing else "statement_legalization_not_sent"
            raise InvalidOperationError("The legalization is not in review", code=code)
        return advance, company.currency

    async def _check_size(self, file: UploadedFile) -> None:
        max_mb = (await self._settings.current()).reconciliation_max_file_mb
        if len(file.content) > max_mb * 1024 * 1024:
            raise ValidationError("Statement too large", code="file_too_large", max_mb=max_mb)

    async def _params(self) -> MatchParams:
        return MatchParams.of((await self._settings.current()).reconciliation_match)

    async def _view(self, statement_id: uuid.UUID) -> StatementView:
        async with self._uow() as uow:
            statement = await uow.statements.get(statement_id)
            assert statement is not None
            return StatementView(statement, await uow.statements.movements_of([statement_id]))


def unresolved_items(movements: list[StatementMovement]) -> int:
    """Sugerencias por confirmar y cargos del viaje sin factura ni decisión: impiden cerrar la legalización."""
    return sum(1 for m in movements if m.needs_decision)


def _is_card_payment(expense: Expense) -> bool:
    return (
        expense.status == ExpenseStatus.CONFIRMED
        and expense.source != ExpenseSource.BANK
        and expense.review_status != ReviewStatus.REJECTED
        and expense.payment_method == PaymentMethod.CARD
    )


def _period(statement: BankStatement, movements: list[StatementMovement], max_days: int) -> tuple[date, date] | None:
    """Días que cubre el extracto. Una compra del último día puede llegar en el extracto siguiente, así que
    la alerta de "sin cargo" no aplica a los últimos `max_days` días."""
    days = [m.day for m in movements if m.statement_id == statement.id]
    if not days:
        return None
    return min(days), max(days) - timedelta(days=max_days)
