from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import sqlalchemy as sa

from app.domain.enums import Role
from tests.conftest import Harness, wa_message
from tests.fakes import invoice, make_jpeg

PHONE = "573001112233"


async def _advance(harness: Harness, **extra: Any):  # type: ignore[no-untyped-def]
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    accountant = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver, phone=PHONE)
    emp_h, appr_h, acc_h = await harness.login(employee), await harness.login(approver), await harness.login(accountant)
    created = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={
            "company_id": str(company.id),
            "kind": "cash",
            "currency": "COP",
            "amount": "500000",
            "purpose": "Obra Medellín",
            "destination": "Medellín",
            "start_date": "2026-10-12",
            "end_date": "2026-10-15",
            **extra,
        },
    )
    return company, employee, approver, emp_h, appr_h, acc_h, created.json()["id"]


async def _approved(harness: Harness):  # type: ignore[no-untyped-def]
    data = await _advance(harness)
    await harness.client.post(f"/api/v1/advances/{data[-1]}/approve", headers=data[4])
    return data


async def _confirmed_expense(harness: Harness, headers: dict[str, str], seed: int = 1, total: str = "45000") -> str:
    harness.extractor.respond = lambda _r, _n: [invoice(total=Decimal(total), invoice_number=f"POS-{seed}")]
    upload = await harness.client.post(
        "/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(seed=seed), "image/jpeg")}
    )
    await harness.drain()
    expense_id = upload.json()["id"]
    confirmed = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=headers, json={})
    assert confirmed.status_code == 200, confirmed.text
    return expense_id


async def test_detail_has_photo_lines_and_local_dates_without_extra_queries(harness: Harness) -> None:
    _, employee, _, emp_h, appr_h, _, advance_id = await _approved(harness)
    sent = datetime(2026, 10, 14, 2, 47, tzinfo=UTC)  # 21:47 del 13 en Bogotá
    harness.wa.media["M1"] = (make_jpeg(), "image/jpeg")
    message = wa_message("wamid.D1", phone=PHONE, type="image", image={"id": "M1", "mime_type": "image/jpeg"})
    message["entry"][0]["changes"][0]["value"]["messages"][0]["timestamp"] = str(int(sent.timestamp()))
    await harness.webhook(message)
    await harness.drain()
    expense_id = (await harness.client.get("/api/v1/expenses", headers=emp_h)).json()["data"][0]["id"]
    await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=emp_h, json={})

    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=appr_h)).json()
    assert detail["company_timezone"] == "America/Bogota" and detail["employee"]["full_name"] == employee.full_name
    item = detail["expenses"][0]
    assert item["file"]["url"].startswith("https://r2.example/expenses/") and ".thumb.jpg?" in item["file"]["thumbnail_url"]
    assert item["file"]["mime_type"] == "image/jpeg" and item["file"]["expires_at"]
    assert item["lines"][0]["description"] == "Almuerzo ejecutivo"
    assert item["reported_at"] == "2026-10-13T21:47:00-05:00" and item["source"] == "whatsapp"
    assert item["confirmed_at"].endswith("-05:00") and item["confirmed_by"] == str(employee.id)
    assert detail["approved_at"].endswith("-05:00")
    assert any(key.endswith(".thumb.jpg") for key in harness.storage.files)

    # La cantidad de consultas no crece con la cantidad de gastos (sin N+1).
    async def queries() -> int:
        count = 0

        def counter(*_args: object) -> None:
            nonlocal count
            count += 1

        sa.event.listen(harness.container.engine.sync_engine, "before_cursor_execute", counter)
        await harness.client.get(f"/api/v1/advances/{advance_id}", headers=appr_h)
        sa.event.remove(harness.container.engine.sync_engine, "before_cursor_execute", counter)
        return count

    one = await queries()
    for seed in (2, 3):
        await _confirmed_expense(harness, emp_h, seed, total=str(40000 + seed * 1000))
    assert await queries() == one

    outsider = await harness.add_employee(await harness.add_company("Forsa Panamá", "PA", "USD"), "otro@forsa.com")
    assert (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=await harness.login(outsider))).status_code == 404


