from __future__ import annotations

from decimal import Decimal

from app.domain.enums import Role
from app.domain.values import InvoiceLine
from tests.conftest import Harness
from tests.fakes import invoice, make_jpeg


async def _team(harness: Harness):  # type: ignore[no-untyped-def]
    company = await harness.add_company()
    accountant = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver)
    return company, await harness.login(accountant), await harness.login(approver), await harness.login(employee)


async def _open_advance(harness: Harness, email: str = "juan@forsa.com", currency: str = "COP") -> None:
    """Sin un anticipo aprobado no se registran facturas."""
    async with harness.container.uow() as uow:
        employee = await uow.employees.get_by_email(email)
    assert employee is not None
    await harness.add_open_advance(employee, currency=currency)


async def _read(harness: Harness, headers: dict[str, str], seed: int, *lines: InvoiceLine, **data: object) -> str:
    total = sum((line.amount or Decimal(0) for line in lines), Decimal(0))
    harness.extractor.respond = lambda _r, _n: [
        invoice(invoice_number=f"F-{seed}", lines=lines, total=total, subtotal=None, tax_amount=None, **data)
    ]
    upload = await harness.client.post(
        "/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(seed=seed), "image/jpeg")}
    )
    await harness.drain()
    return upload.json()["id"]


async def _lines(harness: Harness, headers: dict[str, str], expense_id: str) -> list[dict]:  # type: ignore[type-arg]
    return (await harness.client.get(f"/api/v1/expenses/{expense_id}/lines", headers=headers)).json()["data"]


async def _set_concept(harness: Harness, headers: dict[str, str], expense_id: str, position: int, concept: str | None) -> None:
    line = next(item for item in await _lines(harness, headers, expense_id) if item["position"] == position)
    response = await harness.client.patch(
        f"/api/v1/expenses/{expense_id}/lines/{line['id']}", headers=headers, json={"concept_code": concept}
    )
    assert response.status_code == 200, response.text


async def test_a_reviewer_correction_is_remembered_exactly(harness: Harness) -> None:
    _, acc_h, appr_h, emp_h = await _team(harness)
    await _open_advance(harness)
    first = await _read(harness, emp_h, 1, InvoiceLine("Almuerzo", Decimal("30000")), InvoiceLine("POKER x3", Decimal("12000")))
    # Las líneas las decide contabilidad (el jefe solo aprueba la solicitud).
    assert (await harness.client.get(f"/api/v1/expenses/{first}/lines", headers=appr_h)).status_code == 200
    await _set_concept(harness, acc_h, first, 2, "alcohol")

    # La IA no lo marca, pero la memoria sí: "Poker x6" es el mismo texto normalizado.
    second = await _read(harness, emp_h, 2, InvoiceLine("Poker x6", Decimal("24000")))
    line = (await _lines(harness, emp_h, second))[0]
    assert line["final_concept_code"] == "alcohol" and line["ai_concept_code"] is None and line["memory_example_id"]
    findings = (await harness.client.get(f"/api/v1/expenses/{second}", headers=emp_h)).json()["policy_findings"]
    assert "blocked_concept" in {f["code"] for f in findings}

    # Un negativo: contabilidad dice que el agua está permitida aunque la IA la marque.
    third = await _read(
        harness, emp_h, 3, InvoiceLine("Agua Cristal", Decimal("3000"), concept_code="alcohol", concept_confidence=0.7)
    )
    await _set_concept(harness, acc_h, third, 1, None)
    fourth = await _read(
        harness, emp_h, 4, InvoiceLine("AGUA CRISTAL", Decimal("3000"), concept_code="alcohol", concept_confidence=0.7)
    )
    assert (await _lines(harness, emp_h, fourth))[0]["final_concept_code"] is None

    # La IA recibe las correcciones como ejemplos en el prompt.
    assert {(e.text, e.concept_code) for e in harness.extractor.calls[-1].context.learned} >= {("POKER x3", "alcohol")}

    examples = (await harness.client.get("/api/v1/classification-examples", headers=acc_h)).json()["data"]
    assert {(e["key_text"], e["label"], e["status"]) for e in examples} == {
        ("poker", "alcohol", "active"),
        ("agua cristal", "none", "active"),
    }


async def test_the_employee_cannot_teach_without_validation(harness: Harness) -> None:
    _, _, appr_h, emp_h = await _team(harness)
    await _open_advance(harness)
    first = await _read(
        harness, emp_h, 1, InvoiceLine("Ron Viejo de Caldas", Decimal("40000"), concept_code="alcohol", concept_confidence=0.95)
    )
    await _set_concept(harness, emp_h, first, 1, None)
    findings = (await harness.client.get(f"/api/v1/expenses/{first}", headers=emp_h)).json()["policy_findings"]
    assert "owner_concept_override" in {f["code"] for f in findings}

    pending = (await harness.client.get("/api/v1/classification-examples", headers=appr_h, params={"status": "pending"})).json()
    example_id = pending["data"][0]["id"]
    second = await _read(
        harness, emp_h, 2, InvoiceLine("Ron Viejo de Caldas", Decimal("40000"), concept_code="alcohol", concept_confidence=0.95)
    )
    assert (await _lines(harness, emp_h, second))[0]["final_concept_code"] == "alcohol"  # lo pendiente no aplica

    sneaky = await harness.client.patch(f"/api/v1/classification-examples/{example_id}", headers=emp_h, json={"active": True})
    assert sneaky.status_code == 403
    own = await harness.client.post(f"/api/v1/classification-examples/{example_id}/approve", headers=emp_h)
    assert own.status_code == 409 and own.json()["error"]["code"] == "self_validation"
    approved = await harness.client.post(f"/api/v1/classification-examples/{example_id}/approve", headers=appr_h)
    assert approved.json()["status"] == "active"
    # Al activarse se recalcula lo que aún no se confirma.
    assert (await _lines(harness, emp_h, second))[0]["final_concept_code"] is None


