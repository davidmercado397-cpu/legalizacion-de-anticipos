from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.domain.entities import (
    Advance,
    BlockedConcept,
    Company,
    Employee,
    Expense,
    ExpenseLine,
    PolicyRuleConfig,
)
from app.domain.enums import (
    AdvanceKind,
    Deductibility,
    DocumentType,
    ExpenseSource,
    Legibility,
    PolicyAction,
    ReviewDecision,
    ReviewStatus,
    Role,
)
from app.domain.errors import JustificationRequiredError, PolicyBlockedError
from app.domain.policies import PolicyContext, PolicyEngine, effective_rules, trip_margins
from app.domain.text import normalize_line_text
from app.domain.time import add_months
from tests.fakes import invoice
from tests.seed import setting_value

DEFAULTS = setting_value("defaults.policy_rules")


def _evaluate(ctx: PolicyContext, configs: list[PolicyRuleConfig]):  # type: ignore[no-untyped-def]
    return PolicyEngine().evaluate(ctx, configs, DEFAULTS)


NOW = datetime(2026, 10, 15, tzinfo=UTC)


def _setup(**invoice_overrides):  # type: ignore[no-untyped-def]
    company = Company("Forsa", "CO", "COP", generic_tax_id="222222222222")
    approver = Employee("Ana", "ana@x.com", Role.APPROVER, company_ids=[company.id])
    employee = Employee("Juan", "juan@x.com", company_ids=[company.id], approver_id=approver.id)
    advance = Advance(
        employee.id,
        company.id,
        AdvanceKind.CASH,
        "COP",
        Decimal("800000"),
        "Obra",
        "Medellín",
        date(2026, 10, 12),
        date(2026, 10, 15),
    )
    advance.approve(approver, employee)
    expense = Expense(employee.id, ExpenseSource.APP, company_id=company.id)
    expense.apply_reading(invoice(**invoice_overrides), [], Legibility.GOOD, NOW)
    expense.assign_to(advance)
    return company, approver, employee, advance, expense


def _line(
    expense: Expense, position: int, text: str, amount: str, concept: str | None = None, confidence: float | None = None
) -> ExpenseLine:
    return ExpenseLine(expense.id, position, text, normalize_line_text(text), Decimal(amount), None, concept, confidence, concept)


def _concepts(company: Company) -> dict[str, BlockedConcept]:
    return {
        "minibar": BlockedConcept(company.id, "minibar", "Minibar"),
        "alcohol": BlockedConcept(company.id, "alcohol", "Bebidas alcohólicas"),
    }


def _codes(result) -> set[str]:  # type: ignore[no-untyped-def]
    return {f.code for f in result.findings}


def test_line_text_normalization() -> None:
    assert normalize_line_text("2 CERVEZA Club Colombia Dorada 330ml $12.000") == "cerveza club colombia dorada"
    assert normalize_line_text("Habitación sencilla x3") == "habitacion sencilla"


def test_clean_expense_has_no_findings() -> None:
    company, *_, advance, expense = _setup()
    result = _evaluate(PolicyContext(expense, [], company, advance), [])
    assert result.findings == [] and result.suggested_non_reimbursable is None


def test_minibar_line_suggests_proportional_non_reimbursable_amount() -> None:
    company, *_, advance, expense = _setup(
        document_type=DocumentType.ELECTRONIC_INVOICE,
        subtotal=Decimal("564000"),
        tax_amount=Decimal("107160"),
        total=Decimal("671160"),
        lines=(),
    )
    lines = [
        _line(expense, 1, "Habitación 3 noches", "540000"),
        _line(expense, 2, "Minibar cerveza x2", "24000", "minibar", 0.92),
    ]
    result = _evaluate(PolicyContext(expense, lines, company, advance, _concepts(company)), [])
    blocked = next(f for f in result.findings if f.code == "blocked_concept")
    assert blocked.action == PolicyAction.REQUIRE_JUSTIFICATION and blocked.detail["lines"][0]["concept_name"] == "Minibar"
    # 24.000 de 564.000 en líneas -> la misma proporción del total de 671.160 (impuestos incluidos proporcionalmente)
    assert result.suggested_non_reimbursable == Decimal("28560.00")


def test_low_confidence_match_only_warns_but_a_human_correction_counts() -> None:
    company, approver, *_, advance, expense = _setup()
    line = _line(expense, 1, "Bebida de la casa", "45000", "alcohol", 0.4)
    result = _evaluate(PolicyContext(expense, [line], company, advance, _concepts(company)), [])
    assert _codes(result) == {"possible_blocked_concept"} and result.findings[0].action == PolicyAction.WARN
    line.correct_concept("alcohol", approver.id, NOW)
    result = _evaluate(PolicyContext(expense, [line], company, advance, _concepts(company)), [])
    assert _codes(result) == {"blocked_concept"}


