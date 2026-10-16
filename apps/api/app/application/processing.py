"""Procesamiento: reclamar -> traer el archivo -> (guardar en R2 || leer el documento) -> guardar -> notificar.

Las transacciones son cortas y nunca quedan abiertas mientras se espera a Meta, R2 o el proveedor de IA."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import uuid

from app.application.exchange import ExchangeRateService
from app.application.expenses import file_key_for, thumbnail_key_for
from app.application.learning import LearningService
from app.application.notifications import ExpenseNotifier
from app.application.policies import CompanyContextProvider, PolicyEvaluator
from app.application.reading import AttemptRecord, DocumentReader, ReadingOutcome
from app.application.settings import SettingsService
from app.domain.entities import Expense, ExpenseLine, ExtractionAttempt, advance_for_date
from app.domain.enums import ExpenseSource, ExpenseStatus, ExpenseWarning, UnreadableReason
from app.domain.policies import effective_rules
from app.domain.ports import Clock, ExtractionContext, FileStorage, MediaSource, UnitOfWork, UnitOfWorkFactory
from app.domain.text import normalize_line_text
from app.domain.time import local_date
from app.domain.values import InvoiceData, WhatsAppAddress

logger = logging.getLogger(__name__)


class ExpenseProcessor:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        storage: FileStorage,
        media: MediaSource,
        reader: DocumentReader,
        notifier: ExpenseNotifier,
        clock: Clock,
        max_attempts: int,
        settings: SettingsService,
        contexts: CompanyContextProvider,
        evaluator: PolicyEvaluator,
        rates: ExchangeRateService,
        learning: LearningService,
    ) -> None:
        self._uow = uow
        self._rates = rates
        self._learning = learning
        self._storage = storage
        self._media = media
        self._reader = reader
        self._notifier = notifier
        self._clock = clock
        self._max_attempts = max_attempts
        self._settings = settings
        self._contexts = contexts
        self._evaluator = evaluator

    async def process(self, expense_id: uuid.UUID) -> None:
        claimed = await self._claim(expense_id)
        if claimed is None:
            return
        expense, context, address = claimed
        slow_task = asyncio.create_task(self._slow_notice(address)) if address is not None else None
        try:
            content, mime = await self._load(expense)
            sha256 = hashlib.sha256(content).hexdigest()
            if await self._discard_if_own_duplicate(expense_id, sha256, mime):
                await self._notifier.expense_processed(expense_id)
                return
            key = expense.file_key or file_key_for(expense, mime)
            today = local_date(self._clock.now(), context.timezone) if context.timezone else self._clock.now().date()
            reading = self._reader.read(content, mime, context, today)
            if expense.file_key:
                outcome = await reading
            else:
                # Se archiva el original en R2 mientras la IA lee la copia redimensionada.
                _, outcome = await asyncio.gather(self._storage.save(key, content, mime), reading)
        except Exception as exc:  # noqa: BLE001 - cualquier falla queda registrada y el sweeper la reintenta
            logger.warning("Expense %s processing failed: %s", expense_id, exc)
            await self._fail(expense_id, f"{type(exc).__name__}: {exc}")
            return
        finally:
            if slow_task:
                slow_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await slow_task
        thumbnail_key = await self._save_thumbnail(expense, outcome.thumbnail)
        await self._save(expense_id, key, mime, sha256, outcome, thumbnail_key)
        await self._notifier.expense_processed(expense_id)

    async def _discard_if_own_duplicate(self, expense_id: uuid.UUID, sha256: str, mime: str) -> bool:
        """La misma foto que el empleado ya envió: se descarta antes de pagar otra lectura de la IA."""
        async with self._uow() as uow:
            expense = await uow.expenses.get(expense_id)
            original = await uow.expenses.find_own_duplicate(expense, sha256) if expense else None
            if expense is None or original is None:
                return False
            expense.file_sha256, expense.mime_type = sha256, mime
            expense.discard_as_duplicate(original.id, self._clock.now())
            await uow.commit()
        return True

    async def _save_thumbnail(self, expense: Expense, thumbnail: bytes | None) -> str | None:
        """La miniatura es un extra: si no se puede guardar, el gasto sigue con su original."""
        if thumbnail is None:
            return None
        key = thumbnail_key_for(expense)
        try:
            await self._storage.save(key, thumbnail, "image/jpeg")
        except Exception:  # noqa: BLE001
            logger.warning("Thumbnail of expense %s not stored", expense.id, exc_info=True)
            return None
        return key

    async def _claim(self, expense_id: uuid.UUID) -> tuple[Expense, ExtractionContext, WhatsAppAddress | None] | None:
        async with self._uow() as uow:
            expense = await uow.expenses.get_for_processing(expense_id)
            if expense is None or expense.status not in (ExpenseStatus.RECEIVED, ExpenseStatus.PROCESSING):
                return None
            expense.start_processing(self._clock.now())
            employee = await uow.employees.get(expense.employee_id)
            await uow.commit()
        context = await self._contexts.get(expense.company_id)
        address = employee.whatsapp_address if employee and expense.source == ExpenseSource.WHATSAPP else None
        return expense, context, address

    async def _load(self, expense: Expense) -> tuple[bytes, str]:
        if expense.file_key:
            return await self._storage.read(expense.file_key), expense.mime_type or "application/octet-stream"
        if not expense.wa_media_id:
            raise ValueError("Expense has neither a stored file nor a WhatsApp media id")
        return await self._media.download(expense.wa_media_id)

    async def _slow_notice(self, address: WhatsAppAddress) -> None:
        await asyncio.sleep((await self._settings.current()).whatsapp_slow_notice_seconds)
        await self._notifier.slow_notice(address)

    async def _fail(self, expense_id: uuid.UUID, error: str) -> None:
        async with self._uow() as uow:
            expense = await uow.expenses.get(expense_id)
            if expense is None:
                return
            expense.register_failure(error, self._max_attempts, self._clock.now())
            await uow.commit()
        if expense.status == ExpenseStatus.FAILED:
            await self._notifier.expense_processed(expense_id)

    async def _save(
        self, expense_id: uuid.UUID, key: str, mime: str, sha256: str, outcome: ReadingOutcome, thumbnail_key: str | None
    ) -> None:
        now = self._clock.now()
        async with self._uow() as uow:
            expense = await uow.expenses.get(expense_id)
            assert expense is not None
            expense.attach_file(key, mime, sha256)
            expense.thumbnail_key = thumbnail_key or expense.thumbnail_key
            if outcome.unreadable:
                reason = UnreadableReason.NOT_A_RECEIPT if outcome.not_a_receipt else UnreadableReason.UNREADABLE
                expense.mark_unreadable(now, reason)
            else:
                expense.apply_reading(outcome.documents[0], outcome.warnings[0], outcome.legibility, now)
                created = [(expense, outcome.documents[0])]
                for index, doc in enumerate(outcome.documents[1:], start=1):
                    sibling = expense.spawn_sibling(index)
                    sibling.apply_reading(doc, outcome.warnings[index], outcome.legibility, now)
                    await uow.expenses.add(sibling)
                    created.append((sibling, doc))
                await uow.flush()  # sin relaciones ORM: los hermanos deben existir antes que sus líneas
                for item, _ in created:
                    original = await uow.expenses.find_own_duplicate(item)
                    if original is not None:  # misma factura (CUFE) que el empleado ya registró
                        item.discard_as_duplicate(original.id, now)
                created = [(item, doc) for item, doc in created if item.duplicate_of_id is None]
                await self._auto_assign(uow, expense.employee_id, [e for e, _ in created])
                valid_codes = (
                    {c.code for c in await uow.concepts.list_for_company(expense.company_id)} if expense.company_id else set()
                )
                categories = (
                    {c.code for c in await uow.categories.list_for_company(expense.company_id)} if expense.company_id else set()
                )
                for item, doc in created:
                    if item.category not in categories:
                        # La IA solo puede sugerir categorías activas de la compañía.
                        item.category = None
                    lines = _lines_for(item, doc, valid_codes)
                    await self._learning.apply(uow, item, lines, valid_codes)
                    for line in lines:
                        await uow.lines.add(line)
                    await self._evaluator.apply(uow, item, lines, now)
            previous = len(await uow.attempts.list_for_expense(expense.id))
            for number, attempt in enumerate(outcome.attempts, start=previous + 1):
                await uow.attempts.add(_attempt_row(expense.id, number, attempt, outcome.timings))
            await uow.commit()

    async def _auto_assign(self, uow: UnitOfWork, employee_id: uuid.UUID, expenses: list[Expense]) -> None:
        """Con un solo anticipo abierto, o con varios si la fecha de la factura cae en uno solo, se asigna
        solo (el usuario lo puede cambiar); si no, el aviso le pide que elija."""
        open_advances = await uow.advances.list_open_for(employee_id)
        tolerance = await self._date_tolerance(uow, expenses[0].company_id) if expenses and len(open_advances) > 1 else 0
        for expense in expenses:
            if expense.advance_id is None:
                target = advance_for_date(open_advances, expense.invoice_date, tolerance)
                if target is not None:
                    expense.assign_to(target)
            target = next((a for a in open_advances if a.id == expense.advance_id), None)
            await self._rates.convert_expense(uow, expense, target)
            if target and expense.currency and expense.currency != target.currency:
                expense.warnings = sorted({*expense.warnings, ExpenseWarning.CURRENCY_MISMATCH.value})

    async def _date_tolerance(self, uow: UnitOfWork, company_id: uuid.UUID | None) -> int:
        """La misma tolerancia de días que usa la regla de fechas fuera del viaje de la compañía."""
        if company_id is None:
            return 0
        defaults = (await self._settings.current()).policy_rule_defaults
        for rule in effective_rules(await uow.policy_rules.list_for_company(company_id), defaults):
            if rule.rule_type == "outside_trip_dates" and rule.active:
                return int(rule.params.get("tolerance_days", 0))
        return 0


def _lines_for(expense: Expense, doc: InvoiceData, valid_codes: set[str]) -> list[ExpenseLine]:
    lines = []
    for position, line in enumerate(doc.lines, start=1):
        # La IA solo puede apuntar a conceptos que la compañía configuró; lo demás se ignora.
        code = line.concept_code if line.concept_code in valid_codes else None
        lines.append(
            ExpenseLine(
                expense_id=expense.id,
                position=position,
                description=line.description[:300] or "-",
                normalized_text=normalize_line_text(line.description)[:300],
                amount=line.amount,
                quantity=line.quantity,
                ai_concept_code=code,
                ai_concept_confidence=line.concept_confidence if code else None,
                final_concept_code=code,
            )
        )
    return lines


def _attempt_row(expense_id: uuid.UUID, number: int, record: AttemptRecord, timings: dict[str, int]) -> ExtractionAttempt:
    response = record.response
    return ExtractionAttempt(
        expense_id=expense_id,
        attempt_no=number,
        tier=record.tier,
        model_requested=record.model_requested,
        prompt_version=response.prompt_version if response else "n/a",
        model_used=response.model_used if response else None,
        raw_response=response.raw_text if response else None,
        parsed=response.parsed if response else None,
        validation_errors=[f"{i.code}: {i.detail}" for i in record.issues],
        escalation_reason=record.escalation_reason,
        confidence=max((d.confidence for d in response.documents), default=None) if response else None,
        prompt_tokens=response.prompt_tokens if response else None,
        completion_tokens=response.completion_tokens if response else None,
        cached_tokens=response.cached_tokens if response else None,
        cost_usd=response.cost_usd if response else None,
        latency_ms=response.latency_ms if response else None,
        timings=timings,
        error=record.error,
    )
