from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.adapters.outbound.documents import PillowDocumentPreparer, ZxingQrDecoder
from app.application.reading import DocumentReader, ReadingConfig
from app.domain.enums import ExpenseWarning, Legibility
from app.domain.ports import ExtractionContext, ExtractionOptions, ExtractionRequest, ImageOptions
from app.domain.verification import InvoiceVerifier
from tests.fakes import FakeExtractor, invoice, make_jpeg

TODAY = date(2026, 10, 15)
CUFE = "b" * 96
DIAN_QR = f"NumFac: FE-4521\nFecFac: 2026-10-13\nNitFac: 890903938-8\nValFac: 37815.00\nValIva: 7185.00\nValTolFac: 45000.00\nCUFE: {CUFE}"


def _reader(extractor: FakeExtractor, routing: str = "by_difficulty") -> DocumentReader:
    config = ReadingConfig(
        "primary",
        "lite",
        "strong",
        routing,
        0.7,
        ImageOptions(1600, 2400, 15.0, 400),
        ExtractionOptions("v3", 2500, "minimal", "low", False),
        supported_currencies=("COP", "USD"),
        currency_aliases={"PAB": "USD"},
    )

    async def provider() -> ReadingConfig:
        return config

    return DocumentReader(PillowDocumentPreparer(), ZxingQrDecoder(), extractor, InvoiceVerifier(), provider)


async def test_photo_with_fiscal_qr_uses_the_lite_model_and_qr_values_win() -> None:
    extractor = FakeExtractor(respond=lambda _r, _n: [invoice(invoice_number="FE 4521?", fiscal_id=None)])
    outcome = await _reader(extractor).read(make_jpeg(DIAN_QR), "image/jpeg", ExtractionContext(), TODAY)
    assert extractor.calls[0].model == "lite"
    assert extractor.calls[0].known_values["total"] == "45000.00"
    doc = outcome.documents[0]
    assert doc.invoice_number == "FE-4521" and doc.fiscal_id == CUFE
    assert doc.field_sources["total"] == "qr" and doc.field_sources["vendor_name"] == "ai"
    assert not outcome.escalated and outcome.warnings == [[]]


async def test_photo_without_qr_uses_the_primary_model() -> None:
    extractor = FakeExtractor()
    await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert extractor.calls[0].model == "primary"


async def test_always_primary_routing() -> None:
    extractor = FakeExtractor()
    await _reader(extractor, "always_primary").read(make_jpeg(DIAN_QR), "image/jpeg", ExtractionContext(), TODAY)
    assert extractor.calls[0].model == "primary"


async def test_failed_verification_escalates_with_reasoning_and_keeps_the_better_reading() -> None:
    def respond(_request: ExtractionRequest, call: int) -> list:  # type: ignore[type-arg]
        return [invoice(total=Decimal("54000"))] if call == 1 else [invoice()]

    extractor = FakeExtractor(respond=respond)
    outcome = await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert [c.model for c in extractor.calls] == ["primary", "strong"]
    assert extractor.calls[1].reasoning is True
    assert outcome.escalated and outcome.documents[0].total == Decimal("45000")
    assert outcome.attempts[0].escalation_reason and "arithmetic" in outcome.attempts[0].escalation_reason
    assert outcome.warnings == [[]]


async def test_problems_that_survive_escalation_become_warnings() -> None:
    extractor = FakeExtractor(respond=lambda _r, _n: [invoice(total=Decimal("54000"), confidence=0.4)])
    outcome = await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert set(outcome.warnings[0]) == {ExpenseWarning.LOW_CONFIDENCE, ExpenseWarning.VERIFICATION_FAILED}


async def test_blurry_photo_stops_before_calling_the_ai() -> None:
    extractor = FakeExtractor()
    outcome = await _reader(extractor).read(make_jpeg(blurry=True), "image/jpeg", ExtractionContext(), TODAY)
    assert outcome.unreadable and extractor.calls == []


async def test_unreadable_answer_is_not_escalated() -> None:
    extractor = FakeExtractor(respond=lambda _r, _n: [], legibility=Legibility.UNREADABLE)
    outcome = await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert outcome.unreadable and len(extractor.calls) == 1


async def test_several_invoices_in_one_photo() -> None:
    extractor = FakeExtractor(
        respond=lambda _r, _n: [
            invoice(),
            invoice(vendor_name="Taxi", total=Decimal("12000"), subtotal=None, tax_amount=None, lines=()),
        ]
    )
    outcome = await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert len(outcome.documents) == 2 and len(outcome.warnings) == 2


async def test_balboas_are_recorded_as_dollars_and_unknown_currencies_are_flagged() -> None:
    extractor = FakeExtractor(respond=lambda _r, _n: [invoice(currency="PAB"), invoice(currency="XYZ", invoice_number="POS-2")])
    outcome = await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert [d.currency for d in outcome.documents] == ["USD", "XYZ"]
    assert ExpenseWarning.UNSUPPORTED_CURRENCY not in outcome.warnings[0]
    assert ExpenseWarning.UNSUPPORTED_CURRENCY in outcome.warnings[1]


async def test_a_photo_that_is_not_a_receipt_is_not_escalated() -> None:
    extractor = FakeExtractor(respond=lambda _r, _n: [invoice(is_receipt=False, total=None, confidence=0.1)])
    outcome = await _reader(extractor).read(make_jpeg(), "image/jpeg", ExtractionContext(), TODAY)
    assert outcome.not_a_receipt and outcome.unreadable and len(extractor.calls) == 1
