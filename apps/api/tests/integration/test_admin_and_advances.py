from __future__ import annotations

from decimal import Decimal

from app.domain.enums import Role
from tests.conftest import Harness


async def test_user_crud_with_uniqueness_and_welcome(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    headers = await harness.login(admin)

    body = {
        "full_name": "Juan Técnico",
        "email": "Juan@Forsa.com",
        "role": "employee",
        "company_ids": [str(company.id)],
        "phone": "+57 300 111 2233",
        "approver_id": str(approver.id),
    }
    created = await harness.client.post("/api/v1/employees", headers=headers, json=body)
    assert created.status_code == 201, created.text
    data = created.json()
    assert data["email"] == "juan@forsa.com" and data["phone"] == "573001112233"
    assert data["temporary_password"] and data["must_change_password"] is True
    await harness.drain()
    welcome = harness.wa.of_kind("template")
    assert welcome and welcome[0].text == "bienvenida" and welcome[0].extra["payloads"][0].startswith("link_confirm:")

    dup_phone = await harness.client.post("/api/v1/employees", headers=headers, json={**body, "email": "otro@forsa.com"})
    assert dup_phone.status_code == 409
    dup_email = await harness.client.post("/api/v1/employees", headers=headers, json={**body, "phone": None})
    assert dup_email.status_code == 409

    listed = await harness.client.get("/api/v1/employees", headers=headers, params={"search": "juan"})
    assert [e["email"] for e in listed.json()["data"]] == ["juan@forsa.com"]

    patched = await harness.client.patch(f"/api/v1/employees/{data['id']}", headers=headers, json={"role": "approver"})
    assert patched.status_code == 200 and patched.json()["role"] == "approver"

    self_demote = await harness.client.post(f"/api/v1/employees/{admin.id}/deactivate", headers=headers)
    assert self_demote.status_code == 409

    audit = await harness.client.get("/api/v1/audit", headers=headers, params={"entity_type": "employee"})
    assert {"user_created", "user_updated"} <= {e["action"] for e in audit.json()["data"]}


async def test_advance_flow_with_segregation_of_duties(harness: Harness) -> None:
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER, phone="573005550000", wa_user_id="CO.ana")
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver)
    other = await harness.add_employee(company, "pedro@forsa.com")
    emp_h, appr_h, other_h = await harness.login(employee), await harness.login(approver), await harness.login(other)

    requested = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={
            "company_id": str(company.id),
            "kind": "cash",
            "currency": "COP",
            "amount": "800000",
            "purpose": "Obra Medellín",
            "destination": "Medellín",
            "start_date": "2026-10-12",
            "end_date": "2026-10-15",
        },
    )
    assert requested.status_code == 201, requested.text
    advance_id = requested.json()["id"]
    await harness.drain()
    template = harness.wa.of_kind("template")[-1]
    assert template.text == "aprobacion_anticipo" and template.extra["payloads"] == [
        f"adv_approve:{advance_id}",
        f"adv_reject:{advance_id}",
    ]

    # Quien solicita no puede aprobar (su rol no tiene el permiso) y otro empleado ni siquiera lo ve.
    assert (await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=emp_h)).status_code == 403
    assert (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=other_h)).status_code == 404

    approved = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=appr_h)
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    again = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=appr_h)
    assert again.status_code == 409

    balances = (await harness.client.get("/api/v1/me/balances", headers=emp_h)).json()["data"]
    assert balances[0]["balance"]["pending"] == "800000.00"

    # Un aprobador tampoco puede aprobar su propio anticipo (sin jefe, lo aprueba la gerencia).
    await harness.add_employee(company, "gerencia@forsa.com", Role.MANAGEMENT)
    own = await harness.client.post(
        "/api/v1/advances",
        headers=appr_h,
        json={"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "100000", "purpose": "Visita"},
    )
    assert (await harness.client.post(f"/api/v1/advances/{own.json()['id']}/approve", headers=appr_h)).status_code == 403


async def test_expense_upload_confirm_and_balance(harness: Harness) -> None:
    from tests.fakes import make_jpeg

    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver)
    other = await harness.add_employee(company, "pedro@forsa.com")
    emp_h, appr_h = await harness.login(employee), await harness.login(approver)
    advance = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "800000", "purpose": "Obra"},
    )
    await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/approve", headers=appr_h)

    fake = await harness.client.post(
        "/api/v1/expenses", headers=emp_h, files={"file": ("x.jpg", b"<html>not an image</html>", "image/jpeg")}
    )
    assert fake.status_code == 422  # el tipo se valida por el contenido, no por el declarado

    photo = make_jpeg()
    upload = await harness.client.post(
        "/api/v1/expenses", headers=emp_h, files={"file": ("f.jpg", photo, "image/jpeg")}, data={"client_ref": "offline-1"}
    )
    assert upload.status_code == 202 and upload.json()["status"] == "received"
    expense_id = upload.json()["id"]
    retry = await harness.client.post(
        "/api/v1/expenses", headers=emp_h, files={"file": ("f.jpg", photo, "image/jpeg")}, data={"client_ref": "offline-1"}
    )
    assert retry.status_code == 200 and retry.json()["id"] == expense_id  # reintento de la cola offline, sin duplicar

    await harness.drain()
    expense = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=emp_h)).json()
    assert expense["status"] == "extracted" and expense["total"] == "45000.00"
    assert expense["advance_id"] == advance.json()["id"]  # el único anticipo abierto se asigna solo

    other_h = await harness.login(other)
    assert (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=other_h)).status_code == 404
    assert (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=appr_h)).status_code == 200
    assert (await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=appr_h, json={})).status_code == 403

    file = await harness.client.get(f"/api/v1/expenses/{expense_id}/file", headers=emp_h, follow_redirects=False)
    assert file.status_code == 307 and file.headers["location"].startswith("https://r2.example/")

    corrected = await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=emp_h, json={"vendor_name": "El Cielo SAS"})
    assert corrected.json()["vendor_name"] == "El Cielo SAS"
    confirmed = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=emp_h, json={})
    assert confirmed.status_code == 200 and confirmed.json()["amount_applied"] == "45000.00"

    detail = (await harness.client.get(f"/api/v1/advances/{advance.json()['id']}", headers=emp_h)).json()
    assert Decimal(detail["balance"]["pending"]) == Decimal("755000")

    changed = await harness.client.get(
        "/api/v1/expenses", headers=emp_h, params={"updated_since": confirmed.json()["updated_at"]}
    )
    assert changed.json() == {"data": [], "pagination": {"limit": 50, "offset": 0, "total": 0}}


