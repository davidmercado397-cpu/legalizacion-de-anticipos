from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.domain.errors import ValidationError
from app.domain.reconciliation import (
    CardPayment,
    Charge,
    MatchParams,
    StatementProfile,
    TripWindow,
    match,
    merchant_similarity,
    parse_date,
    parse_number,
    read_movements,
    suggest_profile,
)

PARAMS = MatchParams.of(
    {
        "max_days": 1,
        "same_currency_tolerance": 0.01,
        "other_currency_tolerance": 0.06,
        "weights": {"amount": 0.5, "date": 0.3, "merchant": 0.2},
        "auto_threshold": 0.8,
        "suggest_threshold": 0.55,
    }
)


@pytest.mark.parametrize(
    ("text", "separator", "expected"),
    [
        ("1.234.567,89", ",", Decimal("1234567.89")),
        ("1,234.56", ".", Decimal("1234.56")),
        ("$ -45.000", ",", Decimal("-45000")),
        ("(1.200,00)", ",", Decimal("-1200.00")),
        ("1.200,00-", ",", Decimal("-1200.00")),
        ("R$ 300,50", ",", Decimal("300.50")),
        ("abc", ",", None),
        ("", ",", None),
    ],
)
def test_numbers_are_read_as_the_bank_writes_them(text: str, separator: str, expected: Decimal | None) -> None:
    assert parse_number(text, separator) == expected


def test_dates_follow_the_profile_but_iso_is_always_accepted() -> None:
    assert parse_date("13/10/2026", "DD/MM/YYYY") == date(2026, 10, 13)
    assert parse_date("10/13/2026", "MM/DD/YYYY") == date(2026, 10, 13)
    assert parse_date("13/10/26", "DD/MM/YY") == date(2026, 10, 13)
    assert parse_date("20261013", "YYYYMMDD") == date(2026, 10, 13)
    assert parse_date("2026-10-13 00:00:00", "DD/MM/YYYY") == date(2026, 10, 13)
    assert parse_date("31/02/2026", "DD/MM/YYYY") is None
    assert parse_date("Total", "DD/MM/YYYY") is None


ROWS = [
    ["BANCO DE PRUEBA", "", ""],
    ["Fecha", "Descripción", "Valor"],
    ["13/10/2026", "REST EL CIELO   MEDELLIN", "-85.000"],
    ["14/10/2026", "ABONO", "50.000,00"],
    ["Total", "", "-35.000"],
    ["", "", ""],
]


def test_suggested_profile_finds_the_titles_and_reads_charges_and_credits() -> None:
    suggestion = suggest_profile(ROWS, "cop")
    profile = suggestion.profile
    assert suggestion.confident
    assert (profile.header_row, profile.date_col, profile.description_col, profile.amount_col) == (2, 0, 1, 2)
    assert profile.decimal_separator == "," and profile.currency == "COP"
    reading = read_movements(ROWS, profile)
    charge, credit = reading.movements
    assert (charge.amount, charge.is_charge, charge.description) == (Decimal("85000"), True, "REST EL CIELO MEDELLIN")
    assert (credit.amount, credit.is_charge) == (Decimal("50000.00"), False)
    assert reading.skipped == [(5, "Fecha no reconocida: Total")]


def test_debit_and_credit_columns_are_supported() -> None:
    rows = [
        ["Date", "Description", "Debit", "Credit"],
        ["2026-10-13", "Starbucks Coffee", "12.50", ""],
        ["2026-10-14", "Refund", "", "3.00"],
    ]
    profile = suggest_profile(rows, "USD").profile
    assert (profile.debit_col, profile.credit_col, profile.amount_col) == (2, 3, None)
    movements = read_movements(rows, profile).movements
    assert [(m.amount, m.is_charge) for m in movements] == [(Decimal("12.50"), True), (Decimal("3.00"), False)]


def test_a_profile_needs_an_amount_column() -> None:
    with pytest.raises(ValidationError):
        StatementProfile(header_row=1, date_col=0, description_col=1, currency="COP")


def test_bank_names_are_truncated_so_prefixes_count() -> None:
    assert merchant_similarity("STARBUCKS COF 1234", "Starbucks Coffee") == Decimal(1)
    assert merchant_similarity("UBER *TRIP", "Restaurante El Cielo") == Decimal(0)


def _charge(day: int, amount: str, text: str) -> Charge:
    return Charge(uuid.uuid4(), date(2026, 10, day), text, Decimal(amount))


def _payment(day: int, amount: str, vendor: str, same_currency: bool = True) -> CardPayment:
    return CardPayment(uuid.uuid4(), date(2026, 10, day), vendor, same_currency, Decimal(amount))


def test_exact_charge_matches_automatically_and_two_days_apart_never_matches() -> None:
    lunch = _payment(13, "85000", "Restaurante El Cielo")
    exact = _charge(13, "85000", "REST EL CIELO MEDELLIN")
    late = _charge(15, "85000", "REST EL CIELO MEDELLIN")
    (proposal,) = match([late, exact], [lunch], PARAMS)
    assert (proposal.movement_id, proposal.automatic) == (exact.movement_id, True)
    assert match([late], [lunch], PARAMS) == []


def test_a_borderline_amount_is_only_suggested_and_a_rejected_pair_is_not_proposed_again() -> None:
    hotel = _payment(12, "300000", "Hotel Dann")
    charge = _charge(12, "303000", "HOTEL DANN CARLTON")
    (proposal,) = match([charge], [hotel], PARAMS)
    assert not proposal.automatic and proposal.score == Decimal("0.750")
    assert match([charge], [hotel], PARAMS, frozenset({(charge.movement_id, hotel.expense_id)})) == []


def test_each_charge_and_each_payment_are_used_once_best_score_first() -> None:
    a, b = _payment(13, "50000", "Taxi Libre"), _payment(13, "50000", "Parqueadero Centro")
    charges = [_charge(13, "50000", "PARQUEADERO CENTRO"), _charge(13, "50000", "TAXI LIBRE")]
    proposals = match(charges, [a, b], PARAMS)
    assert {(p.movement_id, p.expense_id) for p in proposals} == {
        (charges[0].movement_id, b.expense_id),
        (charges[1].movement_id, a.expense_id),
    }


def test_another_currency_has_a_wider_tolerance() -> None:
    # Factura de R$ 300 que el banco cobró en pesos con su tasa y comisión (4 % de diferencia).
    payment = _payment(13, "250000", "Churrascaria Boi", same_currency=False)
    assert match([_charge(13, "260000", "CHURRASCARIA BOI")], [payment], PARAMS)


def test_trip_window_includes_the_margin() -> None:
    window = TripWindow(date(2026, 10, 12), date(2026, 10, 15), 1)
    assert window.contains(date(2026, 10, 11)) and window.contains(date(2026, 10, 16))
    assert not window.contains(date(2026, 10, 25))
    assert TripWindow(None, None).contains(date(2026, 1, 1))
