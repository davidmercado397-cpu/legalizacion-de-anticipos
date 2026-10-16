"""Conocimiento fiscal: dígitos de verificación de NIT, ids fiscales y payloads de QR fiscales.

Los formatos de QR salen de los anexos técnicos públicos (DIAN, SAT, DGI). Hay que validarlos con
facturas reales del cliente antes de confiar en ellos en producción; lo que no se pueda parsear se
ignora y la lectura con IA toma el control."""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlparse

from app.domain.values import FiscalQrData

_NIT_WEIGHTS = (71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3)
_CUFE_RE = re.compile(r"^[0-9a-fA-F]{96}$")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def nit_check_digit(nit: str) -> int:
    """Dígito de verificación DIAN (módulo 11) de un NIT colombiano que viene sin él."""
    digits = nit.zfill(15)
    total = sum(int(d) * w for d, w in zip(digits, _NIT_WEIGHTS, strict=True))
    remainder = total % 11
    return remainder if remainder in (0, 1) else 11 - remainder


def split_nit(tax_id: str | None) -> tuple[str, int | None] | None:
    """'900.123.456-7' -> ('900123456', 7); '900123456' -> ('900123456', None)."""
    if not tax_id:
        return None
    cleaned = tax_id.strip().replace(".", "").replace(" ", "")
    if "-" in cleaned:
        base, _, dv = cleaned.partition("-")
        if base.isdigit() and dv.isdigit() and len(dv) == 1:
            return base, int(dv)
        return None
    return (cleaned, None) if cleaned.isdigit() else None


def is_valid_colombian_nit(tax_id: str | None) -> bool | None:
    """True/False si trae dígito de verificación y se puede validar; None si no hay cómo saberlo."""
    parts = split_nit(tax_id)
    if parts is None or parts[1] is None or not 6 <= len(parts[0]) <= 15:
        return None
    return nit_check_digit(parts[0]) == parts[1]


def tax_id_key(tax_id: str | None) -> str | None:
    """Forma comparable de un NIT, RFC o RUC: sin puntos, espacios ni dígito de verificación.
    '900.123.456-7' y '900123456' son el mismo NIT."""
    if not tax_id:
        return None
    parts = split_nit(tax_id)
    if parts is not None:
        return parts[0].lstrip("0") or "0"
    cleaned = "".join(ch for ch in tax_id.upper() if ch.isalnum())
    return cleaned or None


def same_tax_id(a: str | None, b: str | None) -> bool:
    key_a, key_b = tax_id_key(a), tax_id_key(b)
    if not key_a or not key_b:
        return False
    if key_a == key_b:
        return True
    # Un NIT escrito con el dígito de verificación pegado (9001234567) también es el mismo.
    short, long_ = sorted((key_a, key_b), key=len)
    return short.isdigit() and long_.isdigit() and len(long_) == len(short) + 1 and long_.startswith(short)


def is_valid_fiscal_id(country: str | None, fiscal_id: str | None) -> bool | None:
    if not fiscal_id:
        return None
    if country == "CO":
        return bool(_CUFE_RE.match(fiscal_id))
    if country == "MX":
        return bool(_UUID_RE.match(fiscal_id))
    return None


def _decimal(value: str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(value.strip().replace(",", ""))
    except (InvalidOperation, AttributeError):
        return None


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value.strip()[:10]) if value else None
    except ValueError:
        return None


def parse_fiscal_qr(text: str) -> FiscalQrData | None:
    text = text.strip()
    if "NumFac" in text or "CUFE" in text or "catalogo-vpfe.dian.gov.co" in text:
        return _parse_dian(text)
    if "verificacfdi.facturaelectronica.sat.gob.mx" in text:
        return _parse_sat(text)
    if "dgi-fep.mef.gob.pa" in text:
        return _parse_dgi(text)
    return None


def _parse_dian(text: str) -> FiscalQrData:
    fields: dict[str, str] = {}
    for raw_line in text.splitlines():
        key, sep, value = raw_line.partition(":")
        if sep:
            fields[key.strip().lower()] = value.strip()
    cufe = fields.get("cufe")
    # Muchos tiquetes POS solo codifican la URL de consulta de la DIAN, que trae el CUFE como "documentkey".
    match = re.search(r"https?://\S+", text)
    if not cufe and match:
        params = {k.lower(): v[0] for k, v in parse_qs(urlparse(match.group(0)).query).items()}
        cufe = params.get("documentkey")
    return FiscalQrData(
        country="CO",
        fiscal_id=cufe,
        invoice_number=fields.get("numfac"),
        invoice_date=_date(fields.get("fecfac")),
        vendor_tax_id=fields.get("nitfac"),
        buyer_tax_id=fields.get("docadq"),
        subtotal=_decimal(fields.get("valfac")),
        tax_amount=_decimal(fields.get("valiva")),
        total=_decimal(fields.get("valtolfac")),
    )


def _parse_sat(text: str) -> FiscalQrData:
    params = {k.lower(): v[0] for k, v in parse_qs(urlparse(text).query).items()}
    return FiscalQrData(
        country="MX",
        fiscal_id=params.get("id"),
        vendor_tax_id=params.get("re"),
        buyer_tax_id=params.get("rr"),
        total=_decimal(params.get("tt")),
    )


def _parse_dgi(text: str) -> FiscalQrData:
    params = {k.lower(): v[0] for k, v in parse_qs(urlparse(text).query).items()}
    return FiscalQrData(country="PA", fiscal_id=params.get("chfe"))
