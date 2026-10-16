from __future__ import annotations

import io
from datetime import date, timedelta
from decimal import Decimal

from openpyxl import Workbook

from app.domain.entities import ExchangeRate
from app.domain.enums import ExchangeRateSource, Role, StaffType
from tests.conftest import Harness

HEADER = ["Zona", "Tipo_personal", "Categoria", "Valor", "Moneda", "Unidad", "Desde", "Hasta"]


def _xlsx(rows: list[list[object]]) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.append(HEADER)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


async def _setup(harness: Harness):  # type: ignore[no-untyped-def]
    company = await harness.add_company()
    accountant = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    # Ana no tiene jefe: lo que escala de su equipo lo aprueba la gerencia (decisión 4.5).
    await harness.add_employee(company, "gerencia@forsa.com", Role.MANAGEMENT)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver, staff_type=StaffType.OPERATIONAL)
    acc_h, emp_h, appr_h = await harness.login(accountant), await harness.login(employee), await harness.login(approver)
    zone = await harness.client.post(
        f"/api/v1/companies/{company.id}/travel-zones",
        headers=acc_h,
        json={"name": "Ciudades principales", "places": ["Bogotá", "Medellín", "Cali"]},
    )
    assert zone.status_code == 201
    return company, acc_h, emp_h, appr_h, zone.json()["id"]


async def test_accounting_loads_rates_from_excel_with_a_report_per_row(harness: Harness) -> None:
    company, acc_h, emp_h, _, _ = await _setup(harness)
    url = f"/api/v1/companies/{company.id}/travel-rates/import"
    bad = _xlsx(
        [
            ["Ciudades principales", "operativo", "lodging", 180000, "COP", "noche", date(2026, 1, 1), None],
            ["Costa", "operativo", "meals", 60000, "COP", "día", "2026-01-01", None],
            ["Ciudades principales", "gerente", "meals", -5, "COP", "semana", "ayer", None],
        ]
    )
    rejected = await harness.client.post(url, headers=acc_h, files={"file": ("tarifas.xlsx", bad)})
    assert rejected.status_code == 422 and rejected.json()["error"]["code"] == "budget_import_invalid"
    assert "2 filas" in rejected.json()["error"]["message"]
    details = rejected.json()["error"]["details"]
    assert {(d["row"], d["field"]) for d in details} == {
        (3, "zona"),
        (4, "tipo_personal"),
        (4, "unidad"),
        (4, "valor"),
        (4, "desde"),
    }
    assert (await harness.client.get(f"/api/v1/companies/{company.id}/travel-rates", headers=acc_h)).json()["data"] == []

    good = _xlsx(
        [
            ["Ciudades principales", "operativo", "lodging", 180000, "COP", "noche", date(2026, 1, 1), None],
            ["Ciudades principales", "operativo", "meals", 60000, "COP", "día", "2026-01-01", None],
            ["Ciudades principales", "administrativo", "meals", 80000, "COP", "dia", "2026-01-01", "2026-12-31"],
        ]
    )
    loaded = await harness.client.post(url, headers=acc_h, files={"file": ("tarifas.xlsx", good)})
    assert loaded.status_code == 200 and loaded.json()["imported"] == 3
    # El empleado no ve la tabla de tarifas.
    assert (await harness.client.get(f"/api/v1/companies/{company.id}/travel-rates", headers=emp_h)).status_code == 403
    not_excel = await harness.client.post(url, headers=acc_h, files={"file": ("tarifas.xlsx", b"hola")})
    assert not_excel.json()["error"]["code"] == "invalid_spreadsheet"


