from __future__ import annotations

from decimal import Decimal

from app.domain.deductibility import breakdown
from app.domain.entities import BlockedConcept
from app.domain.enums import Deductibility, DocumentType, ReviewStatus
from app.domain.fiscal import same_tax_id
from app.domain.policies import PolicyContext
from tests.unit.test_policies import _concepts, _evaluate, _line, _setup

GENERIC = ("222222222222",)


def _ctx(**invoice):  # type: ignore[no-untyped-def]
    company, approver, employee, advance, expense = _setup(**invoice)
    company.tax_id, company.legal_name = "900123456-7", "Forsa S.A."
    company.deductibility = {"electronic_invoice": "deductible", "foreign_invoice": "requires_review"}
    group = {"800765432-1": "Forsa Panamá"}
    return PolicyContext(expense, [], company, advance, group_companies=group, generic_buyer_ids=GENERIC), expense


def test_tax_ids_match_with_or_without_check_digit_and_format() -> None:
    assert same_tax_id("900.123.456-7", "900123456")
    assert same_tax_id("9001234567", "900123456-7")
    assert same_tax_id("xaxx010101000", "XAXX010101000")
    assert not same_tax_id("900123456", "900123457") and not same_tax_id(None, "900123456")


def test_the_invoice_must_be_in_the_name_of_the_company() -> None:
    cases = {
        "900123456": set(),
        "222222222222": {"invoice_not_to_company"},
        "1020304050": {"invoice_not_to_company"},  # la cédula del empleado
        None: {"invoice_not_to_company"},
        "800765432": {"invoice_to_other_group_company"},
    }
    for buyer, expected in cases.items():
        ctx, _ = _ctx(document_type=DocumentType.ELECTRONIC_INVOICE, buyer_tax_id=buyer)
        result = _evaluate(ctx, [])
        codes = {f.code for f in result.findings} & {"invoice_not_to_company", "invoice_to_other_group_company"}
        assert codes == expected, buyer
        expected_deductibility = (
            Deductibility.NON_DEDUCTIBLE if "invoice_not_to_company" in expected else Deductibility.DEDUCTIBLE
        )
        assert result.deductibility == expected_deductibility
    generic = _evaluate(_ctx(document_type=DocumentType.ELECTRONIC_INVOICE, buyer_tax_id="222222222222")[0], [])
    detail = next(f for f in generic.findings if f.code == "invoice_not_to_company").detail
    assert detail["reason"] == "generic" and detail["legal_name"] == "Forsa S.A."


def test_a_foreign_invoice_is_left_for_accounting_to_review() -> None:
    ctx, _ = _ctx(document_type=DocumentType.ELECTRONIC_INVOICE, buyer_tax_id=None, country="US", currency="USD")
    result = _evaluate(ctx, [])
    assert not {f.code for f in result.findings} & {"invoice_not_to_company"}
    assert result.deductibility == Deductibility.REQUIRES_REVIEW


def test_handwritten_receipts_need_concept_date_and_value() -> None:
    ctx, _ = _ctx(document_type=DocumentType.CASH_RECEIPT, description=None, invoice_date=None)
    finding = next(f for f in _evaluate(ctx, []).findings if f.code == "receipt_missing_data")
    assert finding.detail["fields"] == ["concept", "date"]


def test_breakdown_with_vat_and_a_blocked_line_for_each_review_decision() -> None:
    ctx, expense = _ctx(
        document_type=DocumentType.ELECTRONIC_INVOICE,
        buyer_tax_id="900123456",
        subtotal=Decimal("100000"),
        tax_amount=Decimal("19000"),
        total=Decimal("119000"),
    )
    expense.taxes = [{"type": "iva", "rate": "19", "amount": "19000"}]
    expense.deductibility = Deductibility.DEDUCTIBLE
    lines = [_line(expense, 1, "Habitación", "80000"), _line(expense, 2, "Minibar", "20000", "minibar", 0.9)]
    concepts = _concepts(ctx.company)

    pending = breakdown(expense, lines, concepts)
    assert pending is not None
    assert pending.deductible_base == Decimal("80000.00") and pending.non_deductible_base == Decimal("20000.00")
    assert pending.vat_creditable == Decimal("15200.00") and pending.vat_non_creditable == Decimal("3800.00")

    expense.review_status = ReviewStatus.ACCEPTED_PARTIAL  # el empleado asume el minibar
    partial = breakdown(expense, lines, concepts)
    assert partial is not None and partial.employee_assumed == Decimal("23800.00") and partial.non_deductible_base == 0

    expense.review_status = ReviewStatus.ACCEPTED
    concepts["minibar"] = BlockedConcept(ctx.company.id, "minibar", "Minibar", deductible=True)
    full = breakdown(expense, lines, concepts)
    assert full is not None and full.deductible_base == Decimal("100000.00") and full.vat_creditable == Decimal("19000.00")


def test_restaurant_consumption_tax_and_non_deductible_documents() -> None:
    _, expense = _ctx(
        document_type=DocumentType.ELECTRONIC_INVOICE,
        subtotal=Decimal("50000"),
        tax_amount=Decimal("4000"),
        tip_amount=Decimal("5000"),
        total=Decimal("59000"),
    )
    expense.taxes = [{"type": "inc", "rate": "8", "amount": "4000"}]
    expense.deductibility = Deductibility.DEDUCTIBLE
    restaurant = breakdown(expense, [], {})
    assert restaurant is not None
    assert restaurant.deductible_base == Decimal("50000.00") and restaurant.consumption_tax == Decimal("4000.00")
    assert restaurant.vat_creditable == 0 and restaurant.tip == Decimal("5000.00")
    expense.deductibility = Deductibility.NON_DEDUCTIBLE
    rejected = breakdown(expense, [], {})
    assert rejected is not None and rejected.deductible_base == 0 and rejected.non_deductible_base == Decimal("50000.00")
