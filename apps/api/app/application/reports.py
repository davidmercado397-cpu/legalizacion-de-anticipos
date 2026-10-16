"""Tableros para el frontend (y su exportación a Excel). Las consultas viven en el ReportRepository
(SQLAlchemy Core); aquí solo se autoriza, se calcula lo que depende de la zona horaria de cada
compañía y se arma la tabla para Excel."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

from app.application import messages as msg
from app.application.access import AccessPolicy
from app.application.settings import SettingsService
from app.domain.entities import Employee
from app.domain.errors import NotFoundError, ValidationError
from app.domain.permissions import Permission
from app.domain.ports import (
    AiCostRow,
    BudgetRow,
    Clock,
    IntercompanyRow,
    PendingBalanceRow,
    ReportTable,
    SpendRow,
    UnitOfWorkFactory,
    UsageRow,
)
from app.domain.time import local_date

_ACCURACY_FIELDS = ("vendor_name", "total", "invoice_date", "category")
_DEFAULT_COST_MONTHS = 6  # el mes vigente y los cinco anteriores


@dataclass(frozen=True)
class PendingBalance:
    row: PendingBalanceRow
    days: int | None  # días desde que terminó el viaje (o desde la aprobación si no tiene fechas)
    bucket: str


@dataclass(frozen=True)
class UsageReport:
    month: str
    rows: list[UsageRow]
    documents: int
    included_documents: int
    extra_documents: int
    extra_price: Decimal
    extra_amount: Decimal
    price_currency: str
    cost_usd: Decimal


@dataclass(frozen=True)
class AccuracyReport:
    month: str
    lines: int
    lines_matched: int
    memory_hits: int
    documents: int
    fields: dict[str, float]  # campo -> fracción de documentos en que la IA acertó
    corrected_before_confirm: int  # documentos en que el usuario cambió algo de lo que leyó la IA


@dataclass(frozen=True)
class AiCostTotals:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    cost_usd: Decimal = Decimal(0)

    def plus(self, row: AiCostRow | AiCostTotals) -> AiCostTotals:
        return AiCostTotals(
            self.calls + row.calls,
            self.prompt_tokens + row.prompt_tokens,
            self.completion_tokens + row.completion_tokens,
            self.cached_tokens + row.cached_tokens,
            self.cost_usd + row.cost_usd,
        )


@dataclass(frozen=True)
class AiCostModel:
    model: str
    totals: AiCostTotals
    companies: list[AiCostRow]


@dataclass(frozen=True)
class AiCostMonth:
    month: str
    totals: AiCostTotals
    models: list[AiCostModel]


@dataclass(frozen=True)
class AiCostReport:
    from_month: str
    to_month: str
    totals: AiCostTotals
    months: list[AiCostMonth]  # del más reciente al más antiguo, también los meses sin lecturas


def month_range(month: str) -> tuple[datetime, datetime]:
    """'2026-10' -> [1 oct, 1 nov) en UTC."""
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
    except ValueError as exc:
        raise ValidationError("Invalid month", code="invalid_month") from exc
    end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
    return start, end


class ReportService:
    def __init__(self, uow: UnitOfWorkFactory, access: AccessPolicy, settings: SettingsService, clock: Clock) -> None:
        self._uow = uow
        self._access = access
        self._settings = settings
        self._clock = clock

    def _scope(self, actor: Employee, company_id: uuid.UUID | None) -> list[uuid.UUID] | None:
        self._access.require(actor, Permission.REPORTS_EXPORT)
        allowed = None if actor.is_admin else list(actor.company_ids)
        if company_id is None:
            return allowed
        if allowed is not None and company_id not in allowed:
            raise NotFoundError("company")
        return [company_id]

    async def pending_balances(self, actor: Employee, company_id: uuid.UUID | None = None) -> list[PendingBalance]:
        scope = self._scope(actor, company_id)
        limits = (await self._settings.current()).aging_buckets
        async with self._uow() as uow:
            rows = await uow.reports.pending_balances(scope)
            zones = {c.id: c.timezone for c in await uow.companies.find()}
        now = self._clock.now()
        result = []
        for row in rows:
            today = local_date(now, zones.get(row.company_id, "UTC"))
            reference = row.end_date or (
                local_date(row.approved_at, zones.get(row.company_id, "UTC")) if row.approved_at else None
            )
            days = max((today - reference).days, 0) if reference else None
            result.append(PendingBalance(row, days, _bucket(days, limits)))
        return result

    async def spend(self, actor: Employee, start: date, end: date, company_id: uuid.UUID | None = None) -> list[SpendRow]:
        scope = self._scope(actor, company_id)
        async with self._uow() as uow:
            return await uow.reports.spend(scope, start, end)

    async def budget_compliance(
        self, actor: Employee, start: date, end: date, company_id: uuid.UUID | None = None
    ) -> list[BudgetRow]:
        scope = self._scope(actor, company_id)
        async with self._uow() as uow:
            return await uow.reports.budget_compliance(scope, start, end)

    async def intercompany(
        self, actor: Employee, start: date, end: date, company_id: uuid.UUID | None = None
    ) -> list[IntercompanyRow]:
        scope = self._scope(actor, company_id)
        async with self._uow() as uow:
            return await uow.reports.intercompany(scope, start, end)

    async def usage(self, actor: Employee, month: str, include_test: bool = False) -> UsageReport:
        """Comprobantes del mes frente a los incluidos en el plan, y costo real de la IA."""
        self._access.require(actor, Permission.USAGE_READ)
        start, end = month_range(month)
        current = await self._settings.current()
        async with self._uow() as uow:
            rows = await uow.reports.usage(start, end, include_test)
        documents = sum(r.documents for r in rows)
        extra = max(documents - current.usage_included_documents, 0)
        price = Decimal(str(current.usage_extra_document_price))
        return UsageReport(
            month,
            rows,
            documents,
            current.usage_included_documents,
            extra,
            price,
            price * extra,
            current.usage_price_currency,
            sum((r.cost_usd for r in rows), Decimal(0)),
        )

    async def ai_costs(self, actor: Employee, from_month: str | None = None, to_month: str | None = None) -> AiCostReport:
        """Costo real de la IA (USD y tokens) por mes, modelo y compañía. Solo el operador de la
        plataforma: son agregados, sin datos de gastos ni de personas."""
        self._access.require(actor, Permission.PLATFORM_COSTS_READ)
        now = self._clock.now()
        to_month = to_month or now.strftime("%Y-%m")
        _, end = month_range(to_month)
        if from_month is None:
            first = end
            for _ in range(_DEFAULT_COST_MONTHS):
                first = _previous_month(first)
            from_month = first.strftime("%Y-%m")
        start, _ = month_range(from_month)
        if start >= end:
            raise ValidationError("Invalid month range", code="invalid_month_range")
        async with self._uow() as uow:
            rows = await uow.reports.ai_costs(start, end)
        months = []
        cursor = end
        while cursor > start:
            cursor = _previous_month(cursor)
            label = cursor.strftime("%Y-%m")
            of_month = [r for r in rows if r.month == label]
            models = []
            for model in dict.fromkeys(r.model for r in of_month):
                companies = [r for r in of_month if r.model == model]
                models.append(AiCostModel(model, _sum(companies), companies))
            models.sort(key=lambda m: m.totals.cost_usd, reverse=True)
            months.append(AiCostMonth(label, _sum(of_month), models))
        return AiCostReport(from_month, to_month, _sum(rows), months)

    async def ai_accuracy(self, actor: Employee, company_id: uuid.UUID, month: str) -> AccuracyReport:
        self._scope(actor, company_id)
        start, end = month_range(month)
        async with self._uow() as uow:
            lines, matched, memory = await uow.reports.line_accuracy(company_id, start, end)
            samples = await uow.reports.header_samples(company_id, start, end)
        fields = {}
        for name in _ACCURACY_FIELDS:
            hits = sum(1 for s in samples if _same(s.ai.get(name), s.final.get(name)))
            fields[name] = round(hits / len(samples), 4) if samples else 0.0
        corrected = sum(1 for s in samples if any(not _same(s.ai.get(n), s.final.get(n)) for n in _ACCURACY_FIELDS))
        return AccuracyReport(month, lines, matched, memory, len(samples), fields, corrected)

    # --- Excel ---------------------------------------------------------------------------------

    @staticmethod
    def pending_table(items: list[PendingBalance]) -> ReportTable:
        rows = [
            [
                i.row.company_name,
                i.row.employee_name,
                i.row.destination,
                msg.ADVANCE_STATUS_LABELS.get(i.row.status.value, i.row.status.value),
                i.row.currency,
                i.row.amount,
                i.row.applied,
                i.row.pending,
                i.row.end_date,
                i.days,
                i.bucket,
            ]
            for i in items
        ]
        return ReportTable("Saldos por legalizar", [], msg.REPORT_COLUMNS["pending_balances"], rows)

    @staticmethod
    def spend_table(rows: list[SpendRow], start: date, end: date) -> ReportTable:
        data = [[r.company_name, r.category, r.country, r.currency, r.expenses, r.total] for r in rows]
        return ReportTable("Gasto por concepto", [("Periodo", f"{start} a {end}")], msg.REPORT_COLUMNS["spend"], data)

    @staticmethod
    def budget_table(rows: list[BudgetRow], start: date, end: date) -> ReportTable:
        data = [[r.company_name, r.employee_name, r.category, r.currency, r.budget, r.spent, r.budget - r.spent] for r in rows]
        return ReportTable("Cumplimiento del presupuesto", [("Viajes", f"{start} a {end}")], msg.REPORT_COLUMNS["budget"], data)

    @staticmethod
    def intercompany_table(rows: list[IntercompanyRow], start: date, end: date) -> ReportTable:
        data = [[r.company_name, r.billed_to, r.employee_name, r.vendor_name, r.invoice_date, r.currency, r.total] for r in rows]
        return ReportTable(
            "Facturas a nombre de otra compañía", [("Periodo", f"{start} a {end}")], msg.REPORT_COLUMNS["intercompany"], data
        )

    @staticmethod
    def ai_costs_table(report: AiCostReport) -> ReportTable:
        data = [
            [
                month.month,
                model.model,
                row.company_name or msg.NO_COMPANY,
                msg.YES if row.is_test else msg.NO,
                row.calls,
                row.prompt_tokens,
                row.completion_tokens,
                row.cached_tokens,
                row.cost_usd,
            ]
            for month in report.months
            for model in month.models
            for row in model.companies
        ]
        header = [("Periodo", f"{report.from_month} a {report.to_month}"), ("Costo total (USD)", f"{report.totals.cost_usd:.4f}")]
        return ReportTable("Costo de la IA", header, msg.REPORT_COLUMNS["ai_costs"], data)

    @staticmethod
    def usage_table(report: UsageReport) -> ReportTable:
        data = [[r.company_name, r.documents, r.attempts, r.escalated, r.cost_usd, r.avg_latency_ms] for r in report.rows]
        header = [
            ("Mes", report.month),
            ("Comprobantes", str(report.documents)),
            ("Incluidos en el plan", str(report.included_documents)),
            ("Adicionales", str(report.extra_documents)),
            ("Valor adicionales", msg.money(report.extra_amount, report.price_currency)),
        ]
        return ReportTable("Uso de la plataforma", header, msg.REPORT_COLUMNS["usage"], data)


def _previous_month(moment: datetime) -> datetime:
    return moment.replace(year=moment.year - 1, month=12) if moment.month == 1 else moment.replace(month=moment.month - 1)


def _sum(rows: list[AiCostRow]) -> AiCostTotals:
    total = AiCostTotals()
    for row in rows:
        total = total.plus(row)
    return total


def _bucket(days: int | None, limits: list[int]) -> str:
    if days is None:
        return msg.AGING_NO_DATE
    lower = 0
    for limit in limits:
        if days <= limit:
            return f"{lower}-{limit}"
        lower = limit + 1
    return f"+{limits[-1]}" if limits else msg.AGING_NO_DATE


def _same(ai: object, final: object) -> bool:
    if ai is None or final is None:
        return ai is final
    try:
        return Decimal(str(ai)) == Decimal(str(final))
    except ArithmeticError:
        return str(ai).strip().lower() == str(final).strip().lower()
