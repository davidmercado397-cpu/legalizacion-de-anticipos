"""Consultas de los tableros con SQLAlchemy Core sobre las mismas tablas (`tables.py`): agregan en
PostgreSQL con GROUP BY, parámetros siempre ligados y sin cargar entidades."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.outbound.persistence import tables as t
from app.domain.enums import AdvanceStatus, ExpenseStatus, ReviewStatus
from app.domain.ports import AccuracySample, AiCostRow, BudgetRow, IntercompanyRow, PendingBalanceRow, SpendRow, UsageRow

_e, _a, _c, _emp = t.expenses.c, t.advances.c, t.companies.c, t.employees.c

# Lo que un gasto confirmado descuenta del anticipo (igual que Expense.applied_net en el dominio).
_APPLIED_NET = sa.case(
    (_e.review_status == ReviewStatus.REJECTED, sa.literal(0)),
    else_=sa.func.coalesce(_e.amount_applied, 0) - sa.func.coalesce(_e.non_reimbursable_amount, 0),
)
_COUNTED = sa.and_(_e.status == ExpenseStatus.CONFIRMED, _e.review_status != ReviewStatus.REJECTED)


def _companies(stmt: sa.Select, column: sa.ColumnElement, company_ids: list[uuid.UUID] | None) -> sa.Select:
    stmt = stmt.where(_c.is_test.is_(False))
    return stmt.where(column.in_(company_ids)) if company_ids is not None else stmt


_INTERCOMPANY = "invoice_to_other_group_company"


def _billed_to(findings: list[dict[str, object]]) -> str | None:
    for finding in findings or []:
        detail = finding.get("detail")
        if finding.get("code") == _INTERCOMPANY and isinstance(detail, dict):
            return str(detail.get("company") or "") or None
    return None


def _dec(value: object) -> Decimal:
    return Decimal(str(value or 0))


class SqlReportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def pending_balances(self, company_ids: list[uuid.UUID] | None) -> list[PendingBalanceRow]:
        applied = (
            sa.select(_e.advance_id, sa.func.sum(_APPLIED_NET).label("applied"))
            .where(_COUNTED, _e.advance_id.is_not(None))
            .group_by(_e.advance_id)
            .subquery()
        )
        stmt = (
            sa.select(
                _a.id,
                _emp.full_name,
                _c.id.label("company_id"),
                _c.name,
                _a.destination,
                _a.status,
                _a.currency,
                _a.amount,
                sa.func.coalesce(applied.c.applied, 0).label("applied"),
                _a.end_date,
                _a.approved_at,
            )
            .select_from(t.advances.join(t.employees, _emp.id == _a.employee_id).join(t.companies, _c.id == _a.company_id))
            .outerjoin(applied, applied.c.advance_id == _a.id)
            .where(_a.status.in_([AdvanceStatus.APPROVED, AdvanceStatus.IN_REVIEW]))
            .order_by(_c.name, _emp.full_name, _a.end_date)
        )
        rows = await self._s.execute(_companies(stmt, _a.company_id, company_ids))
        return [
            PendingBalanceRow(r[0], r[1], r[2], r[3], r[4], AdvanceStatus(r[5]), r[6], _dec(r[7]), _dec(r[8]), r[9], r[10])
            for r in rows
        ]

    async def spend(self, company_ids: list[uuid.UUID] | None, start: date, end: date) -> list[SpendRow]:
        stmt = (
            sa.select(
                _c.name,
                _e.category,
                _e.country,
                _e.currency,
                sa.func.count().label("expenses"),
                sa.func.sum(_e.total).label("total"),
            )
            .select_from(t.expenses.join(t.companies, _c.id == _e.company_id))
            .where(_COUNTED, _e.invoice_date >= start, _e.invoice_date <= end)
            .group_by(_c.name, _e.category, _e.country, _e.currency)
            .order_by(_c.name, sa.func.sum(_e.total).desc())
        )
        rows = await self._s.execute(_companies(stmt, _e.company_id, company_ids))
        return [SpendRow(r[0], r[1], r[2], r[3], int(r[4]), _dec(r[5])) for r in rows]

    async def budget_compliance(self, company_ids: list[uuid.UUID] | None, start: date, end: date) -> list[BudgetRow]:
        # Cada línea del presupuesto calculado (JSONB) frente a lo legalizado en esa categoría.
        lines = (
            sa.func.jsonb_to_recordset(_a.budget_breakdown)
            .table_valued(sa.column("category", sa.String), sa.column("amount", sa.Numeric))
            .render_derived(with_types=True)
        )
        budget = (
            sa.select(_a.id.label("advance_id"), lines.c.category, sa.func.sum(lines.c.amount).label("budget"))
            .select_from(t.advances)
            .join(lines, sa.true())
            .where(_a.budget_amount.is_not(None), _a.start_date >= start, _a.start_date <= end)
            .group_by(_a.id, lines.c.category)
            .subquery()
        )
        spent = (
            sa.select(_e.advance_id, _e.category, sa.func.sum(_APPLIED_NET).label("spent"))
            .where(_COUNTED, _e.advance_id.is_not(None))
            .group_by(_e.advance_id, _e.category)
            .subquery()
        )
        stmt = (
            sa.select(
                _a.id,
                _emp.full_name,
                _c.name,
                _a.currency,
                budget.c.category,
                budget.c.budget,
                sa.func.coalesce(spent.c.spent, 0),
            )
            .select_from(
                budget.join(t.advances, _a.id == budget.c.advance_id)
                .join(t.employees, _emp.id == _a.employee_id)
                .join(t.companies, _c.id == _a.company_id)
            )
            .outerjoin(spent, sa.and_(spent.c.advance_id == budget.c.advance_id, spent.c.category == budget.c.category))
            .order_by(_c.name, _emp.full_name, budget.c.category)
        )
        rows = await self._s.execute(_companies(stmt, _a.company_id, company_ids))
        return [BudgetRow(r[0], r[1], r[2], r[3], r[4], _dec(r[5]), _dec(r[6])) for r in rows]

    async def intercompany(self, company_ids: list[uuid.UUID] | None, start: date, end: date) -> list[IntercompanyRow]:
        finding = sa.cast([{"code": _INTERCOMPANY}], pg.JSONB)
        stmt = (
            sa.select(
                _e.id,
                _c.name,
                _e.policy_findings,
                _emp.full_name,
                _e.vendor_name,
                _e.invoice_date,
                _e.currency,
                _e.total,
            )
            .select_from(t.expenses.join(t.companies, _c.id == _e.company_id).join(t.employees, _emp.id == _e.employee_id))
            .where(_e.policy_findings.contains(finding), _e.invoice_date >= start, _e.invoice_date <= end)
            .where(_e.status.notin_([ExpenseStatus.DISCARDED, ExpenseStatus.UNREADABLE, ExpenseStatus.FAILED]))
            .order_by(_e.invoice_date)
        )
        rows = await self._s.execute(_companies(stmt, _e.company_id, company_ids))
        return [IntercompanyRow(r[0], r[1], _billed_to(r[2]), r[3], r[4], r[5], r[6], r[7]) for r in rows]

    async def usage(self, start: datetime, end: datetime, include_test: bool) -> list[UsageRow]:
        at = t.extraction_attempts.c
        attempts = (
            sa.select(
                at.expense_id,
                sa.func.count().label("attempts"),
                sa.func.count().filter(at.tier == "escalation").label("escalated"),
                sa.func.coalesce(sa.func.sum(at.cost_usd), 0).label("cost"),
                sa.func.avg(at.latency_ms).label("latency"),
            )
            .where(at.created_at >= start, at.created_at < end)
            .group_by(at.expense_id)
            .subquery()
        )
        stmt = (
            sa.select(
                _c.id,
                _c.name,
                sa.func.count(sa.distinct(sa.func.coalesce(_e.parent_id, _e.id))).label("documents"),
                sa.func.coalesce(sa.func.sum(attempts.c.attempts), 0),
                sa.func.coalesce(sa.func.sum(attempts.c.escalated), 0),
                sa.func.coalesce(sa.func.sum(attempts.c.cost), 0),
                sa.func.avg(attempts.c.latency),
            )
            .select_from(t.expenses.join(t.companies, _c.id == _e.company_id))
            .outerjoin(attempts, attempts.c.expense_id == _e.id)
            .where(_e.processed_at >= start, _e.processed_at < end)
            .group_by(_c.id, _c.name)
            .order_by(_c.name)
        )
        if not include_test:
            stmt = stmt.where(_c.is_test.is_(False))
        rows = await self._s.execute(stmt)
        return [
            UsageRow(r[0], r[1], int(r[2]), int(r[3]), int(r[4]), _dec(r[5]), int(r[6]) if r[6] is not None else None)
            for r in rows
        ]

    async def ai_costs(self, start: datetime, end: datetime) -> list[AiCostRow]:
        at = t.extraction_attempts.c
        month = sa.func.to_char(sa.func.timezone("UTC", at.created_at), "YYYY-MM").label("month")
        model = sa.func.coalesce(at.model_used, at.model_requested).label("model")
        stmt = (
            sa.select(
                month,
                model,
                _c.id,
                _c.name,
                sa.func.coalesce(sa.func.bool_or(_c.is_test), False),
                sa.func.count(),
                sa.func.coalesce(sa.func.sum(at.prompt_tokens), 0),
                sa.func.coalesce(sa.func.sum(at.completion_tokens), 0),
                sa.func.coalesce(sa.func.sum(at.cached_tokens), 0),
                sa.func.coalesce(sa.func.sum(at.cost_usd), 0),
            )
            .select_from(
                t.extraction_attempts.join(t.expenses, _e.id == at.expense_id).outerjoin(t.companies, _c.id == _e.company_id)
            )
            .where(at.created_at >= start, at.created_at < end)
            .group_by(month, model, _c.id, _c.name)
            .order_by(month.desc(), model, _c.name)
        )
        result = [
            AiCostRow(r[0], r[1], r[2], r[3], bool(r[4]), int(r[5]), int(r[6]), int(r[7]), int(r[8]), _dec(r[9]))
            for r in await self._s.execute(stmt)
        ]
        return _merge_costs(result, await self._statement_costs(start, end))

    async def _statement_costs(self, start: datetime, end: datetime) -> list[AiCostRow]:
        """Extractos en PDF leídos con IA (conciliación)."""
        bs = t.bank_statements.c
        month = sa.func.to_char(sa.func.timezone("UTC", bs.uploaded_at), "YYYY-MM").label("month")
        stmt = (
            sa.select(
                month,
                bs.ai_model,
                _c.id,
                _c.name,
                sa.func.coalesce(sa.func.bool_or(_c.is_test), False),
                sa.func.count(),
                sa.func.coalesce(sa.func.sum(bs.ai_prompt_tokens), 0),
                sa.func.coalesce(sa.func.sum(bs.ai_completion_tokens), 0),
                sa.func.coalesce(sa.func.sum(bs.ai_cached_tokens), 0),
                sa.func.coalesce(sa.func.sum(bs.ai_cost_usd), 0),
            )
            .select_from(t.bank_statements.join(t.companies, _c.id == bs.company_id))
            .where(bs.ai_model.is_not(None), bs.uploaded_at >= start, bs.uploaded_at < end)
            .group_by(month, bs.ai_model, _c.id, _c.name)
        )
        return [
            AiCostRow(r[0], r[1], r[2], r[3], bool(r[4]), int(r[5]), int(r[6]), int(r[7]), int(r[8]), _dec(r[9]))
            for r in await self._s.execute(stmt)
        ]

    async def line_accuracy(self, company_id: uuid.UUID, start: datetime, end: datetime) -> tuple[int, int, int]:
        lc = t.expense_lines.c
        stmt = (
            sa.select(
                sa.func.count(),
                sa.func.count().filter(lc.ai_concept_code.is_not_distinct_from(lc.final_concept_code)),
                sa.func.count().filter(lc.memory_example_id.is_not(None)),
            )
            .select_from(t.expense_lines.join(t.expenses, _e.id == lc.expense_id))
            .where(_e.company_id == company_id, _e.status == ExpenseStatus.CONFIRMED)
            .where(_e.confirmed_at >= start, _e.confirmed_at < end)
        )
        total, matched, memory = (await self._s.execute(stmt)).one()
        return int(total), int(matched), int(memory)

    async def header_samples(self, company_id: uuid.UUID, start: datetime, end: datetime) -> list[AccuracySample]:
        stmt = sa.select(_e.ai_snapshot, _e.vendor_name, _e.total, _e.invoice_date, _e.category).where(
            _e.company_id == company_id,
            _e.status == ExpenseStatus.CONFIRMED,
            _e.ai_snapshot.is_not(None),
            _e.confirmed_at >= start,
            _e.confirmed_at < end,
        )
        rows = await self._s.execute(stmt)
        return [
            AccuracySample(
                r[0] or {},
                {
                    "vendor_name": r[1],
                    "total": None if r[2] is None else str(r[2]),
                    "invoice_date": None if r[3] is None else str(r[3]),
                    "category": r[4],
                },
            )
            for r in rows
        ]


def _merge_costs(*groups: list[AiCostRow]) -> list[AiCostRow]:
    """Suma las filas del mismo mes, modelo y compañía (facturas y extractos), en el orden del reporte."""
    merged: dict[tuple[str, str, uuid.UUID | None], AiCostRow] = {}
    for row in (r for group in groups for r in group):
        key = (row.month, row.model, row.company_id)
        prev = merged.get(key)
        merged[key] = (
            row
            if prev is None
            else replace(
                prev,
                calls=prev.calls + row.calls,
                prompt_tokens=prev.prompt_tokens + row.prompt_tokens,
                completion_tokens=prev.completion_tokens + row.completion_tokens,
                cached_tokens=prev.cached_tokens + row.cached_tokens,
                cost_usd=prev.cost_usd + row.cost_usd,
            )
        )
    by_model = sorted(merged.values(), key=lambda r: (r.model, r.company_name or ""))
    return sorted(by_model, key=lambda r: r.month, reverse=True)  # estable: el mes más reciente primero
