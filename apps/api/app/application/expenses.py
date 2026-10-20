from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from app.application.access import AccessPolicy
from app.application.exchange import ExchangeRateService
from app.application.learning import LearningService
from app.application.policies import PolicyEvaluator
from app.application.settings import SettingsService, check_currency
from app.application.withdrawals import WithdrawalService
from app.domain.deductibility import DeductibilityBreakdown, breakdown
from app.domain.entities import Advance, AuditEntry, Employee, Expense, ExpenseLine
from app.domain.enums import Channel, Deductibility, ExpenseSource, ExpenseStatus, ReviewDecision
from app.domain.errors import InvalidOperationError, NotFoundError, PermissionDeniedError, ValidationError
from app.domain.files import detect_mime, extension_for
from app.domain.permissions import Permission
from app.domain.ports import Clock, ExpenseFilter, FileStorage, Page, Paged, UnitOfWork, UnitOfWorkFactory

ProcessScheduler = Callable[[uuid.UUID], None]


@dataclass(frozen=True)
class FileLinks:
    url: str
    mime_type: str | None
    expires_at: datetime
    thumbnail_url: str | None


def file_key_for(expense: Expense, mime_type: str) -> str:
    # Llaves no adivinables (UUID) dentro de un bucket privado.
    return f"expenses/{expense.employee_id}/{expense.id}{extension_for(mime_type)}"


def thumbnail_key_for(expense: Expense) -> str:
    return f"expenses/{expense.employee_id}/{expense.id}.thumb.jpg"


