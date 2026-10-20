"""WhatsApp Flows (formularios de Meta) para corregir y justificar un gasto y para solicitar un anticipo.

Los Flows se publican en WhatsApp Manager desde `whatsapp_flows/*.json` y no tienen endpoint de datos:
los datos van precargados al abrirlos y la respuesta llega como un mensaje (`nfm_reply`). Lo que
identifica la respuesta es el token firmado: quién lo abrió, para qué y sobre qué registro."""

from __future__ import annotations

import logging
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from app.application import messages as msg
from app.application.advances import AdvanceRequest, AdvanceService
from app.application.expenses import ExpenseService
from app.application.notifications import ExpenseNotifier
from app.application.settings import SettingsService
from app.application.whatsapp_bot import FLOW_ACTIONS, Conversation, Handler, balance_line, run_action
from app.application.whatsapp_events import InboundMessage, MessageKind
from app.application.whatsapp_presenter import finding_text
from app.domain.entities import Employee, Expense
from app.domain.enums import AdvanceKind, Channel, DocumentType, PaymentMethod, PolicyAction
from app.domain.errors import AuthenticationError, JustificationRequiredError, NotFoundError
from app.domain.ports import Clock, FlowMessage, MessageSender, TokenService, UnitOfWorkFactory
from app.domain.values import WhatsAppAddress

logger = logging.getLogger(__name__)

ADVANCE_REQUEST = "advance_request"
EXPENSE_CORRECTION = "expense_correction"
JUSTIFICATION = "justification"
# Opciones de las listas del Flow que no son un valor: la lista exige elegir algo.
UNSET = "unset"  # el gasto no tiene tipo de documento: se deja como está
BY_ADVANCE = "advance"  # sin medio de pago propio: el del anticipo


