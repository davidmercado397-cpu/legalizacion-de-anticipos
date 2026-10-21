from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from app.domain.ports import FlowMessage
from app.domain.values import InvoiceLine
from tests.conftest import Harness, wa_message
from tests.fakes import invoice
from tests.integration.test_whatsapp_menu import PHONE, Chat, _scenario


async def flow_reply(harness: Harness, chat: Chat, response: dict[str, Any]) -> None:
    interactive = {"type": "nfm_reply", "nfm_reply": {"name": "flow", "body": "Sent", "response_json": json.dumps(response)}}
    await harness.webhook(wa_message(chat._id(), phone=chat.phone, type="interactive", interactive=interactive))
    await harness.drain()


async def _configure_flows(harness: Harness) -> None:
    await harness.set_setting("whatsapp.flow_expense_correction_id", "FLOW-CORRECT")
    await harness.set_setting("whatsapp.flow_justification_id", "FLOW-JUSTIFY")
    await harness.set_setting("whatsapp.flow_advance_request_id", "FLOW-REQUEST")


def _flow(chat: Chat) -> FlowMessage:
    flow: FlowMessage = chat.last("flow").extra
    return flow


async def test_correct_button_opens_the_flow_prefilled_and_its_reply_corrects_and_confirms(harness: Harness) -> None:
    juan, _, emp_h, advance_id = await _scenario(harness)
    await _configure_flows(harness)
    await juan.photo(1)
    detail = juan.last("buttons")
    await juan.tap(detail.extra[1].id)  # Corregir

    flow = _flow(juan)
    assert flow.flow_id == "FLOW-CORRECT" and flow.screen == "CORRECT" and flow.cta == "Corregir"
    assert flow.data["vendor_name"] == "Restaurante El Cielo" and flow.data["total"] == "45000"
    assert flow.data["invoice_date"] == "2026-10-13" and flow.data["category"] == "meals"
    assert {"id": "lodging", "title": "Hospedaje"} in flow.data["categories"]

    response = {**flow.data, "flow_token": flow.token, "vendor_name": "El Cielo Gourmet", "total": "52000"}
    await flow_reply(harness, juan, response)
    assert juan.last("text").text.startswith("✏️ Listo, lo corregí y quedó confirmado.\n📌 En Medellín")
    expense = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]
    assert expense["status"] == "confirmed" and expense["vendor_name"] == "El Cielo Gourmet"
    assert Decimal(expense["total"]) == Decimal("52000")


async def test_the_correction_flow_edits_every_field_of_the_web_form(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    await juan.photo(1)
    await juan.tap(juan.last("buttons").extra[1].id)  # Corregir

    flow = _flow(juan)
    assert flow.data["document_type"] == "pos_ticket" and flow.data["currency"] == "COP"
    assert {"id": "COP", "title": "COP"} in flow.data["currencies"]
    assert flow.data["subtotal"] == "37815" and flow.data["tax_amount"] == "7185" and flow.data["tip_amount"] == ""
    assert flow.data["payment_method"] == "advance" and flow.data["description"] == "Almuerzo"
    assert flow.data["receipt_signed"] is False
    assert {"id": "unset", "title": "Sin definir"} not in flow.data["document_types"]
    assert [d["id"] for d in flow.data["document_types"]] == ["electronic_invoice", "pos_ticket", "cash_receipt", "other"]
    assert [m["id"] for m in flow.data["payment_methods"]] == ["advance", "card", "cash", "transfer"]
    assert [c["id"] for c in flow.data["currencies"]] == ["COP", "USD", "EUR", "BRL", "MXN"]
    assert len(flow.data["categories"]) > 1

    response = {
        **flow.data,
        "flow_token": flow.token,
        "document_type": "cash_receipt",
        "tip_amount": "4500",
        "total": "49500",
        "payment_method": "card",
        "description": "Almuerzo con el cliente",
        "receipt_signed": True,
    }
    await flow_reply(harness, juan, response)
    expense = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]
    assert expense["status"] == "confirmed" and expense["document_type"] == "cash_receipt"
    assert expense["receipt_signed"] is True and expense["payment_method"] == "card"
    assert Decimal(expense["tip_amount"]) == Decimal("4500") and expense["description"] == "Almuerzo con el cliente"


