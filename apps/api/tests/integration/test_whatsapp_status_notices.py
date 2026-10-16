from __future__ import annotations

import uuid
from datetime import date

import sqlalchemy as sa

from app.domain.enums import Role
from tests.conftest import Harness
from tests.fakes import invoice
from tests.integration.test_whatsapp_flows import _configure_flows, _flow, flow_reply
from tests.integration.test_whatsapp_menu import _scenario


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
    acc_h, appr_h = await harness.login(accountant), await harness.login(await _employee(harness, "ana@forsa.com"))
    await juan.say("hola")  # ventana de 24 h abierta

    first = await _new_advance(harness, emp_h)
    await harness.client.post(f"/api/v1/advances/{first}/approve", headers=appr_h)
    await harness.drain()
    approved = juan.last("text").text
    assert approved.startswith("✅ Ana Pérez aprobó tu anticipo Cali por $200.000 COP.")
    assert "Pide tus facturas a nombre de *Forsa S.A.S.*, NIT 900123456-7." in approved

    await harness.client.post(f"/api/v1/advances/{first}/disburse", headers=acc_h, json={"method": "cash"})
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


async def test_legalization_round_trip_notifies_both_sides(harness: Harness) -> None:
    juan, ana, emp_h, advance_id = await _scenario(harness)
    appr_h = await harness.login(await _employee(harness, "ana@forsa.com"))
    await _configure_flows(harness)
    await ana.say("hola")
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 10, 13))]
    await juan.photo(1)
    expense_id = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]["id"]
    await juan.tap(juan.last("buttons").extra[0].id)  # Está bien
    await juan.tap(f"submit:{advance_id}")
    await juan.tap(juan.last("buttons").extra[0].id)  # Enviar
    assert ana.last("text").text.startswith("📤 Juan Pérez envió su legalización de Medellín 12/10–15/10: 1 gasto, 0 con alertas")

    await harness.client.post(
        f"/api/v1/advances/{advance_id}/return",
        headers=appr_h,
        json={"note": "Falta un soporte", "items": [{"expense_id": expense_id, "note": "Explica el almuerzo"}]},
    )
    await harness.drain()
    returned = juan.last("buttons")
    assert returned.text.startswith("↩️ Ana Pérez te devolvió la legalización de Medellín 12/10–15/10 para cambios.")
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
    assert "corrigió y reenvió la legalización de Medellín 12/10–15/10: 1 corregidos y 0 sin resolver" in ana.last("text").text

    await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=appr_h)
    await harness.drain()
    assert juan.last("text").text == (
        "✅ Ana Pérez aprobó tu legalización de Medellín 12/10–15/10.\n"
        "Te queda por reintegrar $355.000 COP. Tesorería te dirá cómo hacerlo."
    )


async def _employee(harness: Harness, email: str):  # type: ignore[no-untyped-def]
    async with harness.container.uow() as uow:
        return await uow.employees.get_by_email(email)


async def _company(harness: Harness, company_id: str):  # type: ignore[no-untyped-def]
    async with harness.container.uow() as uow:
        return await uow.companies.get(uuid.UUID(company_id))