async def test_the_advance_amount_comes_from_the_budget(harness: Harness) -> None:
    company, acc_h, emp_h, appr_h, zone_id = await _setup(harness)
    for category, amount, unit in (("lodging", "180000", "per_night"), ("meals", "60000", "per_day")):
        response = await harness.client.post(
            f"/api/v1/companies/{company.id}/travel-rates",
            headers=acc_h,
            json={
                "zone_id": zone_id,
                "staff_type": "operational",
                "category_code": category,
                "amount": amount,
                "currency": "COP",
                "unit": unit,
                "valid_from": "2026-01-01",
            },
        )
        assert response.status_code == 201
    trip = {"company_id": str(company.id), "destination": "Medellín", "start_date": "2026-10-12", "end_date": "2026-10-14"}

    preview = await harness.client.post("/api/v1/advances/budget-preview", headers=emp_h, json=trip)
    assert preview.status_code == 200 and Decimal(preview.json()["total"]) == Decimal("540000")
    assert {(line["category"], line["units"]) for line in preview.json()["lines"]} == {("lodging", 2), ("meals", 3)}

    base = {**trip, "kind": "cash", "currency": "COP", "purpose": "Obra Medellín"}
    created = await harness.client.post("/api/v1/advances", headers=emp_h, json=base)
    assert created.status_code == 201, created.text
    assert Decimal(created.json()["amount"]) == Decimal("540000") and Decimal(created.json()["budget_amount"]) == Decimal(
        "540000"
    )

    more = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "amount": "700000"})
    assert more.status_code == 422 and more.json()["error"]["code"] == "budget_justification_required"
    assert "$540.000" in more.json()["error"]["message"]
    justified = await harness.client.post(
        "/api/v1/advances", headers=emp_h, json={**base, "amount": "700000", "justification": "Dos noches más de obra"}
    )
    detail = (await harness.client.get(f"/api/v1/advances/{justified.json()['id']}", headers=appr_h)).json()
    assert Decimal(detail["amount"]) == Decimal("700000") and Decimal(detail["budget_amount"]) == Decimal("540000")
    assert detail["budget_justification"] == "Dos noches más de obra" and len(detail["budget_breakdown"]) == 2
    # 700.000 supera en más del 10 % los 540.000 calculados: escala por encima del jefe inmediato.
    assert [r["code"] for r in detail["escalation_reasons"]] == ["over_budget"]
    assert detail["escalation_reasons"][0]["message"] == "Supera en más del 10 % el presupuesto calculado ($540.000 COP)"
    assert [s["level"] for s in detail["approval_steps"]] == ["boss", "management"]

    # Sin tarifas para el destino: el valor lo pone el empleado.
    elsewhere = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "destination": "Pasto"})
    assert elsewhere.json()["error"]["code"] == "amount_required"
    other = await harness.client.post("/api/v1/advances/budget-preview", headers=emp_h, json={**trip, "destination": "Pasto"})
    assert other.status_code == 404


async def test_cash_in_foreign_currency_has_a_cap(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=admin)
    admin_h, emp_h = await harness.login(admin), await harness.login(employee)
    patched = await harness.client.patch(
        f"/api/v1/companies/{company.id}", headers=admin_h, json={"cash_international_cap": {"amount": "200", "currency": "USD"}}
    )
    assert patched.json()["cash_international_cap"] == {"amount": "200", "currency": "USD"}
    today = harness.container.clock.now().date()
    async with harness.container.uow() as uow:
        await uow.exchange_rates.upsert(
            [ExchangeRate(today - timedelta(days=i), "USD", "EUR", Decimal("0.8"), ExchangeRateSource.ECB) for i in range(3)]
        )
        await uow.commit()
    base = {"company_id": str(company.id), "kind": "cash", "purpose": "Feria en Madrid"}
    over = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "currency": "USD", "amount": "250"})
    assert over.status_code == 422 and over.json()["error"]["code"] == "cash_cap_exceeded"
    assert "$200 USD" in over.json()["error"]["message"]
    euros = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "currency": "EUR", "amount": "150"})
    assert euros.status_code == 201  # 150 EUR = 187,50 USD
    card = await harness.client.post(
        "/api/v1/advances", headers=emp_h, json={**base, "kind": "reloadable_card", "currency": "USD", "amount": "900"}
    )
    assert card.status_code == 201
    bad_cap = await harness.client.patch(
        f"/api/v1/companies/{company.id}", headers=admin_h, json={"cash_international_cap": {"amount": "200", "currency": "JPY"}}
    )
    assert bad_cap.json()["error"]["code"] == "invalid_cash_cap"
    cleared = await harness.client.patch(
        f"/api/v1/companies/{company.id}", headers=admin_h, json={"cash_international_cap": None}
    )
    assert cleared.json()["cash_international_cap"] is None