async def test_similar_lines_get_only_a_warning(harness: Harness) -> None:
    _, acc_h, _, emp_h = await _team(harness)
    await _open_advance(harness)
    first = await _read(harness, emp_h, 1, InvoiceLine("Club Colombia Dorada", Decimal("9000")))
    await _set_concept(harness, acc_h, first, 1, "alcohol")
    second = await _read(harness, emp_h, 2, InvoiceLine("Club Colombia Roja", Decimal("9000")))
    line = (await _lines(harness, emp_h, second))[0]
    assert line["final_concept_code"] is None and line["similar_concept_code"] == "alcohol"
    findings = (await harness.client.get(f"/api/v1/expenses/{second}", headers=emp_h)).json()["policy_findings"]
    possible = next(f for f in findings if f["code"] == "possible_blocked_concept")
    assert possible["action"] == "warn" and possible["detail"]["lines"][0]["similar_to"] == "Club Colombia Dorada"


async def test_conflicts_history_deactivation_and_group_scope(harness: Harness) -> None:
    company, acc_h, _, emp_h = await _team(harness)
    await _open_advance(harness)
    other_accountant = await harness.add_employee(company, "conta2@forsa.com", Role.ACCOUNTANT)
    first = await _read(harness, emp_h, 1, InvoiceLine("Frigobar", Decimal("15000")))
    await _set_concept(harness, await harness.login(other_accountant), first, 1, "minibar")
    second = await _read(harness, emp_h, 2, InvoiceLine("Frigobar", Decimal("15000")))
    await _set_concept(harness, acc_h, second, 1, "alcohol")  # otra persona, otra etiqueta
    example = (await harness.client.get("/api/v1/classification-examples", headers=acc_h, params={"conflicted": True})).json()[
        "data"
    ][0]
    assert example["label"] == "alcohol"
    history = (await harness.client.get(f"/api/v1/classification-examples/{example['id']}/history", headers=acc_h)).json()["data"]
    assert [h["action"] for h in history] == ["created", "corrected"] and history[1]["before"]["label"] == "minibar"

    pending_one = await _read(harness, emp_h, 3, InvoiceLine("Frigobar", Decimal("15000")))
    assert (await _lines(harness, emp_h, pending_one))[0]["final_concept_code"] == "alcohol"
    await harness.client.delete(f"/api/v1/classification-examples/{example['id']}", headers=acc_h)
    assert (await _lines(harness, emp_h, pending_one))[0]["final_concept_code"] is None  # no confirmado: se recalcula

    await harness.client.patch(
        f"/api/v1/classification-examples/{example['id']}", headers=acc_h, json={"active": True, "scope": "group"}
    )
    other = await harness.add_company("Forsa México", "MX", "MXN")
    mexican = await harness.add_employee(other, "pepe@forsa.mx")
    mx_h = await harness.login(mexican)
    await _open_advance(harness, "pepe@forsa.mx", "MXN")
    abroad = await _read(harness, mx_h, 4, InvoiceLine("Frigobar", Decimal("300")), currency="MXN")
    assert (await _lines(harness, mx_h, abroad))[0]["final_concept_code"] == "alcohol"
    assert company


async def test_vendor_category_is_learned_when_the_legalization_closes(harness: Harness) -> None:
    company, acc_h, appr_h, emp_h = await _team(harness)
    advance = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={"company_id": str(company.id), "kind": "cash", "currency": "COP", "amount": "500000", "purpose": "Obra"},
    )
    await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/approve", headers=appr_h)
    first = await _read(
        harness, emp_h, 1, InvoiceLine("Lavado camisas", Decimal("20000")), vendor_tax_id="900555111-3", category="other"
    )
    await harness.client.patch(f"/api/v1/expenses/{first}", headers=emp_h, json={"category": "laundry"})
    await harness.client.post(f"/api/v1/expenses/{first}/confirm", headers=emp_h, json={})
    second = await _read(
        harness, emp_h, 2, InvoiceLine("Planchado", Decimal("8000")), vendor_tax_id="900555111", category="other"
    )
    assert (await harness.client.get(f"/api/v1/expenses/{second}", headers=emp_h)).json()["category"] == "other"

    await harness.client.post(f"/api/v1/expenses/{second}/discard", headers=emp_h)
    await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/submit", headers=emp_h)
    await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/close", headers=acc_h)
    await _open_advance(harness)  # el siguiente viaje
    third = await _read(
        harness, emp_h, 3, InvoiceLine("Lavado", Decimal("9000")), vendor_tax_id="900.555.111-3", category="other"
    )
    assert (await harness.client.get(f"/api/v1/expenses/{third}", headers=emp_h)).json()["category"] == "laundry"
    month = (await harness.client.get(f"/api/v1/expenses/{first}", headers=emp_h)).json()["confirmed_at"][:7]
    accuracy = await harness.client.get(f"/api/v1/companies/{company.id}/ai-accuracy", headers=acc_h, params={"month": month})
    assert accuracy.json()["documents"] == 1