async def test_justification_flow_confirms_with_the_reason(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    # Fuera de las fechas del viaje (12 al 15 de octubre) solo lo revisa contabilidad; el licor pide justificación.
    harness.extractor.respond = lambda _r, _n: [
        invoice(
            invoice_date=date(2026, 9, 1),
            lines=(InvoiceLine("Cerveza", Decimal("45000"), concept_code="alcohol", concept_confidence=0.9),),
        )
    ]
    await juan.photo(1)
    detail = juan.last("buttons")
    assert detail.extra[0].title == "✍️ Justificar"
    await juan.tap(detail.extra[0].id)
    flow = _flow(juan)
    assert flow.screen == "JUSTIFY" and "Incluye" in flow.data["reason"]

    await flow_reply(harness, juan, {"flow_token": flow.token, "justification": "Compra del viaje anterior"})
    assert juan.last("text").text.startswith("✅ Gasto confirmado.")
    expense = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]
    assert expense["status"] == "confirmed" and expense["justification"] == "Compra del viaje anterior"


async def test_request_an_advance_with_the_flow(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    await juan.tap("menu:request")
    flow = _flow(juan)
    assert flow.screen == "REQUEST" and flow.data["companies"][0]["title"] == "Forsa Colombia"
    assert juan.last("flow").text == "➕ Completa los datos del viaje y te muestro el valor calculado con las tarifas de viaje."
    # La moneda y el valor van en la segunda pantalla, que arma el endpoint de datos; la respuesta final trae todo.

    response = {
        "flow_token": flow.token,
        "company_id": flow.data["company_id"],
        "destination": "Cali",
        "purpose": "Visita de obra",
        "start_date": "2026-11-03",
        "end_date": "2026-11-05",
        "kind": "cash",
        "currency": "COP",
        "amount": "250000",
        "justification": "",
    }
    await flow_reply(harness, juan, response)
    assert (
        juan.last("text").text == "📨 Listo, pedí tu anticipo de $250.000 COP para Cali 03/11–05/11. Te aviso cuando lo aprueben."
    )
    advances = (await harness.client.get("/api/v1/advances", headers=emp_h, params={"status": "requested"})).json()["data"]
    assert advances[0]["destination"] == "Cali" and Decimal(advances[0]["amount"]) == Decimal("250000")

    # Datos que no se pueden leer: se pide revisar el formulario, sin crear nada.
    await flow_reply(harness, juan, {**response, "start_date": "mañana"})
    assert juan.last("text").text == "No pude leer los datos del formulario. Ábrelo de nuevo y revísalos."


async def test_without_the_flow_configured_the_bot_points_to_the_app(harness: Harness) -> None:
    juan, _, _, _ = await _scenario(harness)
    await juan.tap("menu:request")
    assert juan.last("text").text.startswith("➕ Solicita el anticipo en la app")
    assert not [s for s in harness.wa.of_kind("flow") if s.to and s.to.phone == PHONE]


async def test_register_a_cash_withdrawal_with_the_flow(harness: Harness) -> None:
    """Retiro en reales de un anticipo en pesos: lo debitado fija la tasa y la comisión queda como gasto."""
    juan, _, emp_h, advance_id = await _scenario(harness)
    await harness.set_setting("whatsapp.flow_withdrawal_id", "FLOW-WITHDRAW")
    await juan.tap("menu:withdraw")  # un solo anticipo abierto: abre el formulario de una vez
    flow = _flow(juan)
    assert flow.flow_id == "FLOW-WITHDRAW" and flow.screen == "WITHDRAW" and flow.cta == "Registrar retiro"
    assert "COP" not in [c["id"] for c in flow.data["currencies"]] and flow.data["ledger"].endswith(
        "en COP, la moneda en que legalizas."
    )

    response = {
        "flow_token": flow.token,
        "withdrawn_on": "2026-10-13",
        "currency": "BRL",
        "amount": "500",
        "debited_amount": "410000",
        "fee_amount": "15000",
    }
    await flow_reply(harness, juan, response)
    assert juan.last("text").text.startswith("🏧 Listo, registré el retiro de")
    assert "(tasa 820)" in juan.last("text").text
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()
    [withdrawal] = detail["withdrawals"]
    assert withdrawal["currency"] == "BRL" and Decimal(withdrawal["rate"]) == Decimal("820")
    assert Decimal(withdrawal["fee_amount"]) == Decimal("15000")

    # Sin tasa oficial para ese día ni lo debitado: se pide el valor del banco, sin crear nada.
    await flow_reply(harness, juan, {**response, "withdrawn_on": "2026-10-14", "debited_amount": ""})
    assert juan.last("text").text == "❌ No hay tasa de cambio para ese día: escribe cuánto te debitó el banco en COP."
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()
    assert len(detail["withdrawals"]) == 1


async def test_without_the_withdrawal_flow_the_bot_points_to_the_app(harness: Harness) -> None:
    juan, _, _, _ = await _scenario(harness)
    await juan.tap("menu:withdraw")
    assert juan.last("text").text.startswith("🏧")
    assert not [s for s in harness.wa.of_kind("flow") if s.to and s.to.phone == PHONE]


async def _two_advances(harness: Harness, *, with_alcohol: bool = False) -> tuple[Chat, dict[str, str], str]:
    """Juan con dos anticipos abiertos y una factura fuera de las fechas de ambos: no se puede asignar sola."""
    juan, _, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    async with harness.container.uow() as uow:
        employee = await uow.employees.get_by_email("juan@forsa.com")
    assert employee is not None
    bogota = await harness.add_open_advance(employee, purpose="Visita Bogotá")
    # Un viaje que todavía no empieza no se ofrece para asignar gastos.
    await harness.add_open_advance(employee, purpose="Feria Cartagena", start_date=date(2027, 6, 1), end_date=date(2027, 6, 3))
    lines = (InvoiceLine("Cerveza", Decimal("45000"), concept_code="alcohol", concept_confidence=0.9),) if with_alcohol else ()
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 9, 1), **({"lines": lines} if lines else {}))]
    await juan.photo(1)
    return juan, emp_h, str(bogota.id)