async def test_staff_type_is_part_of_the_user(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    headers = await harness.login(admin)
    created = await harness.client.post(
        "/api/v1/employees",
        headers=headers,
        json={
            "full_name": "Juan Técnico",
            "email": "juan@forsa.com",
            "company_ids": [str(company.id)],
            "staff_type": "operational",
        },
    )
    assert created.json()["staff_type"] == "operational"
    patched = await harness.client.patch(
        f"/api/v1/employees/{created.json()['id']}", headers=headers, json={"staff_type": "administrative"}
    )
    assert patched.json()["staff_type"] == "administrative"


async def test_a_trip_with_two_destinations_in_two_currencies_goes_in_dollars(harness: Harness) -> None:
    company, acc_h, emp_h, appr_h, zone_id = await _setup(harness)
    brazil = await harness.client.post(
        f"/api/v1/companies/{company.id}/travel-zones", headers=acc_h, json={"name": "Brasil", "places": ["São Paulo", "BR"]}
    )
    rates = ((zone_id, "meals", "80000", "COP"), (brazil.json()["id"], "meals", "50", "USD"))
    for zone, category, amount, currency in rates:
        rate = {"zone_id": zone, "staff_type": "operational", "category_code": category, "amount": amount}
        rate |= {"currency": currency, "unit": "per_day", "valid_from": "2026-01-01"}
        assert (
            await harness.client.post(f"/api/v1/companies/{company.id}/travel-rates", headers=acc_h, json=rate)
        ).status_code == 201
    today = harness.container.clock.now().date()
    async with harness.container.uow() as uow:
        await uow.exchange_rates.upsert([ExchangeRate(today, "USD", "COP", Decimal("4000"), ExchangeRateSource.TRM)])
        await uow.commit()
    legs = [
        {"destination": "São Paulo", "start_date": "2026-10-13", "end_date": "2026-10-15"},
        {"destination": "Medellín", "start_date": "2026-10-12", "end_date": "2026-10-13"},
    ]
    trip = {"company_id": str(company.id), "legs": legs}

    preview = (await harness.client.post("/api/v1/advances/budget-preview", headers=emp_h, json=trip)).json()
    # El 13 es día de traslado: se paga una sola vez, con la tarifa de São Paulo.
    assert preview["currency"] == "USD" and Decimal(preview["total"]) == Decimal("170")
    assert [(line["destination"], line["units"], Decimal(line["rate"])) for line in preview["lines"]] == [
        ("Medellín", 1, Decimal("20")),
        ("São Paulo", 3, Decimal("50")),
    ]

    base = {**trip, "kind": "reloadable_card", "purpose": "Visita a proveedores"}
    pesos = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "currency": "COP"})
    assert pesos.json()["error"]["code"] == "budget_currency_mismatch"
    created = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "currency": "USD"})
    assert created.status_code == 201, created.text
    advance = created.json()
    assert advance["destination"] == "Medellín → São Paulo" and Decimal(advance["amount"]) == Decimal("170")
    assert (advance["start_date"], advance["end_date"]) == ("2026-10-12", "2026-10-15")
    assert [leg["destination"] for leg in advance["legs"]] == ["Medellín", "São Paulo"]

    overlap = [{**legs[1], "end_date": "2026-10-14"}, legs[0]]
    crossed = await harness.client.post("/api/v1/advances", headers=emp_h, json={**base, "legs": overlap, "currency": "USD"})
    assert crossed.status_code == 422 and crossed.json()["error"]["code"] == "legs_overlap"
    assert "Medellín y São Paulo" in crossed.json()["error"]["message"]
    # Un tramo sin zona: no hay presupuesto y el valor lo pone el empleado.
    unknown = [legs[1], {**legs[0], "destination": "Lima"}]
    manual = await harness.client.post(
        "/api/v1/advances", headers=emp_h, json={**base, "legs": unknown, "currency": "USD", "amount": "300"}
    )
    assert manual.status_code == 201 and manual.json()["budget_amount"] is None
