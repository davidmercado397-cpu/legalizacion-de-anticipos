from __future__ import annotations

import uuid
from datetime import date
from typing import cast

import sqlalchemy as sa

from app.application.whatsapp_notifier import NOTICE_DETAIL_PAYLOAD, WhatsAppSessions
from app.domain.enums import Role
from tests.conftest import Harness, wa_message
from tests.fakes import invoice
from tests.integration.test_whatsapp_flows import _configure_flows, _flow, flow_reply
from tests.integration.test_whatsapp_menu import Chat, _scenario


async def _new_advance(harness: Harness, headers: dict[str, str], **extra: object) -> str:
    company_id = (await harness.client.get("/api/v1/me", headers=headers)).json()["company_ids"][0]
    body = {"company_id": company_id, "kind": "cash", "currency": "COP", "amount": "200000", "purpose": "Cali", **extra}
    created = await harness.client.post("/api/v1/advances", headers=headers, json=body)
    await harness.drain()
    advance_id: str = created.json()["id"]
    return advance_id


async def test_employee_hears_about_approval_rejection_disbursement_and_void(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE companies SET legal_name = 'Forsa S.A.S.', tax_id = '900123456-7'"))
    company = (await harness.client.get("/api/v1/me", headers=emp_h)).json()["company_ids"][0]
    accountant = await harness.add_employee(await _company(harness, company), "conta@forsa.com", Role.ACCOUNTANT)
    treasurer = await harness.add_employee(await _company(harness, company), "tesoreria@forsa.com", Role.TREASURY)
    acc_h, appr_h = await harness.login(accountant), await harness.login(await _employee(harness, "ana@forsa.com"))
    await juan.say("hola")  # ventana de 24 h abierta

    first = await _new_advance(harness, emp_h)
    await harness.client.post(f"/api/v1/advances/{first}/approve", headers=appr_h)
    await harness.drain()
    approved = juan.last("text").text
    assert approved.startswith("✅ Ana Pérez aprobó tu anticipo Cali por $200.000 COP.")
    assert "Pide tus facturas a nombre de *Forsa S.A.S.*, NIT 900123456-7." in approved

    await harness.client.post(
        f"/api/v1/advances/{first}/disburse", headers=await harness.login(treasurer), json={"method": "cash"}
    )
    await harness.drain()
    assert juan.last("text").text == "💸 Tesorería te entregó el anticipo Cali ($200.000 COP)."
    await harness.client.post(f"/api/v1/advances/{first}/void", headers=acc_h, json={"note": "Viaje cancelado"})
    await harness.drain()
    assert juan.last("text").text == "🚫 Contabilidad anuló tu anticipo Cali.\nMotivo: Viaje cancelado"

    # Fuera de la ventana el aviso va con la plantilla, en una línea.
    await harness.set_setting("whatsapp.notice_template", "aviso_gastos")
    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE whatsapp_sessions SET last_inbound_at = now() - interval '2 days'"))
    second = await _new_advance(harness, emp_h, purpose="Bogotá")
    await harness.client.post(f"/api/v1/advances/{second}/reject", headers=appr_h, json={"note": "No hay presupuesto"})
    await harness.drain()
    template = juan.last("template")
    assert template.text == "aviso_gastos" and template.extra["params"] == ["Juan", "Ana Pérez no aprobó tu anticipo Bogotá"]
    assert template.extra["payloads"] == [NOTICE_DETAIL_PAYLOAD]

    # [Ver detalle] entrega el mensaje completo, con el motivo, y nada más.
    sent = juan.received
    await _tap_template_button(harness, juan)
    assert juan.received == sent + 1
    assert juan.last("text").text == "❌ Ana Pérez no aprobó tu anticipo Bogotá.\nMotivo: No hay presupuesto"
    # Ya se mostró: el mismo botón abre el menú.
    await _tap_template_button(harness, juan)
    assert juan.received == sent + 2 and juan.last("list").to.phone == juan.phone


async def test_a_held_notice_arrives_before_whatever_the_employee_writes_and_expires(harness: Harness) -> None:
    juan, _, emp_h, _ = await _scenario(harness)
    appr_h = await harness.login(await _employee(harness, "ana@forsa.com"))
    await harness.set_setting("whatsapp.notice_template", "aviso_gastos")
    await juan.say("hola")
    await _close_window(harness)
    await _rejected(harness, emp_h, appr_h, "Bogotá")
    assert juan.last("template").extra["params"][1] == "Ana Pérez no aprobó tu anticipo Bogotá"

    sent = juan.received
    await juan.say("saldo")
    detail, balance = harness.wa.sent[-2:]
    assert juan.received == sent + 2
    assert detail.text == "❌ Ana Pérez no aprobó tu anticipo Bogotá.\nMotivo: No hay presupuesto"
    assert balance.text.startswith("💰 *Medellín")
    await juan.say("saldo")
    assert juan.received == sent + 3  # el aviso se entrega una sola vez

    # Vencido no se entrega...
    await _close_window(harness)
    await _rejected(harness, emp_h, appr_h, "Cali")
    await _age_held(harness)
    sent = juan.received
    await juan.say("saldo")
    assert juan.received == sent + 1 and juan.last("text").text.startswith("💰 *Medellín")
    # ...y el cierre de sesiones lo borra aunque el empleado no vuelva a escribir.
    await _close_window(harness)
    await _rejected(harness, emp_h, appr_h, "Pasto")
    await _age_held(harness)
    await cast(WhatsAppSessions, harness.container.extras["sessions"]).close_idle()
    async with harness.container.engine.begin() as conn:
        assert (await conn.execute(sa.text("SELECT count(*) FROM whatsapp_held_notices"))).scalar_one() == 0


async def _rejected(harness: Harness, emp_h: dict[str, str], appr_h: dict[str, str], purpose: str) -> None:
    advance_id = await _new_advance(harness, emp_h, purpose=purpose)
    await harness.client.post(f"/api/v1/advances/{advance_id}/reject", headers=appr_h, json={"note": "No hay presupuesto"})
    await harness.drain()


async def _tap_template_button(harness: Harness, chat: Chat) -> None:
    button = {"payload": NOTICE_DETAIL_PAYLOAD, "text": "Ver detalle"}
    await harness.webhook(wa_message(chat._id(), phone=chat.phone, type="button", button=button))
    await harness.drain()


async def _close_window(harness: Harness) -> None:
    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE whatsapp_sessions SET last_inbound_at = now() - interval '2 days'"))


async def _age_held(harness: Harness) -> None:
    async with harness.container.engine.begin() as conn:
        await conn.execute(sa.text("UPDATE whatsapp_held_notices SET created_at = now() - interval '8 days'"))


async def test_legalization_round_trip_notifies_the_employee(harness: Harness) -> None:
    """La legalización la revisa contabilidad desde la app: al jefe ya no le llega por WhatsApp."""
    juan, ana, emp_h, advance_id = await _scenario(harness)
    company = (await harness.client.get("/api/v1/me", headers=emp_h)).json()["company_ids"][0]
    accountant = await harness.add_employee(await _company(harness, company), "conta@forsa.com", Role.ACCOUNTANT)
    acc_h = await harness.login(accountant)
    await _configure_flows(harness)
    await ana.say("hola")
    sent_to_ana = ana.received
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 10, 13))]
    await juan.photo(1)
    expense_id = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]["id"]
    await juan.tap(juan.last("buttons").extra[0].id)  # Está bien
    await juan.tap(f"submit:{advance_id}")
    await juan.tap(juan.last("buttons").extra[0].id)  # Enviar
    await harness.drain()
    assert ana.received == sent_to_ana

    await harness.client.post(
        f"/api/v1/advances/{advance_id}/return",
        headers=acc_h,
        json={"note": "Falta un soporte", "items": [{"expense_id": expense_id, "note": "Explica el almuerzo"}]},
    )
    await harness.drain()
    returned = juan.last("buttons")
    assert returned.text.startswith("↩️ Conta Pérez te devolvió la legalización de Medellín 12/10–15/10 para cambios.")
    assert "Motivo: Falta un soporte" in returned.text and "Marcó 1 gasto para revisar." in returned.text
    await juan.tap(returned.extra[0].id)  # Ver marcados
    await juan.tap(juan.last("list").extra[0].id)
    marked = juan.last("buttons")
    assert [b.title for b in marked.extra] == ["✍️ Justificar", "✏️ Corregir", "🗑️ Descartar"]
    await juan.tap(marked.extra[0].id)
    flow = _flow(juan)
    assert "Explica el almuerzo" in flow.data["reason"]
    await flow_reply(harness, juan, {"flow_token": flow.token, "justification": "Almuerzo con el cliente en obra"})

    await juan.tap(f"submit:{advance_id}")
    await juan.tap(juan.last("buttons").extra[0].id)
    await harness.drain()
    assert ana.received == sent_to_ana

    await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=acc_h)
    await harness.drain()
    assert juan.last("text").text == (
        "✅ Conta Pérez aprobó tu legalización de Medellín 12/10–15/10.\n"
        "Te queda por reintegrar $355.000 COP. Tesorería te dirá cómo hacerlo."
    )


async def _employee(harness: Harness, email: str):  # type: ignore[no-untyped-def]
    async with harness.container.uow() as uow:
        return await uow.employees.get_by_email(email)


async def _company(harness: Harness, company_id: str):  # type: ignore[no-untyped-def]
    async with harness.container.uow() as uow:
        return await uow.companies.get(uuid.UUID(company_id))
