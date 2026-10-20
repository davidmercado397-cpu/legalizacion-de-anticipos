"""Menú del bot: saludo al empezar la conversación, palabras clave, despedida y cada opción del menú.
Las opciones llaman a los mismos casos de uso que la API (una sola fuente de verdad)."""

from __future__ import annotations

import re
import unicodedata
import uuid

from app.application import messages as msg
from app.application.advances import AdvanceService
from app.application.expenses import ExpenseService
from app.application.notifications import ExpenseNotifier
from app.application.settings import SettingsService
from app.application.whatsapp_bot import MENU_ACTIONS, Conversation, Handler, run_action
from app.application.whatsapp_events import InboundMessage, MessageKind
from app.application.whatsapp_flows import FlowLauncher
from app.application.whatsapp_notifier import WhatsAppSessions, send_reply
from app.application.whatsapp_presenter import (
    ExpenseView,
    Reply,
    advance_rows,
    advances_list,
    approval_request,
    expense_detail,
    expense_rows,
    greeting,
    menu,
    short_date,
    submit_summary,
)
from app.domain.entities import Employee
from app.domain.enums import ExpenseStatus
from app.domain.errors import NotFoundError
from app.domain.permissions import Permission, has_permission
from app.domain.ports import Button, MessageSender

_PUNCTUATION = re.compile(r"[^\w\s]")
_SPACES = re.compile(r"\s+")
_OPEN = (ExpenseStatus.RECEIVED, ExpenseStatus.PROCESSING, ExpenseStatus.EXTRACTED)
_APPROVALS_SHOWN = 5  # solicitudes por aprobar que se muestran con botones; el resto, en la app


def normalize_command(text: str | None) -> str:
    """'¡Mis Gastos!' -> 'mis gastos' (sin tildes ni signos) para comparar con las palabras clave."""
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return _SPACES.sub(" ", _PUNCTUATION.sub(" ", plain)).strip()


