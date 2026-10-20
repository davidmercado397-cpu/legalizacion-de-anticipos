from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.domain.enums import ExpenseStatus, Role, WhatsAppLinkStatus
from tests.conftest import Harness, wa_message, wa_status
from tests.fakes import invoice, make_jpeg

PHONE = "573001112233"
BSUID = "CO.1502576394655843"


async def _employee_with_advance(harness: Harness, *, phone: str | None = PHONE, wa_user_id: str | None = None):  # type: ignore[no-untyped-def]
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", phone=phone, approver=approver, wa_user_id=wa_user_id)
    emp_h, appr_h = await harness.login(employee), await harness.login(approver)
    advance = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={
            "company_id": str(company.id),
            "kind": "cash",
            "currency": "COP",
            "amount": "400000",
            "purpose": "Obra Medellín",
            "destination": "Medellín",
            "start_date": "2026-10-12",
            "end_date": "2026-10-15",
        },
    )
    await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/approve", headers=appr_h)
    await harness.drain()
    harness.wa.sent.clear()
    return company, employee, emp_h, advance.json()["id"]


def _reply(message_id: str, reply_id: str) -> dict[str, Any]:
    return wa_message(
        message_id,
        user_id=BSUID,
        phone=PHONE,
        type="interactive",
        interactive={"type": "button_reply", "button_reply": {"id": reply_id, "title": "-"}},
    )


async def _approver(harness: Harness):  # type: ignore[no-untyped-def]
    async with harness.container.uow() as uow:
        return await uow.employees.get_by_email("ana@forsa.com")


async def _expenses(harness: Harness, headers: dict[str, str]) -> list[dict]:  # type: ignore[type-arg]
    return (await harness.client.get("/api/v1/expenses", headers=headers)).json()["data"]


async def test_webhook_handshake_and_signature(harness: Harness) -> None:
    ok = await harness.client.get(
        "/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42"}
    )
    assert ok.status_code == 200 and ok.text == "42"
    bad = await harness.client.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "no"})
    assert bad.status_code == 403
    forged = await harness.webhook(wa_message("m1", phone=PHONE, type="text", text={"body": "hola"}), secret="wrong")
    assert forged.status_code == 403


async def test_photo_by_phone_links_bsuid_reacts_and_summarizes(harness: Harness) -> None:
    _, employee, emp_h, advance_id = await _employee_with_advance(harness)
    harness.wa.media["MEDIA1"] = (make_jpeg(), "image/jpeg")
    payload = wa_message(
        "wamid.IN1", phone=PHONE, user_id=BSUID, username="juanp", type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"}
    )
    assert (await harness.webhook(payload)).status_code == 200
    await harness.drain()

    reactions = [s.text for s in harness.wa.of_kind("reaction")]
    assert reactions == ["⏳", "✅"]
    assert harness.wa.of_kind("read")
    detail = harness.wa.of_kind("buttons")[-1]
    assert "Alimentación" in detail.text and "*Restaurante El Cielo*" in detail.text and "NIT 890903938-8" in detail.text
    assert "• Almuerzo ejecutivo — $45.000" in detail.text and "*Total: $45.000 COP*" in detail.text
    assert "saldo al confirmar: $355.000 COP" in detail.text and "CUFE" not in detail.text
    assert [b.title for b in detail.extra] == ["✅ Está bien", "✏️ Corregir"]
    expenses = await _expenses(harness, emp_h)
    assert expenses[0]["status"] == "extracted" and expenses[0]["advance_id"] == advance_id
    assert any(k.startswith("expenses/") for k in harness.storage.files)  # el original queda archivado en R2

    me = (await harness.client.get("/api/v1/me", headers=emp_h)).json()
    assert me["wa_link_status"] == WhatsAppLinkStatus.ACTIVE and me["wa_username"] == "juanp"

    # [Está bien] -> confirmado, con el saldo actualizado.
    confirm_id = detail.extra[0].id
    await harness.webhook(
        wa_message(
            "wamid.IN2",
            user_id=BSUID,
            type="interactive",
            interactive={"type": "button_reply", "button_reply": {"id": confirm_id, "title": "Confirmar"}},
        )
    )
    await harness.drain()
    assert (
        harness.wa.of_kind("text")[-1].text
        == "✅ Gasto confirmado.\n📌 En Medellín 12/10–15/10 te quedan $355.000 COP por legalizar."
    )
    balances = (await harness.client.get("/api/v1/me/balances", headers=emp_h)).json()["data"]
    assert Decimal(balances[0]["balance"]["pending"]) == Decimal("355000")

    # Los mensajes siguientes sin teléfono (usuario con nombre de usuario) se reconocen solo por el BSUID.
    await harness.webhook(wa_message("wamid.IN3", user_id=BSUID, type="text", text={"body": "saldo"}))
    await harness.drain()
    reply = harness.wa.of_kind("text")[-1]
    assert "Pendiente: $355.000 COP" in reply.text and reply.to is not None and reply.to.user_id == BSUID


