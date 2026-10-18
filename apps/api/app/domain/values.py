from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, time
from decimal import Decimal

from app.domain.enums import DocumentType, TaxType

# Un BSUID se ve así: "CO.1502576394655843" (código ISO de país, un punto, hasta 128 alfanuméricos).
_BSUID_RE = re.compile(r"^[A-Z]{2}\.[A-Za-z0-9.]{1,128}$")


def normalize_phone(phone: str | None) -> str | None:
    """Solo dígitos (formato wa_id de WhatsApp). México: Meta puede mandar el prefijo móvil viejo
    521XXXXXXXXXX; guardamos el canónico 52XXXXXXXXXX para que ambas formas den con el mismo usuario."""
    digits = "".join(ch for ch in phone or "" if ch.isdigit())
    if len(digits) == 13 and digits.startswith("521"):
        digits = "52" + digits[3:]
    return digits or None


def is_bsuid(value: str | None) -> bool:
    return bool(value) and bool(_BSUID_RE.match(value or ""))


@dataclass(frozen=True)
class WhatsAppAddress:
    """A dónde mandar un mensaje de WhatsApp: al teléfono si lo conocemos, si no al BSUID."""

    phone: str | None = None
    user_id: str | None = None

    def __post_init__(self) -> None:
        if not self.phone and not self.user_id:
            raise ValueError("A WhatsApp address needs a phone or a business-scoped user id")


@dataclass(frozen=True)
class WhatsAppSender:
    user_id: str | None  # BSUID, siempre viene desde la actualización de usernames de Meta (2026)
    phone: str | None  # puede no venir si el usuario tiene username
    username: str | None = None
    profile_name: str | None = None

    @property
    def address(self) -> WhatsAppAddress:
        return WhatsAppAddress(phone=self.phone, user_id=self.user_id)


@dataclass(frozen=True)
class InvoiceLine:
    description: str
    amount: Decimal | None = None
    quantity: Decimal | None = None
    concept_code: str | None = None  # concepto bloqueado que detectó la IA (None = ítem permitido)
    concept_confidence: float | None = None


@dataclass(frozen=True)
class TaxItem:
    type: TaxType
    amount: Decimal
    rate: Decimal | None = None  # porcentaje: 19 = 19 %
    base: Decimal | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "type": self.type.value,
            "amount": str(self.amount),
            "rate": None if self.rate is None else str(self.rate),
            "base": None if self.base is None else str(self.base),
        }


@dataclass(frozen=True)
class InvoiceData:
    """Lo que el pipeline de lectura sabe de un documento fiscal."""

    document_type: DocumentType | None = None
    vendor_name: str | None = None
    vendor_tax_id: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    invoice_time: time | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax_amount: Decimal | None = None  # suma de `taxes`
    tip_amount: Decimal | None = None
    discount_amount: Decimal | None = None  # descuentos de la factura, en positivo; ya restados del total
    total: Decimal | None = None
    fiscal_id: str | None = None  # CUFE (CO/PA) o UUID (MX)
    buyer_tax_id: str | None = None  # NIT/RFC/RUC del adquiriente impreso en la factura
    country: str | None = None
    category: str | None = None  # código de una categoría de la compañía
    description: str | None = None
    itemized: bool = False
    is_receipt: bool = True  # False = la foto no es una factura ni un recibo
    confidence: float = 0.0
    taxes: tuple[TaxItem, ...] = ()
    lines: tuple[InvoiceLine, ...] = ()
    field_sources: dict[str, str] = field(default_factory=dict)  # campo -> qr | pdf_text | ai


@dataclass(frozen=True)
class FiscalQrData:
    """Valores leídos del QR fiscal impreso en una factura electrónica; mandan sobre lo que lea la IA."""

    country: str
    fiscal_id: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    vendor_tax_id: str | None = None
    buyer_tax_id: str | None = None
    subtotal: Decimal | None = None
    tax_amount: Decimal | None = None
    total: Decimal | None = None

    @property
    def has_amounts(self) -> bool:
        return self.total is not None