async def test_timeline_cancel_void_and_reopen(harness: Harness) -> None:
    _, _, _, emp_h, appr_h, acc_h, advance_id = await _advance(harness)
    # Una solicitud sin aprobar se puede cancelar; aprobada ya no.
    second = (await _advance_again(harness, emp_h)).json()["id"]
    assert (await harness.client.delete(f"/api/v1/advances/{second}", headers=emp_h)).json()["status"] == "cancelled"
    await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=appr_h)
    blocked = await harness.client.delete(f"/api/v1/advances/{advance_id}", headers=emp_h)
    assert blocked.status_code == 409 and "cancelar" in blocked.json()["error"]["message"]

    # Anular: solo contabilidad, con nota, y sin gastos aplicados.
    assert (
        await harness.client.post(f"/api/v1/advances/{advance_id}/void", headers=emp_h, json={"note": "x" * 5})
    ).status_code == 403
    expense_id = await _confirmed_expense(harness, emp_h)
    with_expenses = await harness.client.post(f"/api/v1/advances/{advance_id}/void", headers=acc_h, json={"note": "Se canceló"})
    assert with_expenses.json()["error"]["code"] == "advance_has_expenses"

    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=emp_h)
    # La legalización la cierra contabilidad; el jefe solo aprueba la solicitud.
    assert (await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=appr_h)).status_code == 403
    await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=acc_h)
    no_note = await harness.client.post(f"/api/v1/advances/{advance_id}/reopen", headers=acc_h, json={"note": ""})
    assert no_note.status_code == 422
    reopened = await harness.client.post(
        f"/api/v1/advances/{advance_id}/reopen", headers=acc_h, json={"note": "Faltó una factura"}
    )
    assert reopened.json()["status"] == "in_review" and reopened.json()["closed_at"] is None

    timeline = (await harness.client.get(f"/api/v1/advances/{advance_id}/timeline", headers=emp_h)).json()["data"]
    labels = [e["label"] for e in timeline]
    assert "Creado en Siesa" in labels  # lo agrega el envío en segundo plano al aprobarse
    timeline = [e for e in timeline if "Siesa" not in e["label"]]
    assert [e["label"] for e in timeline] == [
        "Solicitado",
        "Aprobado",
        "Enviado a revisión",
        "Legalización aprobada",
        "Reabierto",
    ]
    assert timeline[1]["actor_name"] == "Ana Pérez" and timeline[-1]["note"] == "Faltó una factura"
    assert timeline[0]["at"].endswith("-05:00")
    assert expense_id


async def _advance_again(harness: Harness, headers: dict[str, str]):  # type: ignore[no-untyped-def]
    company_id = (await harness.client.get("/api/v1/me", headers=headers)).json()["company_ids"][0]
    return await harness.client.post(
        "/api/v1/advances",
        headers=headers,
        json={"company_id": company_id, "kind": "cash", "currency": "COP", "amount": "100000", "purpose": "Otro viaje"},
    )


async def test_void_keeps_unconfirmed_expenses_without_an_advance(harness: Harness) -> None:
    _, _, _, emp_h, _, acc_h, advance_id = await _approved(harness)
    upload = await harness.client.post("/api/v1/expenses", headers=emp_h, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    voided = await harness.client.post(f"/api/v1/advances/{advance_id}/void", headers=acc_h, json={"note": "Viaje cancelado"})
    assert voided.json()["status"] == "voided"
    expense = (await harness.client.get(f"/api/v1/expenses/{upload.json()['id']}", headers=emp_h)).json()
    assert expense["advance_id"] is None and expense["status"] == "extracted"


async def test_treasury_disburses_and_settles_the_difference(harness: Harness) -> None:
    company, _, _, emp_h, appr_h, acc_h, advance_id = await _approved(harness)
    treasurer = await harness.add_employee(company, "tesoreria@forsa.com", Role.TREASURY)
    tre_h = await harness.login(treasurer)
    pending = await harness.client.get("/api/v1/advances", headers=tre_h, params={"status": "approved", "disbursed": "false"})
    assert [a["id"] for a in pending.json()["data"]] == [advance_id]
    assert pending.json()["data"][0]["employee_name"]  # los listados dicen de quién es cada anticipo
    # Desembolsa tesorería: ni el jefe ni contabilidad.
    for headers in (appr_h, acc_h):
        denied = await harness.client.post(f"/api/v1/advances/{advance_id}/disburse", headers=headers, json={"method": "cash"})
        assert denied.status_code == 403
    paid = await harness.client.post(
        f"/api/v1/advances/{advance_id}/disburse", headers=tre_h, json={"method": "transfer", "reference": "TRX-991"}
    )
    assert paid.json()["disbursement_method"] == "transfer" and paid.json()["disbursed_at"]
    again = await harness.client.post(f"/api/v1/advances/{advance_id}/disburse", headers=tre_h, json={"method": "cash"})
    assert again.json()["error"]["code"] == "advance_already_disbursed"
    balance = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()["balance"]
    assert Decimal(balance["disbursed"]) == Decimal("500000")

    await _confirmed_expense(harness, emp_h, total="45000")
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=emp_h)
    closed = await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=acc_h)
    assert closed.json()["settlement_status"] == "refund_pending"
    # Tesorería no cierra legalizaciones.
    assert (
        await harness.client.post(f"/api/v1/advances/{advance_id}/reopen", headers=tre_h, json={"note": "Cerrada por error"})
    ).status_code == 403
    to_settle = await harness.client.get("/api/v1/advances", headers=tre_h, params={"settlement": "pending"})
    assert [a["id"] for a in to_settle.json()["data"]] == [advance_id]
    wrong = await harness.client.post(f"/api/v1/advances/{advance_id}/settle", headers=tre_h, json={"method": "payment"})
    assert wrong.status_code == 409 and "reintegro pendiente" in wrong.json()["error"]["message"]
    assert (
        await harness.client.post(f"/api/v1/advances/{advance_id}/settle", headers=acc_h, json={"method": "refund"})
    ).status_code == 403
    settled = await harness.client.post(
        f"/api/v1/advances/{advance_id}/settle", headers=tre_h, json={"method": "payroll_deduction", "reference": "Nómina oct"}
    )
    assert settled.json()["settlement_status"] == "payroll_deducted"
    late = await harness.client.post(f"/api/v1/advances/{advance_id}/reopen", headers=acc_h, json={"note": "Error"})
    assert late.json()["error"]["code"] == "advance_already_settled"


