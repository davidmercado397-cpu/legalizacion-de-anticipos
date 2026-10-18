"""Chequeos deterministas sobre lo que leyó la IA. Un chequeo fallido es motivo para escalar al modelo
más fuerte, y si sigue fallando después de escalar se vuelve una alerta para el usuario / aprobador.

La confianza que reporta el propio modelo está mal calibrada, así que estos chequeos pesan más que ella."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.domain.fiscal import is_valid_colombian_nit, is_valid_fiscal_id
from app.domain.values import FiscalQrData, InvoiceData


@dataclass(frozen=True)
class VerificationIssue:
    code: str
    detail: str


def _close(a: Decimal, b: Decimal) -> bool:
    # Tolerancia: 1 unidad o el 1 % del valor mayor (los recibos redondean como quieren).
    tolerance = max(Decimal(1), max(abs(a), abs(b)) * Decimal("0.01"))
    return abs(a - b) <= tolerance


class InvoiceVerifier:
    def __init__(self, max_age_days: int = 400) -> None:
        self._max_age = timedelta(days=max_age_days)

    def verify(self, doc: InvoiceData, today: date, qr: FiscalQrData | None = None) -> list[VerificationIssue]:
        issues: list[VerificationIssue] = []
        if doc.total is None or doc.total <= 0:
            issues.append(VerificationIssue("total_missing", "Total is missing or not positive"))
        if not doc.currency:
            issues.append(VerificationIssue("currency_missing", "Currency is missing"))
        if doc.invoice_date is None:
            issues.append(VerificationIssue("date_missing", "Invoice date is missing"))
        elif doc.invoice_date > today + timedelta(days=1):
            issues.append(VerificationIssue("date_in_future", f"Invoice date {doc.invoice_date} is in the future"))
        elif doc.invoice_date < today - self._max_age:
            issues.append(VerificationIssue("date_too_old", f"Invoice date {doc.invoice_date} is too old"))
        issues.extend(self._arithmetic(doc))
        if (doc.country or "CO") == "CO" and is_valid_colombian_nit(doc.vendor_tax_id) is False:
            issues.append(VerificationIssue("nit_check_digit", f"NIT {doc.vendor_tax_id} has a wrong check digit"))
        if is_valid_fiscal_id(doc.country, doc.fiscal_id) is False:
            issues.append(VerificationIssue("fiscal_id_format", "Fiscal id (CUFE/UUID) has an invalid format"))
        if qr is not None:
            issues.extend(self._against_qr(doc, qr))
        return issues

    @staticmethod
    def _arithmetic(doc: InvoiceData) -> list[VerificationIssue]:
        issues: list[VerificationIssue] = []
        tip = doc.tip_amount or Decimal(0)
        discount = doc.discount_amount or Decimal(0)
        if doc.total is not None and doc.subtotal is not None and doc.tax_amount is not None:
            # Algunos recibos imprimen un subtotal que ya incluye impuestos, y otros uno que ya tiene restado el
            # descuento: se acepta cualquiera de esas lecturas.
            sums = (doc.subtotal + doc.tax_amount + tip, doc.subtotal + tip)
            if not any(_close(s, doc.total) or _close(s - discount, doc.total) for s in sums):
                issues.append(VerificationIssue("arithmetic", "subtotal + taxes - discount does not match the total"))
        amounts = [line.amount for line in doc.lines if line.amount is not None]
        if doc.itemized and amounts and doc.total is not None:
            lines_sum = sum(amounts, Decimal(0))
            # Las líneas van con su precio antes del descuento; el descuento se resta aparte.
            candidates = [doc.total, doc.subtotal, doc.total - tip]
            if not any(c is not None and (_close(lines_sum, c) or _close(lines_sum - discount, c)) for c in candidates):
                issues.append(VerificationIssue("lines_sum", "The line items minus the discount do not add up to the total"))
        return issues

    @staticmethod
    def _against_qr(doc: InvoiceData, qr: FiscalQrData) -> list[VerificationIssue]:
        issues: list[VerificationIssue] = []
        if qr.total is not None and doc.total is not None and not _close(qr.total, doc.total):
            issues.append(VerificationIssue("qr_total_mismatch", "The total read differs from the fiscal QR"))
        return issues
