from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from app.domain.entities import ExchangeRate
from app.domain.enums import ExchangeRateSource, Role
from tests.conftest import Harness
from tests.fakes import invoice, make_jpeg


async def _rates(harness: Harness, start: date, days: int) -> None:
    """1 USD = 4.000 COP y 5 BRL: 1 BRL = 800 COP (todos los días, para no depender del fin de semana)."""
    rates = []
    for i in range(days):
        day = start + timedelta(days=i)
        rates.append(ExchangeRate(day, "USD", "COP", Decimal("4000"), ExchangeRateSource.TRM))
        rates.append(ExchangeRate(day, "USD", "BRL", Decimal("5"), ExchangeRateSource.ECB))
    async with harness.container.uow() as uow:
        await uow.exchange_rates.upsert(rates)
        await uow.commit()


async def _brazil_trip(harness: Harness):  # type: ignore[no-untyped-def]
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver)
    treasurer = await harness.add_employee(company, "tomas@forsa.com", Role.TREASURY)
    emp_h, appr_h, treas_h = await harness.login(employee), await harness.login(approver), await harness.login(treasurer)
    body = {"company_id": str(company.id), "kind": "cash", "currency": "BRL", "amount": "3000", "purpose": "Feria en São Paulo"}
    advance_id = (await harness.client.post("/api/v1/advances", headers=emp_h, json=body)).json()["id"]
    await harness.client.post(f"/api/v1/advances/{advance_id}/approve", headers=appr_h)
    return emp_h, treas_h, advance_id


async def _cash_invoice(harness: Harness, headers: dict[str, str], day: date, total: str, seed: int) -> str:
    harness.extractor.respond = lambda _r, _n: [
        invoice(currency="BRL", total=Decimal(total), invoice_date=day, invoice_number=f"POS-{seed}")
    ]
    upload = await harness.client.post(
        "/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(seed=seed), "image/jpeg")}
    )
    await harness.drain()
    expense_id = upload.json()["id"]
    confirmed = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=headers, json={})
    assert confirmed.status_code == 200, confirmed.text
    return expense_id


async def _detail(harness: Harness, headers: dict[str, str], advance_id: str) -> dict[str, Any]:
    return (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=headers)).json()


def _applied(detail: dict[str, Any], expense_id: str) -> Decimal:
    return Decimal(next(e for e in detail["expenses"] if e["id"] == expense_id)["amount_applied"])