async def test_failed_reads_are_retried_by_the_sweeper(harness: Harness) -> None:
    from tests.fakes import make_jpeg

    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com")
    headers = await harness.login(employee)
    harness.extractor.fail_times = 1
    upload = await harness.client.post("/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    expense_id = upload.json()["id"]
    first = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=headers)).json()
    assert first["status"] == "received" and first["last_error"]

    harness.container.sweeper._stale = __import__("datetime").timedelta(seconds=-1)
    assert await harness.container.sweeper.run_once() == 1
    await harness.drain()
    second = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=headers)).json()
    assert second["status"] == "extracted"


async def test_without_ai_configured_an_uploaded_invoice_goes_straight_to_manual_entry(harness: Harness) -> None:
    from app.domain.errors import ServiceNotConfiguredError
    from tests.fakes import make_jpeg

    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com")
    headers = await harness.login(employee)

    def unconfigured(_request: object, _call: int) -> list[object]:
        raise ServiceNotConfiguredError("openrouter")

    harness.extractor.respond = unconfigured  # type: ignore[assignment]
    upload = await harness.client.post("/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    expense = (await harness.client.get(f"/api/v1/expenses/{upload.json()['id']}", headers=headers)).json()
    # Reintentar no sirve: queda para completar a mano, con la foto guardada.
    assert expense["status"] == "failed" and expense["file"] is not None


async def test_an_invoice_waiting_for_a_retry_can_be_discarded_and_stays_discarded(harness: Harness) -> None:
    from datetime import timedelta

    from tests.fakes import make_jpeg

    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com")
    headers = await harness.login(employee)
    harness.extractor.fail_times = 1
    upload = await harness.client.post("/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    expense_id = upload.json()["id"]

    discarded = await harness.client.post(f"/api/v1/expenses/{expense_id}/discard", headers=headers)
    assert discarded.status_code == 200 and discarded.json()["status"] == "discarded"
    # El barrido ya no la reintenta.
    harness.container.sweeper._stale = timedelta(seconds=-1)
    assert await harness.container.sweeper.run_once() == 0


async def test_discarding_while_the_ai_reads_is_not_undone_by_the_reading(harness: Harness) -> None:
    from tests.fakes import make_jpeg

    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com")
    headers = await harness.login(employee)
    read = harness.extractor.extract

    async def discard_meanwhile(request):  # type: ignore[no-untyped-def]
        listed = (await harness.client.get("/api/v1/expenses", headers=headers)).json()["data"]
        await harness.client.post(f"/api/v1/expenses/{listed[0]['id']}/discard", headers=headers)
        return await read(request)

    harness.extractor.extract = discard_meanwhile  # type: ignore[method-assign]
    upload = await harness.client.post("/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    expense = (await harness.client.get(f"/api/v1/expenses/{upload.json()['id']}", headers=headers)).json()
    assert expense["status"] == "discarded"
