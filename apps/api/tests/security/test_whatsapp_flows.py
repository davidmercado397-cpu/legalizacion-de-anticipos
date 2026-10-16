"""Control W6: la respuesta de un WhatsApp Flow solo actúa si trae un token firmado, vigente y emitido
para quien responde."""

from __future__ import annotations

import uuid
from typing import cast

from app.domain.ports import TokenService
from tests.conftest import Harness
from tests.integration.test_whatsapp_flows import _configure_flows, _flow, flow_reply
from tests.integration.test_whatsapp_menu import _scenario


async def test_flow_reply_needs_a_valid_token_of_the_same_employee(harness: Harness) -> None:
    juan, ana, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    await juan.photo(1)
    await juan.tap(juan.last("buttons").extra[1].id)
    flow = _flow(juan)
    stolen = {**flow.data, "flow_token": flow.token, "vendor_name": "Otro"}

    # Otro empleado reenvía el formulario de Juan: no se toca el gasto.
    await flow_reply(harness, ana, stolen)
    assert ana.last("text").text == "No puedes realizar esa acción."
    # Sin token, con uno inventado o con un access token: el formulario se trata como vencido.
    await flow_reply(harness, juan, {**flow.data, "vendor_name": "Otro"})
    assert juan.last("text").text.startswith("⌛ Ese formulario venció")
    await flow_reply(harness, juan, {**flow.data, "flow_token": emp_h["Authorization"].split()[1], "vendor_name": "Otro"})
    assert juan.last("text").text.startswith("⌛ Ese formulario venció")
    tokens = cast(TokenService, harness.container.extras["tokens"])
    await flow_reply(harness, juan, {"flow_token": tokens.issue_flow_token(uuid.uuid4(), "justification", None)})
    assert juan.last("text").text == "No puedes realizar esa acción."

    expense = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]
    assert expense["vendor_name"] == "Restaurante El Cielo" and expense["status"] == "extracted"


async def test_the_flow_only_opens_for_the_owner_of_the_expense(harness: Harness) -> None:
    juan, ana, emp_h, _ = await _scenario(harness)
    await _configure_flows(harness)
    await juan.photo(1)
    expense_id = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]["id"]
    await ana.tap(f"exp_correct:{expense_id}")  # su aprobadora: lo ve en la app, no lo corrige por el chat
    assert ana.last("text").text.startswith("❌ No encontramos el gasto")
    assert not [s for s in harness.wa.of_kind("flow") if s.to and s.to.phone == ana.phone]
