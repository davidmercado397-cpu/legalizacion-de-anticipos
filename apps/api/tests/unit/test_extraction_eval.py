from __future__ import annotations

from datetime import date
from decimal import Decimal

from scripts.extraction_eval import Summary, field_matches, score
from tests.fakes import invoice


def test_fields_are_compared_without_format_noise() -> None:
    assert field_matches("vendor_tax_id", "890.903.938-8", "890903938")
    assert field_matches("total", 45000, Decimal("45000.40"))
    assert not field_matches("total", 45000, Decimal("45900"))
    assert field_matches("vendor_name", "Restaurante El Cielo", "RESTAURANTE EL CIELO S.A.S.") is False
    assert field_matches("vendor_name", "Café Águila", "cafe aguila")
    assert field_matches("invoice_date", "2026-10-13", date(2026, 10, 13))
    assert field_matches("invoice_number", None, None) and not field_matches("invoice_number", "F-1", None)


def test_summary_reports_accuracy_by_field_and_failures() -> None:
    summary = Summary()
    expected = {"vendor_name": "Restaurante El Cielo", "total": 45000, "category": "meals"}
    summary.add("ok.jpg", score(expected, invoice()), Decimal("0.002"), 4000)
    summary.add("bad.jpg", score(expected, invoice(total=Decimal("54000"))), Decimal("0.003"), 6000)
    summary.add("unread.jpg", score(expected, None), Decimal("0"), 1000)
    report = summary.report()
    assert report["documents"] == 3 and report["by_field"]["total"] == round(1 / 3, 4)
    assert report["by_field"]["vendor_name"] == round(2 / 3, 4) and report["cost_usd"] == "0.005"
    assert {f["file"] for f in report["failures"]} == {"bad.jpg", "unread.jpg"}
    assert 0 < summary.accuracy < 1