def test_duplicate_missing_tax_id_and_dates() -> None:
    company, *_, advance, expense = _setup(vendor_tax_id=None, invoice_date=date(2026, 10, 20))
    result = _evaluate(PolicyContext(expense, [], company, advance, is_duplicate=True), [])
    assert _codes(result) == {"duplicate_invoice", "missing_tax_id", "outside_trip_dates"}
    missing = next(f for f in result.findings if f.code == "missing_tax_id")
    assert missing.detail["generic_tax_id"] == "222222222222"


def test_trip_date_tolerance_is_configurable() -> None:
    company, *_, advance, expense = _setup(invoice_date=date(2026, 10, 16))
    assert _codes(_evaluate(PolicyContext(expense, [], company, advance), [])) == set()
    strict = PolicyRuleConfig(company.id, "outside_trip_dates", PolicyAction.BLOCK, {"days_after": 0})
    result = _evaluate(PolicyContext(expense, [], company, advance), [strict])
    assert result.findings[0].action == PolicyAction.BLOCK


def test_trip_dates_accept_one_day_after_but_none_before() -> None:
    company, *_, advance, expense = _setup(invoice_date=date(2026, 10, 11))
    result = _evaluate(PolicyContext(expense, [], company, advance), [])
    assert result.findings[0].code == "outside_trip_dates" and result.findings[0].action == PolicyAction.REVIEW
    legacy = PolicyRuleConfig(company.id, "outside_trip_dates", PolicyAction.WARN, {"tolerance_days": 1})
    assert trip_margins(legacy.params) == (1, 1)


def test_wrong_nit_check_digit_goes_to_generic_third_party() -> None:
    company, *_, advance, expense = _setup(vendor_tax_id="890903938-1")
    assert _codes(_evaluate(PolicyContext(expense, [], company, advance), [])) == {"invalid_tax_id"}


def test_cash_receipt_caps() -> None:
    company, *_, advance, expense = _setup(document_type=DocumentType.CASH_RECEIPT, vendor_tax_id=None)
    rules = [
        PolicyRuleConfig(
            company.id,
            "non_fiscal_document",
            PolicyAction.REQUIRE_JUSTIFICATION,
            {"max_per_receipt": 40000, "max_monthly": 100000},
        )
    ]
    ctx = PolicyContext(expense, [], company, advance, non_fiscal_month_total=Decimal("60000"))
    assert _codes(_evaluate(ctx, rules)) == {"receipt_cap_exceeded", "monthly_cap_exceeded", "receipt_not_signed"}
    expense.receipt_signed = True
    assert _codes(_evaluate(ctx, rules)) == {"receipt_cap_exceeded", "monthly_cap_exceeded"}


def test_inactive_rule_and_itemized_rule() -> None:
    company, *_, advance, expense = _setup(vendor_tax_id=None, itemized=False, lines=())
    rules = [
        PolicyRuleConfig(company.id, "missing_tax_id", PolicyAction.WARN, {}, active=False),
        PolicyRuleConfig(company.id, "itemized_required", PolicyAction.WARN, {"above_amount": 30000}),
    ]
    assert _codes(_evaluate(PolicyContext(expense, [], company, advance), rules)) == {"not_itemized"}


def test_tip_above_the_suggested_one_is_flagged_and_not_reimbursable() -> None:
    company, *_, advance, expense = _setup(subtotal=Decimal("100000"), tax_amount=Decimal("8000"), total=Decimal("123000"))
    expense.tip_amount = Decimal("15000")
    result = _evaluate(PolicyContext(expense, [], company, advance), [])
    tip = next(f for f in result.findings if f.code == "excessive_tip")
    assert tip.action == PolicyAction.REVIEW and tip.detail == {
        "tip": "15000",
        "suggested": "10000.00",
        "excess": "5000.00",
        "pct": "10",
    }
    assert result.suggested_non_reimbursable == Decimal("5000.00")
    expense.tip_amount = Decimal("10000")
    assert "excessive_tip" not in _codes(_evaluate(PolicyContext(expense, [], company, advance), []))
    # Sin subtotal, la base es el total menos la propina y los impuestos.
    expense.subtotal, expense.tip_amount = None, Decimal("12000")
    base_from_total = next(f for f in _evaluate(PolicyContext(expense, [], company, advance), []).findings)
    assert base_from_total.detail["suggested"] == "10300.00"


def test_electronic_invoice_without_fiscal_id_goes_to_accounting() -> None:
    company, *_, advance, expense = _setup(document_type=DocumentType.ELECTRONIC_INVOICE)
    result = _evaluate(PolicyContext(expense, [], company, advance), [])
    assert _codes(result) == {"missing_fiscal_id"} and result.findings[0].action == PolicyAction.REVIEW
    expense.fiscal_id = "a" * 96
    assert _codes(_evaluate(PolicyContext(expense, [], company, advance), [])) == set()
    expense.fiscal_id, expense.country = None, "US"
    assert _codes(_evaluate(PolicyContext(expense, [], company, advance), [])) == set()


