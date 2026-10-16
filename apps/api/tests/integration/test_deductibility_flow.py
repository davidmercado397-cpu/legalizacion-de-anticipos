from __future__ import annotations

from decimal import Decimal

from app.domain.enums import DocumentType, Role, TaxType
from app.domain.values import TaxItem
from tests.conftest import Harness
from tests.fakes import invoice, make_jpeg


async def test_invoice_buyer_deductibility_and_accounting_override(harness: Harness) -> None:
    company = await harness.add_company()
    accountant = await harness.add_employee(company, "conta@forsa.com", Role.ACCOUNTANT)
    admin = await harness.add_employee(company, "admin@forsa.com", Role.ADMIN)
    employee = await harness.add_employee(company, "juan@forsa.com")
    acc_h, emp_h, admin_h = await harness.login(accountant), await harness.login(employee), await harness.login(admin)
    await harness.client.patch(
        f"/api/v1/companies/{company.id}", headers=admin_h, json={"tax_id": "900123456-7", "legal_name": "Forsa S.A."}
    )
    harness.extractor.respond = lambda _r, _n: [
        invoice(
            document_type=DocumentType.ELECTRONIC_INVOICE,
            buyer_tax_id="222222222222",
            subtotal=Decimal("100000"),
            tax_amount=Decimal("19000"),
            total=Decimal("119000"),
            taxes=(TaxItem(TaxType.IVA, Decimal("19000"), Decimal("19")),),
        )
    ]
    upload = await harness.client.post("/api/v1/expenses", headers=emp_h, files={"file": ("f.jpg", make_jpeg(), "image/jpeg")})
    await harness.drain()
    expense_id = upload.json()["id"]
    read = (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=emp_h)).json()
    assert read["deductibility"] == "non_deductible"
    assert {f["code"] for f in read["policy_findings"]} >= {"invoice_not_to_company"}
    split = (await harness.client.get(f"/api/v1/expenses/{expense_id}/deductibility", headers=acc_h)).json()
    assert Decimal(split["non_deductible_base"]) == Decimal("100000") and Decimal(split["vat_non_creditable"]) == Decimal("19000")

    # Contabilidad decide que sí es deducible: una corrección posterior del empleado no lo revierte.
    await harness.client.post(f"/api/v1/expenses/{expense_id}/deductibility", headers=acc_h, json={"deductibility": "deductible"})
    await harness.client.patch(f"/api/v1/expenses/{expense_id}", headers=emp_h, json={"description": "Hotel"})
    assert (await harness.client.get(f"/api/v1/expenses/{expense_id}", headers=emp_h)).json()["deductibility"] == "deductible"

    await harness.client.post(
        f"/api/v1/expenses/{expense_id}/deductibility", headers=acc_h, json={"deductibility": "requires_review"}
    )
    pending = await harness.client.get("/api/v1/expenses", headers=acc_h, params={"deductibility": "requires_review"})
    assert [e["id"] for e in pending.json()["data"]] == [expense_id]

    concepts = (await harness.client.get(f"/api/v1/companies/{company.id}/blocked-concepts", headers=acc_h)).json()["data"]
    minibar = next(c for c in concepts if c["code"] == "minibar")
    patched = await harness.client.patch(
        f"/api/v1/companies/{company.id}/blocked-concepts/{minibar['id']}", headers=acc_h, json={"deductible": True}
    )
    assert patched.json()["deductible"] is True
