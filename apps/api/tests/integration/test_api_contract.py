from __future__ import annotations

from app.domain.enums import Role
from tests.conftest import Harness


async def test_validation_errors_explain_each_field_in_spanish(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    headers = await harness.login(admin)
    response = await harness.client.post("/api/v1/employees", headers=headers, json={"email": "no-es-correo"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error" and error["message"] == "Revisa los datos enviados."
    issues = {item["field"]: item["issue"] for item in error["details"]}
    assert issues["full_name"] == "Este campo es obligatorio."
    assert "email" in issues and error["request_id"]


async def test_unknown_route_uses_the_same_error_shape(harness: Harness) -> None:
    response = await harness.client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert response.json()["error"]["message"] == "No encontramos esa ruta."


async def test_request_id_is_echoed_or_generated(harness: Harness) -> None:
    echoed = await harness.client.get("/health", headers={"X-Request-ID": "front-1234-abcd"})
    assert echoed.headers["X-Request-ID"] == "front-1234-abcd"
    generated = await harness.client.get("/health", headers={"X-Request-ID": "bad id with spaces"})
    assert generated.headers["X-Request-ID"] != "bad id with spaces" and len(generated.headers["X-Request-ID"]) == 32


async def test_business_errors_never_leak_internal_english_text(harness: Harness) -> None:
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    headers = await harness.login(approver)
    body = {"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "100", "purpose": "Obra"}
    advance = await harness.client.post("/api/v1/advances", headers=headers, json=body)
    own = await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/approve", headers=headers)
    assert own.status_code == 403
    error = own.json()["error"]
    assert error["code"] == "self_decision"
    assert error["message"] == "No puedes aprobar ni revisar tu propio anticipo. Lo debe hacer tu aprobador."


async def test_lists_are_paginated_with_total(harness: Harness) -> None:
    company = await harness.add_company()
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    for i in range(3):
        await harness.add_employee(company, f"tecnico{i}@forsa.com")
    headers = await harness.login(admin)
    page = (await harness.client.get("/api/v1/employees", headers=headers, params={"limit": 2, "offset": 1})).json()
    assert page["pagination"] == {"limit": 2, "offset": 1, "total": 4} and len(page["data"]) == 2