def test_legalization_due_one_month_after_the_return() -> None:
    company, approver, employee, advance, _ = _setup()
    assert advance.legalization_due is None and not advance.is_overdue(date(2027, 1, 1))
    advance.legalization_due = add_months(date(2026, 1, 31), 1)
    assert advance.legalization_due == date(2026, 2, 28) and add_months(date(2026, 11, 15), 2) == date(2027, 1, 15)
    assert not advance.is_overdue(date(2026, 2, 28)) and advance.is_overdue(date(2026, 3, 1))


def test_effective_rules_merge_defaults_and_overrides() -> None:
    company = Company("Forsa", "CO", "COP")
    rules = {r.rule_type: r for r in effective_rules([PolicyRuleConfig(company.id, "duplicate", PolicyAction.BLOCK)], DEFAULTS)}
    assert rules["duplicate"].action == PolicyAction.BLOCK and rules["duplicate"].customized
    assert (
        rules["outside_trip_dates"].params == {"days_before": 0, "days_after": 1} and not rules["outside_trip_dates"].customized
    )


def test_confirmation_needs_justification_or_review_when_blocked() -> None:
    company, approver, employee, advance, expense = _setup()
    expense.set_policy_result(
        [{"rule": "duplicate", "action": "require_justification", "code": "duplicate_invoice"}], Deductibility.DEDUCTIBLE, None
    )
    assert expense.review_status == ReviewStatus.PENDING
    with pytest.raises(JustificationRequiredError):
        expense.confirm(advance, NOW)
    expense.confirm(advance, NOW, justification="Cena del equipo, la pagué yo")
    assert expense.justification and expense.amount_applied == Decimal("45000")

    _, _, _, advance2, blocked = _setup()
    blocked.set_policy_result([{"rule": "blocked_concept", "action": "block", "code": "blocked_concept"}], None, None)
    with pytest.raises(PolicyBlockedError):
        blocked.confirm(advance2, NOW)
    blocked.review(ReviewDecision.ACCEPT_FULL, approver.id, "Excepción aprobada", NOW)
    blocked.confirm(advance2, NOW, justification="ok")
    assert blocked.review_status == ReviewStatus.ACCEPTED
    # Una reevaluación posterior no debe revivir el bloqueo ya levantado.
    blocked.set_policy_result([{"rule": "blocked_concept", "action": "block", "code": "blocked_concept"}], None, None)
    assert not blocked.findings_with(PolicyAction.BLOCK)


def test_review_without_blocked_lines_reduces_the_balance() -> None:
    company, approver, employee, advance, expense = _setup(
        total=Decimal("100000"), subtotal=None, tax_amount=None, lines=(), itemized=False
    )
    expense.set_policy_result(
        [{"rule": "blocked_concept", "action": "require_justification", "code": "blocked_concept"}], None, Decimal("20000")
    )
    expense.confirm(advance, NOW, justification="Incluye minibar")
    expense.review(ReviewDecision.ACCEPT_WITHOUT_BLOCKED, approver.id, None, NOW)
    assert expense.non_reimbursable_amount == Decimal("20000.00")
    assert advance.balance([expense]).applied == Decimal("80000.00")
    expense.review(ReviewDecision.REJECT, approver.id, "No corresponde", NOW)
    assert advance.balance([expense]).applied == Decimal(0)


def test_non_reimbursable_is_converted_to_the_advance_currency() -> None:
    company, approver, employee, advance, expense = _setup(
        currency="USD", total=Decimal("100"), subtotal=None, tax_amount=None, lines=(), itemized=False
    )
    expense.set_policy_result([{"rule": "blocked_concept", "action": "warn", "code": "blocked_concept"}], None, Decimal("10"))
    expense.confirm(advance, NOW, amount_applied=Decimal("400000"))
    expense.review(ReviewDecision.ACCEPT_WITHOUT_BLOCKED, approver.id, None, NOW)
    assert expense.non_reimbursable_amount == Decimal("40000.00")


def test_deductibility_by_document_type() -> None:
    company = Company(
        "Forsa", "CO", "COP", deductibility={"pos_ticket": "non_deductible", "cash_receipt": "requires_support_document"}
    )
    assert company.deductibility_for(DocumentType.CASH_RECEIPT) == Deductibility.REQUIRES_SUPPORT_DOCUMENT
    assert company.deductibility_for(DocumentType.POS_TICKET) == Deductibility.NON_DEDUCTIBLE
    assert company.deductibility_for(None) == Deductibility.NON_DEDUCTIBLE
    assert uuid.UUID(str(company.id))
