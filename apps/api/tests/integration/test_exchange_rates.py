from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.application.jobs import Job, PeriodicJobs
from app.domain.entities import ExchangeRate
from app.domain.enums import ExchangeRateSource, Role
from tests.conftest import Harness
from tests.fakes import FakeRateProvider, invoice, make_jpeg


async def _rates(harness: Harness, start: date, days: int, cop: str, eur: str) -> None:
    """1 USD = `cop` pesos (TRM) y `eur` euros (BCE), solo en días hábiles como las fuentes reales."""
    rates = []
    for i in range(days):
        day = start + timedelta(days=i)
        if day.weekday() < 5:
            rates.append(ExchangeRate(day, "USD", "COP", Decimal(cop), ExchangeRateSource.TRM))
            rates.append(ExchangeRate(day, "USD", "EUR", Decimal(eur), ExchangeRateSource.ECB))
    async with harness.container.uow() as uow:
        await uow.exchange_rates.upsert(rates)
        await uow.commit()


async def _setup(harness: Harness, currency: str = "COP"):  # type: ignore[no-untyped-def]
    company = await harness.add_company()
    approver = await harness.add_employee(company, "ana@forsa.com", Role.APPROVER)
    employee = await harness.add_employee(company, "juan@forsa.com", approver=approver)
    emp_h, appr_h = await harness.login(employee), await harness.login(approver)
    advance = await harness.client.post(
        "/api/v1/advances",
        headers=emp_h,
        json={"company_id": str(company.id), "kind": "cash", "currency": currency, "amount": "4000000", "purpose": "Feria"},
    )
    await harness.client.post(f"/api/v1/advances/{advance.json()['id']}/approve", headers=appr_h)
    return company, emp_h, advance.json()["id"]


async def _upload(harness: Harness, headers: dict[str, str], seed: int = 1) -> str:
    response = await harness.client.post(
        "/api/v1/expenses", headers=headers, files={"file": ("f.jpg", make_jpeg(seed=seed), "image/jpeg")}
    )
    await harness.drain()
    return response.json()["id"]


async def test_a_euro_invoice_is_converted_to_pesos_through_the_dollar(harness: Harness) -> None:
    await _rates(harness, date(2026, 9, 1), 60, cop="4000", eur="0.8")
    _, emp_h, advance_id = await _setup(harness)
    # Sábado: no hay tasa ese día, se usa la del viernes.
    harness.extractor.respond = lambda _r, _n: [invoice(currency="EUR", total=Decimal("120"), invoice_date=date(2026, 10, 10))]
    expense_id = await _upload(harness, emp_h)

    read = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=emp_h)).json()
    assert Decimal(read["exchange_rate"]) == Decimal("5000") and read["exchange_rate_source"] == "ecb_cross"
    assert read["exchange_rate_date"] == "2026-10-09"

    confirmed = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=emp_h, json={})
    assert confirmed.status_code == 200, confirmed.text
    assert Decimal(confirmed.json()["amount_applied"]) == Decimal("600000")
    balance = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()["balance"]
    assert Decimal(balance["pending"]) == Decimal("3400000") and balance["functional"] is None


async def test_the_user_can_override_the_rate_and_missing_rates_ask_for_the_amount(harness: Harness) -> None:
    _, emp_h, _ = await _setup(harness)
    harness.extractor.respond = lambda _r, _n: [invoice(currency="EUR", total=Decimal("100"), invoice_date=date(2026, 10, 13))]
    expense_id = await _upload(harness, emp_h)
    # Sin tasas cargadas: hay que mandar el valor convertido.
    missing = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=emp_h, json={})
    assert missing.status_code == 409 and missing.json()["error"]["code"] == "converted_amount_required"
    manual = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=emp_h, json={"amount_applied": "455000"})
    assert manual.json()["exchange_rate_source"] == "manual" and Decimal(manual.json()["exchange_rate"]) == Decimal("4550")


