"""Conversación de WhatsApp: identifica al remitente, protege el canal y despacha a una cadena de
handlers (Chain of Responsibility). Funcionalidad nueva = handler nuevo; el despachador no cambia."""

from __future__ import annotations

import logging
import re
import uuid
from abc import ABC, abstractmethod
from collections.abc import Awaitable
from dataclasses import dataclass

from app.application import messages as msg
from app.application.advances import AdvanceService
from app.application.expenses import ExpenseService
from app.application.notifications import ExpenseNotifier
from app.application.whatsapp_events import InboundMessage, MessageKind, StatusUpdate, WebhookBatch
from app.application.whatsapp_identity import WELCOME_PAYLOAD_PREFIX, WhatsAppIdentityService
from app.application.whatsapp_notifier import NOTICE_DETAIL_PAYLOAD, WhatsAppSessions, send_reply
from app.application.whatsapp_presenter import Reply, advance_rows, menu
from app.domain.entities import Employee
from app.domain.enums import AdvanceStatus, Channel
from app.domain.errors import DomainError, InvalidOperationError, JustificationRequiredError, PolicyBlockedError
from app.domain.permissions import Permission, has_permission
from app.domain.ports import Button, MessageSender, RateLimiter, UnitOfWorkFactory
from app.domain.values import WhatsAppAddress, WhatsAppSender

logger = logging.getLogger(__name__)