async def _expense(harness: Harness, emp_h: dict[str, str]) -> dict[str, Any]:
    expense: dict[str, Any] = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]
    return expense


async def test_justifying_an_invoice_without_advance_asks_which_one_and_then_opens_the_flow(harness: Harness) -> None:
    juan, emp_h, bogota = await _two_advances(harness, with_alcohol=True)
    detail = next(m for m in reversed(harness.wa.sent) if m.kind == "buttons")
    await juan.tap(detail.extra[0].id)  # Justificar, antes de elegir el anticipo

    pick = juan.last("list")
    assert pick.text.startswith("📌 Primero dime a qué anticipo va este gasto")
    row = next(r for r in pick.extra if r.id.endswith(bogota))
    assert row.id.startswith("pick:") and len(pick.extra) == 2  # Medellín y Bogotá; Cartagena aún no empieza
    await juan.tap(row.id)
    assert juan.last("text").text == "📌 Listo, quedó en Visita Bogotá."
    flow = _flow(juan)
    assert flow.screen == "JUSTIFY"

    await flow_reply(harness, juan, {"flow_token": flow.token, "justification": "Cena con el cliente"})
    assert juan.last("text").text.startswith("✅ Gasto confirmado.")
    expense = await _expense(harness, emp_h)
    assert expense["status"] == "confirmed" and expense["advance_id"] == bogota


async def test_confirming_an_invoice_without_advance_lists_them_instead_of_failing(harness: Harness) -> None:
    juan, emp_h, bogota = await _two_advances(harness)
    detail = next(m for m in reversed(harness.wa.sent) if m.kind == "buttons")
    await juan.tap(detail.extra[0].id)  # Está bien

    pick = juan.last("list")
    assert pick.text.startswith("📌 Primero dime a qué anticipo va este gasto")
    await juan.tap(next(r.id for r in pick.extra if r.id.endswith(bogota)))
    assert juan.last("text").text.startswith("📌 Listo, quedó en Visita Bogotá.\n✅ Gasto confirmado.")
    assert (await _expense(harness, emp_h))["advance_id"] == bogota


async def test_typing_while_an_invoice_waits_for_its_advance_shows_the_list_again(harness: Harness) -> None:
    juan, emp_h, bogota = await _two_advances(harness)

    await juan.say("bogota")  # no se interpreta texto libre: la respuesta se elige de la lista
    pick = juan.last("list")
    assert pick.text == "📌 Elige de la lista a qué anticipo va la factura de Restaurante El Cielo."
    assert all(r.id.startswith("move:") for r in pick.extra) and len(pick.extra) == 2
    assert (await _expense(harness, emp_h))["advance_id"] is None

    await juan.tap(next(r.id for r in pick.extra if r.id.endswith(bogota)))
    assert juan.last("text").text == "📌 Listo, quedó en Visita Bogotá."
    assert (await _expense(harness, emp_h))["advance_id"] == bogota


async def test_with_only_future_trips_there_is_no_advance_in_progress_to_choose(harness: Harness) -> None:
    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com", phone=PHONE)
    for destino, mes in (("Cartagena", 6), ("Lima", 8)):
        await harness.add_open_advance(employee, purpose=destino, start_date=date(2027, mes, 1), end_date=date(2027, mes, 3))
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 9, 1))]
    juan = Chat(harness, PHONE)

    await juan.photo(1)  # la fecha no cae en ningún viaje y ninguno ha empezado: no hay lista que ofrecer
    aviso = "📅 No tienes un anticipo en curso: los que tienes abiertos son de viajes que todavía no empiezan."
    assert juan.last("text").text == aviso
    assert not harness.wa.of_kind("list")

    detail = next(m for m in reversed(harness.wa.sent) if m.kind == "buttons")
    await juan.tap(detail.extra[0].id)  # Está bien
    assert juan.last("text").text == aviso