class ExpenseService:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        access: AccessPolicy,
        storage: FileStorage,
        clock: Clock,
        max_upload_bytes: int,
        signed_url_ttl: int,
        evaluator: PolicyEvaluator,
        settings: SettingsService,
        rates: ExchangeRateService,
        learning: LearningService,
        withdrawals: WithdrawalService | None = None,
    ) -> None:
        self._uow = uow
        self._withdrawals = withdrawals
        self._settings = settings
        self._rates = rates
        self._learning = learning
        self._access = access
        self._storage = storage
        self._clock = clock
        self._max_upload = max_upload_bytes
        self._signed_ttl = signed_url_ttl
        self._evaluator = evaluator
        self._schedule: ProcessScheduler = lambda _id: None

    def set_scheduler(self, schedule: ProcessScheduler) -> None:
        self._schedule = schedule

    async def upload(
        self,
        actor: Employee,
        content: bytes,
        client_ref: str | None,
        sent_at: datetime | None,
        advance_id: uuid.UUID | None,
    ) -> tuple[Expense, bool]:
        """Devuelve (gasto, creado). Reintentar con el mismo client_ref devuelve el original (cola offline de la app)."""
        self._access.require(actor, Permission.EXPENSES_CREATE)
        if len(content) > self._max_upload:
            raise ValidationError("The file is too large", code="file_too_large", max_mb=self._max_upload // (1024 * 1024))
        mime = detect_mime(content)
        if mime is None:
            raise ValidationError("Unsupported file type", code="unsupported_file_type")
        async with self._uow() as uow:
            if client_ref:
                existing = await uow.expenses.get_by_client_ref(actor.id, client_ref)
                if existing is not None:
                    return existing, False
            if advance_id is None:
                await self._require_open_advance(uow, actor.id)
            advance = await self._own_open_advance(uow, actor, advance_id) if advance_id else None
        expense = Expense(
            employee_id=actor.id,
            source=ExpenseSource.APP,
            company_id=advance.company_id if advance else actor.primary_company_id,
            advance_id=advance.id if advance else None,
            client_ref=client_ref,
            sent_at=sent_at,
        )
        key = file_key_for(expense, mime)
        await self._storage.save(key, content, mime)
        expense.attach_file(key, mime, hashlib.sha256(content).hexdigest())
        async with self._uow() as uow:
            await uow.expenses.add(expense)
            await uow.commit()
        self._schedule(expense.id)
        return expense, True

    async def register_whatsapp_media(
        self, employee: Employee, wa_message_id: str, media_id: str, mime_type: str | None, sent_at: datetime | None
    ) -> Expense | None:
        """Idempotente por el id del mensaje de WhatsApp. El archivo lo descarga después el procesador."""
        async with self._uow() as uow:
            if await uow.expenses.get_by_wa_message_id(wa_message_id) is not None:
                return None
            await self._require_open_advance(uow, employee.id)
            expense = Expense(
                employee_id=employee.id,
                source=ExpenseSource.WHATSAPP,
                company_id=employee.primary_company_id,
                wa_message_id=wa_message_id,
                wa_media_id=media_id,
                mime_type=mime_type,
                sent_at=sent_at,
            )
            await uow.expenses.add(expense)
            await uow.commit()
        self._schedule(expense.id)
        return expense

    async def search(
        self,
        actor: Employee,
        status: ExpenseStatus | None,
        advance_id: uuid.UUID | None,
        updated_since: datetime | None,
        page: Page,
        deductibility: Deductibility | None = None,
    ) -> Paged[Expense]:
        async with self._uow() as uow:
            scope = await self._access.scope_for(uow, actor)
            flt = ExpenseFilter(
                scope=scope, status=status, advance_id=advance_id, updated_since=updated_since, deductibility=deductibility
            )
            return await uow.expenses.find(flt, page)

    async def get(self, actor: Employee, expense_id: uuid.UUID) -> Expense:
        async with self._uow() as uow:
            return await self._visible(uow, actor, expense_id)

    async def file_links(self, expenses: list[Expense]) -> dict[uuid.UUID, FileLinks]:
        """URLs firmadas del original y la miniatura. Quien llama ya verificó que puede verlos; firmar
        es local (no hay llamada a R2) y nunca se exponen las llaves."""
        expires_at = self._clock.now() + timedelta(seconds=self._signed_ttl)
        links: dict[uuid.UUID, FileLinks] = {}
        for expense in expenses:
            if not expense.file_key:
                continue
            thumbnail = await self._storage.signed_url(expense.thumbnail_key, self._signed_ttl) if expense.thumbnail_key else None
            url = await self._storage.signed_url(expense.file_key, self._signed_ttl)
            links[expense.id] = FileLinks(url, expense.mime_type, expires_at, thumbnail)
        return links

    async def file_url(self, actor: Employee, expense_id: uuid.UUID) -> str:
        """URL firmada de corta duración: la imagen nunca pasa por la API."""
        expense = await self.get(actor, expense_id)
        if not expense.file_key:
            raise NotFoundError("file")
        return await self._storage.signed_url(expense.file_key, self._signed_ttl)

    async def recent_for(self, employee_id: uuid.UUID, limit: int) -> list[Expense]:
        """Los últimos gastos del empleado que todavía cuentan (sin descartados)."""
        async with self._uow() as uow:
            found = await uow.expenses.find(ExpenseFilter(employee_id=employee_id), Page(limit * 2, 0))
        return [e for e in found.items if e.status != ExpenseStatus.DISCARDED][:limit]

    async def pending_for(self, employee_id: uuid.UUID) -> list[Expense]:
        async with self._uow() as uow:
            return await uow.expenses.list_by_status_for(employee_id, ExpenseStatus.EXTRACTED)

    async def correct(self, actor: Employee, expense_id: uuid.UUID, changes: dict[str, Any]) -> Expense:
        check_currency(changes.get("currency"), (await self._settings.current()).supported_currencies)
        async with self._uow() as uow:
            expense = await self._owned(uow, actor, expense_id)
            if expense.advance_id and not await self._advance_editable(uow, expense.advance_id):
                raise InvalidOperationError("The advance is already in review or closed", code="legalization_locked")
            if changes.get("category") is not None:
                active = await uow.categories.list_for_company(expense.company_id) if expense.company_id else []
                if changes["category"] not in {c.code for c in active}:
                    raise ValidationError("Unknown category", code="unknown_category", category=changes["category"])
            expense.correct(changes, self._clock.now())
            expense.resolve_return_mark(self._clock.now())
            if changes.get("category"):
                await self._learning.learn_category(uow, actor, expense, reviewer=False)
            await self._evaluator.apply(uow, expense, await uow.lines.list_for_expense(expense.id), self._clock.now())
            await uow.audit.add(AuditEntry("expense_corrected", "expense", str(expense.id), actor.id, data=changes))
            await uow.commit()
        return expense

    async def confirm(
        self,
        actor: Employee,
        expense_id: uuid.UUID,
        advance_id: uuid.UUID | None,
        amount_applied: Decimal | None,
        *,
        justification: str | None = None,
        channel: Channel = Channel.API,
        receipt_signed: bool | None = None,
    ) -> Expense:
        async with self._uow() as uow:
            expense = await self._owned(uow, actor, expense_id)
            if receipt_signed is not None:
                expense.receipt_signed = receipt_signed  # el empleado declara la firma del recibo (decisión 5.6)
            target = advance_id or expense.advance_id
            if target is None:
                raise InvalidOperationError("The expense needs an advance", code="advance_required")
            advance = await self._own_open_advance(uow, actor, target)
            if advance.id != expense.advance_id:
                expense.assign_to(advance)
            # Se reevalúan las reglas al confirmar: pudo aparecer un duplicado entretanto.
            await self._evaluator.apply(uow, expense, await uow.lines.list_for_expense(expense.id), self._clock.now())
            await self._rates.convert_expense(uow, expense, advance)
            expense.confirm(advance, self._clock.now(), amount_applied, justification)
            expense.confirmed_by = actor.id
            expense.resolve_return_mark(self._clock.now())
            await self._reallocate_cash(uow, advance)
            await uow.audit.add(AuditEntry("expense_confirmed", "expense", str(expense.id), actor.id, channel))
            await uow.commit()
        return expense

    async def discard(self, actor: Employee, expense_id: uuid.UUID, channel: Channel = Channel.API) -> Expense:
        async with self._uow() as uow:
            expense = await self._owned(uow, actor, expense_id)
            if expense.advance_id and not await self._advance_editable(uow, expense.advance_id):
                raise InvalidOperationError("The advance is already in review or closed", code="legalization_locked")
            if expense.source == ExpenseSource.WITHDRAWAL_FEE:
                raise InvalidOperationError("The fee belongs to a withdrawal", code="withdrawal_fee_expense")
            expense.discard(self._clock.now())
            expense.resolve_return_mark(self._clock.now())
            advance = await uow.advances.get(expense.advance_id) if expense.advance_id else None
            if advance is not None:
                await self._reallocate_cash(uow, advance)
            await uow.audit.add(AuditEntry("expense_discarded", "expense", str(expense.id), actor.id, channel))
            await uow.commit()
        return expense

    async def assign(self, actor: Employee, expense_id: uuid.UUID, advance_id: uuid.UUID) -> Advance:
        """Pasar un gasto sin confirmar a otro anticipo abierto."""
        async with self._uow() as uow:
            expense = await self._owned(uow, actor, expense_id)
            if expense.status != ExpenseStatus.EXTRACTED:
                raise InvalidOperationError(
                    "Only unconfirmed expenses move", code="expense_not_editable", status=expense.status.value
                )
            advance = await self._own_open_advance(uow, actor, advance_id)
            expense.assign_to(advance)
            await self._rates.convert_expense(uow, expense, advance)
            await self._evaluator.apply(uow, expense, await uow.lines.list_for_expense(expense.id), self._clock.now())
            expense.touch(self._clock.now())
            await uow.audit.add(
                AuditEntry("expense_assigned", "expense", str(expense.id), actor.id, Channel.WHATSAPP, {"advance": advance_id})
            )
            await uow.commit()
        return advance

    async def assign_batch(self, actor: Employee, batch_id: uuid.UUID, advance_id: uuid.UUID) -> Advance:
        async with self._uow() as uow:
            advance = await self._own_open_advance(uow, actor, advance_id)
            for expense in await uow.expenses.list_by_batch(batch_id):
                if expense.employee_id == actor.id and expense.status == ExpenseStatus.EXTRACTED:
                    expense.assign_to(advance)
                    await self._rates.convert_expense(uow, expense, advance)
                    expense.touch(self._clock.now())
            await uow.commit()
        return advance

    async def lines(self, actor: Employee, expense_id: uuid.UUID) -> list[ExpenseLine]:
        async with self._uow() as uow:
            await self._visible(uow, actor, expense_id)
            return await uow.lines.list_for_expense(expense_id)

    async def correct_line(
        self, actor: Employee, expense_id: uuid.UUID, line_id: uuid.UUID, concept_code: str | None
    ) -> tuple[Expense, ExpenseLine]:
        now = self._clock.now()
        async with self._uow() as uow:
            expense, owner, delegated = await self._visible_with_owner(uow, actor, expense_id)
            is_reviewer = actor.id != owner.id and actor.can_approve_for(owner, delegated)
            if actor.id != owner.id and not is_reviewer:
                raise PermissionDeniedError("Only the owner or a reviewer can correct lines", code="line_correction_forbidden")
            if is_reviewer:
                self._access.require(actor, Permission.EXPENSES_REVIEW)
            line = await uow.lines.get(line_id)
            if line is None or line.expense_id != expense.id:
                raise NotFoundError("line")
            if concept_code is not None:
                codes = {c.code for c in await uow.concepts.list_for_company(expense.company_id)} if expense.company_id else set()
                if concept_code not in codes:
                    raise ValidationError("Unknown concept for this company", code="unknown_concept")
            line.correct_concept(concept_code, actor.id, now)
            if actor.id == owner.id:
                expense.resolve_return_mark(now)
            lines = await uow.lines.list_for_expense(expense.id)
            await self._evaluator.apply(uow, expense, lines, now)
            await self._learning.learn_line(uow, actor, expense, line, is_reviewer)
            await uow.audit.add(
                AuditEntry(
                    "expense_line_corrected",
                    "expense",
                    str(expense.id),
                    actor.id,
                    data={"line": str(line.id), "concept": concept_code},
                )
            )
            await uow.commit()
        return expense, line

    async def review(self, actor: Employee, expense_id: uuid.UUID, decision: ReviewDecision, note: str | None) -> Expense:
        """El aprobador decide sobre los hallazgos de política: aceptar sin las líneas bloqueadas,
        aceptar completo (con nota) o rechazar. Nadie revisa sus propios gastos."""
        self._access.require(actor, Permission.EXPENSES_REVIEW)
        async with self._uow() as uow:
            expense, owner, delegated = await self._visible_with_owner(uow, actor, expense_id)
            if owner.id == actor.id or not actor.can_approve_for(owner, delegated):
                raise PermissionDeniedError("You cannot review this expense", code="review_forbidden")
            expense.review(decision, actor.id, note, self._clock.now())
            await uow.audit.add(
                AuditEntry("expense_reviewed", "expense", str(expense.id), actor.id, data={"decision": decision, "note": note})
            )
            await uow.commit()
        return expense

    async def deductibility_breakdown(self, actor: Employee, expense_id: uuid.UUID) -> DeductibilityBreakdown | None:
        async with self._uow() as uow:
            expense = await self._visible(uow, actor, expense_id)
            lines = await uow.lines.list_for_expense(expense.id)
            concepts = await uow.concepts.list_for_company(expense.company_id, active_only=False) if expense.company_id else []
        return breakdown(expense, lines, {c.code: c for c in concepts})

    async def set_deductibility(self, actor: Employee, expense_id: uuid.UUID, value: Deductibility) -> Expense:
        self._access.require(actor, Permission.POLICIES_MANAGE)
        async with self._uow() as uow:
            expense = await self._visible(uow, actor, expense_id)
            before = expense.deductibility
            expense.deductibility, expense.deductibility_set_by = value, actor.id
            expense.touch(self._clock.now())
            await uow.audit.add(
                AuditEntry("deductibility_changed", "expense", str(expense.id), actor.id, data={"before": before, "after": value})
            )
            await uow.commit()
        return expense

    async def _visible(self, uow: UnitOfWork, actor: Employee, expense_id: uuid.UUID) -> Expense:
        expense, _, _ = await self._visible_with_owner(uow, actor, expense_id)
        return expense

    async def _visible_with_owner(
        self, uow: UnitOfWork, actor: Employee, expense_id: uuid.UUID
    ) -> tuple[Expense, Employee, frozenset[uuid.UUID]]:
        expense = await uow.expenses.get(expense_id)
        owner = await uow.employees.get(expense.employee_id) if expense else None
        if expense is None or owner is None:
            raise NotFoundError("expense")
        delegated = await self._access.delegated_from(uow, actor)
        self._access.ensure_view(actor, owner, expense.company_id, "expense", delegated)
        return expense, owner, delegated

    async def _owned(self, uow: UnitOfWork, actor: Employee, expense_id: uuid.UUID) -> Expense:
        expense = await self._visible(uow, actor, expense_id)
        if expense.employee_id != actor.id:
            raise PermissionDeniedError("Only the owner can change this expense", code="owner_only")
        return expense

    async def _reallocate_cash(self, uow: UnitOfWork, advance: Advance) -> None:
        """Una factura en efectivo confirmada o descartada cambia lo que queda de cada retiro."""
        if self._withdrawals is not None:
            await uow.flush()
            await self._withdrawals.reallocate(uow, advance)

    @staticmethod
    async def _require_open_advance(uow: UnitOfWork, employee_id: uuid.UUID) -> None:
        """Las facturas se legalizan contra un anticipo: sin uno aprobado no se guardan ni se leen (no gastan IA)."""
        if not await uow.advances.list_open_for(employee_id):
            raise InvalidOperationError("No approved advance to legalize", code="no_open_advance")

    @staticmethod
    async def _own_open_advance(uow: UnitOfWork, actor: Employee, advance_id: uuid.UUID) -> Advance:
        advance = await uow.advances.get(advance_id)
        if advance is None or advance.employee_id != actor.id:
            raise NotFoundError("advance")
        if not advance.accepts_expenses:
            raise InvalidOperationError("The advance is not receiving expenses", code="advance_not_open")
        return advance

    @staticmethod
    async def _advance_editable(uow: UnitOfWork, advance_id: uuid.UUID) -> bool:
        advance = await uow.advances.get(advance_id)
        return advance is None or advance.accepts_expenses
