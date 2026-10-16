"""Conciliación con el extracto bancario (decisiones 7.1 a 7.9), de punta a punta con PostgreSQL real."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from app.domain.enums import Role
from app.domain.ports import StatementTable
from tests.conftest import Harness
from tests.fakes import invoice, make_jpeg

STATEMENT = (
    "BANCO DE PRUEBA S.A.\n"
    "Fecha;Descripción;Valor\n"
    "12/10/2026;HOTEL DANN CARLTON;-303.000\n"
    "13/10/2026;REST EL CIELO MEDELLIN;-85.000\n"
    "14/10/2026;UBER *TRIP;-20.000\n"
    "15/10/2026;ABONO;50.000\n"
    "25/10/2026;NETFLIX.COM;-40.000\n"
).encode()


async def _scenario(harness: Harness) -> dict[str, Any]:
    company = await harness.add_company()
    boss = await harness.add_employee(company, "jefe@forsa.com", Role.APPROVER)
    traveler = await harness.add_employee(company, "juan@forsa.com", approver=boss)
    accounting = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    treasury = await harness.add_employee(company, "teso@forsa.com", Role.TREASURY)
    h = {k: await harness.login(e) for k, e in (("boss", boss), ("emp", traveler), ("acc", accounting), ("tre", treasury))}
    body = {
        "company_id": str(company.id),
        "kind": "reloadable_card",
        "currency": "COP",
        "amount": "1000000",
        "purpose": "Obra Medellín",
        "start_date": "2026-10-12",
        "end_date": "2026-10-15",
    }
    advance_id = (await harness.client.post("/api/v1/advances", headers=h["emp"], json=body)).json()["id"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=h["boss"])
    expenses = {}
    for seed, (name, vendor, day, total, method) in enumerate(
        [
            ("hotel", "Hotel Dann", 12, "300000", None),
            ("lunch", "Restaurante El Cielo", 13, "85000", None),
            ("dinner", "Parrilla La Brasa", 13, "40000", None),
            ("taxi", "Taxi Libre", 14, "20000", "cash"),
        ],
        start=1,
    ):
        expenses[name] = await _expense(harness, h["emp"], advance_id, seed, vendor, date(2026, 10, day), total, method)
    return {"h": h, "advance_id": advance_id, "expenses": expenses, "company": company}


async def _expense(
    harness: Harness, headers: dict[str, str], advance_id: str, seed: int, vendor: str, day: date, total: str, method: str | None
) -> str:
    harness.extractor.respond = lambda _r, _n: [
        invoice(
            vendor_name=vendor, invoice_number=f"F-{seed}", invoice_date=day, total=Decimal(total), subtotal=None, tax_amount=None
        )
    ]
    upload = await harness.client.post(
        "/api/v1/expenses",
        headers=headers,
        files={"file": ("f.jpg", make_jpeg(seed=seed), "image/jpeg")},
        data={"advance_id": advance_id},
    )
    await harness.drain()
    expense_id: str = upload.json()["id"]
    if method:
        await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=headers, json={"payment_method": method})
    confirmed = await harness.client.post(
        f"/api/v1/expenses/{expense_id}/confirm", headers=headers, json={"advance_id": advance_id}
    )
    assert confirmed.status_code == 200, confirmed.text
    return expense_id


async def _upload(
    harness: Harness, headers: dict[str, str], advance_id: str, content: bytes = STATEMENT, name: str = "extracto.csv"
):  # type: ignore[no-untyped-def]
    return await harness.client.post(
        f"/api/v1/advances/{advance_id}/statements", headers=headers, files={"file": (name, content, "text/csv")}
    )


def _movement(statement: dict[str, Any], description: str) -> dict[str, Any]:
    return next(m for m in statement["movements"] if m["description"] == description)


async def _expense_json(harness: Harness, headers: dict[str, str], expense_id: str) -> dict[str, Any]:
    response: dict[str, Any] = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=headers)).json()
    return response


async def test_treasury_loads_the_statement_and_accounting_resolves_it_before_closing(harness: Harness) -> None:
    s = await _scenario(harness)
    h, advance_id, expenses = s["h"], s["advance_id"], s["expenses"]

    # 7.1: el extracto se carga cuando la legalización ya está enviada, y lo carga tesorería.
    early = await _upload(harness, h["tre"], advance_id)
    assert early.status_code == 409 and early.json()["error"]["code"] == "statement_legalization_not_sent"
    assert (await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=h["emp"])).status_code == 200
    assert (await _upload(harness, h["acc"], advance_id)).status_code == 403

    preview = await harness.client.post(
        f"/api/v1/advances/{advance_id}/statements/preview",
        headers=h["tre"],
        files={"file": ("extracto.csv", STATEMENT, "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["confident"] and preview.json()["charges"] == 4 and preview.json()["credits"] == 1

    loaded = await _upload(harness, h["tre"], advance_id)
    assert loaded.status_code == 201, loaded.text
    statement = loaded.json()
    assert (await _upload(harness, h["tre"], advance_id)).json()["error"]["code"] == "statement_already_loaded"

    # 7.3/7.4: el mismo valor el mismo día se cruza solo; el hotel con 1 % de diferencia queda sugerido.
    lunch_charge = _movement(statement, "REST EL CIELO MEDELLIN")
    hotel_charge = _movement(statement, "HOTEL DANN CARLTON")
    uber, netflix = _movement(statement, "UBER *TRIP"), _movement(statement, "NETFLIX.COM")
    assert lunch_charge["expense_id"] == expenses["lunch"] and lunch_charge["match_status"] == "auto"
    assert hotel_charge["expense_id"] == expenses["hotel"] and hotel_charge["match_status"] == "suggested"
    assert uber["expense_id"] is None and uber["needs_decision"]  # el taxi se pagó en efectivo
    assert not netflix["in_trip"] and not netflix["needs_decision"]  # fuera del viaje: no es de esta legalización

    lunch = await _expense_json(harness, h["emp"], expenses["lunch"])
    assert lunch["bank_status"] == "matched" and lunch["bank_amount"] == "85000.00"
    # 7.7: la cena se pagó con tarjeta y el extracto no trae el cargo: alerta a contabilidad.
    assert (await _expense_json(harness, h["emp"], expenses["dinner"]))["bank_status"] == "no_charge"

    # No se cierra con la sugerencia y el cargo sin factura pendientes.
    blocked = await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=h["acc"])
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "unresolved_bank_items"
    assert "2 movimientos" in blocked.json()["error"]["message"]

    url = f"/api/v1/statements/{statement['id']}/movements"
    assert (await harness.client.post(f"{url}/{hotel_charge['id']}/confirm", headers=h["tre"])).status_code == 403
    confirmed = await harness.client.post(f"{url}/{hotel_charge['id']}/confirm", headers=h["acc"])
    assert _movement(confirmed.json(), "HOTEL DANN CARLTON")["match_status"] == "confirmed"
    # 7.8: se legaliza el valor cobrado en el extracto.
    hotel = await _expense_json(harness, h["emp"], expenses["hotel"])
    assert (hotel["amount_applied"], hotel["amount_before_bank"]) == ("303000.00", "300000.00")

    # 7.6: contabilidad decide el cargo sin factura. Si la empresa lo asume, cuenta como legalizado.
    absorbed = await harness.client.post(f"{url}/{uber['id']}/decision", headers=h["acc"], json={"decision": "absorb"})
    assert _movement(absorbed.json(), "UBER *TRIP")["charge_decision"] == "absorb"
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=h["acc"])).json()
    bank_expense = next(e for e in detail["expenses"] if e["source"] == "bank" and e["status"] == "confirmed")
    assert bank_expense["total"] == "20000.00" and bank_expense["deductibility"] == "non_deductible"
    # 303.000 + 85.000 + 40.000 (cena por factura) + 20.000 (taxi en efectivo) + 20.000 (Uber asumido)
    assert Decimal(detail["balance"]["applied"]) == Decimal("468000")

    # Cambiar a descontarlo: el gasto que lo representaba se descarta y queda en lo que debe reintegrar.
    await harness.client.post(f"{url}/{uber['id']}/decision", headers=h["acc"], json={"decision": "discount"})
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=h["acc"])).json()
    assert Decimal(detail["balance"]["applied"]) == Decimal("448000")
    assert not [e for e in detail["expenses"] if e["source"] == "bank" and e["status"] == "confirmed"]

    closed = await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=h["acc"])
    assert closed.status_code == 200 and closed.json()["settlement_status"] == "refund_pending"
    late = await harness.client.post(f"{url}/{uber['id']}/decision", headers=h["acc"], json={"decision": "absorb"})
    assert late.json()["error"]["code"] == "statement_legalization_closed"

    # El empleado ve el extracto de su legalización.
    mine = await harness.client.get(f"/api/v1/advances/{advance_id}/statements", headers=h["emp"])
    assert mine.status_code == 200 and len(mine.json()["data"]) == 1


async def test_rejected_match_is_not_proposed_again_and_a_manual_link_wins(harness: Harness) -> None:
    s = await _scenario(harness)
    h, advance_id, expenses = s["h"], s["advance_id"], s["expenses"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=h["emp"])
    statement = (await _upload(harness, h["tre"], advance_id)).json()
    url = f"/api/v1/statements/{statement['id']}/movements"
    lunch_charge = _movement(statement, "REST EL CIELO MEDELLIN")

    rejected = (await harness.client.post(f"{url}/{lunch_charge['id']}/reject", headers=h["acc"])).json()
    assert _movement(rejected, "REST EL CIELO MEDELLIN")["expense_id"] is None
    assert (await _expense_json(harness, h["emp"], expenses["lunch"]))["bank_status"] == "no_charge"

    # Con propina en el datáfono (7.5) el valor no cuadra solo: contabilidad lo enlaza a mano.
    uber = _movement(statement, "UBER *TRIP")
    linked = await harness.client.post(f"{url}/{uber['id']}/link", headers=h["acc"], json={"expense_id": expenses["dinner"]})
    assert _movement(linked.json(), "UBER *TRIP")["match_status"] == "manual"
    dinner = await _expense_json(harness, h["emp"], expenses["dinner"])
    assert (dinner["bank_status"], dinner["amount_applied"]) == ("matched", "20000.00")
    cash = await harness.client.post(f"{url}/{lunch_charge['id']}/link", headers=h["acc"], json={"expense_id": expenses["taxi"]})
    assert cash.status_code == 404  # el taxi se pagó en efectivo: no se cruza con la tarjeta


async def test_a_resubmitted_legalization_is_matched_again(harness: Harness) -> None:
    s = await _scenario(harness)
    h, advance_id, expenses = s["h"], s["advance_id"], s["expenses"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=h["emp"])
    await _upload(harness, h["tre"], advance_id)
    await harness.client.post(f"/api/v1/advances/{advance_id}/return", headers=h["acc"], json={"note": "Corrige la cena"})
    # Al confirmar de nuevo, el gasto vuelve al valor de la factura hasta que se vuelve a cruzar.
    await harness.client.post(f"/api/v1/expenses/{expenses['lunch']}/confirm", headers=h["emp"], json={"advance_id": advance_id})
    assert (await _expense_json(harness, h["emp"], expenses["lunch"]))["bank_status"] is None
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=h["emp"])
    await harness.drain()
    assert (await _expense_json(harness, h["emp"], expenses["lunch"]))["bank_status"] == "matched"


async def test_a_pdf_statement_is_read_by_the_ai(harness: Harness) -> None:
    s = await _scenario(harness)
    h, advance_id, expenses = s["h"], s["advance_id"], s["expenses"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=h["emp"])
    harness.statement_reader.table = StatementTable(
        rows=[["fecha", "descripcion", "referencia", "valor"], ["2026-10-13", "REST EL CIELO", "A1", "-85000.00"]],
        currency="COP",
        card_last4="4321",
        model_used="primary-model",
        prompt_tokens=3000,
        completion_tokens=400,
        cost_usd=Decimal("0.004"),
    )
    operator = await harness.add_employee(s["company"], "ops@nextbyte.com", Role.SUPERADMIN)
    ops_h = await harness.login(operator)
    before = (await harness.client.get("/api/v1/ai-costs", headers=ops_h)).json()["totals"]
    loaded = await _upload(harness, h["tre"], advance_id, b"%PDF-1.7 extracto", "extracto.pdf")
    assert loaded.status_code == 201, loaded.text
    statement = loaded.json()
    assert harness.statement_reader.calls == 1 and statement["card_last4"] == "4321"
    assert statement["movements"][0]["expense_id"] == expenses["lunch"]
    preview = await harness.client.post(
        f"/api/v1/advances/{advance_id}/statements/preview",
        headers=h["tre"],
        files={"file": ("otro.pdf", b"%PDF-1.7 otro", "application/pdf")},
    )
    assert preview.json()["error"]["code"] == "statement_pdf_no_preview"
    # La lectura del PDF suma al costo de la IA del mes.
    after = (await harness.client.get("/api/v1/ai-costs", headers=ops_h)).json()["totals"]
    assert after["calls"] - before["calls"] == 1 and after["prompt_tokens"] - before["prompt_tokens"] == 3000
    assert Decimal(after["cost_usd"]) - Decimal(before["cost_usd"]) == Decimal("0.004")


async def test_a_wrong_mapping_is_rejected_with_a_clear_message(harness: Harness) -> None:
    s = await _scenario(harness)
    h, advance_id = s["h"], s["advance_id"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=h["emp"])
    profile = {"header_row": 2, "date_col": 1, "description_col": 0, "amount_col": 2, "currency": "COP"}
    wrong = await harness.client.post(
        f"/api/v1/advances/{advance_id}/statements",
        headers=h["tre"],
        files={"file": ("extracto.csv", STATEMENT, "text/csv")},
        data={"profile": json.dumps(profile)},
    )
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "statement_without_charges"
