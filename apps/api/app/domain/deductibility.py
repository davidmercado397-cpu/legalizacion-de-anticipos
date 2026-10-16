"""Desglose de deducibilidad por línea de la factura, para contabilidad.

Es una sugerencia calculada (el criterio tributario lo define contabilidad de Forsa):
- El documento manda: si no es deducible (tipo de documento o factura que no está a nombre de la
  compañía), nada lo es.
- Las líneas bloqueadas que el aprobador aceptó "sin lo no reembolsable" las asume el empleado y
  quedan fuera de la base de la compañía; aceptadas completas, siguen la marca del concepto.
- El IVA se reparte en proporción a las líneas: el de las líneas deducibles es descontable.
- El INC y otros impuestos no se descuentan; la propina va aparte."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal

from app.domain.entities import BlockedConcept, Expense, ExpenseLine
from app.domain.enums import Deductibility, ReviewStatus, TaxType

_CENT = Decimal("0.01")


@dataclass(frozen=True)
class DeductibilityBreakdown:
    deductible_base: Decimal
    non_deductible_base: Decimal
    employee_assumed: Decimal  # líneas bloqueadas que paga el empleado (base + su IVA)
    vat_creditable: Decimal
    vat_non_creditable: Decimal
    consumption_tax: Decimal  # INC: no es descontable
    other_taxes: Decimal
    tip: Decimal

    def as_dict(self) -> dict[str, str]:
        return {key: str(value) for key, value in asdict(self).items()}


def _tax(expense: Expense, *types: TaxType) -> Decimal:
    wanted = {t.value for t in types}
    return sum((Decimal(str(t["amount"])) for t in expense.taxes if t.get("type") in wanted), Decimal(0))


def breakdown(expense: Expense, lines: list[ExpenseLine], concepts: dict[str, BlockedConcept]) -> DeductibilityBreakdown | None:
    if expense.total is None:
        return None
    tip = expense.tip_amount or Decimal(0)
    if expense.taxes:
        vat = _tax(expense, TaxType.IVA, TaxType.IEPS, TaxType.ITBMS)
        inc = _tax(expense, TaxType.INC)
        other = _tax(expense, TaxType.OTHER)
    else:
        # Facturas sin desglose: todo el impuesto se trata como IVA, como lo imprimen casi siempre.
        vat, inc, other = expense.tax_amount or Decimal(0), Decimal(0), Decimal(0)
    base = expense.subtotal if expense.subtotal is not None else expense.total - vat - inc - other - tip
    document_ok = expense.deductibility == Deductibility.DEDUCTIBLE
    priced = [line for line in lines if line.amount is not None and line.amount > 0]
    lines_total = sum((line.amount or Decimal(0) for line in priced), Decimal(0))
    shares: dict[str, Decimal] = {"deductible": Decimal(0), "non_deductible": Decimal(0), "assumed": Decimal(0)}
    if not priced or lines_total <= 0:
        shares["deductible" if document_ok else "non_deductible"] = Decimal(1)
    else:
        for line in priced:
            share = (line.amount or Decimal(0)) / lines_total
            concept = concepts.get(line.final_concept_code or "")
            if line.is_blocked and expense.review_status == ReviewStatus.ACCEPTED_PARTIAL:
                shares["assumed"] += share
            elif document_ok and (not line.is_blocked or (concept is not None and concept.deductible)):
                shares["deductible"] += share
            else:
                shares["non_deductible"] += share
    company_share = shares["deductible"] + shares["non_deductible"]
    return DeductibilityBreakdown(
        deductible_base=(base * shares["deductible"]).quantize(_CENT),
        non_deductible_base=(base * shares["non_deductible"]).quantize(_CENT),
        employee_assumed=((base + vat) * shares["assumed"]).quantize(_CENT),
        vat_creditable=(vat * shares["deductible"]).quantize(_CENT),
        vat_non_creditable=(vat * shares["non_deductible"]).quantize(_CENT),
        consumption_tax=(inc * company_share).quantize(_CENT),
        other_taxes=(other * company_share).quantize(_CENT),
        tip=tip.quantize(_CENT),
    )