class MenuHandler(Handler):
    def __init__(
        self,
        advances: AdvanceService,
        expenses: ExpenseService,
        notifier: ExpenseNotifier,
        sessions: WhatsAppSessions,
        sender: MessageSender,
        settings: SettingsService,
        flows: FlowLauncher,
    ) -> None:
        self._flows = flows
        self._advances = advances
        self._expenses = expenses
        self._notifier = notifier
        self._sessions = sessions
        self._sender = sender
        self._settings = settings

    def can_handle(self, message: InboundMessage) -> bool:
        if message.kind == MessageKind.REPLY:
            return (message.reply_id or "").partition(":")[0] in MENU_ACTIONS
        return message.kind in (MessageKind.TEXT, MessageKind.OTHER, MessageKind.MEDIA)

    async def handle(self, conversation: Conversation) -> None:
        m = conversation.message
        if m.kind == MessageKind.REPLY:
            action, _, rest = (m.reply_id or "").partition(":")
            await run_action(self._sender, conversation.address, action, self._reply(conversation, action, rest))
            return
        option = await self._keyword(m.text) if m.kind == MessageKind.TEXT else None
        if option == "farewell":
            await self._sessions.close(conversation.employee.id)
            await self._sender.send_text(conversation.address, msg.FAREWELL.format(name=conversation.employee.first_name))
        elif option and option != "menu":
            await run_action(self._sender, conversation.address, option, self._option(conversation, option))
        else:
            await self._show_menu(conversation)

    async def _keyword(self, text: str | None) -> str | None:
        command = normalize_command(text)
        for option, words in (await self._settings.current()).whatsapp_keywords.items():
            if command in {normalize_command(w) for w in words}:
                return option
        return None

    async def _show_menu(self, c: Conversation) -> None:
        if c.new_session:
            assistant = (await self._settings.current()).whatsapp_assistant_name
            text = greeting(c.employee.first_name, assistant)
        else:
            text = msg.MENU_PROMPT
        can_approve = has_permission(c.employee.role, Permission.ADVANCES_APPROVE)
        await self._sender.send_list(c.address, text, msg.MENU_BUTTON, menu(can_approve))

    async def _reply(self, c: Conversation, action: str, rest: str) -> str | None:
        match action:
            case "menu":
                return await self._option(c, rest)
            case "exp_view":
                await self._show_expense(c, uuid.UUID(rest))
            case "submit":
                await self._submit_prompt(c, uuid.UUID(rest))
        return None

    async def _option(self, c: Conversation, option: str) -> str | None:
        employee = c.employee
        fmt = await self._notifier.number_format(employee.primary_company_id)
        match option:
            case "advances":
                return advances_list(await self._advances.mine(employee, 10), fmt)
            case "balance":
                return await self._balances(employee)
            case "pending":
                pending = await self._expenses.pending_for(employee.id)
                if not pending:
                    return msg.NO_PENDING
                prompt = msg.PENDING_PROMPT.format(what=msg.expenses_count(len(pending)))
                await self._sender.send_list(c.address, prompt, msg.EXPENSES_BUTTON, expense_rows(pending, fmt))
            case "expenses":
                recent = await self._expenses.recent_for(employee.id, 10)
                if not recent:
                    return msg.NO_EXPENSES
                await self._sender.send_list(c.address, msg.EXPENSES_PROMPT, msg.EXPENSES_BUTTON, expense_rows(recent, fmt))
            case "marked":
                recent = await self._expenses.recent_for(employee.id, 30)
                marked = [e for e in recent if e.return_note and e.return_resolved_at is None]
                if not marked:
                    return msg.NO_MARKED
                await self._sender.send_list(c.address, msg.MARKED_PROMPT, msg.EXPENSES_BUTTON, expense_rows(marked, fmt))
            case "request":
                return await self._flows.advance_request(employee, c.address)
            case "withdraw":
                open_advances = [b.advance for b in await self._advances.open_balances(employee.id)]
                if not open_advances:
                    return msg.NO_OPEN_ADVANCES
                if len(open_advances) == 1:
                    return await self._flows.withdrawal(employee, c.address, open_advances[0].id)
                rows = advance_rows(open_advances, "withdraw")
                await self._sender.send_list(c.address, msg.WITHDRAW_PROMPT, msg.ASSIGN_BUTTON, rows)
            case "submit":
                open_advances = [b.advance for b in await self._advances.open_balances(employee.id)]
                if not open_advances:
                    return msg.NO_OPEN_ADVANCES
                if len(open_advances) == 1:
                    await self._submit_prompt(c, open_advances[0].id)
                else:
                    rows = advance_rows(open_advances, "submit")
                    await self._sender.send_list(c.address, msg.SUBMIT_PROMPT, msg.ASSIGN_BUTTON, rows)
            case "approvals":
                return await self._approvals(c, fmt)
            case _:
                await self._show_menu(c)
        return None

    async def _balances(self, employee: Employee) -> str:
        fmt = await self._notifier.number_format(employee.primary_company_id)
        balances = await self._advances.open_balances(employee.id)
        if not balances:
            return msg.NO_OPEN_ADVANCES
        blocks = []
        for b in balances:
            currency = b.balance.currency
            text = msg.BALANCE_ITEM.format(
                label=b.advance.label,
                amount=msg.money(b.balance.amount, currency, fmt),
                applied=msg.money(b.balance.applied, currency, fmt),
                pending=msg.money(b.balance.pending, currency, fmt),
            )
            if b.functional is not None:
                f = b.functional
                text += "\n" + msg.BALANCE_FUNCTIONAL.format(
                    currency=f.currency, pending=msg.money(f.pending, f.currency, fmt), rate=f.rate, day=short_date(f.rate_date)
                )
            blocks.append(text)
        return "\n\n".join(blocks)

    async def _show_expense(self, c: Conversation, expense_id: uuid.UUID) -> None:
        employee = c.employee
        expense = await self._expenses.get(employee, expense_id)
        if expense.employee_id != employee.id:
            raise NotFoundError("expense")  # un aprobador ve gastos de su equipo, pero aquí solo maneja los suyos
        open_ids = {b.advance.id for b in await self._advances.open_balances(employee.id)}
        view = ExpenseView(
            expense,
            await self._expenses.lines(employee, expense.id),
            await self._notifier.categories_of(expense.company_id),
            await self._notifier.number_format(expense.company_id),
            manage=True,
            editable=expense.advance_id is None or expense.advance_id in open_ids,
        )
        await send_reply(self._sender, c.address, expense_detail(view))

    async def _submit_prompt(self, c: Conversation, advance_id: uuid.UUID) -> None:
        detail = await self._advances.get(c.employee, advance_id)
        if detail.advance.employee_id != c.employee.id:
            raise NotFoundError("advance")
        fmt = await self._notifier.number_format(detail.advance.company_id)
        confirmed = sum(1 for e in detail.expenses if e.status == ExpenseStatus.CONFIRMED)
        open_count = sum(1 for e in detail.expenses if e.status in _OPEN)
        text = submit_summary(detail.advance, detail.balance.applied, confirmed, fmt)
        if open_count:
            text += "\n" + msg.LEGALIZATION_REMINDER_PENDING.format(what=msg.pending_expenses(open_count))
            reply = Reply(text, (Button("menu:pending", msg.BUTTON_SEE_PENDING),))
        else:
            reply = Reply(text + "\n" + msg.SUBMIT_QUESTION, (Button(f"adv_submit:{advance_id}", msg.BUTTON_SEND),))
        await send_reply(self._sender, c.address, reply)

    async def _approvals(self, c: Conversation, fmt: msg.NumberFormat) -> str | None:
        queue = await self._advances.decision_queue(c.employee, _APPROVALS_SHOWN)
        if not queue.requested:
            return msg.NOTHING_TO_APPROVE
        for advance, owner in queue.requested:
            await send_reply(self._sender, c.address, approval_request(advance, owner.full_name, fmt))
        if queue.requested_total > len(queue.requested):
            return msg.APPROVALS_MORE.format(count=queue.requested_total - len(queue.requested))
        return None