async def test_a_substitute_approves_only_while_the_delegation_lasts(harness: Harness) -> None:
    company, employee, approver, emp_h, _, acc_h, advance_id = await _advance(harness)
    substitute = await harness.add_employee(company, "carlos@forsa.com", Role.APPROVER)
    sub_h = await harness.login(substitute)
    assert (await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=sub_h)).status_code == 404

    now = datetime.now(UTC)
    bad = await harness.client.post(
        f"/api/v1/employees/{approver.id}/delegations",
        headers=acc_h,
        json={"delegate_id": str(employee.id), "starts_at": now.isoformat(), "ends_at": (now + timedelta(days=5)).isoformat()},
    )
    assert bad.json()["error"]["code"] == "invalid_delegation"  # un empleado no puede ser suplente
    created = await harness.client.post(
        f"/api/v1/employees/{approver.id}/delegations",
        headers=acc_h,
        json={
            "delegate_id": str(substitute.id),
            "starts_at": (now - timedelta(hours=1)).isoformat(),
            "ends_at": (now + timedelta(days=5)).isoformat(),
        },
    )
    assert created.status_code == 201
    listed = await harness.client.get("/api/v1/advances", headers=sub_h)
    assert [a["id"] for a in listed.json()["data"]] == [advance_id]
    approved = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=sub_h)
    assert approved.status_code == 200 and approved.json()["approved_by"] == str(substitute.id)
    audit = await harness.client.get(
        "/api/v1/audit",
        headers=await harness.login(await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)),
        params={"action": "advance_approve"},
    )
    assert audit.json()["data"][0]["data"]["on_behalf_of"] == str(approver.id)

    await harness.client.delete(f"/api/v1/employees/{approver.id}/delegations/{created.json()['id']}", headers=acc_h)
    later = (await _advance_again(harness, emp_h)).json()["id"]
    assert (await harness.client.post(f"/api/v1/advances/{later}/approve", headers=sub_h)).status_code == 404
    history = await harness.client.get(f"/api/v1/employees/{approver.id}/delegations", headers=acc_h)
    assert history.json()["data"][0]["revoked_at"] is not None


async def test_return_with_marked_expenses_and_suggestions(harness: Harness) -> None:
    _, _, _, emp_h, _, acc_h, advance_id = await _approved(harness)
    harness.extractor.respond = lambda _r, _n: [invoice(invoice_date=datetime(2026, 9, 1).date(), invoice_number="POS-OLD")]
    upload = await harness.client.post(
        "/api/v1/expenses", headers=emp_h, files={"file": ("f.jpg", make_jpeg(seed=4), "image/jpeg")}
    )
    await harness.drain()
    flagged = upload.json()["id"]
    await harness.client.post(f"/api/v1/expenses/{flagged}/confirm", headers=emp_h, json={"justification": "Compra previa"})
    clean = await _confirmed_expense(harness, emp_h, seed=5)
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=emp_h)

    suggestions = (await harness.client.get(f"/api/v1/advances/{advance_id}/return-suggestions", headers=acc_h)).json()["data"]
    assert [s["expense_id"] for s in suggestions] == [flagged] and "fuera del viaje" in suggestions[0]["note"]

    returned = await harness.client.post(
        f"/api/v1/advances/{advance_id}/return",
        headers=acc_h,
        json={"note": "Revisa lo marcado", "items": [{"expense_id": flagged, "note": "¿Por qué antes del viaje?"}]},
    )
    assert returned.json()["status"] == "approved" and returned.json()["returned_at"]
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()
    marks = {e["id"]: e["return_note"] for e in detail["expenses"]}
    assert marks[flagged] == "¿Por qué antes del viaje?" and marks[clean] is None

    await harness.client.patch(f"/api/v1/expenses/{flagged}", headers=emp_h, json={"description": "Tiquete comprado antes"})
    fixed = (await harness.client.get(f"/api/v1/expenses/{flagged}", headers=emp_h)).json()
    assert fixed["return_resolved_at"] is not None


async def test_contact_data_of_a_retired_user_can_be_erased(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    retired = await harness.add_employee(company, "juan@forsa.com", phone=PHONE, wa_user_id="CO.123")
    headers = await harness.login(admin)
    active = await harness.client.post(f"/api/v1/employees/{retired.id}/anonymize-contact", headers=headers)
    assert active.json()["error"]["code"] == "anonymize_active_user"
    await harness.client.post(f"/api/v1/employees/{retired.id}/deactivate", headers=headers)
    erased = await harness.client.post(f"/api/v1/employees/{retired.id}/anonymize-contact", headers=headers)
    assert erased.json()["phone"] is None and erased.json()["wa_link_status"] == "none"