async def test_previous_month_close_policy(harness: Harness) -> None:
    await _rates(harness, date(2026, 9, 28), 3, cop="3900", eur="0.8")  # lunes 28 a miércoles 30
    await _rates(harness, date(2026, 10, 1), 20, cop="4100", eur="0.8")
    company, emp_h, _ = await _setup(harness, currency="USD")
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    await harness.client.patch(
        f"/api/v1/companies/{company.id}",
        headers=await harness.login(admin),
        json={"exchange_rate_policy": "previous_month_close"},
    )
    # El anticipo en dólares se legaliza en pesos (la moneda de la compañía): la factura en USD se convierte
    # con la TRM del cierre del mes anterior a la factura.
    harness.extractor.respond = lambda _r, _n: [invoice(currency="USD", total=Decimal("100"), invoice_date=date(2026, 10, 13))]
    expense_id = await _upload(harness, emp_h)
    read = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=emp_h)).json()
    assert read["exchange_rate_date"] == "2026-09-30" and read["exchange_rate_source"] == "trm"
    confirmed = await harness.client.post(f"/api/v1/expenses/{expense_id}/confirm", headers=emp_h, json={})
    assert Decimal(confirmed.json()["amount_applied"]) == Decimal("390000.00")


async def test_a_dollar_advance_is_delivered_and_legalized_in_pesos(harness: Harness) -> None:
    today = harness.container.clock.now().date()
    await _rates(harness, today - timedelta(days=10), 11, cop="4000", eur="0.8")
    _, emp_h, advance_id = await _setup(harness, currency="USD")
    detail = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()
    # Calculado en USD, se entrega y se legaliza en pesos: estimado con la TRM de hoy.
    assert detail["currency"] == "USD" and detail["settlement_currency"] == "COP"
    assert Decimal(detail["settlement_rate"]) == Decimal("4000")
    balance = detail["balance"]
    assert balance["currency"] == "COP" and Decimal(balance["pending"]) == Decimal("16000000000")
    assert balance["functional"] is None
    mine = (await harness.client.get("/api/v1/me/balances", headers=emp_h)).json()["data"]
    assert mine[0]["balance"]["currency"] == "COP"


async def test_rates_endpoints_and_sync(harness: Harness) -> None:
    await _rates(harness, date(2026, 10, 5), 5, cop="4000", eur="0.8")
    company = await harness.add_company()
    employee = await harness.add_employee(company, "juan@forsa.com")
    headers = await harness.login(employee)
    quote = await harness.client.get(
        "/api/v1/exchange-rates/convert", headers=headers, params={"from": "eur", "to": "COP", "on": "2026-10-07"}
    )
    assert quote.status_code == 200 and Decimal(quote.json()["rate"]) == Decimal("5000")
    stale = await harness.client.get(
        "/api/v1/exchange-rates/convert", headers=headers, params={"from": "EUR", "to": "COP", "on": "2027-01-01"}
    )
    assert stale.status_code == 404

    assert (await harness.client.post("/api/v1/exchange-rates/sync", headers=headers)).status_code == 403
    operator = await harness.add_employee(company, "ops@nextbyte.com", Role.SUPERADMIN)
    synced = await harness.client.post("/api/v1/exchange-rates/sync", headers=await harness.login(operator))
    assert synced.status_code == 200 and synced.json()["stored"] > 0


async def test_a_source_that_fails_does_not_stop_the_others(harness: Harness) -> None:
    harness.container.rates._providers = [FakeRateProvider(fail=True), FakeRateProvider({"EUR": Decimal("0.9")}, "ecb")]
    assert await harness.container.rates.sync() > 0


async def test_each_job_round_runs_in_one_worker_only(harness: Harness) -> None:
    calls: list[int] = []

    async def work() -> None:
        calls.append(1)

    job = Job("demo", 60, work)
    first, second = PeriodicJobs([job], harness.container.jobs._lock), PeriodicJobs([job], harness.container.jobs._lock)
    assert await first.run_once(job) is True
    assert await second.run_once(job) is False
    assert calls == [1]