async def test_duplicate_webhook_is_processed_once(harness: Harness) -> None:
    _, _, emp_h, _ = await _employee_with_advance(harness)
    harness.wa.media["MEDIA1"] = (make_jpeg(), "image/jpeg")
    payload = wa_message("wamid.DUP", phone=PHONE, user_id=BSUID, type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"})
    await harness.webhook(payload)
    await harness.webhook(payload)
    await harness.drain()
    assert len(await _expenses(harness, emp_h)) == 1


async def test_burst_of_photos_gets_one_detail_per_invoice(harness: Harness) -> None:
    _, _, emp_h, _ = await _employee_with_advance(harness)
    for index in range(3):
        harness.wa.media[f"M{index}"] = (make_jpeg(seed=index), "image/jpeg")
    # Tres facturas distintas (mismo proveedor + fecha + total se marcaría como duplicada).
    harness.extractor.respond = lambda _r, n: [
        invoice(invoice_number=f"POS-{n}", total=Decimal(10000 * n), subtotal=None, tax_amount=None, lines=(), itemized=False)
    ]
    await harness.set_setting("whatsapp.batch_grace_seconds", 0.2)
    for index in range(3):
        await harness.webhook(
            wa_message(
                f"wamid.B{index}", phone=PHONE, user_id=BSUID, type="image", image={"id": f"M{index}", "mime_type": "image/jpeg"}
            )
        )
    await harness.drain()
    details = harness.wa.of_kind("buttons")
    assert len(details) == 3 and all(d.extra[0].id.startswith("exp_confirm:") for d in details)
    # El saldo de cada mensaje descuenta las facturas anteriores de la ráfaga.
    assert "saldo al confirmar: $340.000 COP" in details[-1].text
    for number, detail in enumerate(details):
        await harness.webhook(
            wa_message(
                f"wamid.B9{number}",
                user_id=BSUID,
                type="interactive",
                interactive={"type": "button_reply", "button_reply": {"id": detail.extra[0].id, "title": "Está bien"}},
            )
        )
    await harness.drain()
    assert {e["status"] for e in await _expenses(harness, emp_h)} == {ExpenseStatus.CONFIRMED}


async def test_the_same_photo_twice_is_not_read_again(harness: Harness) -> None:
    _, _, emp_h, _ = await _employee_with_advance(harness)
    harness.wa.media["MEDIA1"] = (make_jpeg(), "image/jpeg")
    for number in (1, 2):
        await harness.webhook(
            wa_message(f"wamid.D{number}", phone=PHONE, type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"})
        )
        await harness.drain()
    assert len(harness.extractor.calls) == 1
    assert harness.wa.of_kind("text")[-1].text.startswith("⚠️ Esta factura ya la tengo registrada (Restaurante El Cielo")
    # No se sumó: la reacción no puede ser la de un registro exitoso.
    assert [r.text for r in harness.wa.of_kind("reaction") if r.extra == "wamid.D2"] == ["⏳", "⚠️"]
    expenses = {e["status"]: e for e in await _expenses(harness, emp_h)}
    assert set(expenses) == {"discarded", "extracted"}
    assert expenses["discarded"]["duplicate_of_id"] == expenses["extracted"]["id"]


async def test_the_same_invoice_in_another_photo_is_discarded_by_cufe(harness: Harness) -> None:
    _, _, emp_h, _ = await _employee_with_advance(harness)
    harness.extractor.respond = lambda _r, _n: [invoice(document_type="electronic_invoice", fiscal_id="cufe-123")]
    for number in (1, 2):
        harness.wa.media[f"M{number}"] = (make_jpeg(seed=number), "image/jpeg")
        await harness.webhook(
            wa_message(f"wamid.C{number}", phone=PHONE, type="image", image={"id": f"M{number}", "mime_type": "image/jpeg"})
        )
        await harness.drain()
    assert "ya la tengo registrada" in harness.wa.of_kind("text")[-1].text
    expenses = await _expenses(harness, emp_h)
    assert sorted(e["status"] for e in expenses) == ["discarded", "extracted"]


async def test_invoice_date_picks_the_advance_and_the_user_can_change_it(harness: Harness) -> None:
    company, employee, emp_h, medellin = await _employee_with_advance(harness)
    approver = await harness.login(await _approver(harness))
    cali = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={
            "company_id": str(company.id),
            "kind": "cash",
            "currency": "COP",
            "amount": "300000",
            "purpose": "Obra Cali",
            "destination": "Cali",
            "start_date": "2026-10-20",
            "end_date": "2026-10-22",
        },
    )
    await harness.client.post(f"/api/v1/advances/{cali.json()['id']}/approve", headers=approver)
    await harness.drain()
    harness.wa.sent.clear()
    harness.wa.media["M1"] = (make_jpeg(), "image/jpeg")
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 10, 21))]
    await harness.webhook(wa_message("wamid.T1", phone=PHONE, type="image", image={"id": "M1", "mime_type": "image/jpeg"}))
    await harness.drain()

    detail = harness.wa.of_kind("buttons")[-1]
    assert "Por la fecha lo asigné a Cali 20/10–22/10" in detail.text
    assert detail.extra[-1].title == "🔁 Cambiar anticipo" and not harness.wa.of_kind("list")
    expense = (await _expenses(harness, emp_h))[0]
    assert expense["advance_id"] == cali.json()["id"]

    await harness.webhook(_reply("wamid.T2", detail.extra[-1].id))
    await harness.drain()
    rows = harness.wa.of_kind("list")[-1].extra
    move = next(r for r in rows if r.id.endswith(medellin))
    await harness.webhook(_reply("wamid.T3", move.id))
    await harness.drain()
    assert harness.wa.of_kind("text")[-1].text == "📌 Listo, quedó en Medellín 12/10–15/10."
    assert (await _expenses(harness, emp_h))[0]["advance_id"] == medellin

    # Una fecha que no cae en ningún viaje: se pregunta a cuál anticipo va.
    harness.wa.media["M2"] = (make_jpeg(seed=2), "image/jpeg")
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=date(2026, 9, 1), invoice_number="X-2")]
    await harness.webhook(wa_message("wamid.T4", phone=PHONE, type="image", image={"id": "M2", "mime_type": "image/jpeg"}))
    await harness.drain()
    assert harness.wa.of_kind("list")[-1].text == "¿A qué anticipo asigno este gasto?"


