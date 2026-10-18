from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from app.domain.entities import Advance, Employee, Expense
from app.domain.enums import AdvanceKind, AdvanceStatus, ExpenseSource, ExpenseStatus, Legibility, Role
from app.domain.errors import InvalidOperationError, PermissionDeniedError
from app.domain.files import detect_mime
from app.domain.fiscal import is_valid_colombian_nit, nit_check_digit, parse_fiscal_qr
from app.domain.permissions import Permission, has_permission
from app.domain.values import is_bsuid, normalize_phone
from app.domain.verification import InvoiceVerifier
from tests.fakes import invoice

NOW = datetime(2026, 10, 15, tzinfo=UTC)
TODAY = NOW.date()


def _people() -> tuple[Employee, Employee, Employee]:
    company = uuid.uuid4()
    approver = Employee("Ana", "ana@x.com", Role.APPROVER, company_ids=[company])
    employee = Employee("Juan", "juan@x.com", Role.EMPLOYEE, company_ids=[company], approver_id=approver.id)
    stranger = Employee("Otro", "otro@x.com", Role.APPROVER, company_ids=[company])
    return approver, employee, stranger


def _advance(employee: Employee, currency: str = "COP") -> Advance:
    return Advance(
        employee.id,
        employee.company_ids[0],
        AdvanceKind.CASH,
        currency,
        Decimal("800000"),
        "Obra Medellín",
        "Medellín",
        date(2026, 10, 12),
        date(2026, 10, 15),
    )


class TestFiscal:
    def test_known_nit_check_digits(self) -> None:
        assert nit_check_digit("800197268") == 4  # DIAN
        assert nit_check_digit("890903938") == 8  # Bancolombia
        assert is_valid_colombian_nit("800.197.268-4") is True
        assert is_valid_colombian_nit("800197268-5") is False
        assert is_valid_colombian_nit("800197268") is None  # sin dígito de verificación impreso

    def test_dian_qr_payload(self) -> None:
        cufe = "a" * 96
        text = (
            "NumFac: FE-4521\nFecFac: 2026-10-13\nNitFac: 890900608\nDocAdq: 900111222\n"
            f"ValFac: 37815.00\nValIva: 7185.00\nValOtroIm: 0.00\nValTolFac: 45000.00\nCUFE: {cufe}\n"
            f"QRCode: https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey={cufe}"
        )
        qr = parse_fiscal_qr(text)
        assert qr is not None and qr.country == "CO"
        assert qr.invoice_number == "FE-4521" and qr.total == Decimal("45000.00")
        assert qr.invoice_date == date(2026, 10, 13) and qr.fiscal_id == cufe

    def test_dian_url_only_qr(self) -> None:
        qr = parse_fiscal_qr("https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=abc123")
        assert qr is not None and qr.fiscal_id == "abc123" and qr.total is None

    def test_sat_qr(self) -> None:
        url = "https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=5803EB8D-81CD-4557-8719-26632D2FA434&re=XAXX010101000&rr=XEXX010101000&tt=1234.56&fe=abcd1234"
        qr = parse_fiscal_qr(url)
        assert qr is not None and qr.country == "MX" and qr.total == Decimal("1234.56")

    def test_unknown_qr_is_ignored(self) -> None:
        assert parse_fiscal_qr("https://example.com/menu") is None


