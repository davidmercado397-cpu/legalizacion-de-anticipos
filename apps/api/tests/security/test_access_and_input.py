"""Controles de acceso por registro, validación de archivos y logs sin datos sensibles."""

from __future__ import annotations

import logging

import pytest

from app.domain.enums import Role
from tests.conftest import PASSWORD, Harness, wa_message
from tests.fakes import make_jpeg


async def test_records_of_another_company_are_invisible_to_accounting(harness: Harness) -> None:
    """IDOR: contabilidad de una compañía no ve (404, no 403) lo de otra compañía del grupo."""
    colombia = await harness.add_company()
    panama = await harness.add_company("Forsa Panamá", "PA", "USD")
    tecnico = await harness.add_employee(panama, "pedro@forsa.com")
    await harness.add_open_advance(tecnico, currency="USD")
    contador = await harness.add_employee(colombia, "carlos@forsa.com", Role.ACCOUNTANT)
    upload = await harness.client.post(
        "/api/v1/expenses", headers=await harness.login(tecnico), files={"file": ("f.jpg", make_jpeg(), "image/jpeg")}
    )
    expense_id = upload.json()["id"]
    contador_h = await harness.login(contador)
    assert (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=contador_h)).status_code == 404
    assert (await harness.client.get(f"/api/v1/expenses/{expense_id}/file", headers=contador_h)).status_code == 404


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"MZ\x90\x00 not an image", "unsupported_file_type"),  # ejecutable renombrado como .jpg
        (b"<svg onload=alert(1)>", "unsupported_file_type"),
    ],
)
async def test_files_are_validated_by_content_not_by_name(harness: Harness, content: bytes, code: str) -> None:
    company = await harness.add_company()
    user = await harness.add_employee(company, "juan@forsa.com")
    response = await harness.client.post(
        "/api/v1/expenses", headers=await harness.login(user), files={"file": ("factura.jpg", content, "image/jpeg")}
    )
    assert response.status_code == 422 and response.json()["error"]["code"] == code


async def test_logs_never_contain_passwords_tokens_or_full_phone_numbers(
    harness: Harness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    company = await harness.add_company()
    phone = "573001112233"
    user = await harness.add_employee(company, "juan@forsa.com", phone=phone)
    login = await harness.client.post("/api/v1/auth/login", json={"email": user.email, "password": PASSWORD})
    tokens = login.json()
    await harness.client.post("/api/v1/auth/login", json={"email": user.email, "password": "otra-clave-mala"})
    await harness.webhook(wa_message("wamid.L1", phone=phone, user_id="CO.1", type="text", text={"body": "saldo"}))
    await harness.drain()
    logged = "\n".join(record.getMessage() for record in caplog.records)
    for secret in (PASSWORD, "otra-clave-mala", tokens["access_token"], tokens["refresh_token"], phone):
        assert secret not in logged


async def test_each_step_belongs_to_its_role(harness: Harness) -> None:
    """Segregación (decisiones 8.1 a 8.5): el jefe aprueba la solicitud, tesorería entrega y liquida, y
    contabilidad revisa y cierra la legalización. Ninguno hace el paso del otro."""
    company = await harness.add_company()
    boss = await harness.add_employee(company, "jefe@forsa.com", Role.APPROVER)
    traveler = await harness.add_employee(company, "juan@forsa.com", approver=boss)
    accounting = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    treasury = await harness.add_employee(company, "teso@forsa.com", Role.TREASURY)
    boss_h, emp_h, acc_h, tre_h = [await harness.login(e) for e in (boss, traveler, accounting, treasury)]
    body = {"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "100000", "purpose": "Obra"}
    advance_id = (await harness.client.post("/api/v1/advances", headers=emp_h, json=body)).json()["id"]
    url = f"/api/v1/advances/{advance_id}"

    assert (await harness.client.post(f"{url}/approve", headers=tre_h)).status_code == 403
    assert (await harness.client.post(f"{url}/approve", headers=boss_h)).status_code == 200
    assert (await harness.client.post(f"{url}/disburse", headers=boss_h, json={"method": "cash"})).status_code == 403
    assert (await harness.client.post(f"{url}/disburse", headers=acc_h, json={"method": "cash"})).status_code == 403
    assert (await harness.client.post(f"{url}/disburse", headers=tre_h, json={"method": "cash"})).status_code == 200
    assert (await harness.client.post(f"{url}/submit", headers=emp_h)).status_code == 200
    for headers in (boss_h, tre_h):
        assert (await harness.client.post(f"{url}/close", headers=headers)).status_code == 403
    closed = await harness.client.post(f"{url}/close", headers=acc_h)
    assert closed.json()["settlement_status"] == "refund_pending"
    assert (await harness.client.post(f"{url}/settle", headers=acc_h, json={"method": "refund"})).status_code == 403
    assert (await harness.client.post(f"{url}/settle", headers=tre_h, json={"method": "refund"})).status_code == 200
