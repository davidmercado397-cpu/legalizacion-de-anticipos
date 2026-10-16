"""Vista de la legalización para el frontend: cada gasto con su foto (URL firmada), lo que se leyó,
sus líneas y las fechas de cada paso; la línea de tiempo del anticipo y las sugerencias de marcas al
devolverla. Todo en una sola consulta por tabla (sin N+1)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from app.application import messages as msg
from app.application.advances import AdvanceDetail, AdvanceService
from app.application.expenses import ExpenseService, FileLinks
from app.domain.entities import Company, Employee, Expense, ExpenseLine
from app.domain.enums import Channel, ExpenseStatus
from app.domain.ports import AuditFilter, Page, UnitOfWorkFactory

_TIMELINE_LIMIT = 200


@dataclass(frozen=True)
class ExpenseView:
    expense: Expense
    lines: list[ExpenseLine]
    file: FileLinks | None


@dataclass(frozen=True)
class LegalizationDetail:
    detail: AdvanceDetail
    company: Company
    owner: Employee
    items: list[ExpenseView]


@dataclass(frozen=True)
class TimelineEvent:
    action: str
    label: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    channel: Channel
    at: datetime
    note: str | None


@dataclass(frozen=True)
class ReturnSuggestion:
    expense_id: uuid.UUID
    note: str


class LegalizationService:
    def __init__(self, uow: UnitOfWorkFactory, advances: AdvanceService, expenses: ExpenseService) -> None:
        self._uow = uow
        self._advances = advances
        self._expenses = expenses

    async def detail(self, actor: Employee, advance_id: uuid.UUID) -> LegalizationDetail:
        detail = await self._advances.get(actor, advance_id)  # aquí se valida la visibilidad
        async with self._uow() as uow:
            company = await uow.companies.get(detail.advance.company_id)
            owner = await uow.employees.get(detail.advance.employee_id)
            lines = await uow.lines.list_for_expenses([e.id for e in detail.expenses])
        assert company is not None and owner is not None
        by_expense: dict[uuid.UUID, list[ExpenseLine]] = {}
        for line in lines:
            by_expense.setdefault(line.expense_id, []).append(line)
        visible = [e for e in detail.expenses if e.status != ExpenseStatus.DISCARDED]
        files = await self._expenses.file_links(visible)
        items = [ExpenseView(e, by_expense.get(e.id, []), files.get(e.id)) for e in visible]
        return LegalizationDetail(detail, company, owner, items)

    async def timeline(self, actor: Employee, advance_id: uuid.UUID) -> list[TimelineEvent]:
        await self._advances.get(actor, advance_id)
        async with self._uow() as uow:
            entries = await uow.audit.find(
                AuditFilter(entity_type="advance", entity_id=str(advance_id)), Page(_TIMELINE_LIMIT, 0)
            )
            names: dict[uuid.UUID, str] = {}
            for actor_id in {e.actor_id for e in entries.items if e.actor_id}:
                person = await uow.employees.get(actor_id)
                if person is not None:
                    names[actor_id] = person.full_name
        events = [
            TimelineEvent(
                entry.action,
                msg.TIMELINE_LABELS.get(entry.action, entry.action),
                entry.actor_id,
                names.get(entry.actor_id) if entry.actor_id else None,
                entry.channel,
                entry.created_at,
                (entry.data or {}).get("note"),
            )
            for entry in entries.items
        ]
        return sorted(events, key=lambda e: e.at)

    async def return_suggestions(self, actor: Employee, advance_id: uuid.UUID) -> list[ReturnSuggestion]:
        """Gastos que conviene marcar al devolver: los que tienen hallazgos o advertencias, con un
        comentario listo que el aprobador confirma, edita o quita."""
        detail = await self._advances.get(actor, advance_id)
        suggestions = []
        for expense in detail.expenses:
            if expense.status != ExpenseStatus.CONFIRMED:
                continue
            codes = [f.get("code", "") for f in expense.policy_findings] + list(expense.warnings)
            notes = [msg.RETURN_SUGGESTIONS[code] for code in dict.fromkeys(codes) if code in msg.RETURN_SUGGESTIONS]
            if notes:
                suggestions.append(ReturnSuggestion(expense.id, " ".join(notes)))
        return suggestions
