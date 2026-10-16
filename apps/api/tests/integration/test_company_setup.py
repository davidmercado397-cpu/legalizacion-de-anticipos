from __future__ import annotations

from decimal import Decimal

from app.domain.enums import Role
from tests.conftest import Harness, wa_message
from tests.fakes import invoice, make_jpeg

PHONE = "573001112233"


async def test_a_new_company_takes_its_country_defaults(harness: Harness) -> None:
    holding = await harness.add_company()
    admin = await harness.add_employee(holding, "admin@forsa.com", Role.ADMIN)
    headers = await harness.login(admin)

    created = await harness.client.post(
        "/api/v1/companies",
        headers=headers,
        json={"name": "Forsa México", "country": "mx", "currency": "MXN", "legal_name": "Forsa de México S.A. de C.V."},
    )
    assert created.status_code == 201, created.text
    company = created.json()
    assert company["timezone"] == "America/Mexico_City" and company["generic_tax_id"] == "XAXX010101000"
    assert company["legal_name"] == "Forsa de México S.A. de C.V."
    assert company["deductibility"]["cash_receipt"] == "requires_support_document"
    categories = (await harness.client.get(f"/api/v1/companies/{company['id']}/categories", headers=headers)).json()["data"]
    assert [c["code"] for c in categories][:2] == ["lodging", "meals"] and categories[0]["emoji"] == "🏨"

    unknown_country = await harness.client.post(
        "/api/v1/companies", headers=headers, json={"name": "Forsa Chile", "country": "CL", "currency": "USD"}
    )
    assert unknown_country.status_code == 422 and unknown_country.json()["error"]["code"] == "unknown_country"
    with_zone = await harness.client.post(
        "/api/v1/companies",
        headers=headers,
        json={"name": "Forsa Chile", "country": "CL", "currency": "USD", "timezone": "America/Santiago"},
    )
    assert with_zone.status_code == 201 and with_zone.json()["timezone"] == "America/Santiago"
    bad_zone = await harness.client.patch(
        f"/api/v1/companies/{company['id']}", headers=headers, json={"timezone": "Mars/Olympus"}
    )
    assert bad_zone.status_code == 422 and bad_zone.json()["error"]["code"] == "invalid_timezone"
    bad_currency = await harness.client.post(
        "/api/v1/companies", headers=headers, json={"name": "Forsa Perú", "country": "PE", "currency": "PEN"}
    )
    assert bad_currency.json()["error"]["code"] == "unsupported_currency"
    assert "COP" in bad_currency.json()["error"]["message"]


async def test_accounting_manages_categories_and_corrections_must_use_active_ones(harness: Harness) -> None:
    company = await harness.add_company()
    accountant = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    employee = await harness.add_employee(company, "juan@forsa.com")
    acc_h, emp_h = await harness.login(accountant), await harness.login(employee)
    base = f"/api/v1/companies/{company.id}/categories"

    added = await harness.client.post(
        base, headers=acc_h, json={"code": "parking", "name": "Parqueadero", "emoji": "🅿️", "accounting_account": "523550"}
    )
    assert added.status_code == 201
    assert (await harness.client.post(base, headers=acc_h, json={"code": "parking", "name": "Otro"})).status_code == 409
    assert (await harness.client.post(base, headers=emp_h, json={"code": "spa", "name": "Spa"})).status_code == 403

    upload = await harness.client.post("/api/v1/expenses", headers=emp_h, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    expense_id = upload.json()["id"]
    assert (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=emp_h)).json()["category"] == "meals"

    ok = await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=emp_h, json={"category": "parking"})
    assert ok.status_code == 200 and ok.json()["category"] == "parking"
    await harness.client.patch(f"{base}/{added.json()['id']}", headers=acc_h, json={"active": False})
    rejected = await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=emp_h, json={"category": "parking"})
    assert rejected.status_code == 422 and rejected.json()["error"]["code"] == "unknown_category"
    assert (await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=emp_h, json={"currency": "JPY"})).json()[
        "error"
    ]["code"] == "unsupported_currency"

    # Corregir el desglose de impuestos recalcula el total de impuestos.
    taxes = [{"type": "iva", "rate": "19", "base": "30000", "amount": "5700"}, {"type": "inc", "rate": "8", "amount": "2400"}]
    fixed = await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=emp_h, json={"taxes": taxes})
    assert fixed.status_code == 200 and Decimal(fixed.json()["tax_amount"]) == Decimal("8100")
    assert [t["type"] for t in fixed.json()["taxes"]] == ["iva", "inc"]

    # La IA no puede inventar categorías: una que no existe en la compañía queda vacía.
    harness.extractor.respond = lambda _r, _n: [invoice(category="spa", invoice_number="POS-9")]
    second = await harness.client.post(
        "/api/v1/expenses", headers=emp_h, files={"file": ("g.jpg", make_jpeg(seed=2), "image/jpeg")}
    )
    await harness.drain()
    assert (await harness.client.get(f"/api/v1/expenses/{second.json()['id']}", headers=emp_h)).json()["category"] is None
    prompt_categories = {c.code for c in harness.extractor.calls[-1].context.categories}
    assert "parking" not in prompt_categories and "meals" in prompt_categories


async def test_unsupported_currency_on_an_advance_is_rejected(harness: Harness) -> None:
    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com")
    response = await harness.client.post(
        "/api/v1/advances",
        headers=await harness.login(employee),
        json={"company_id": str(company.id), "kind": "cash", "currency": "JPY", "amount": "1000", "purpose": "Viaje"},
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == "unsupported_currency"


async def test_a_selfie_gets_a_clear_message_and_no_escalation(harness: Harness) -> None:
    company = await harness.add_company()
    await harness.add_employee(company, "juan@forsa.com", phone=PHONE)
    harness.extractor.respond = lambda _r, _n: [invoice(is_receipt=False, total=None, confidence=0.2)]
    harness.wa.media["SELFIE"] = (make_jpeg(), "image/jpeg")
    await harness.webhook(wa_message("wamid.S1", phone=PHONE, type="image", image={"id": "SELFIE", "mime_type": "image/jpeg"}))
    await harness.drain()
    assert len(harness.extractor.calls) == 1
    assert any("no parece una factura" in text for text in harness.wa.texts())