async def test_correct_and_justify_buttons_point_to_the_app(harness: Harness) -> None:
    _, _, _, _ = await _employee_with_advance(harness)
    harness.wa.media["M1"] = (make_jpeg(), "image/jpeg")
    await harness.webhook(wa_message("wamid.K1", phone=PHONE, type="image", image={"id": "M1", "mime_type": "image/jpeg"}))
    await harness.drain()
    correct = harness.wa.of_kind("buttons")[-1].extra[1]
    await harness.webhook(_reply("wamid.K2", correct.id))
    await harness.drain()
    assert harness.wa.of_kind("text")[-1].text.startswith("✏️ Para corregir este gasto")
    # Un id de otro gasto (o inventado) no confirma que exista.
    await harness.webhook(_reply("wamid.K3", "exp_correct:00000000-0000-0000-0000-000000000000"))
    await harness.drain()
    assert harness.wa.of_kind("text")[-1].text.startswith("❌ No encontramos el gasto")


async def test_several_invoices_in_one_photo_create_several_expenses(harness: Harness) -> None:
    _, _, emp_h, _ = await _employee_with_advance(harness)
    harness.extractor.respond = lambda _r, _n: [
        invoice(),
        invoice(vendor_name="Taxi Libre", total=Decimal("12000"), subtotal=None, tax_amount=None, lines=()),
    ]
    harness.wa.media["MEDIA1"] = (make_jpeg(), "image/jpeg")
    await harness.webhook(
        wa_message("wamid.M", phone=PHONE, user_id=BSUID, type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"})
    )
    await harness.drain()
    expenses = await _expenses(harness, emp_h)
    assert sorted(e["total"] for e in expenses) == ["12000.00", "45000.00"]
    assert len({e["document_index"] for e in expenses}) == 2


async def test_blurry_photo_asks_to_resend_without_calling_the_ai(harness: Harness) -> None:
    _, _, emp_h, _ = await _employee_with_advance(harness)
    harness.wa.media["MEDIA1"] = (make_jpeg(blurry=True), "image/jpeg")
    await harness.webhook(
        wa_message("wamid.BL", phone=PHONE, user_id=BSUID, type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"})
    )
    await harness.drain()
    assert harness.extractor.calls == []
    assert [s.text for s in harness.wa.of_kind("reaction")][-1] == "❌"
    assert "borrosa" in harness.wa.of_kind("text")[-1].text
    assert (await _expenses(harness, emp_h))[0]["status"] == "unreadable"


async def test_unknown_number_gets_no_expense_and_a_contact_request(harness: Harness) -> None:
    harness.wa.media["MEDIA1"] = (make_jpeg(), "image/jpeg")
    await harness.webhook(
        wa_message("wamid.U1", user_id="CO.stranger", type="image", image={"id": "MEDIA1", "mime_type": "image/jpeg"})
    )
    await harness.drain()
    assert harness.wa.of_kind("request_contact_info")
    assert harness.extractor.calls == []
    async with harness.container.uow() as uow:
        assert await uow.expenses.get_by_wa_message_id("wamid.U1") is None


async def test_username_user_links_with_shared_contact(harness: Harness) -> None:
    _, employee, emp_h, _ = await _employee_with_advance(harness)
    payload = wa_message(
        "wamid.C1",
        user_id="CO.hidden",
        type="contacts",
        contacts=[{"origin": "contact_request", "phones": [{"phone": "+57 300 111 2233", "wa_id": PHONE}]}],
    )
    await harness.webhook(payload)
    await harness.drain()
    assert "quedó vinculado" in harness.wa.of_kind("text")[-1].text
    assert (await harness.client.get("/api/v1/me", headers=emp_h)).json()["wa_link_status"] == "active"


async def test_link_code_for_hidden_numbers(harness: Harness) -> None:
    _, employee, emp_h, _ = await _employee_with_advance(harness, phone=None)
    code = (await harness.client.post("/api/v1/me/whatsapp-link-code", headers=emp_h)).json()["code"]
    await harness.webhook(
        wa_message(
            "wamid.L1",
            user_id="CO.hidden",
            type="text",
            text={"body": "VINCULAR 000000" if code != "000000" else "VINCULAR 111111"},
        )
    )
    await harness.drain()
    assert "No pude vincular" in harness.wa.of_kind("text")[-1].text
    await harness.webhook(wa_message("wamid.L2", user_id="CO.hidden", type="text", text={"body": f"vincular {code}"}))
    await harness.drain()
    assert "quedó vinculado" in harness.wa.of_kind("text")[-1].text
    await harness.webhook(wa_message("wamid.L3", user_id="CO.hidden", type="text", text={"body": f"vincular {code}"}))
    await harness.drain()
    # Ya vinculado: el código es de un solo uso y ahora se reconoce al usuario (saludo y menú).
    assert harness.wa.of_kind("list")[-1].text.startswith("Hola Juan 👋")


async def test_welcome_confirmation_flow_and_user_id_update(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    headers = await harness.login(admin)
    created = await harness.client.post(
        "/api/v1/employees",
        headers=headers,
        json={"full_name": "Juan Técnico", "email": "juan@forsa.com", "company_ids": [str(company.id)], "phone": PHONE},
    )
    employee_id = created.json()["id"]
    await harness.drain()
    template = harness.wa.of_kind("template")[0]
    welcome_message_id = "wamid.out.1"

    # El estado de entrega trae el BSUID: queda pendiente hasta que el usuario confirme.
    await harness.webhook(wa_status(welcome_message_id, "delivered", PHONE, BSUID))
    await harness.drain()
    pending = (await harness.client.get(f"/api/v1/employees/{employee_id}", headers=headers)).json()
    assert pending["wa_link_status"] == "pending"

    # Si un extraño reenvía el payload desde otra cuenta, se rechaza.
    payload = template.extra["payloads"][0]
    await harness.webhook(wa_message("wamid.X", user_id="CO.attacker", type="button", button={"payload": payload, "text": "Sí"}))
    await harness.drain()
    assert (await harness.client.get(f"/api/v1/employees/{employee_id}", headers=headers)).json()["wa_link_status"] == "pending"

    await harness.webhook(
        wa_message("wamid.Y", user_id=BSUID, type="button", button={"payload": payload, "text": "Sí, soy Juan"})
    )
    await harness.drain()
    linked = (await harness.client.get(f"/api/v1/employees/{employee_id}", headers=headers)).json()
    assert linked["wa_link_status"] == "active" and linked["privacy_accepted_at"]

    # El usuario cambia de número: Meta regenera el BSUID y lo seguimos.
    await harness.webhook(
        wa_message("wamid.Z", user_id=BSUID, type="system", system={"type": "user_id_update", "user_id": "CO.new"})
    )
    await harness.drain()
    async with harness.container.uow() as uow:
        employee = await uow.employees.get_by_wa_user_id("CO.new")
    assert employee is not None and str(employee.id) == employee_id


async def test_approver_approves_from_whatsapp_but_not_their_own(harness: Harness) -> None:
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER, phone="573005550000", wa_user_id="CO.ana")
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver)
    emp_h = await harness.login(employee)
    advance = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "500000", "purpose": "Obra"},
    )
    advance_id = advance.json()["id"]
    await harness.drain()
    await harness.webhook(
        wa_message(
            "wamid.A1", user_id="CO.ana", type="button", button={"payload": f"adv_approve:{advance_id}", "text": "Aprobar"}
        )
    )
    await harness.drain()
    assert "aprobado" in harness.wa.of_kind("text")[-1].text
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()
    assert detail["status"] == "approved"

    # El empleado intenta aprobar su propio anticipo con una respuesta falsificada: se rechaza.
    await harness.add_employee(company, "x@forsa.com", Role.MANAGEMENT)
    own = await harness.client.post(
        "/api/v1/advances",
        headers=await harness.login(approver),
        json={"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "1000", "purpose": "Propio"},
    )
    await harness.webhook(
        wa_message(
            "wamid.A2", user_id="CO.ana", type="button", button={"payload": f"adv_approve:{own.json()['id']}", "text": "Aprobar"}
        )
    )
    await harness.drain()
    assert harness.wa.of_kind("text")[-1].text.startswith("❌ No puedes aprobar ni revisar tu propio anticipo")


async def test_whatsapp_flood_is_rate_limited(harness: Harness) -> None:
    await _employee_with_advance(harness)
    harness.container.bot._limits = type(harness.container.bot._limits)("2/minute", "60/minute", "5/hour", "3/hour", "1/minute")
    for index in range(3):
        harness.wa.media[f"F{index}"] = (make_jpeg(seed=index), "image/jpeg")
        await harness.webhook(
            wa_message(
                f"wamid.F{index}", phone=PHONE, user_id=BSUID, type="image", image={"id": f"F{index}", "mime_type": "image/jpeg"}
            )
        )
    await harness.drain()
    assert len(harness.extractor.calls) == 2
    assert any("Vas muy rápido" in t for t in harness.wa.texts())


async def test_without_an_approved_advance_an_invoice_is_not_registered_nor_read(harness: Harness) -> None:
    """Las facturas se legalizan contra un anticipo: sin uno aprobado no se guardan ni gastan IA."""
    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com", phone=PHONE)
    headers = await harness.login(employee)
    harness.wa.media["M1"] = (make_jpeg(), "image/jpeg")
    await harness.webhook(wa_message("wamid.NOADV", phone=PHONE, type="image", image={"id": "M1", "mime_type": "image/jpeg"}))
    await harness.drain()
    reply = harness.wa.of_kind("buttons")[-1]
    assert reply.text.startswith("📭 Todavía no tienes un anticipo aprobado")
    assert [(b.id, b.title) for b in reply.extra] == [("menu:request", "➕ Solicitar anticipo")]
    assert harness.wa.of_kind("reaction") == [] and harness.extractor.calls == []
    assert (await harness.client.get("/api/v1/expenses", headers=headers)).json()["data"] == []

    # Por la app tampoco.
    upload = await harness.client.post("/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    assert upload.status_code == 409 and upload.json()["error"]["code"] == "no_open_advance"
