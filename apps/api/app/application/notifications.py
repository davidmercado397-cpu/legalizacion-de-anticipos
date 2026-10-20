"""Feedback de gastos por WhatsApp: acuse inmediato, reacción por foto y un mensaje por factura cuando
termina la ráfaga de fotos (Observer del procesador de gastos)."""

from __future__ import annotations

import asyncio
import logging
import uuid

from app.application import messages as msg
from app.application.messages import NumberFormat
from app.application.policies import CompanyContextProvider
from app.application.settings import SettingsService
from app.application.whatsapp_notifier import send_reply
from app.application.whatsapp_presenter import ExpenseView, advance_rows, expense_detail
from app.domain.entities import Employee, Expense
from app.domain.enums import ExpenseSource, ExpenseStatus
from app.domain.ports import CategoryHint, Clock, MessageSender, UnitOfWorkFactory
from app.domain.values import WhatsAppAddress

logger = logging.getLogger(__name__)


class ExpenseNotifier:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        sender: MessageSender,
        clock: Clock,
        settings: SettingsService,
        contexts: CompanyContextProvider,
    ) -> None:
        self._uow = uow
        self._sender = sender
        self._clock = clock
        self._settings = settings
        self._contexts = contexts

    async def acknowledge(self, address: WhatsAppAddress, message_id: str) -> None:
        """Feedback en menos de 1 s: chulos azules + "escribiendo..." + ⏳ sobre la foto del usuario."""
        await asyncio.gather(
            self._safe(self._sender.mark_read(message_id, typing=True)),
            self._safe(self._sender.react(address, message_id, msg.REACTION_RECEIVED)),
        )

    async def slow_notice(self, address: WhatsAppAddress) -> None:
        await self._safe(self._sender.send_text(address, msg.SLOW_NOTICE))

    async def expense_processed(self, expense_id: uuid.UUID) -> None:
        async with self._uow() as uow:
            expense = await uow.expenses.get(expense_id)
            employee = await uow.employees.get(expense.employee_id) if expense else None
            root = await uow.expenses.get(expense.parent_id) if expense and expense.parent_id else expense
        if expense is None or employee is None or expense.source != ExpenseSource.WHATSAPP:
            return
        address = employee.whatsapp_address
        if address is None:
            return
        if root is not None and root.wa_message_id and expense.document_index == 0:
            await self._safe(self._sender.react(address, root.wa_message_id, _reaction(expense)))
        # Pequeña espera: las fotos de la misma ráfaga que estén llegando se avisan juntas al final.
        await asyncio.sleep((await self._settings.current()).whatsapp_batch_grace_seconds)
        await self.send_summary_if_idle(employee)

    async def send_summary_if_idle(self, employee: Employee) -> None:
        address = employee.whatsapp_address
        if address is None:
            return
        batch_id = uuid.uuid4()
        async with self._uow() as uow:
            if await uow.expenses.count_pending_for(employee.id) > 0:
                return  # los mensajes los manda la última foto de la ráfaga
            expenses = await uow.expenses.claim_unnotified(employee.id, batch_id, self._clock.now())
            if not expenses:
                return
            advances = await uow.advances.list_open_for(employee.id)
            in_advances = await uow.expenses.list_for_advances([a.id for a in advances])
            lines = await uow.lines.list_for_expenses([e.id for e in expenses])
            originals = {e.duplicate_of_id: await uow.expenses.get(e.duplicate_of_id) for e in expenses if e.duplicate_of_id}
            await uow.commit()
        pending = {a.id: a.balance(in_advances).pending for a in advances}
        by_id = {a.id: a for a in advances}
        for expense in expenses:
            advance = by_id.get(expense.advance_id) if expense.advance_id else None
            pending_after = None
            if advance is not None and expense.status == ExpenseStatus.EXTRACTED:
                # Saldo si confirma esta factura y las anteriores de la misma ráfaga.
                pending[advance.id] -= expense.amount_applied if expense.amount_applied is not None else expense.total or 0
                pending_after = pending[advance.id]
            view = ExpenseView(
                expense,
                [line for line in lines if line.expense_id == expense.id],
                await self.categories_of(expense.company_id),
                await self.number_format(expense.company_id),
                advance if pending_after is not None else None,
                pending_after,
                by_date=pending_after is not None and len(advances) > 1,
                duplicate_of=originals.get(expense.duplicate_of_id) if expense.duplicate_of_id else None,
            )
            await self._safe(send_reply(self._sender, address, expense_detail(view)))
        unassigned = [e for e in expenses if e.status == ExpenseStatus.EXTRACTED and e.advance_id is None]
        if unassigned and len(advances) > 1:
            what = "este gasto" if len(unassigned) == 1 else f"estos {len(unassigned)} gastos"
            rows = advance_rows(advances, f"assign:{batch_id}")
            await self._safe(self._sender.send_list(address, msg.ASSIGN_PROMPT.format(what=what), msg.ASSIGN_BUTTON, rows))

    async def categories_of(self, company_id: uuid.UUID | None) -> dict[str, CategoryHint]:
        return {c.code: c for c in (await self._contexts.get(company_id)).categories}

    async def number_format(self, company_id: uuid.UUID | None) -> NumberFormat:
        country = (await self._contexts.get(company_id)).country
        countries = (await self._settings.current()).country_defaults
        return NumberFormat.of((countries.get(country or "") or {}).get("number_format"))

    @staticmethod
    async def _safe(awaitable) -> object | None:  # type: ignore[no-untyped-def]
        """Las notificaciones nunca rompen el procesamiento: si un envío falla, se registra y se ignora."""
        try:
            return await awaitable
        except Exception:  # noqa: BLE001
            logger.exception("WhatsApp notification failed")
            return None


def _reaction(expense: Expense) -> str:
    if expense.status in (ExpenseStatus.UNREADABLE, ExpenseStatus.FAILED):
        return msg.REACTION_ERROR
    if expense.duplicate_of_id is not None:
        return msg.REACTION_OK
    return msg.REACTION_WARNING if expense.warnings or expense.policy_findings else msg.REACTION_OK
