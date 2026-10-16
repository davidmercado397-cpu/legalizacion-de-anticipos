"""Tableros (contabilidad y administración) y uso de la plataforma. `?format=xlsx` descarga el Excel."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Query, Response

from app.adapters.inbound.http.deps import ContainerDep, CurrentEmployee
from app.adapters.inbound.http.schemas import (
    AccuracyOut,
    AiCostCompanyOut,
    AiCostModelOut,
    AiCostMonthOut,
    AiCostsOut,
    AiCostTotalsOut,
    BudgetComplianceOut,
    IntercompanyOut,
    ListOut,
    PendingBalanceOut,
    SpendOut,
    UsageCompanyOut,
    UsageOut,
)
from app.container import Container
from app.domain.ports import ReportTable

router = APIRouter(tags=["reports"])
Format = Literal["json", "xlsx"]
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _excel(container: Container, table: ReportTable, name: str) -> Response:
    return Response(
        content=container.exporter.writer.write(table),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"', "Cache-Control": "private, no-store"},
    )


@router.get("/reports/pending-balances", response_model=ListOut[PendingBalanceOut], summary="Balances to legalize, with age")
async def pending_balances(
    actor: CurrentEmployee, container: ContainerDep, company_id: uuid.UUID | None = None, format: Format = "json"
) -> ListOut[PendingBalanceOut] | Response:
    items = await container.reports.pending_balances(actor, company_id)
    if format == "xlsx":
        return _excel(container, container.reports.pending_table(items), "saldos_por_legalizar")
    data = [PendingBalanceOut(**i.row.__dict__, pending=i.row.pending, days=i.days, bucket=i.bucket) for i in items]
    return ListOut[PendingBalanceOut](data=data)


@router.get("/reports/spend", response_model=ListOut[SpendOut], summary="Spend by category, country and company")
async def spend(
    actor: CurrentEmployee,
    container: ContainerDep,
    start: date,
    end: date,
    company_id: uuid.UUID | None = None,
    format: Format = "json",
) -> ListOut[SpendOut] | Response:
    rows = await container.reports.spend(actor, start, end, company_id)
    if format == "xlsx":
        return _excel(container, container.reports.spend_table(rows, start, end), "gasto_por_concepto")
    return ListOut[SpendOut](data=[SpendOut(**r.__dict__) for r in rows])


@router.get("/reports/budget-compliance", response_model=ListOut[BudgetComplianceOut], summary="Calculated budget vs legalized")
async def budget_compliance(
    actor: CurrentEmployee,
    container: ContainerDep,
    start: date,
    end: date,
    company_id: uuid.UUID | None = None,
    format: Format = "json",
) -> ListOut[BudgetComplianceOut] | Response:
    rows = await container.reports.budget_compliance(actor, start, end, company_id)
    if format == "xlsx":
        return _excel(container, container.reports.budget_table(rows, start, end), "cumplimiento_presupuesto")
    data = [BudgetComplianceOut(**r.__dict__, difference=r.budget - r.spent) for r in rows]
    return ListOut[BudgetComplianceOut](data=data)


@router.get(
    "/reports/intercompany-invoices",
    response_model=ListOut[IntercompanyOut],
    summary="Invoices billed to another company of the group",
)
async def intercompany(
    actor: CurrentEmployee,
    container: ContainerDep,
    start: date,
    end: date,
    company_id: uuid.UUID | None = None,
    format: Format = "json",
) -> ListOut[IntercompanyOut] | Response:
    rows = await container.reports.intercompany(actor, start, end, company_id)
    if format == "xlsx":
        return _excel(container, container.reports.intercompany_table(rows, start, end), "facturas_otra_compania")
    return ListOut[IntercompanyOut](data=[IntercompanyOut(**r.__dict__) for r in rows])


@router.get("/usage", response_model=UsageOut, summary="Documents processed and AI cost of a month")
async def usage(
    actor: CurrentEmployee, container: ContainerDep, month: str, include_test: bool = False, format: Format = "json"
) -> UsageOut | Response:
    report = await container.reports.usage(actor, month, include_test)
    if format == "xlsx":
        return _excel(container, container.reports.usage_table(report), f"uso_{month}")
    companies = [UsageCompanyOut(**r.__dict__) for r in report.rows]
    return UsageOut(**{k: v for k, v in report.__dict__.items() if k != "rows"}, companies=companies)


@router.get("/ai-costs", response_model=AiCostsOut, summary="AI cost and tokens by month, model and company (platform operator)")
async def ai_costs(
    actor: CurrentEmployee,
    container: ContainerDep,
    from_month: str | None = Query(None, alias="from", description="AAAA-MM; por defecto, cinco meses antes de `to`"),
    to_month: str | None = Query(None, alias="to", description="AAAA-MM; por defecto, el mes vigente"),
    format: Format = "json",
) -> AiCostsOut | Response:
    report = await container.reports.ai_costs(actor, from_month, to_month)
    if format == "xlsx":
        return _excel(container, container.reports.ai_costs_table(report), f"costo_ia_{report.from_month}_{report.to_month}")
    return AiCostsOut(
        from_month=report.from_month,
        to_month=report.to_month,
        totals=AiCostTotalsOut(**report.totals.__dict__),
        months=[
            AiCostMonthOut(
                month=m.month,
                totals=AiCostTotalsOut(**m.totals.__dict__),
                models=[
                    AiCostModelOut(
                        model=model.model,
                        totals=AiCostTotalsOut(**model.totals.__dict__),
                        companies=[
                            AiCostCompanyOut(**{k: v for k, v in r.__dict__.items() if k not in ("month", "model")})
                            for r in model.companies
                        ],
                    )
                    for model in m.models
                ],
            )
            for m in report.months
        ],
    )


@router.get("/companies/{company_id}/ai-accuracy", response_model=AccuracyOut, summary="How often the AI read right")
async def ai_accuracy(company_id: uuid.UUID, month: str, actor: CurrentEmployee, container: ContainerDep) -> AccuracyOut:
    return AccuracyOut(**(await container.reports.ai_accuracy(actor, company_id, month)).__dict__)
