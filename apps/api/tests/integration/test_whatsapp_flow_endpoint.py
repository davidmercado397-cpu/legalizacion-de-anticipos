"""Endpoint de datos del Flow de solicitar anticipo: con el viaje calcula el valor con las tarifas y abre la
pantalla del valor con ese dato ya escrito."""

from __future__ import annotations

from typing import Any, cast

from app.domain.entities import Company, Employee
from app.domain.enums import Role, StaffType
from app.domain.ports import TokenService
from tests.conftest import Harness
from tests.flow_meta import enable_flow_endpoint, exchange


async def _trip_with_rates(harness: Harness) -> tuple[Company, Employee]:
    company = await harness.add_company()
    accountant = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver, staff_type=StaffType.OPERATIONAL)
    acc_h = await harness.login(accountant)
    zone = await harness.client.post(
        f"/api/v1/companies/{company.id}/travel-zones", headers=acc_h, json={"name": "Ciudades", "places": ["Medellín"]}
    )
    for category, amount, unit in (("lodging", "180000", "per_night"), ("meals", "60000", "per_day")):
        rate = {
            "zone_id": zone.json()["id"],
            "staff_type": "operational",
            "category_code": category,
            "amount": amount,
            "currency": "COP",
            "unit": unit,
            "valid_from": "2026-01-01",
        }
        await harness.client.post(f"/api/v1/companies/{company.id}/travel-rates", headers=acc_h, json=rate)
    enable_flow_endpoint(harness)
    return company, employee


def flow_token(harness: Harness, employee: Employee, purpose: str = "advance_request") -> str:
    return cast(TokenService, harness.container.extras["tokens"]).issue_flow_token(employee.id, purpose, None)


def trip_request(token: str, company: Company, **data: Any) -> dict[str, Any]:
    trip = {
        "company_id": str(company.id),
        "destination": "Medellín",
        "purpose": "Obra",
        "start_date": "2026-10-12",
        "end_date": "2026-10-14",
        "kind": "cash",
        **data,
    }
    return {"version": "3.0", "action": "data_exchange", "screen": "REQUEST", "flow_token": token, "data": trip}


async def test_the_amount_screen_comes_with_the_value_calculated_from_the_rates(harness: Harness) -> None:
    company, juan = await _trip_with_rates(harness)
    assert await exchange(harness, {"version": "3.0", "action": "ping"}) == {"data": {"status": "active"}}

    reply = await exchange(harness, trip_request(flow_token(harness, juan), company))
    assert reply["screen"] == "AMOUNT"
    data = reply["data"]
    # Dos noches y tres días, igual que en la app.
    assert data["amount"] == "540000" and data["currency"] == "COP"
    assert data["summary"].startswith("💰 Valor calculado con las tarifas de viaje: $540.000 COP.")
    assert data["destination"] == "Medellín" and data["start_date"] == "2026-10-12" and data["kind"] == "cash"
    assert {"id": "USD", "title": "USD"} in data["currencies"]


async def test_without_rates_the_employee_writes_the_value(harness: Harness) -> None:
    company, juan = await _trip_with_rates(harness)
    reply = await exchange(harness, trip_request(flow_token(harness, juan), company, destination="Pasto"))
    assert reply["screen"] == "AMOUNT" and reply["data"]["amount"] == ""
    assert reply["data"]["summary"] == "No hay tarifas de viaje para este destino: escribe el valor del anticipo."
    assert reply["data"]["currency"] == "COP"


async def test_a_trip_that_cannot_be_calculated_stays_on_the_first_screen_with_the_reason(harness: Harness) -> None:
    company, juan = await _trip_with_rates(harness)
    token = flow_token(harness, juan)
    backwards = await exchange(harness, trip_request(token, company, start_date="2026-10-14", end_date="2026-10-12"))
    assert backwards["screen"] == "REQUEST"
    assert backwards["data"]["error_message"] == "La fecha de regreso no puede ser anterior a la de salida."
    assert backwards["data"]["companies"] == [{"id": str(company.id), "title": company.name}]

    unreadable = await exchange(harness, trip_request(token, company, start_date="mañana"))
    assert unreadable["data"]["error_message"] == "No pude leer los datos del formulario. Ábrelo de nuevo y revísalos."

    # Meta avisa que no pudo mostrar una respuesta: solo se acusa recibo.
    notice = {"version": "3.0", "action": "data_exchange", "screen": "AMOUNT", "flow_token": token, "data": {"error": "x"}}
    assert await exchange(harness, notice) == {"data": {"acknowledged": True}}
