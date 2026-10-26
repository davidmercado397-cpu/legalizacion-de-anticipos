"""Avisos por WhatsApp de cada cambio de estado del anticipo al empleado (aprobado, rechazado, anulado,
devuelto, cerrado, entregado). Se disparan con los eventos de `AdvanceService` después del commit y van
por `WhatsAppNotifier` (ventana o plantilla). La legalización enviada no se avisa: la revisa contabilidad
desde su bandeja en la app, no el jefe."""

from __future__ import annotations

import logging

from app.application import messages as msg
from app.application.advances import AdvanceEvent, AdvanceEventType
from app.application.messages import NumberFormat
from app.application.settings import SettingsService
from app.application.whatsapp_notifier import WhatsAppNotifier
from app.application.whatsapp_presenter import Reply
from app.domain.entities import Advance, Company, Expense
from app.domain.ports import Button, UnitOfWorkFactory

logger = logging.getLogger(__name__)

EMPLOYEE_EVENTS = [
    AdvanceEventType.APPROVED,
    AdvanceEventType.REJECTED,
    AdvanceEventType.VOIDED,
    AdvanceEventType.RETURNED,
    AdvanceEventType.CLOSED,
    AdvanceEventType.DISBURSED,
]


class StatusNotices:
    def __init__(self, uow: UnitOfWorkFactory, notifier: WhatsAppNotifier, settings: SettingsService) -> None:
        self._uow = uow
        self._notifier = notifier
        self._settings = settings

    async def handle(self, event: AdvanceEvent) -> None:
        async with self._uow() as uow:
            advance = await uow.advances.get(event.advance_id)
            owner = await uow.employees.get(advance.employee_id) if advance else None
            actor = await uow.employees.get(event.actor_id)
            company = await uow.companies.get(advance.company_id) if advance else None
            expenses = await uow.expenses.list_for_advance(advance.id) if advance else []
        if advance is None or owner is None or company is None:
            return
        countries = (await self._settings.current()).country_defaults
        fmt = NumberFormat.of((countries.get(company.country) or {}).get("number_format"))
        actor_name = actor.full_name if actor else ""
        reply, line = _for_employee(event.type, advance, company, actor_name, expenses, fmt)
        await self._notifier.notify(owner, reply, line)


def _for_employee(
    event: AdvanceEventType, advance: Advance, company: Company, actor: str, expenses: list[Expense], fmt: NumberFormat
) -> tuple[Reply, str]:
    values = {"approver": actor, "label": advance.label, "amount": msg.money(advance.amount, advance.currency, fmt)}
    note = msg.NOTICE_NOTE.format(note=advance.decision_note) if advance.decision_note else ""
    match event:
        case AdvanceEventType.APPROVED:
            text = msg.NOTICE_APPROVED.format(**values)
            if company.legal_name and company.tax_id:
                text += "\n" + msg.NOTICE_INVOICE_TO.format(legal_name=company.legal_name, tax_id=company.tax_id)
            return Reply(text), msg.NOTICE_APPROVED_LINE.format(**values)
        case AdvanceEventType.REJECTED:
            return Reply(_join(msg.NOTICE_REJECTED.format(**values), note)), msg.NOTICE_REJECTED_LINE.format(**values)
        case AdvanceEventType.VOIDED:
            return Reply(_join(msg.NOTICE_VOIDED.format(**values), note)), msg.NOTICE_VOIDED_LINE.format(**values)
        case AdvanceEventType.RETURNED:
            marked = sum(1 for e in expenses if e.return_note and e.return_resolved_at is None)
            text = _join(msg.NOTICE_RETURNED.format(**values), note)
            buttons: tuple[Button, ...] = ()
            if marked:
                text += "\n" + msg.NOTICE_RETURNED_MARKS.format(what=msg.expenses_count(marked))
                buttons = (Button("menu:marked", msg.BUTTON_SEE_MARKED),)
            return Reply(text, buttons), msg.NOTICE_RETURNED_LINE.format(**values)
        case AdvanceEventType.CLOSED:
            pending = advance.balance(expenses).pending
            settlement = advance.settlement_status.value if advance.settlement_status else "none"
            result = msg.NOTICE_SETTLEMENT.get(settlement, "").format(
                amount=msg.money(abs(pending), advance.ledger_currency, fmt)
            )
            return Reply(_join(msg.NOTICE_CLOSED.format(**values), result)), msg.NOTICE_CLOSED_LINE.format(**values)
        case _:
            values["parts"] = msg.joined(
                [
                    f"{msg.money(p.amount, advance.ledger_currency, fmt)} {msg.DISBURSEMENT_METHODS[p.method]}"
                    for p in advance.disbursement
                ]
            )
            return Reply(msg.NOTICE_DISBURSED.format(**values)), msg.NOTICE_DISBURSED_LINE.format(**values)


def _join(*parts: str) -> str:
    return "\n".join(p for p in parts if p)
