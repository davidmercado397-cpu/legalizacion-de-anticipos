"""Ruta de aprobación por niveles (decisiones 4.1 a 4.5)."""

from __future__ import annotations

from typing import Any

from app.domain.enums import Role
from tests.conftest import Harness


async def _org(harness: Harness) -> dict[str, Any]:
    company = await harness.add_company()
    director = await harness.add_employee(company, "diana@forsa.com", Role.APPROVER)
    boss = await harness.add_employee(company, "carlos@forsa.com", Role.APPROVER, approver=director)
    traveler = await harness.add_employee(company, "ana@forsa.com", approver=boss)
    management = await harness.add_employee(company, "gerencia@forsa.com", Role.MANAGEMENT)
    accounting = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    people = {"director": director, "boss": boss, "emp": traveler, "mgmt": management, "acc": accounting}
    return {"company": company, "h": {k: await harness.login(v) for k, v in people.items()}}


async def _request(harness: Harness, org: dict[str, Any], who: str = "emp", amount: str = "500000", **extra: Any) -> str:
    body = {"company_id": str(org["company"].id), "kind": "cash", "currency": "COP", "amount": amount, "purpose": "Obra", **extra}
    created = await harness.client.post("/api/v1/advances", headers=org["h"][who], json=body)
    assert created.status_code == 201, created.text
    advance_id: str = created.json()["id"]
    return advance_id


async def _set_threshold(harness: Harness, org: dict[str, Any], cop: str) -> None:
    url = f"/api/v1/companies/{org['company'].id}/approval-rules"
    rules = await harness.client.put(url, headers=org["h"]["acc"], json={"tolerance_pct": "10", "thresholds": {"COP": cop}})
    assert rules.status_code == 200, rules.text


async def _pending(harness: Harness, headers: dict[str, str]) -> list[str]:
    return [a["id"] for a in (await harness.client.get("/api/v1/advances/pending-approval", headers=headers)).json()["data"]]


async def test_without_escalation_only_the_boss_decides(harness: Harness) -> None:
    org = await _org(harness)
    advance_id = await _request(harness, org)
    assert await _pending(harness, org["h"]["boss"]) == [advance_id]
    assert await _pending(harness, org["h"]["director"]) == []
    director = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["director"])
    assert director.status_code == 404  # no está en la ruta ni es su colaborador directo
    approved = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["boss"])
    assert approved.json()["status"] == "approved"
    assert [(s["level"], s["status"]) for s in approved.json()["approval_steps"]] == [("boss", "approved")]


async def test_over_the_threshold_needs_the_director_after_the_boss(harness: Harness) -> None:
    org = await _org(harness)
    await _set_threshold(harness, org, "1000000")
    missing = await harness.client.post(
        "/api/v1/advances",
        headers=org["h"]["emp"],
        json={"company_id": str(org["company"].id), "kind": "cash", "currency": "COP", "amount": "1500000", "purpose": "Obra"},
    )
    assert missing.json()["error"]["code"] == "escalation_justification_required"  # 4.3
    advance_id = await _request(harness, org, amount="1500000", justification="Equipo de cinco personas")
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=org["h"]["director"])).json()
    assert (
        detail["escalation_reasons"][0]["message"]
        == "Supera el monto de $1.000.000 COP que exige la aprobación del jefe directivo"
    )
    # El directivo la ve en su bandeja desde el principio: puede aprobar sin esperar (4.4).
    assert await _pending(harness, org["h"]["director"]) == [advance_id]

    first = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["boss"])
    assert first.json()["status"] == "requested"
    assert [s["status"] for s in first.json()["approval_steps"]] == ["approved", "pending"]
    assert await _pending(harness, org["h"]["boss"]) == []
    final = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["director"])
    assert final.json()["status"] == "approved" and final.json()["approved_by"] == str(await _id(harness, "diana@forsa.com"))


async def test_the_director_can_approve_without_waiting_for_the_boss(harness: Harness) -> None:
    org = await _org(harness)
    await _set_threshold(harness, org, "1000000")
    advance_id = await _request(harness, org, amount="1500000", justification="Equipo de cinco personas")
    approved = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["director"])
    assert approved.json()["status"] == "approved"
    assert [s["status"] for s in approved.json()["approval_steps"]] == ["skipped", "approved"]
    late = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["boss"])
    assert late.status_code == 409


async def test_a_director_can_reject_an_escalated_request(harness: Harness) -> None:
    org = await _org(harness)
    await _set_threshold(harness, org, "1000000")
    advance_id = await _request(harness, org, amount="1500000", justification="Equipo de cinco personas")
    rejected = await harness.client.post(
        f"/api/v1/advances/{advance_id}/reject", headers=org["h"]["director"], json={"note": "Que viajen tres"}
    )
    assert rejected.json()["status"] == "rejected"
    assert [s["status"] for s in rejected.json()["approval_steps"]] == ["pending", "rejected"]


async def test_trips_of_directors_are_approved_by_management(harness: Harness) -> None:
    org = await _org(harness)
    advance_id = await _request(harness, org, who="director")
    steps = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=org["h"]["mgmt"])).json()["approval_steps"]
    assert [(s["level"], s["approver_id"]) for s in steps] == [("management", None)]
    assert await _pending(harness, org["h"]["mgmt"]) == [advance_id]
    assert (await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["acc"])).status_code == 403
    approved = await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=org["h"]["mgmt"])
    assert approved.json()["status"] == "approved"


async def test_only_accounting_configures_the_escalation(harness: Harness) -> None:
    org = await _org(harness)
    url = f"/api/v1/companies/{org['company'].id}/approval-rules"
    current = (await harness.client.get(url, headers=org["h"]["acc"])).json()
    assert current == {"tolerance_pct": "10.00", "thresholds": {}}  # decisión 4.1 por defecto
    body = {"tolerance_pct": "15", "thresholds": {"USD": "2000"}}
    assert (await harness.client.put(url, headers=org["h"]["boss"], json=body)).status_code == 403
    wrong = await harness.client.put(url, headers=org["h"]["acc"], json={"tolerance_pct": "5", "thresholds": {"USD": "0"}})
    assert wrong.status_code == 422
    saved = await harness.client.put(url, headers=org["h"]["acc"], json=body)
    assert saved.json() == {"tolerance_pct": "15", "thresholds": {"USD": "2000"}}


async def _id(harness: Harness, email: str) -> object:
    async with harness.container.uow() as uow:
        employee = await uow.employees.get_by_email(email)
    assert employee is not None
    return employee.id
