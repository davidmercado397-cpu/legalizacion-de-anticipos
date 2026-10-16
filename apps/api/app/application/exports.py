"""Excel de legalización para contabilidad: puente mientras no exista la integración con Siesa."""

from __future__ import annotations

import uuid

from app.application import messages as msg
from app.application.advances import AdvanceService
from app.domain.deductibility import DeductibilityBreakdown, breakdown
from app.domain.entities import Category, Employee, Expense, ExpenseLine
from app.domain.enums import ExpenseStatus
from app.domain.ports import ReportTable, SpreadsheetWriter, UnitOfWorkFactory

COLUMNS = [
    "Fecha",
    "Hora",
    "Tipo de soporte",
    "Proveedor",
    "NIT / ID",
    "Tercero genérico",
    "N.º factura",
    "CUFE / UUID",
    "Adquiriente (NIT)",
    "Categoría",
    "Cuenta contable",
    "Descripción",
    "Moneda",
    "Subtotal",
    "Detalle de impuestos",
    "Impuestos",
    "Propina",
    "Total",
    "Valor aplicado",
    "No reembolsable",
    "Neto legalizado",
    "Deducibilidad",
    "Base deducible",
    "IVA descontable",
    "IVA no descontable",
    "INC",
    "Asume el empleado",
    "Hallazgos de política",
    "Justificación",
    "Revisión",
    "Nota de revisión",
]


class LegalizationExporter:
    def __init__(self, uow: UnitOfWorkFactory, advances: AdvanceService, writer: SpreadsheetWriter) -> None:
        self._uow = uow
        self._advances = advances
        self.writer = writer

    async def export(self, actor: Employee, advance_id: uuid.UUID) -> tuple[str, bytes]:
        detail = await self._advances.get(actor, advance_id)  # aquí se valida la visibilidad
        advance = detail.advance
        async with self._uow() as uow:
            owner = await uow.employees.get(advance.employee_id)
            company = await uow.companies.get(advance.company_id)
            categories = {c.code: c for c in await uow.categories.list_for_company(advance.company_id, active_only=False)}
            concepts = {c.code: c for c in await uow.concepts.list_for_company(advance.company_id, active_only=False)}
            lines = await uow.lines.list_for_expenses([e.id for e in detail.expenses])
        assert owner is not None and company is not None
        confirmed = [e for e in detail.expenses if e.status == ExpenseStatus.CONFIRMED]
        header = [
            ("Compañía", company.name),
            ("Empleado", f"{owner.full_name} ({owner.email})"),
            ("Anticipo", f"{advance.label} · {advance.kind}"),
            ("Estado", str(advance.status)),
            ("Entregado", msg.money(detail.balance.amount, advance.currency)),
            ("Legalizado", msg.money(detail.balance.applied, advance.currency)),
            ("Pendiente", msg.money(detail.balance.pending, advance.currency)),
        ]
        by_expense: dict[uuid.UUID, list[ExpenseLine]] = {}
        for line in lines:
            by_expense.setdefault(line.expense_id, []).append(line)
        rows = [_row(e, company.generic_tax_id, categories, breakdown(e, by_expense.get(e.id, []), concepts)) for e in confirmed]
        header.append(("Deducibilidad", msg.DEDUCTIBILITY_NOTE))
        table = ReportTable(f"Legalización {advance.label}", header, COLUMNS, rows)
        filename = f"legalizacion_{owner.first_name.lower()}_{advance.id.hex[:8]}.xlsx"
        return filename, self.writer.write(table)


def _row(
    e: Expense, generic_tax_id: str | None, categories: dict[str, Category], split: DeductibilityBreakdown | None
) -> list[object]:
    findings = "; ".join(f"{f.get('code')} ({f.get('action')})" for f in e.policy_findings)
    category = categories.get(e.category or "")
    taxes = "; ".join(_tax_text(t) for t in e.taxes)
    return [
        e.invoice_date,
        e.invoice_time,
        e.document_type,
        e.vendor_name,
        e.vendor_tax_id,
        generic_tax_id if not e.vendor_tax_id else None,
        e.invoice_number,
        e.fiscal_id,
        e.buyer_tax_id,
        category.name if category else e.category,
        category.accounting_account if category else None,
        e.description,
        e.currency,
        e.subtotal,
        taxes or None,
        e.tax_amount,
        e.tip_amount,
        e.total,
        e.amount_applied,
        e.non_reimbursable_amount,
        e.applied_net,
        e.deductibility,
        split.deductible_base if split else None,
        split.vat_creditable if split else None,
        split.vat_non_creditable if split else None,
        split.consumption_tax if split else None,
        split.employee_assumed if split else None,
        findings or None,
        e.justification,
        e.review_status,
        e.review_note,
    ]


def _tax_text(tax: dict[str, object]) -> str:
    rate = f" {tax['rate']}%" if tax.get("rate") is not None else ""
    return f"{str(tax.get('type', '')).upper()}{rate}: {tax.get('amount')}"
