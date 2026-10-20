"""Arma los mensajes de WhatsApp (texto y botones) a partir de datos ya cargados. No consulta nada ni
envía nada: así cada formato se prueba aparte y los límites de Meta viven en un solo lugar."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from app.application import messages as msg
from app.application.messages import NumberFormat
from app.domain.entities import Advance, Expense, ExpenseLine
from app.domain.enums import AdvanceStatus, DocumentType, ExpenseStatus, ExpenseWarning, PolicyAction, UnreadableReason
from app.domain.ports import Button, CategoryHint, ListRow

# Límites de la API de WhatsApp Cloud.
MAX_BUTTONS = 3
MAX_LIST_ROWS = 10
MAX_ROW_TITLE = 24
MAX_ROW_DESCRIPTION = 72
MAX_TEXT = 4096
MAX_INTERACTIVE_TEXT = 1024  # cuerpo de un mensaje con botones o lista
DETAIL_LINES = 10  # ítems de la factura que se muestran; el resto se resume


@dataclass(frozen=True)
class Reply:
    text: str
    buttons: tuple[Button, ...] = ()

    def __post_init__(self) -> None:
        if len(self.buttons) > MAX_BUTTONS:
            raise ValueError("WhatsApp allows at most three reply buttons")


@dataclass(frozen=True)
class ExpenseView:
    """Lo que se necesita para mostrar una factura: el gasto y su contexto ya resuelto."""

    expense: Expense
    lines: list[ExpenseLine]
    categories: Mapping[str, CategoryHint]
    fmt: NumberFormat
    advance: Advance | None = None
    pending_after: Decimal | None = None  # saldo por legalizar del anticipo si se confirma
    by_date: bool = False  # asignado por la fecha entre varios anticipos abiertos
    duplicate_of: Expense | None = None
    manage: bool = False  # abierto desde "Mis gastos": también se puede descartar
    editable: bool = True  # su legalización no se ha enviado


def expense_detail(view: ExpenseView) -> Reply:
    """Un mensaje por factura: lo que se leyó, las alertas y qué hacer. Sin CUFE: no le sirve al usuario."""
    e = view.expense
    if e.duplicate_of_id is not None:
        original = view.duplicate_of or e
        what = " · ".join(p for p in (original.vendor_name, msg.money(original.total, original.currency, view.fmt)) if p)
        return Reply(msg.DUPLICATE_OWN.format(what=what))
    if e.status == ExpenseStatus.UNREADABLE:
        return Reply(msg.NOT_A_RECEIPT if e.unreadable_reason == UnreadableReason.NOT_A_RECEIPT else msg.UNREADABLE)
    if e.status == ExpenseStatus.FAILED:
        return Reply(msg.PROCESSING_FAILED)

    buttons = _manage_buttons(e, view.editable) if view.manage else _expense_buttons(e, view.by_date)
    limit = MAX_INTERACTIVE_TEXT if buttons else MAX_TEXT
    # Con botones, Meta admite 1.024 caracteres: se muestran menos líneas antes que cortar las alertas.
    for shown in (DETAIL_LINES, 5, 0):
        text = _detail_text(view, shown)
        if len(text) <= limit:
            break
    return Reply(truncate(text, limit), buttons)


def _detail_text(view: ExpenseView, shown_lines: int) -> str:
    e, fmt = view.expense, view.fmt
    review = _needs_review(e)
    blocks = [_header(e, view.categories, review), _lines(view.lines, fmt, shown_lines), _amounts(e, fmt, review)]
    blocks.append("\n".join(_alerts(e, fmt)))
    if view.advance is not None:
        template = msg.DETAIL_ADVANCE_BY_DATE if view.by_date else msg.DETAIL_ADVANCE
        blocks.append(
            template.format(label=view.advance.label, pending=msg.money(view.pending_after, view.advance.currency, fmt))
        )
    return "\n\n".join(b for b in blocks if b)


def _needs_review(e: Expense) -> bool:
    """Recibos y tiquetes sin QR: la IA es la única fuente del total y la fecha, el usuario los revisa."""
    from_document = e.field_sources.get("total") in ("qr", "pdf_text")
    return e.document_type != DocumentType.ELECTRONIC_INVOICE and not from_document


def _header(e: Expense, categories: Mapping[str, CategoryHint], review: bool) -> str:
    rows = [msg.category_label(e.category, categories)]
    if e.vendor_name:
        rows.append(f"*{e.vendor_name}*")
    if e.vendor_tax_id:
        rows.append(msg.DETAIL_TAX_ID.format(tax_id=e.vendor_tax_id))
    when = short_date(e.invoice_date)
    if e.invoice_time is not None:
        when += f" · {e.invoice_time:%H:%M}"
    rows.append(f"📅 *{when}*" if review else f"📅 {when}")
    if e.invoice_number:
        rows.append(msg.DETAIL_NUMBER.format(number=e.invoice_number))
    return "\n".join(rows)


def _lines(lines: list[ExpenseLine], fmt: NumberFormat, limit: int) -> str:
    shown = [
        f"• {line.description}" + (f" — {msg.money(line.amount, None, fmt)}" if line.amount is not None else "")
        for line in sorted(lines, key=lambda item: item.position)[:limit]
    ]
    if len(lines) > limit:
        shown.append(msg.DETAIL_MORE_LINES.format(count=len(lines) - limit))
    return "\n".join(shown)


def _amounts(e: Expense, fmt: NumberFormat, review: bool) -> str:
    rows = []
    if e.subtotal is not None and e.subtotal != e.total:
        rows.append(msg.DETAIL_SUBTOTAL.format(amount=msg.money(e.subtotal, None, fmt)))
    for tax in e.taxes:
        rate = f" {_number(tax.get('rate'))} %" if tax.get("rate") else ""
        label = msg.TAX_LABELS.get(str(tax.get("type")), msg.TAX_LABELS["other"])
        rows.append(msg.DETAIL_TAX.format(label=label, rate=rate, amount=msg.money(_decimal(tax.get("amount")), None, fmt)))
    if e.tip_amount:
        rows.append(msg.DETAIL_TIP.format(amount=msg.money(e.tip_amount, None, fmt)))
    if e.discount_amount:
        rows.append(msg.DETAIL_DISCOUNT.format(amount=msg.money(e.discount_amount, None, fmt)))
    rows.append(msg.DETAIL_TOTAL.format(amount=msg.money(e.total, e.currency, fmt)))
    if e.exchange_rate is not None and e.amount_applied is not None and e.exchange_rate != 1:
        rows.append(
            msg.DETAIL_CONVERTED.format(
                amount=msg.money(e.amount_applied, None, fmt),
                rate=_number(e.exchange_rate),
                day=short_date(e.exchange_rate_date),
            )
        )
    if review:
        rows.append(msg.REVIEW_READING)
    return "\n".join(rows)


def _alerts(e: Expense, fmt: NumberFormat) -> list[str]:
    rows = []
    for warning in e.warnings:
        label = msg.WARNING_LABELS.get(ExpenseWarning(warning)) if warning in ExpenseWarning._value2member_map_ else None
        if label:
            rows.append(f"⚠️ {label}")
    for finding in e.policy_findings:
        label = finding_text(finding, fmt)
        if label:
            rows.append(f"⚠️ {label}")
    if e.findings_with(PolicyAction.BLOCK):
        rows.append(msg.BLOCKED_HINT)
    elif e.findings_with(PolicyAction.REQUIRE_JUSTIFICATION):
        rows.append(msg.NEEDS_JUSTIFICATION_HINT)
    return rows


def _expense_buttons(e: Expense, by_date: bool) -> tuple[Button, ...]:
    if e.status != ExpenseStatus.EXTRACTED:
        return ()
    correct = Button(f"exp_correct:{e.id}", msg.BUTTON_CORRECT)
    if e.findings_with(PolicyAction.BLOCK):
        buttons = [correct]
    elif e.findings_with(PolicyAction.REQUIRE_JUSTIFICATION):
        buttons = [Button(f"exp_justify:{e.id}", msg.BUTTON_JUSTIFY), correct]
    else:
        buttons = [Button(f"exp_confirm:{e.id}", msg.BUTTON_OK), correct]
    if by_date:
        buttons.append(Button(f"exp_move:{e.id}", msg.BUTTON_CHANGE_ADVANCE))
    return tuple(buttons)


def _manage_buttons(e: Expense, editable: bool) -> tuple[Button, ...]:
    if not editable or e.status not in (ExpenseStatus.EXTRACTED, ExpenseStatus.CONFIRMED):
        return ()
    correct = Button(f"exp_correct:{e.id}", msg.BUTTON_CORRECT)
    discard = Button(f"exp_discard:{e.id}", msg.BUTTON_DISCARD)
    if e.status == ExpenseStatus.CONFIRMED:
        marked = e.return_note is not None and e.return_resolved_at is None
        return (Button(f"exp_justify:{e.id}", msg.BUTTON_JUSTIFY), correct, discard) if marked else (correct, discard)
    first = _expense_buttons(e, by_date=False)[0]
    return (first, correct, discard) if first.id != correct.id else (correct, discard)


def menu(can_approve: bool) -> list[ListRow]:
    options = [o for o in msg.MENU_OPTIONS if o != "approvals" or can_approve]
    return [ListRow(f"menu:{o}", *msg.MENU_OPTIONS[o]) for o in options]


def greeting(first_name: str, assistant: str) -> str:
    intro = msg.ASSISTANT_INTRO.format(assistant=assistant) if assistant else ""
    return msg.GREETING.format(name=first_name, assistant=intro) + "\n" + msg.MENU_PHOTO_HINT


def advances_list(advances: list[Advance], fmt: NumberFormat) -> str:
    if not advances:
        return msg.NO_ADVANCES
    rows = [msg.MY_ADVANCES]
    for a in advances:
        status = msg.ADVANCE_STATUS_LABELS.get(a.status.value, a.status.value)
        rows.append(msg.ADVANCE_ITEM.format(label=a.label, status=status, amount=msg.money(a.amount, a.currency, fmt)))
        if a.status == AdvanceStatus.APPROVED and a.returned_at and a.decision_note:
            rows.append(msg.ADVANCE_RETURNED_NOTE.format(note=a.decision_note))
    return truncate("\n".join(rows))


def expense_rows(expenses: list[Expense], fmt: NumberFormat) -> list[ListRow]:
    rows = []
    for e in expenses[:MAX_LIST_ROWS]:
        status = msg.EXPENSE_STATUS_LABELS.get(e.status.value, e.status.value)
        title = e.vendor_name or msg.EXPENSE_STATUS_LABELS[e.status.value].capitalize()
        description = " · ".join([short_date(e.invoice_date), msg.money(e.total, e.currency, fmt), status])
        rows.append(ListRow(f"exp_view:{e.id}", title[:MAX_ROW_TITLE], description[:MAX_ROW_DESCRIPTION]))
    return rows


def submit_summary(advance: Advance, applied: Decimal, count: int, fmt: NumberFormat) -> str:
    return msg.SUBMIT_SUMMARY.format(
        label=advance.label,
        applied=msg.money(applied, advance.currency, fmt),
        amount=msg.money(advance.amount, advance.currency, fmt),
        count=msg.expenses_count(count),
    )


def approval_request(advance: Advance, owner_name: str, fmt: NumberFormat) -> Reply:
    text = msg.APPROVAL_ITEM.format(name=owner_name, amount=msg.money(advance.amount, advance.currency, fmt), label=advance.label)
    if advance.budget_justification:
        budget = msg.money(advance.budget_amount, advance.currency, fmt)
        text += "\n" + msg.APPROVAL_JUSTIFICATION.format(budget=budget, justification=advance.budget_justification)
    return Reply(
        text,
        (Button(f"adv_approve:{advance.id}", msg.BUTTON_APPROVE), Button(f"adv_reject:{advance.id}", msg.BUTTON_REJECT)),
    )


def advance_rows(advances: list[Advance], prefix: str) -> list[ListRow]:
    """Filas para elegir un anticipo: todo gasto se legaliza contra uno."""
    return [
        ListRow(f"{prefix}:{a.id}", a.label[:MAX_ROW_TITLE], a.purpose[:MAX_ROW_DESCRIPTION]) for a in advances[:MAX_LIST_ROWS]
    ]


def legalization_reminder(
    first_name: str, advance: Advance, applied: Decimal, pending_count: int, fmt: NumberFormat
) -> tuple[Reply, str]:
    """Recordatorio completo (ventana abierta) y su versión de una línea para la plantilla."""
    values = {
        "name": first_name,
        "destination": advance.destination or advance.purpose,
        "end": short_date(advance.end_date),
        "applied": msg.money(applied, advance.currency, fmt),
        "amount": msg.money(advance.amount, advance.currency, fmt),
    }
    text = msg.LEGALIZATION_REMINDER.format(**values)
    if pending_count:
        text += "\n" + msg.LEGALIZATION_REMINDER_PENDING.format(what=msg.pending_expenses(pending_count))
        buttons: tuple[Button, ...] = ()
    else:
        text += "\n" + msg.LEGALIZATION_REMINDER_SUBMIT
        buttons = (Button(f"adv_submit:{advance.id}", msg.BUTTON_SUBMIT),)
    return Reply(text, buttons), msg.LEGALIZATION_REMINDER_NOTICE.format(**values)


def finding_text(finding: dict[str, Any], fmt: NumberFormat) -> str | None:
    template = msg.FINDING_LABELS.get(finding.get("code", ""))
    if template is None:
        return None
    detail = finding.get("detail") or {}
    items = detail.get("lines") or []
    concepts = ", ".join(sorted({str(item.get("concept_name") or item.get("concept")) for item in items}))
    amounts = [Decimal(str(item["amount"])) for item in items if item.get("amount")]
    values = {
        "concepts": concepts.lower(),
        "amount": msg.money(sum(amounts, Decimal(0)), None, fmt) if amounts else "—",
        "cap": msg.money(_decimal(detail.get("cap")), None, fmt) if detail.get("cap") else "—",
        "value": msg.money(_decimal(detail.get("value")), None, fmt) if detail.get("value") else "—",
        "invoice_date": short_date(date.fromisoformat(detail["invoice_date"]) if detail.get("invoice_date") else None),
        "legal_name": detail.get("legal_name") or "la compañía",
        "tax_id": detail.get("tax_id") or "",
        "company": detail.get("company") or "",
        "fields": ", ".join(msg.RECEIPT_FIELD_LABELS.get(f, f) for f in detail.get("fields") or []),
        "tip": msg.money(_decimal(detail.get("tip")), None, fmt) if detail.get("tip") else "—",
        "suggested": msg.money(_decimal(detail.get("suggested")), None, fmt) if detail.get("suggested") else "—",
    }
    return template.format(**values)


def short_date(day: date | None) -> str:
    return f"{day:%d/%m/%Y}" if day else "sin fecha"


def truncate(text: str, limit: int = MAX_TEXT) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _decimal(value: object) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _number(value: object) -> str:
    """19.00 -> 19; 4123.5 -> 4123.5 (sin ceros de más)."""
    number = Decimal(str(value)).normalize()
    return f"{number:f}"
