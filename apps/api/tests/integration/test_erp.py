from __future__ import annotations

from decimal import Decimal

from tests.conftest import Harness
from tests.integration.test_legalization import _approved, _confirmed_expense


async def test_the_advance_goes_to_siesa_when_approved_and_accounting_sends_the_legalization(harness: Harness) -> None:
    _, _, _, emp_h, appr_h, acc_h, advance_id = await _approved(harness)
    await harness.drain()
    advance = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=acc_h)).json()
    assert (advance["erp_advance_status"], advance["erp_advance_ref"]) == ("sent", "ANT-1")
    assert harness.erp.advances[0].amount == Decimal("500000") and harness.erp.advances[0].company_name == "Forsa Colombia"
    url = f"/api/v1/advances/{advance_id}/erp/legalization"
    early = await harness.client.post(url, headers=acc_h)
    assert early.status_code == 409 and early.json()["error"]["code"] == "erp_legalization_not_closed"

    await _confirmed_expense(harness, emp_h, total="45000")
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=emp_h)
    await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=acc_h)
    assert (await harness.client.post(url, headers=appr_h)).status_code == 403  # solo contabilidad
    sent = await harness.client.post(url, headers=acc_h)
    assert sent.status_code == 200, sent.text
    assert (sent.json()["erp_legalization_status"], sent.json()["erp_legalization_ref"]) == ("sent", "LEG-1")
    document = harness.erp.legalizations[0]
    assert document.erp_advance_ref == "ANT-1" and len(document.lines) == 1
    assert (document.delivered, document.legalized, document.balance) == (Decimal("500000"), Decimal("45000"), Decimal("455000"))
    again = await harness.client.post(url, headers=acc_h)
    assert again.json()["error"]["code"] == "erp_already_sent"


async def test_a_siesa_failure_is_kept_and_accounting_retries(harness: Harness) -> None:
    harness.erp.mode = "down"
    _, _, _, emp_h, _, acc_h, advance_id = await _approved(harness)
    await harness.drain()
    advance = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=emp_h)).json()
    assert advance["status"] == "approved"  # el ERP nunca frena la aprobación
    assert advance["erp_advance_status"] == "failed" and advance["erp_error"]

    retry = f"/api/v1/advances/{advance_id}/erp/advance"
    failed = await harness.client.post(retry, headers=acc_h)
    assert failed.status_code >= 500 and failed.json()["error"]["code"] == "external_service_error"
    harness.erp.mode = "ok"
    fixed = await harness.client.post(retry, headers=acc_h)
    assert fixed.json()["erp_advance_status"] == "sent" and fixed.json()["erp_error"] is None
    assert (await harness.client.post(retry, headers=acc_h)).json()["error"]["code"] == "erp_already_sent"


async def test_without_siesa_connected_it_stays_pending_and_the_legalization_sends_both(harness: Harness) -> None:
    harness.erp.mode = "unconfigured"
    _, _, _, emp_h, _, acc_h, advance_id = await _approved(harness)
    await harness.drain()
    advance = (await harness.client.get(f"/api/v1/advances/{advance_id}", headers=acc_h)).json()
    assert advance["erp_advance_status"] == "pending" and advance["erp_error"] == "Siesa no está configurado."

    await _confirmed_expense(harness, emp_h, total="45000")
    await harness.client.post(f"/api/v1/advances/{advance_id}/submit", headers=emp_h)
    await harness.client.post(f"/api/v1/advances/{advance_id}/close", headers=acc_h)
    harness.erp.mode = "ok"
    sent = (await harness.client.post(f"/api/v1/advances/{advance_id}/erp/legalization", headers=acc_h)).json()
    assert (sent["erp_advance_status"], sent["erp_legalization_status"]) == ("sent", "sent")
    assert len(harness.erp.advances) == 1 and len(harness.erp.legalizations) == 1
