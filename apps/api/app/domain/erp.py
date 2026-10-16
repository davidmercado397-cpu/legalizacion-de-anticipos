"""Documentos que se envían al ERP (Siesa): el anticipo al aprobarse y la legalización cuando contabilidad
la cierra (decisiones 8.1 y 8.2, un documento por legalización). Son datos planos: cómo se traducen a
la API de Siesa lo decide su adaptador."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class ErpAdvance:
    advance_id: uuid.UUID
    company_tax_id: str | None
    company_name: str
    employee_name: str
    employee_email: str
    kind: str
    currency: str
    amount: Decimal
    purpose: str
    destination: str | None
    start_date: date | None
    end_date: date | None


@dataclass(frozen=True)
class ErpLegalizationLine:
    expense_id: uuid.UUID
    invoice_date: date | None
    vendor_name: str | None
    vendor_tax_id: str | None  # el del proveedor o, si no tiene, el tercero genérico de la compañía
    invoice_number: str | None
    fiscal_id: str | None
    category: str | None
    accounting_account: str | None
    currency: str | None
    total: Decimal | None
    legalized: Decimal  # neto en la moneda del anticipo, sin lo no reembolsable
    non_reimbursable: Decimal
    deductibility: str | None


@dataclass(frozen=True)
class ErpLegalization:
    advance_id: uuid.UUID
    erp_advance_ref: str
    company_tax_id: str | None
    employee_email: str
    currency: str
    delivered: Decimal
    legalized: Decimal
    balance: Decimal  # positivo: el viajero reintegra; negativo: la empresa le reembolsa
    lines: tuple[ErpLegalizationLine, ...]