_LINK_CODE_RE = re.compile(r"^\s*vincular\s+(\d{6})\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class BotLimits:
    media: str
    messages: str
    link_code: str
    unknown_sender: str
    rate_notice: str


@dataclass(frozen=True)
class Conversation:
    employee: Employee
    message: InboundMessage
    new_session: bool = False  # primer mensaje tras la inactividad o la despedida: se saluda

    @property
    def address(self) -> WhatsAppAddress:
        # Se responde a donde llegó el mensaje (sirve también para usuarios con username y sin teléfono).
        return self.message.sender.address


class Handler(ABC):
    @abstractmethod
    def can_handle(self, message: InboundMessage) -> bool: ...

    @abstractmethod
    async def handle(self, conversation: Conversation) -> None: ...


class MediaHandler(Handler):
    def __init__(self, expenses: ExpenseService, notifier: ExpenseNotifier, sender: MessageSender) -> None:
        self._expenses = expenses
        self._notifier = notifier
        self._sender = sender

    def can_handle(self, message: InboundMessage) -> bool:
        return message.kind == MessageKind.MEDIA and bool(message.media_id)

    async def handle(self, conversation: Conversation) -> None:
        m = conversation.message
        assert m.media_id is not None
        try:
            created = await self._expenses.register_whatsapp_media(
                conversation.employee, m.message_id, m.media_id, m.mime_type, m.timestamp
            )
        except InvalidOperationError as exc:
            if exc.code != "no_open_advance":
                raise
            request = Button("menu:request", msg.BUTTON_REQUEST_ADVANCE)
            await send_reply(self._sender, conversation.address, Reply(msg.NO_ADVANCE_FOR_EXPENSES, (request,)))
            return
        if created is not None:
            await self._notifier.acknowledge(conversation.address, m.message_id)


class ReplyHandler(Handler):
    """Botones y selecciones de lista. Cada acción pasa por los mismos casos de uso que la API, así
    que permisos, segregación de funciones y auditoría aplican igual."""

    def __init__(
        self,
        expenses: ExpenseService,
        advances: AdvanceService,
        identity: WhatsAppIdentityService,
        uow: UnitOfWorkFactory,
        sender: MessageSender,
    ) -> None:
        self._expenses = expenses
        self._advances = advances
        self._identity = identity
        self._uow = uow
        self._sender = sender

    def can_handle(self, message: InboundMessage) -> bool:
        prefix = (message.reply_id or "").partition(":")[0]
        return message.kind == MessageKind.REPLY and bool(message.reply_id) and prefix not in (*MENU_ACTIONS, *FLOW_ACTIONS)

    async def handle(self, conversation: Conversation) -> None:
        action, _, rest = (conversation.message.reply_id or "").partition(":")
        await run_action(self._sender, conversation.address, action, self._dispatch(conversation, action, rest))

    async def _dispatch(self, c: Conversation, action: str, rest: str) -> str | None:
        employee = c.employee
        match action:
            case "exp_confirm":
                to_confirm = uuid.UUID(rest)
                try:
                    expense = await self._expenses.confirm(employee, to_confirm, None, None, channel=Channel.WHATSAPP)
                except InvalidOperationError as exc:
                    if exc.code != ADVANCE_REQUIRED:
                        raise
                    await ask_advance(self._sender, self._advances, employee, c.address, to_confirm)
                    return None
                return msg.CONFIRMED_ONE + await balance_line(self._advances, employee, expense.advance_id)
            case "exp_discard":
                expense = await self._expenses.discard(employee, uuid.UUID(rest), channel=Channel.WHATSAPP)
                return msg.DISCARDED + await balance_line(self._advances, employee, expense.advance_id)
            case "exp_move":
                expense = await self._expenses.get(employee, uuid.UUID(rest))
                rows = advance_rows(await self._advances.choosable(employee.id), f"move:{expense.id}")
                await self._sender.send_list(c.address, msg.MOVE_PROMPT, msg.ASSIGN_BUTTON, rows)
                return None
            case "move":
                expense_id, _, target = rest.partition(":")
                advance = await self._expenses.assign(employee, uuid.UUID(expense_id), uuid.UUID(target))
                return msg.MOVED.format(label=advance.label)
            case "assign":
                batch, _, target = rest.partition(":")
                advance = await self._expenses.assign_batch(employee, uuid.UUID(batch), uuid.UUID(target))
                return msg.ASSIGNED.format(label=advance.label)
            case "adv_submit":
                await self._advances.submit(employee, uuid.UUID(rest))
                return msg.SUBMITTED
            case "adv_approve" | "adv_reject":
                advance_id = uuid.UUID(rest)
                if action == "adv_approve":
                    decided = await self._advances.approve(employee, advance_id, Channel.WHATSAPP)
                else:
                    decided = await self._advances.reject(employee, advance_id, None, Channel.WHATSAPP)
                async with self._uow() as uow:
                    owner = await uow.employees.get(decided.employee_id)
                name = owner.full_name if owner else ""
                pending = [s for s in decided.approval_steps if s["status"] == "pending"]
                if action == "adv_approve" and decided.status == AdvanceStatus.REQUESTED and pending:
                    step = pending[0]
                    who = step["approver_name"] or msg.APPROVAL_LEVEL_LABELS.get(step["level"], "")
                    return msg.ADVANCE_STEP_APPROVED_BY_WA.format(name=name, next=who)
                template = msg.ADVANCE_APPROVED_BY_WA if action == "adv_approve" else msg.ADVANCE_REJECTED_BY_WA
                return template.format(name=name)
            case "link_confirm":
                linked = await self._identity.confirm_welcome(c.message.sender, f"{WELCOME_PAYLOAD_PREFIX}{rest}")
                return await self._identity.link_ok(linked) if linked else None
        return None


MENU_ACTIONS = ("menu", "exp_view", "submit")  # respuestas que atiende el menú
# Botones y filas que abren (o pueden terminar abriendo) un WhatsApp Flow. «pick» elige el anticipo de
# un gasto y sigue con su confirmación, que puede pedir el Flow de justificación.
FLOW_ACTIONS = ("exp_correct", "exp_justify", "withdraw", "pick")
ADVANCE_REQUIRED = "advance_required"


async def ask_advance(
    sender: MessageSender, advances: AdvanceService, employee: Employee, to: WhatsAppAddress, expense_id: uuid.UUID
) -> None:
    """Un gasto sin anticipo no se confirma: en vez del error, la lista para elegirlo y seguir."""
    rows = advance_rows(await advances.choosable(employee.id), f"pick:{expense_id}")
    if rows:
        await sender.send_list(to, msg.PICK_ADVANCE_PROMPT, msg.ASSIGN_BUTTON, rows)
    else:
        await sender.send_text(to, msg.NO_OPEN_ADVANCES)


async def balance_line(advances: AdvanceService, employee: Employee, advance_id: uuid.UUID | None) -> str:
    """Tras confirmar o descartar, el saldo actualizado del anticipo."""
    if advance_id is None:
        return ""
    for item in await advances.open_balances(employee.id):
        if item.advance.id == advance_id:
            pending = msg.money(item.balance.pending, item.balance.currency)
            return "\n" + msg.CONFIRMED_BALANCE.format(label=item.advance.label, pending=pending)
    return ""


async def run_action(sender: MessageSender, to: WhatsAppAddress, action: str, work: Awaitable[str | None]) -> None:
    """Ejecuta una acción del usuario y le responde; los errores de negocio se explican en su idioma."""
    try:
        text = await work
    except JustificationRequiredError:
        text = msg.NEEDS_JUSTIFICATION
    except PolicyBlockedError:
        text = msg.BLOCKED_BY_POLICY
    except DomainError as exc:
        logger.info("WhatsApp action %s refused: %s", action, exc)
        text = f"❌ {msg.error_message(exc.code, exc.params)}"
    except ValueError as exc:  # payload de botón alterado o viejo
        logger.info("WhatsApp action %s with an invalid payload: %s", action, exc)
        text = msg.ACTION_NOT_ALLOWED
    if text:
        await sender.send_text(to, text)


class WhatsAppBot:
    def __init__(
        self,
        uow: UnitOfWorkFactory,
        identity: WhatsAppIdentityService,
        sender: MessageSender,
        rate_limiter: RateLimiter,
        limits: BotLimits,
        handlers: list[Handler],
        sessions: WhatsAppSessions,
    ) -> None:
        self._sessions = sessions
        self._uow = uow
        self._identity = identity
        self._sender = sender
        self._limiter = rate_limiter
        self._limits = limits
        self._handlers = handlers

    async def handle_batch(self, batch: WebhookBatch) -> None:
        for status in batch.statuses:
            await self._handle_status(status)
        for message in batch.messages:
            try:
                await self.handle(message)
            except Exception:  # noqa: BLE001 - un mensaje malo no puede tumbar el resto del lote
                logger.exception("Failed to handle WhatsApp message %s", message.message_id)

    async def _handle_status(self, status: StatusUpdate) -> None:
        if status.status == "failed":
            # Meta aceptó el envío pero no lo entregó (número sin código de país, plantilla en otro idioma…).
            logger.warning("WhatsApp message %s was not delivered: %s", status.message_id, status.error or "no detail")
        if status.recipient_user_id:
            await self._identity.capture_from_status(status.message_id, status.recipient_user_id)

    async def handle(self, message: InboundMessage) -> None:
        async with self._uow() as uow:
            is_new = await uow.inbound.register(message.message_id)
            await uow.commit()
        if not is_new:
            return  # Meta reintentó un webhook que ya procesamos
        if message.kind == MessageKind.USER_ID_UPDATE:
            await self._identity.handle_user_id_update(message.sender.user_id, message.new_user_id, message.new_phone)
            return
        employee = await self._identity.identify(message.sender)
        if employee is None:
            await self._handle_unknown(message)
            return
        if not await self._allowed(message):
            return
        new_session = await self._sessions.register_inbound(employee.id)
        conversation = Conversation(employee, message, new_session)
        held = await self._sessions.deliver_held(employee.id, conversation.address)
        if held and message.reply_id == NOTICE_DETAIL_PAYLOAD:
            return  # [Ver detalle]: el detalle era la respuesta
        for handler in self._handlers:
            if handler.can_handle(message):
                await handler.handle(conversation)
                return

    async def _handle_unknown(self, message: InboundMessage) -> None:
        sender = message.sender
        if message.kind == MessageKind.REPLY and (message.reply_id or "").startswith(WELCOME_PAYLOAD_PREFIX):
            linked = await self._identity.confirm_welcome(sender, message.reply_id or "")
            await self._reply_link_result(sender, linked, msg.LINK_CONFIRM_FAILED)
            return
        if message.kind == MessageKind.CONTACTS and message.shared_phones:
            linked = await self._identity.link_by_shared_contact(sender, message.shared_phones)
            await self._reply_link_result(sender, linked, msg.NOT_REGISTERED_SHORT)
            return
        match = _LINK_CODE_RE.match(message.text or "") if message.kind == MessageKind.TEXT else None
        if match:
            if await self._limiter.hit("wa_link_code", _sender_key(sender), self._limits.link_code) is not None:
                await self._sender.send_text(sender.address, msg.RATE_LIMITED)
                return
            linked = await self._identity.link_by_code(sender, match.group(1))
            await self._reply_link_result(sender, linked, msg.LINK_FAILED)
            return
        # A desconocidos se les responde pocas veces por hora (sin bucles con otros bots ni spam).
        if await self._limiter.hit("wa_unknown", _sender_key(sender), self._limits.unknown_sender) is None:
            await self._identity.reply_not_registered(sender)

    async def _reply_link_result(self, sender: WhatsAppSender, linked: Employee | None, failure: str) -> None:
        if linked is None:
            await self._sender.send_text(sender.address, failure)
            return
        await self._sender.send_text(sender.address, await self._identity.link_ok(linked))
        can_approve = has_permission(linked.role, Permission.ADVANCES_APPROVE)
        await self._sender.send_list(sender.address, msg.MENU_PROMPT, msg.MENU_BUTTON, menu(can_approve))

    async def _allowed(self, message: InboundMessage) -> bool:
        """Los límites por remitente protegen el presupuesto de IA de avalanchas de fotos."""
        key = _sender_key(message.sender)
        limit = self._limits.media if message.kind == MessageKind.MEDIA else self._limits.messages
        scope = "wa_media" if message.kind == MessageKind.MEDIA else "wa_messages"
        if await self._limiter.hit(scope, key, limit) is None:
            return True
        if await self._limiter.hit("wa_rate_notice", key, self._limits.rate_notice) is None:
            await self._sender.send_text(message.sender.address, msg.RATE_LIMITED)
        return False


def _sender_key(sender: WhatsAppSender) -> str:
    return sender.user_id or sender.phone or "unknown"