class FlowLauncher:
    """Abre cada Flow con sus datos. Sin el ID del Flow configurado, remite a la app."""

    def __init__(
        self,
        uow: UnitOfWorkFactory,
        sender: MessageSender,
        tokens: TokenService,
        settings: SettingsService,
        expenses: ExpenseService,
        notifier: ExpenseNotifier,
        clock: Clock,
    ) -> None:
        self._clock = clock
        self._uow = uow
        self._sender = sender
        self._tokens = tokens
        self._settings = settings
        self._expenses = expenses
        self._notifier = notifier

    async def correction(self, employee: Employee, to: WhatsAppAddress, expense_id: uuid.UUID) -> str | None:
        expense = await self._own_expense(employee, expense_id)
        flow_id = (await self._settings.current()).whatsapp_flow_expense_correction_id
        if not flow_id:
            return msg.CORRECT_IN_APP
        categories = await self._notifier.categories_of(expense.company_id)
        options = [{"id": code, "title": hint.name} for code, hint in categories.items()]
        currencies = (await self._settings.current()).supported_currencies
        async with self._uow() as uow:
            company = await uow.companies.get(expense.company_id) if expense.company_id else None
        documents = [{"id": code, "title": label} for code, label in msg.DOCUMENT_TYPE_LABELS.items()]
        if expense.document_type is None:
            documents.insert(0, {"id": UNSET, "title": msg.FLOW_UNSET})
        methods = [{"id": BY_ADVANCE, "title": msg.FLOW_BY_ADVANCE}]
        methods += [{"id": code, "title": label} for code, label in msg.PAYMENT_METHOD_LABELS.items()]
        # Las listas y el selector de fecha exigen un valor válido: sin dato, hoy, la primera categoría y la
        # moneda de la compañía.
        if expense.currency in currencies:
            currency = expense.currency
        else:
            currency = company.currency if company and company.currency in currencies else currencies[0]
        data = {
            "summary": await self._summary(expense),
            "document_types": documents,
            "document_type": expense.document_type.value if expense.document_type else UNSET,
            "categories": options,
            "category": expense.category if expense.category in categories else (options[0]["id"] if options else ""),
            "vendor_name": expense.vendor_name or "",
            "vendor_tax_id": expense.vendor_tax_id or "",
            "invoice_number": expense.invoice_number or "",
            "invoice_date": (expense.invoice_date or self._clock.now().date()).isoformat(),
            "currencies": [{"id": code, "title": code} for code in currencies],
            "currency": currency,
            "total": _plain(expense.total),
            "subtotal": _plain(expense.subtotal),
            "tax_amount": _plain(expense.tax_amount),
            "tip_amount": _plain(expense.tip_amount),
            "discount_amount": _plain(expense.discount_amount),
            "payment_methods": methods,
            "payment_method": expense.payment_method.value if expense.payment_method else BY_ADVANCE,
            "description": expense.description or "",
            "receipt_signed": bool(expense.receipt_signed),
        }
        await self._open(
            to, employee, flow_id, EXPENSE_CORRECTION, expense.id, "CORRECT", data, msg.FLOW_CORRECT_TEXT, msg.FLOW_CORRECT_CTA
        )
        return None

    async def justification(self, employee: Employee, to: WhatsAppAddress, expense_id: uuid.UUID) -> str | None:
        expense = await self._own_expense(employee, expense_id)
        flow_id = (await self._settings.current()).whatsapp_flow_justification_id
        if not flow_id:
            return msg.JUSTIFY_IN_APP
        fmt = await self._notifier.number_format(expense.company_id)
        reasons = [finding_text(f, fmt) for f in expense.findings_with(PolicyAction.REQUIRE_JUSTIFICATION)]
        if expense.return_note and expense.return_resolved_at is None:
            reasons.append(expense.return_note)
        data = {"summary": await self._summary(expense), "reason": " ".join(r for r in reasons if r) or msg.JUSTIFY_REASON}
        await self._open(
            to, employee, flow_id, JUSTIFICATION, expense.id, "JUSTIFY", data, msg.FLOW_JUSTIFY_TEXT, msg.FLOW_JUSTIFY_CTA
        )
        return None

    async def advance_request(self, employee: Employee, to: WhatsAppAddress) -> str | None:
        current = await self._settings.current()
        if not current.whatsapp_flow_advance_request_id:
            return msg.REQUEST_IN_APP
        async with self._uow() as uow:
            companies = [c for c in await uow.companies.find(list(employee.company_ids)) if c.active]
        if not companies:
            return msg.REQUEST_IN_APP
        data = {
            "companies": [{"id": str(c.id), "title": c.name} for c in companies],
            "company_id": str(companies[0].id),
            "kinds": [{"id": kind, "title": label} for kind, label in msg.ADVANCE_KIND_LABELS.items()],
            "currencies": [{"id": code, "title": code} for code in current.supported_currencies],
            "currency": companies[0].currency,
        }
        await self._open(
            to,
            employee,
            current.whatsapp_flow_advance_request_id,
            ADVANCE_REQUEST,
            None,
            "REQUEST",
            data,
            msg.FLOW_REQUEST_TEXT,
            msg.FLOW_REQUEST_CTA,
        )
        return None

    async def _open(
        self,
        to: WhatsAppAddress,
        employee: Employee,
        flow_id: str,
        purpose: str,
        entity_id: uuid.UUID | None,
        screen: str,
        data: dict[str, Any],
        text: str,
        cta: str,
    ) -> None:
        token = self._tokens.issue_flow_token(employee.id, purpose, str(entity_id) if entity_id else None)
        await self._sender.send_flow(to, FlowMessage(flow_id, text, cta, token, screen, data))

    async def _own_expense(self, employee: Employee, expense_id: uuid.UUID) -> Expense:
        expense = await self._expenses.get(employee, expense_id)
        if expense.employee_id != employee.id:
            raise NotFoundError("expense")  # en el chat cada quien maneja solo sus gastos
        return expense

    async def _summary(self, expense: Expense) -> str:
        fmt = await self._notifier.number_format(expense.company_id)
        return " · ".join(p for p in (expense.vendor_name, msg.money(expense.total, expense.currency, fmt)) if p)


