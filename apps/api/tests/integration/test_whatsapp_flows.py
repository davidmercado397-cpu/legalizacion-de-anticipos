from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from app.domain.ports import FlowMessage
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


async def test_justification_flow_confirms_with_the_reason(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    # Fuera de las fechas del viaje (12 al 15 de octubre): la política pide justificación.
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 9, 1))]
    await juan.photo(1)
    detail = juan.last("buttons")
    assert detail.extra[0].title == "✍️ Justificar"
    await juan.tap(detail.extra[0].id)
    flow = _flow(juan)
    assert flow.screen == "JUSTIFY" and "fuera de las fechas del viaje" in flow.data["reason"]

    await flow_reply(harness, juan, {"flow_token": flow.token, "justification": "Compra del viaje anterior"})
    assert juan.last("text").text.startswith("✅ Gasto confirmado.")
    expense = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]
    assert expense["status"] == "confirmed" and expense["justification"] == "Compra del viaje anterior"


async def test_request_an_advance_with_the_flow(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    await juan.tap("menu:request")
    flow = _flow(juan)
    assert flow.screen == "REQUEST" and flow.data["currency"] == "COP" and flow.data["companies"][0]["title"] == "Forsa Colombia"

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