async def test_cash_spent_abroad_takes_the_rate_of_each_withdrawal_in_order(harness: Harness) -> None:
    today = harness.container.clock.now().date()
    d0 = today - timedelta(days=8)
    await _rates(harness, d0 - timedelta(days=5), 20)
    emp_h, treas_h, advance_id = await _brazil_trip(harness)

    # Se calcula en BRL y se entrega en pesos: tesorería ajusta lo que realmente transfirió.
    detail = await _detail(harness, emp_h, advance_id)
    assert detail["settlement_currency"] == "COP" and Decimal(detail["settlement_amount"]) == Decimal("2400000.00")
    disbursed = await harness.client.post(
        f"/api/v1/advances/{advance_id}/disburse", headers=treas_h, json={"method": "transfer", "amount": "2500000"}
    )
    assert disbursed.status_code == 200 and Decimal(disbursed.json()["settlement_amount"]) == Decimal("2500000")

    # Primer retiro: 500 BRL con la tasa oficial del día (800). Segundo: 300 BRL, el banco debitó 255.000 (850).
    first = await harness.client.post(
        f"/api/v1/advances/{advance_id}/withdrawals",
        headers=emp_h,
        json={"withdrawn_on": str(d0), "currency": "BRL", "amount": "500"},
    )
    assert first.status_code == 201, first.text
    assert Decimal(first.json()["official_rate"]) == Decimal("800") and Decimal(first.json()["value"]) == Decimal("400000.00")
    second = await harness.client.post(
        f"/api/v1/advances/{advance_id}/withdrawals",
        headers=emp_h,
        json={"withdrawn_on": str(d0 + timedelta(days=2)), "currency": "BRL", "amount": "300", "debited_amount": "255000"},
    )
    assert Decimal(second.json()["rate"]) == Decimal("850")

    lunch = await _cash_invoice(harness, emp_h, d0 + timedelta(days=1), "200", 1)  # sale del primero: 200 × 800
    dinner = await _cash_invoice(harness, emp_h, d0 + timedelta(days=3), "350", 2)  # 300 × 800 + 50 × 850
    before = await _cash_invoice(harness, emp_h, d0 - timedelta(days=1), "50", 3)  # antes de retirar: tasa del día

    detail = await _detail(harness, emp_h, advance_id)
    assert detail["balance"]["currency"] == "COP"
    assert _applied(detail, lunch) == Decimal("160000.00")
    assert _applied(detail, dinner) == Decimal("282500.00")
    assert _applied(detail, before) == Decimal("40000.00")
    uncovered = next(e for e in detail["expenses"] if e["id"] == before)
    assert Decimal(uncovered["cash_uncovered"]) == Decimal("50")
    finding = next(f for f in uncovered["policy_findings"] if f["code"] == "cash_without_withdrawal")
    assert finding["action"] == "review" and "no sale de ningún retiro" in finding["message"]
    covered = next(e for e in detail["expenses"] if e["id"] == lunch)
    assert all(f["code"] != "cash_without_withdrawal" for f in covered["policy_findings"])
    assert covered["exchange_rate_source"] == "withdrawal" and covered["cash_allocations"][0]["amount"] == "200.00"
    remaining = {w["id"]: Decimal(w["remaining"]) for w in detail["withdrawals"]}
    assert remaining == {first.json()["id"]: Decimal("0"), second.json()["id"]: Decimal("250")}

    # Días después tesorería ve el extracto: el primer retiro costó 410.000 (820) y cobraron 15.000 de comisión.
    edited = await harness.client.patch(
        f"/api/v1/withdrawals/{first.json()['id']}",
        headers=treas_h,
        json={"debited_amount": "410000", "fee_amount": "15000", "amount": "999"},  # tesorería no cambia lo retirado
    )
    assert edited.status_code == 200 and Decimal(edited.json()["amount"]) == Decimal("500")
    detail = await _detail(harness, emp_h, advance_id)
    assert _applied(detail, lunch) == Decimal("164000.00")
    assert _applied(detail, dinner) == Decimal("288500.00")  # 300 × 820 + 50 × 850
    fee = next(e for e in detail["expenses"] if e["source"] == "withdrawal_fee")
    assert Decimal(fee["amount_applied"]) == Decimal("15000") and fee["currency"] == "COP"
    assert Decimal(detail["balance"]["applied"]) == Decimal("507500.00")  # 164.000 + 288.500 + 40.000 + 15.000
    assert Decimal(detail["balance"]["pending"]) == Decimal("1992500.00")

    # La comisión se cambia desde el retiro; tesorería no borra retiros; el viajero sí.
    assert (await harness.client.post(f"/api/v1/expenses/{fee['id']}/discard", headers=emp_h)).status_code == 409
    assert (await harness.client.delete(f"/api/v1/withdrawals/{second.json()['id']}", headers=treas_h)).status_code == 403
    assert (await harness.client.delete(f"/api/v1/withdrawals/{second.json()['id']}", headers=emp_h)).status_code == 204
    detail = await _detail(harness, emp_h, advance_id)
    assert _applied(detail, dinner) == Decimal("286000.00")  # los 50 sin retiro van con la tasa del día: 300 × 820 + 50 × 800


async def test_a_withdrawal_needs_a_rate_and_another_currency(harness: Harness) -> None:
    emp_h, treas_h, advance_id = await _brazil_trip(harness)
    today = harness.container.clock.now().date()
    no_rate = await harness.client.post(
        f"/api/v1/advances/{advance_id}/withdrawals",
        headers=emp_h,
        json={"withdrawn_on": str(today), "currency": "BRL", "amount": "100"},
    )
    assert no_rate.status_code == 422 and no_rate.json()["error"]["code"] == "withdrawal_rate_missing"
    with_debit = await harness.client.post(
        f"/api/v1/advances/{advance_id}/withdrawals",
        headers=emp_h,
        json={"withdrawn_on": str(today), "currency": "BRL", "amount": "100", "debited_amount": "81000"},
    )
    assert with_debit.status_code == 201 and Decimal(with_debit.json()["rate"]) == Decimal("810")
    same = await harness.client.post(
        f"/api/v1/advances/{advance_id}/withdrawals",
        headers=emp_h,
        json={"withdrawn_on": str(today), "currency": "COP", "amount": "100"},
    )
    assert same.status_code == 422 and same.json()["error"]["code"] == "withdrawal_same_currency"
    # Sin tasa al pedirlo ni al desembolsar, tesorería tiene que escribir lo que entregó en pesos.
    missing = await harness.client.post(f"/api/v1/advances/{advance_id}/disburse", headers=treas_h, json={"method": "cash"})
    assert missing.status_code == 409 and missing.json()["error"]["code"] == "settlement_amount_required"
    given = await harness.client.post(
        f"/api/v1/advances/{advance_id}/disburse", headers=treas_h, json={"method": "cash", "amount": "2450000"}
    )
    assert given.status_code == 200 and given.json()["settlement_currency"] == "COP"
    assert Decimal(given.json()["settlement_rate"]) == Decimal("816.66666667")