class TestVerification:
    verifier = InvoiceVerifier()

    def test_clean_invoice_has_no_issues(self) -> None:
        assert self.verifier.verify(invoice(), TODAY) == []

    def test_arithmetic_and_lines(self) -> None:
        codes = {i.code for i in self.verifier.verify(invoice(total=Decimal("60000")), TODAY)}
        assert {"arithmetic", "lines_sum"} <= codes

    def test_tip_is_accepted(self) -> None:
        doc = invoice(tip_amount=Decimal("4500"), total=Decimal("49500"), itemized=False)
        assert self.verifier.verify(doc, TODAY) == []

    def test_discount_is_subtracted_from_the_lines(self) -> None:
        # Factura de Makro: las líneas suman 229.600, el descuento es 12.102 y el total pagado 217.498. El subtotal
        # impreso (la base de IVA) ya viene con el descuento restado.
        from app.domain.values import InvoiceLine

        prices = ("12050", "41500", "95700", "16500", "56500", "7350")
        doc = invoice(
            subtotal=Decimal("202978"),
            tax_amount=Decimal("14520"),
            discount_amount=Decimal("12102"),
            total=Decimal("217498"),
            lines=tuple(InvoiceLine(f"Producto {i}", Decimal(p), Decimal(1)) for i, p in enumerate(prices)),
        )
        assert self.verifier.verify(doc, TODAY) == []
        without_discount = {i.code for i in self.verifier.verify(replace(doc, discount_amount=None), TODAY)}
        assert "lines_sum" in without_discount

    def test_subtotal_before_the_discount_is_accepted(self) -> None:
        doc = invoice(
            subtotal=Decimal("100000"),
            tax_amount=Decimal("0"),
            discount_amount=Decimal("10000"),
            total=Decimal("90000"),
            itemized=False,
        )
        assert self.verifier.verify(doc, TODAY) == []

    def test_wrong_nit_future_date_and_bad_cufe(self) -> None:
        doc = invoice(vendor_tax_id="800197268-9", invoice_date=TODAY + timedelta(days=5), fiscal_id="xyz")
        codes = {i.code for i in self.verifier.verify(doc, TODAY)}
        assert {"nit_check_digit", "date_in_future", "fiscal_id_format"} <= codes

    def test_qr_total_mismatch(self) -> None:
        qr = parse_fiscal_qr("NumFac: 1\nValTolFac: 50000\nCUFE: x")
        codes = {i.code for i in self.verifier.verify(invoice(), TODAY, qr)}
        assert "qr_total_mismatch" in codes


class TestEntities:
    def test_nobody_approves_their_own_advance(self) -> None:
        approver, employee, _ = _people()
        own = _advance(approver)
        with pytest.raises(PermissionDeniedError):
            own.approve(approver, approver)

    def test_only_the_direct_approver_decides(self) -> None:
        approver, employee, stranger = _people()
        advance = _advance(employee)
        with pytest.raises(PermissionDeniedError):
            advance.approve(stranger, employee)
        advance.approve(approver, employee)
        assert advance.status == AdvanceStatus.APPROVED and advance.decided_by == approver.id
        with pytest.raises(InvalidOperationError):
            advance.approve(approver, employee)

    def test_confirm_in_other_currency_needs_converted_value(self) -> None:
        approver, employee, _ = _people()
        advance = _advance(employee, "COP")
        advance.approve(approver, employee)
        expense = Expense(employee.id, ExpenseSource.APP)
        expense.apply_reading(invoice(currency="USD", total=Decimal("20")), [], Legibility.GOOD, NOW)
        with pytest.raises(InvalidOperationError):
            expense.confirm(advance, NOW)
        expense.confirm(advance, NOW, amount_applied=Decimal("80000"))
        assert expense.status == ExpenseStatus.CONFIRMED
        assert advance.balance([expense]).pending == Decimal("720000")

    def test_progressive_login_lock(self) -> None:
        employee = Employee("Juan", "juan@x.com")
        for _ in range(4):
            employee.register_failed_login(NOW, 5, timedelta(minutes=5))
        assert not employee.is_locked(NOW)
        employee.register_failed_login(NOW, 5, timedelta(minutes=5))
        assert employee.locked_until == NOW + timedelta(minutes=5)
        employee.register_failed_login(NOW, 5, timedelta(minutes=5))
        assert employee.locked_until == NOW + timedelta(minutes=10)

    def test_changing_phone_drops_the_whatsapp_link(self) -> None:
        employee = Employee("Juan", "juan@x.com", phone="573001112233")
        employee.link_whatsapp("CO.123", NOW)
        employee.set_phone("573009998877")
        assert employee.wa_user_id is None

    def test_permissions_by_role(self) -> None:
        assert has_permission(Role.ADMIN, Permission.USERS_MANAGE)
        assert not has_permission(Role.ACCOUNTANT, Permission.USERS_MANAGE)
        assert has_permission(Role.APPROVER, Permission.ADVANCES_APPROVE)
        assert not has_permission(Role.EMPLOYEE, Permission.ADVANCES_APPROVE)


class TestValues:
    def test_phone_normalization(self) -> None:
        assert normalize_phone("+57 300 111 2233") == "573001112233"
        assert normalize_phone("5215512345678") == "525512345678"  # prefijo móvil antiguo de México

    def test_bsuid_format(self) -> None:
        assert is_bsuid("CO.1502576394655843")
        assert not is_bsuid("573001112233")

    def test_mime_by_magic_bytes(self) -> None:
        assert detect_mime(b"%PDF-1.7 ...") == "application/pdf"
        assert detect_mime(b"\xff\xd8\xff\xe0abc") == "image/jpeg"
        assert detect_mime(b"<html>not an image</html>") is None
