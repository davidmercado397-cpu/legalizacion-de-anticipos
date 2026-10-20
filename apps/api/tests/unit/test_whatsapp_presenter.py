from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from app.application import messages as msg
from app.application.messages import NumberFormat
from app.application.whatsapp_menu import normalize_command
from app.application.whatsapp_presenter import (
    MAX_TEXT,
    ExpenseView,
    advance_rows,
    advances_list,
    expense_detail,
    greeting,
    legalization_reminder,
    menu,
    truncate,
)
from app.domain.entities import Advance, Expense, ExpenseLine, WhatsAppSession, advance_for_date
from app.domain.enums import AdvanceKind, AdvanceStatus, DocumentType, ExpenseSource, ExpenseStatus, PolicyAction
from app.domain.ports import CategoryHint

CATEGORIES = {"meals": CategoryHint("meals", "Alimentación", "🍽️")}
NOW = datetime(2026, 10, 16, 15, 0, tzinfo=UTC)


def _expense(**overrides: object) -> Expense:
    expense = Expense(
        employee_id=uuid.uuid4(),
        source=ExpenseSource.WHATSAPP,
        status=ExpenseStatus.EXTRACTED,
        document_type=DocumentType.ELECTRONIC_INVOICE,
        vendor_name="Hotel Dann",
        vendor_tax_id="890903938-8",
        invoice_number="FE-77",
        invoice_date=date(2026, 10, 13),
        currency="COP",
        subtotal=Decimal("100000"),
        total=Decimal("119000"),
        fiscal_id="cufe-secreto-largo",
        category="meals",
        taxes=[{"type": "iva", "rate": "19.00", "amount": "19000", "base": "100000"}],
    )
    for name, value in overrides.items():
        setattr(expense, name, value)
    return expense


def _lines(expense: Expense, count: int) -> list[ExpenseLine]:
    return [ExpenseLine(expense.id, i, f"Ítem {i}", f"item {i}", Decimal(1000)) for i in range(1, count + 1)]


def _advance(destination: str, start: date | None, end: date | None) -> Advance:
    return Advance(uuid.uuid4(), uuid.uuid4(), AdvanceKind.CASH, "COP", Decimal(400000), "Obra", destination, start, end)


def test_invoice_detail_shows_what_was_read_without_the_cufe() -> None:
    expense = _expense()
    reply = expense_detail(ExpenseView(expense, _lines(expense, 12), CATEGORIES, NumberFormat()))
    assert "*Hotel Dann*" in reply.text and "NIT 890903938-8" in reply.text and "Factura FE-77" in reply.text
    assert "📅 13/10/2026" in reply.text and "cufe" not in reply.text.lower()
    assert "• Ítem 10 — $1.000" in reply.text and "Ítem 11" not in reply.text and "…y 2 más" in reply.text
    assert "Base: $100.000" in reply.text and "IVA 19 %: $19.000" in reply.text and "*Total: $119.000 COP*" in reply.text
    assert "👀" not in reply.text  # factura electrónica: no se pide revisar la lectura
    assert [b.id.split(":")[0] for b in reply.buttons] == ["exp_confirm", "exp_correct"]


def test_receipt_without_qr_asks_to_check_total_and_date_and_shows_the_time() -> None:
    expense = _expense(document_type=DocumentType.CASH_RECEIPT, invoice_time=time(12, 45), taxes=[], subtotal=None)
    reply = expense_detail(ExpenseView(expense, [], CATEGORIES, NumberFormat()))
    assert "📅 *13/10/2026 · 12:45*" in reply.text and msg.REVIEW_READING in reply.text
    read_from_qr = _expense(document_type=DocumentType.POS_TICKET, field_sources={"total": "qr"})
    assert msg.REVIEW_READING not in expense_detail(ExpenseView(read_from_qr, [], CATEGORIES, NumberFormat())).text


def test_buttons_follow_the_policy_result_and_the_advance_by_date() -> None:
    blocked = _expense(policy_findings=[{"code": "blocked_concept", "action": PolicyAction.BLOCK, "detail": {}}])
    assert [b.title for b in expense_detail(ExpenseView(blocked, [], CATEGORIES, NumberFormat())).buttons] == ["✏️ Corregir"]
    justify = _expense(policy_findings=[{"code": "not_itemized", "action": PolicyAction.REQUIRE_JUSTIFICATION}])
    advance = _advance("Cali", date(2026, 10, 12), date(2026, 10, 14))
    reply = expense_detail(ExpenseView(justify, [], CATEGORIES, NumberFormat(), advance, Decimal(281000), by_date=True))
    assert [b.title for b in reply.buttons] == ["✍️ Justificar", "✏️ Corregir", "🔁 Cambiar anticipo"]
    assert "Por la fecha lo asigné a Cali 12/10–14/10 · saldo al confirmar: $281.000 COP" in reply.text
    unreadable = _expense(status=ExpenseStatus.UNREADABLE)
    assert expense_detail(ExpenseView(unreadable, [], CATEGORIES, NumberFormat())).buttons == ()


def test_own_duplicate_and_foreign_currency() -> None:
    original = _expense()
    duplicate = _expense(status=ExpenseStatus.DISCARDED, duplicate_of_id=original.id)
    text = expense_detail(ExpenseView(duplicate, [], CATEGORIES, NumberFormat(), duplicate_of=original)).text
    assert text == msg.DUPLICATE_OWN.format(what="Hotel Dann · $119.000 COP")
    usd = _expense(
        currency="USD",
        total=Decimal("30"),
        subtotal=None,
        taxes=[],
        amount_applied=Decimal("120000"),
        exchange_rate=Decimal("4000"),
        exchange_rate_date=date(2026, 10, 13),
    )
    panama = NumberFormat.of({"thousands": ",", "decimal": ".", "always_decimals": True})
    text = expense_detail(ExpenseView(usd, [], CATEGORIES, panama)).text
    assert "*Total: $30.00 USD*" in text and "Equivale a $120,000.00 (tasa 4000 del 13/10/2026)" in text