class FlowHandler(Handler):
    """Botones que abren un Flow y las respuestas de los Flows."""

    def __init__(
        self,
        launcher: FlowLauncher,
        advances: AdvanceService,
        expenses: ExpenseService,
        tokens: TokenService,
        sender: MessageSender,
    ) -> None:
        self._launcher = launcher
        self._advances = advances
        self._expenses = expenses
        self._tokens = tokens
        self._sender = sender

    def can_handle(self, message: InboundMessage) -> bool:
        if message.kind == MessageKind.FLOW_REPLY:
            return True
        return message.kind == MessageKind.REPLY and (message.reply_id or "").partition(":")[0] in FLOW_ACTIONS

    async def handle(self, conversation: Conversation) -> None:
        m, to = conversation.message, conversation.address
        if m.kind == MessageKind.FLOW_REPLY:
            await run_action(self._sender, to, "flow", self._submit(conversation, m.flow_response or {}))
            return
        action, _, rest = (m.reply_id or "").partition(":")
        employee = conversation.employee
        if action == "exp_correct":
            await run_action(self._sender, to, action, self._launcher.correction(employee, to, uuid.UUID(rest)))
        else:
            await run_action(self._sender, to, action, self._launcher.justification(employee, to, uuid.UUID(rest)))

    async def _submit(self, c: Conversation, response: dict[str, Any]) -> str | None:
        employee = c.employee
        try:
            claims = self._tokens.decode_flow_token(str(response.get("flow_token") or ""))
        except AuthenticationError:
            return msg.FLOW_EXPIRED
        if claims.employee_id != employee.id:
            # Un formulario reenviado desde otra cuenta: nunca se actúa en nombre de otra persona.
            logger.warning("Flow token of another employee used by %s", employee.id)
            return msg.ACTION_NOT_ALLOWED
        try:
            match claims.purpose:
                case "advance_request":
                    advance = await self._advances.request(employee, _advance_request(response))
                    return msg.ADVANCE_REQUESTED.format(amount=msg.money(advance.amount, advance.currency), label=advance.label)
                case "expense_correction":
                    expense_id = uuid.UUID(str(claims.entity_id))
                    corrected = await self._expenses.correct(employee, expense_id, _corrections(response))
                    is_receipt = corrected.document_type == DocumentType.CASH_RECEIPT
                    signed = response.get("receipt_signed") in (True, "true") if is_receipt else None
                    try:
                        expense = await self._expenses.confirm(
                            employee, expense_id, None, None, channel=Channel.WHATSAPP, receipt_signed=signed
                        )
                    except JustificationRequiredError:
                        return await self._launcher.justification(employee, c.address, expense_id)
                    return msg.CORRECTED_CONFIRMED + await balance_line(self._advances, employee, expense.advance_id)
                case "justification":
                    text = str(response.get("justification") or "").strip()
                    expense = await self._expenses.confirm(
                        employee, uuid.UUID(str(claims.entity_id)), None, None, justification=text, channel=Channel.WHATSAPP
                    )
                    return msg.CONFIRMED_ONE + await balance_line(self._advances, employee, expense.advance_id)
        except (ValueError, InvalidOperation, TypeError):
            return msg.FLOW_INVALID
        return msg.FLOW_INVALID


def _text(response: dict[str, Any], name: str) -> str | None:
    value = str(response.get(name) or "").strip()
    return value or None


def _amount(value: str | None) -> Decimal | None:
    """El teclado numérico puede mandar coma decimal; los puntos de miles no se aceptan en ese campo."""
    return Decimal(value.replace(",", ".")) if value else None


def _advance_request(response: dict[str, Any]) -> AdvanceRequest:
    start, end = _text(response, "start_date"), _text(response, "end_date")
    return AdvanceRequest(
        company_id=uuid.UUID(str(response.get("company_id"))),
        kind=AdvanceKind(str(response.get("kind"))),
        currency=str(response.get("currency") or ""),
        amount=_amount(_text(response, "amount")),
        purpose=_text(response, "purpose") or "",
        destination=_text(response, "destination"),
        start_date=date.fromisoformat(start) if start else None,
        end_date=date.fromisoformat(end) if end else None,
        justification=_text(response, "justification"),
    )


def _plain(amount: Decimal | None) -> str:
    return "" if amount is None else f"{amount.normalize():f}"


def _corrections(response: dict[str, Any]) -> dict[str, Any]:
    changes: dict[str, Any] = {
        "vendor_name": _text(response, "vendor_name"),
        "vendor_tax_id": _text(response, "vendor_tax_id"),
        "invoice_number": _text(response, "invoice_number"),
        "description": _text(response, "description"),
    }
    for name in ("subtotal", "tax_amount", "tip_amount", "discount_amount"):
        changes[name] = _amount(_text(response, name))
    day, total, category = _text(response, "invoice_date"), _amount(_text(response, "total")), _text(response, "category")
    if day:
        changes["invoice_date"] = date.fromisoformat(day)
    if total is not None:
        changes["total"] = total
    if category:
        changes["category"] = category
    if currency := _text(response, "currency"):
        changes["currency"] = currency
    document = _text(response, "document_type")
    if document and document != UNSET:
        changes["document_type"] = DocumentType(document)
    method = _text(response, "payment_method")
    if method:
        changes["payment_method"] = None if method == BY_ADVANCE else PaymentMethod(method)
    return changes