def test_money_formats_by_country() -> None:
    assert msg.money(Decimal("1234567.5"), "COP") == "$1.234.567,50 COP"
    assert msg.money(Decimal("1234567"), "COP") == "$1.234.567 COP"
    mexico = NumberFormat.of({"thousands": ",", "decimal": ".", "always_decimals": True})
    assert msg.money(Decimal("1234567"), "MXN", mexico) == "$1,234,567.00 MXN"
    assert msg.money(Decimal("-10"), None, mexico) == "-$10.00"


def test_texts_and_lists_respect_meta_limits() -> None:
    assert len(truncate("x" * 5000)) == MAX_TEXT
    expense = _expense()
    long_lines = [ExpenseLine(expense.id, i, "Producto con descripción muy larga " * 3, "x", Decimal(1)) for i in range(40)]
    expense.policy_findings = [{"code": "missing_tax_id", "action": PolicyAction.WARN}]
    reply = expense_detail(ExpenseView(expense, long_lines, CATEGORIES, NumberFormat()))
    assert len(reply.text) <= 1024 and "La factura no tiene NIT" in reply.text and "…y 35 más" in reply.text
    advances = [_advance(f"Destino con un nombre larguísimo {i}", None, None) for i in range(12)]
    rows = advance_rows(advances, "assign:batch")
    # Sin fila «Sin anticipo»: todo gasto se legaliza contra un anticipo.
    assert len(rows) == 10 and all(r.id.startswith("assign:batch:") and len(r.title) <= 24 for r in rows)
    for title in (
        msg.BUTTON_OK,
        msg.BUTTON_CORRECT,
        msg.BUTTON_JUSTIFY,
        msg.BUTTON_CHANGE_ADVANCE,
        msg.BUTTON_SUBMIT,
        msg.BUTTON_REQUEST_ADVANCE,
    ):
        assert len(title) <= 20


def test_legalization_reminder_with_and_without_pending_expenses() -> None:
    advance = _advance("Medellín", date(2026, 10, 10), date(2026, 10, 14))
    reply, notice = legalization_reminder("Juan", advance, Decimal(150000), 2, NumberFormat())
    assert "confirma o descarta los 2 gastos pendientes" in reply.text and reply.buttons == ()
    assert "\n" not in notice and "14/10/2026" in notice
    reply, _ = legalization_reminder("Juan", advance, Decimal(150000), 0, NumberFormat())
    assert reply.buttons[0].id == f"adv_submit:{advance.id}"


def test_session_starts_again_after_inactivity_or_farewell_and_tracks_the_window() -> None:
    session = WhatsAppSession(uuid.uuid4(), NOW, NOW)
    ttl = timedelta(minutes=15)
    assert session.register_inbound(NOW + timedelta(minutes=10), ttl) is False
    assert session.register_inbound(NOW + timedelta(minutes=30), ttl) is True
    session.close(NOW + timedelta(minutes=31))
    assert session.register_inbound(NOW + timedelta(minutes=32), ttl) is True and session.closed_at is None
    assert session.window_open(NOW + timedelta(hours=23)) and not session.window_open(NOW + timedelta(hours=25))


def test_advance_for_date_prefers_the_exact_trip_and_avoids_ties() -> None:
    medellin = _advance("Medellín", date(2026, 10, 12), date(2026, 10, 15))
    cali = _advance("Cali", date(2026, 10, 20), date(2026, 10, 22))
    undated = _advance("Bogotá", None, None)
    both = [medellin, cali, undated]
    assert advance_for_date([undated], None, 0, 0) is undated
    assert advance_for_date(both, date(2026, 10, 21), 2, 2) is cali
    assert advance_for_date(both, date(2026, 10, 17), 2, 2) is medellin  # con la tolerancia
    assert advance_for_date(both, date(2026, 10, 18), 3, 3) is None  # empate: el usuario elige
    assert advance_for_date(both, None, 2, 2) is None
    # Márgenes asimétricos: ninguno antes de la salida y uno después del regreso.
    assert advance_for_date(both, date(2026, 10, 11), 0, 1) is None
    assert advance_for_date(both, date(2026, 10, 16), 0, 1) is medellin


def test_menu_greeting_and_advances_list() -> None:
    assert greeting("Juan", "").startswith("Hola Juan 👋 ¿Qué necesitas?")
    rows = menu(can_approve=False)
    assert all(len(r.title) <= 24 and len(r.description or "") <= 72 for r in menu(can_approve=True))
    assert len(rows) == 7 and "menu:approvals" not in [r.id for r in rows]
    assert len(menu(can_approve=True)) <= 10  # límite de filas de una lista de Meta
    returned = _advance("Cali", date(2026, 10, 1), date(2026, 10, 3))
    returned.status, returned.returned_at, returned.decision_note = AdvanceStatus.APPROVED, NOW, "Falta la factura del hotel"
    text = advances_list([returned], NumberFormat())
    assert "• *Cali 01/10–03/10* · abierto · $400.000 COP" in text and "↩️ Te la devolvieron: Falta la factura del hotel" in text
    assert advances_list([], NumberFormat()) == msg.NO_ADVANCES


def test_keywords_ignore_case_accents_and_punctuation() -> None:
    assert normalize_command("¡Mis  Gastos!") == "mis gastos"
    assert normalize_command("Menú") == "menu" and normalize_command(None) == ""
