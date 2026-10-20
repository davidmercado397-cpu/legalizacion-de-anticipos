"""Toda consulta se apoya en un índice y los listados siempre van paginados."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.outbound.persistence import tables as t
from app.domain.entities import (
    NO_CONCEPT,
    Advance,
    ApproverDelegation,
    AuditEntry,
    BankStatement,
    BlockedConcept,
    Category,
    ClassificationExample,
    Company,
    Employee,
    ExampleHistory,
    ExchangeRate,
    Expense,
    ExpenseLine,
    ExtractionAttempt,
    HeldNotice,
    PolicyRuleConfig,
    RefreshToken,
    StatementMovement,
    TravelBudgetRate,
    TravelZone,
    WhatsAppLinkCode,
    WhatsAppSession,
)
from app.domain.enums import (
    AdvanceStatus,
    DocumentType,
    ExampleKind,
    ExampleScope,
    ExampleStatus,
    ExpenseStatus,
    Role,
    SettlementStatus,
    StaffType,
)
from app.domain.ports import (
    AdvanceFilter,
    AuditFilter,
    EmployeeFilter,
    ExampleFilter,
    ExpenseFilter,
    Page,
    Paged,
    ScopeFilter,
    SimilarExample,
)
from app.domain.settings import SystemSetting


class _Repo:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def _paged[T](self, stmt: sa.Select[tuple[T]], page: Page) -> Paged[T]:
        # El total se cuenta sobre la misma consulta filtrada (sin orden ni límite) para la paginación.
        total = await self._s.scalar(sa.select(sa.func.count()).select_from(stmt.order_by(None).subquery()))
        rows = await self._s.scalars(stmt.limit(page.limit).offset(page.offset))
        return Paged(list(rows.all()), total or 0)


class SqlCompanyRepository(_Repo):
    async def get(self, company_id: uuid.UUID) -> Company | None:
        return await self._s.get(Company, company_id)

    async def add(self, company: Company) -> None:
        self._s.add(company)

    async def find(self, ids: list[uuid.UUID] | None = None) -> list[Company]:
        stmt = sa.select(Company).order_by(t.companies.c.name)
        if ids is not None:
            stmt = stmt.where(t.companies.c.id.in_(ids))
        return list((await self._s.scalars(stmt)).all())


class SqlEmployeeRepository(_Repo):
    async def get(self, employee_id: uuid.UUID) -> Employee | None:
        return await self._s.get(Employee, employee_id)

    async def _one(self, column: sa.Column, value: str) -> Employee | None:
        return (await self._s.scalars(sa.select(Employee).where(column == value))).first()

    async def get_by_email(self, email: str) -> Employee | None:
        return await self._one(t.employees.c.email, email.strip().lower())

    async def get_by_phone(self, phone: str) -> Employee | None:
        return await self._one(t.employees.c.phone, phone)

    async def get_by_wa_user_id(self, user_id: str) -> Employee | None:
        return await self._one(t.employees.c.wa_user_id, user_id)

    async def get_by_welcome_message_id(self, message_id: str) -> Employee | None:
        return await self._one(t.employees.c.wa_welcome_message_id, message_id)

    async def add(self, employee: Employee) -> None:
        self._s.add(employee)

    async def find(self, flt: EmployeeFilter, page: Page) -> Paged[Employee]:
        c = t.employees.c
        stmt = sa.select(Employee).where(c.role != Role.SUPERADMIN).order_by(c.full_name, c.id)
        if flt.company_id is not None:
            stmt = stmt.where(c.company_ids.any(flt.company_id))
        if flt.company_ids_any is not None:
            stmt = stmt.where(c.company_ids.overlap(sa.cast(flt.company_ids_any, c.company_ids.type)))
        if flt.role is not None:
            stmt = stmt.where(c.role == flt.role)
        if flt.active is not None:
            stmt = stmt.where(c.active == flt.active)
        if flt.search:
            like = f"%{flt.search.strip()}%"
            stmt = stmt.where(sa.or_(c.full_name.ilike(like), c.email.ilike(like), c.phone.ilike(like)))
        return await self._paged(stmt, page)

    async def list_reports_of(self, approver_id: uuid.UUID) -> list[uuid.UUID]:
        rows = await self._s.scalars(sa.select(t.employees.c.id).where(t.employees.c.approver_id == approver_id))
        return list(rows.all())


class SqlRefreshTokenRepository(_Repo):
    async def add(self, token: RefreshToken) -> None:
        self._s.add(token)

    async def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        stmt = sa.select(RefreshToken).where(t.refresh_tokens.c.token_hash == token_hash).with_for_update()
        return (await self._s.scalars(stmt)).first()

    async def revoke_family(self, family_id: uuid.UUID, now: datetime) -> None:
        c = t.refresh_tokens.c
        await self._s.execute(
            sa.update(t.refresh_tokens).where(c.family_id == family_id, c.revoked_at.is_(None)).values(revoked_at=now)
        )

    async def revoke_all_for(self, employee_id: uuid.UUID, now: datetime) -> None:
        c = t.refresh_tokens.c
        await self._s.execute(
            sa.update(t.refresh_tokens).where(c.employee_id == employee_id, c.revoked_at.is_(None)).values(revoked_at=now)
        )


class SqlLinkCodeRepository(_Repo):
    async def add(self, code: WhatsAppLinkCode) -> None:
        self._s.add(code)

    async def get_by_hash(self, code_hash: str) -> WhatsAppLinkCode | None:
        stmt = sa.select(WhatsAppLinkCode).where(t.whatsapp_link_codes.c.code_hash == code_hash).with_for_update()
        return (await self._s.scalars(stmt)).first()

    async def invalidate_for(self, employee_id: uuid.UUID, now: datetime) -> None:
        c = t.whatsapp_link_codes.c
        await self._s.execute(
            sa.update(t.whatsapp_link_codes).where(c.employee_id == employee_id, c.used_at.is_(None)).values(used_at=now)
        )


def _scope(stmt: sa.Select, table: sa.Table, scope: ScopeFilter) -> sa.Select:
    if scope.employee_ids is not None:
        stmt = stmt.where(table.c.employee_id.in_(scope.employee_ids))
    if scope.company_ids is not None:
        stmt = stmt.where(table.c.company_id.in_(scope.company_ids))
    return stmt


class SqlAdvanceRepository(_Repo):
    async def get(self, advance_id: uuid.UUID) -> Advance | None:
        return await self._s.get(Advance, advance_id)

    async def add(self, advance: Advance) -> None:
        self._s.add(advance)

    async def find(self, flt: AdvanceFilter, page: Page) -> Paged[Advance]:
        c = t.advances.c
        stmt = sa.select(Advance).order_by(c.created_at.desc(), c.id)
        stmt = _scope(stmt, t.advances, flt.scope)
        if flt.status is not None:
            stmt = stmt.where(c.status == flt.status)
        if flt.employee_id is not None:
            stmt = stmt.where(c.employee_id == flt.employee_id)
        if flt.disbursed is not None:
            stmt = stmt.where(c.disbursed_at.is_not(None) if flt.disbursed else c.disbursed_at.is_(None))
        if flt.settlement_pending:
            stmt = stmt.where(c.settlement_status.in_([SettlementStatus.REFUND_PENDING, SettlementStatus.PAYMENT_PENDING]))
        return await self._paged(stmt, page)

    async def list_open_for(self, employee_id: uuid.UUID) -> list[Advance]:
        c = t.advances.c
        stmt = (
            sa.select(Advance)
            .where(c.employee_id == employee_id, c.status == AdvanceStatus.APPROVED)
            .order_by(c.start_date.desc().nulls_last(), c.created_at.desc())
        )
        return list((await self._s.scalars(stmt)).all())

    async def list_ended(self, until: date) -> list[Advance]:
        c = t.advances.c
        stmt = sa.select(Advance).where(c.status == AdvanceStatus.APPROVED, c.end_date <= until).order_by(c.end_date)
        return list((await self._s.scalars(stmt)).all())


class SqlExpenseRepository(_Repo):
    async def get(self, expense_id: uuid.UUID) -> Expense | None:
        return await self._s.get(Expense, expense_id)

    async def get_for_processing(self, expense_id: uuid.UUID) -> Expense | None:
        # SKIP LOCKED: dos workers (o el barrido) nunca procesan el mismo gasto a la vez.
        stmt = sa.select(Expense).where(t.expenses.c.id == expense_id).with_for_update(skip_locked=True)
        return (await self._s.scalars(stmt)).first()

    async def add(self, expense: Expense) -> None:
        self._s.add(expense)

    async def get_by_wa_message_id(self, wa_message_id: str) -> Expense | None:
        return (await self._s.scalars(sa.select(Expense).where(t.expenses.c.wa_message_id == wa_message_id))).first()

    async def get_by_client_ref(self, employee_id: uuid.UUID, client_ref: str) -> Expense | None:
        c = t.expenses.c
        stmt = sa.select(Expense).where(c.employee_id == employee_id, c.client_ref == client_ref)
        return (await self._s.scalars(stmt)).first()

    async def find(self, flt: ExpenseFilter, page: Page) -> Paged[Expense]:
        c = t.expenses.c
        stmt = sa.select(Expense).order_by(c.created_at.desc(), c.document_index, c.id)
        stmt = _scope(stmt, t.expenses, flt.scope)
        if flt.status is not None:
            stmt = stmt.where(c.status == flt.status)
        if flt.advance_id is not None:
            stmt = stmt.where(c.advance_id == flt.advance_id)
        if flt.employee_id is not None:
            stmt = stmt.where(c.employee_id == flt.employee_id)
        if flt.updated_since is not None:
            stmt = stmt.where(c.updated_at > flt.updated_since)
        if flt.deductibility is not None:
            stmt = stmt.where(c.deductibility == flt.deductibility)
        return await self._paged(stmt, page)

    async def list_for_advance(self, advance_id: uuid.UUID) -> list[Expense]:
        return await self.list_for_advances([advance_id])

    async def list_for_advances(self, advance_ids: list[uuid.UUID]) -> list[Expense]:
        if not advance_ids:
            return []
        c = t.expenses.c
        stmt = sa.select(Expense).where(c.advance_id.in_(advance_ids)).order_by(c.invoice_date, c.created_at)
        return list((await self._s.scalars(stmt)).all())

    async def list_retryable(self, stale_before: datetime, limit: int) -> list[uuid.UUID]:
        c = t.expenses.c
        stmt = (
            sa.select(c.id)
            .where(
                sa.or_(
                    sa.and_(c.status == ExpenseStatus.RECEIVED, c.updated_at < stale_before),
                    sa.and_(c.status == ExpenseStatus.PROCESSING, c.processing_started_at < stale_before),
                )
            )
            .order_by(c.created_at)
            .limit(limit)
        )
        return list((await self._s.scalars(stmt)).all())

    async def count_pending_for(self, employee_id: uuid.UUID) -> int:
        c = t.expenses.c
        stmt = sa.select(sa.func.count()).where(
            c.employee_id == employee_id, c.status.in_([ExpenseStatus.RECEIVED, ExpenseStatus.PROCESSING])
        )
        return int(await self._s.scalar(stmt) or 0)

    async def claim_unnotified(self, employee_id: uuid.UUID, batch_id: uuid.UUID, now: datetime) -> list[Expense]:
        # Reclamo atómico: si dos gastos terminan al mismo tiempo, solo uno se lleva las filas y el
        # usuario recibe un único resumen.
        c = t.expenses.c
        stmt = (
            sa.update(t.expenses)
            .where(
                c.employee_id == employee_id,
                c.source == "whatsapp",
                c.notified_at.is_(None),
                sa.or_(
                    c.status.in_([ExpenseStatus.EXTRACTED, ExpenseStatus.UNREADABLE, ExpenseStatus.FAILED]),
                    sa.and_(c.status == ExpenseStatus.DISCARDED, c.duplicate_of_id.is_not(None)),
                ),
            )
            .values(notified_at=now, notification_batch_id=batch_id)
            .returning(c.id)
        )
        ids = list((await self._s.scalars(stmt)).all())
        if not ids:
            return []
        rows = await self._s.scalars(
            sa.select(Expense)
            .where(c.id.in_(ids))
            .order_by(c.created_at, c.document_index)
            .execution_options(populate_existing=True)
        )
        return list(rows.all())

    async def list_by_batch(self, batch_id: uuid.UUID) -> list[Expense]:
        c = t.expenses.c
        stmt = sa.select(Expense).where(c.notification_batch_id == batch_id).order_by(c.created_at, c.document_index)
        return list((await self._s.scalars(stmt)).all())

    async def list_by_status_for(self, employee_id: uuid.UUID, status: ExpenseStatus) -> list[Expense]:
        c = t.expenses.c
        stmt = sa.select(Expense).where(c.employee_id == employee_id, c.status == status).order_by(c.created_at)
        return list((await self._s.scalars(stmt)).all())

    async def find_own_duplicate(self, expense: Expense, sha256: str | None = None) -> Expense | None:
        c = t.expenses.c
        group = expense.parent_id or expense.id
        keys = []
        if sha256:
            keys.append(sa.and_(c.file_sha256 == sha256, c.document_index == expense.document_index))
        if expense.fiscal_id:
            keys.append(c.fiscal_id == expense.fiscal_id)
        if not keys:
            return None
        stmt = (
            sa.select(Expense)
            .where(
                sa.or_(*keys),
                c.employee_id == expense.employee_id,
                c.id != group,
                sa.or_(c.parent_id.is_(None), c.parent_id != group),
                c.status.in_([ExpenseStatus.EXTRACTED, ExpenseStatus.CONFIRMED]),
            )
            .order_by(c.created_at)
            .limit(1)
        )
        return (await self._s.scalars(stmt)).first()

    async def has_duplicate(self, expense: Expense) -> bool:
        """La misma factura ya registrada por cualquiera en la compañía (id fiscal, id tributario + número,
        proveedor + fecha + total, o el mismo archivo de otra carga)."""
        c = t.expenses.c
        same_file_group = expense.parent_id or expense.id
        keys = []
        if expense.fiscal_id:
            keys.append(c.fiscal_id == expense.fiscal_id)
        if expense.vendor_tax_id and expense.invoice_number:
            keys.append(sa.and_(c.vendor_tax_id == expense.vendor_tax_id, c.invoice_number == expense.invoice_number))
        if expense.vendor_name and expense.invoice_date and expense.total is not None:
            keys.append(
                sa.and_(c.vendor_name == expense.vendor_name, c.invoice_date == expense.invoice_date, c.total == expense.total)
            )
        if expense.file_sha256:
            keys.append(sa.and_(c.file_sha256 == expense.file_sha256, c.document_index == expense.document_index))
        if not keys:
            return False
        stmt = sa.select(sa.literal(1)).where(
            sa.or_(*keys),
            c.id != expense.id,
            sa.or_(c.parent_id.is_(None), c.parent_id != same_file_group),
            c.id != same_file_group,
            c.status.notin_([ExpenseStatus.DISCARDED, ExpenseStatus.UNREADABLE, ExpenseStatus.FAILED]),
        )
        if expense.company_id is not None:
            stmt = stmt.where(c.company_id == expense.company_id)
        return (await self._s.scalar(stmt.limit(1))) is not None

    async def sum_non_fiscal(
        self, employee_id: uuid.UUID, currency: str, since: datetime, exclude_ids: list[uuid.UUID]
    ) -> Decimal:
        c = t.expenses.c
        stmt = sa.select(sa.func.coalesce(sa.func.sum(c.total), 0)).where(
            c.employee_id == employee_id,
            c.document_type == DocumentType.CASH_RECEIPT,
            c.currency == currency,
            c.status.in_([ExpenseStatus.EXTRACTED, ExpenseStatus.CONFIRMED]),
            c.invoice_date >= since.date(),
        )
        if exclude_ids:
            stmt = stmt.where(c.id.notin_(exclude_ids))
        return Decimal(await self._s.scalar(stmt) or 0)


class SqlExpenseLineRepository(_Repo):
    async def add(self, line: ExpenseLine) -> None:
        self._s.add(line)

    async def list_unconfirmed_by_text(self, company_id: uuid.UUID | None, key_text: str) -> list[ExpenseLine]:
        lc, ec = t.expense_lines.c, t.expenses.c
        stmt = (
            sa.select(ExpenseLine)
            .join(t.expenses, ec.id == lc.expense_id)
            .where(lc.normalized_text == key_text, ec.status == ExpenseStatus.EXTRACTED)
        )
        if company_id is not None:
            stmt = stmt.where(ec.company_id == company_id)
        return list((await self._s.scalars(stmt)).all())

    async def get(self, line_id: uuid.UUID) -> ExpenseLine | None:
        return await self._s.get(ExpenseLine, line_id)

    async def list_for_expense(self, expense_id: uuid.UUID) -> list[ExpenseLine]:
        return await self.list_for_expenses([expense_id])

    async def list_for_expenses(self, expense_ids: list[uuid.UUID]) -> list[ExpenseLine]:
        if not expense_ids:
            return []
        c = t.expense_lines.c
        stmt = sa.select(ExpenseLine).where(c.expense_id.in_(expense_ids)).order_by(c.expense_id, c.position)
        return list((await self._s.scalars(stmt)).all())


class SqlBlockedConceptRepository(_Repo):
    async def add(self, concept: BlockedConcept) -> None:
        self._s.add(concept)

    async def get(self, concept_id: uuid.UUID) -> BlockedConcept | None:
        return await self._s.get(BlockedConcept, concept_id)

    async def list_for_company(self, company_id: uuid.UUID, active_only: bool = True) -> list[BlockedConcept]:
        c = t.blocked_concepts.c
        stmt = sa.select(BlockedConcept).where(c.company_id == company_id).order_by(c.code)
        if active_only:
            stmt = stmt.where(c.active.is_(True))
        return list((await self._s.scalars(stmt)).all())


class SqlCategoryRepository(_Repo):
    async def add(self, category: Category) -> None:
        self._s.add(category)

    async def get(self, category_id: uuid.UUID) -> Category | None:
        return await self._s.get(Category, category_id)

    async def list_for_company(self, company_id: uuid.UUID, active_only: bool = True) -> list[Category]:
        c = t.expense_categories.c
        stmt = sa.select(Category).where(c.company_id == company_id).order_by(c.position, c.code)
        if active_only:
            stmt = stmt.where(c.active.is_(True))
        return list((await self._s.scalars(stmt)).all())


class SqlTravelZoneRepository(_Repo):
    async def add(self, zone: TravelZone) -> None:
        self._s.add(zone)

    async def get(self, zone_id: uuid.UUID) -> TravelZone | None:
        return await self._s.get(TravelZone, zone_id)

    async def list_for_company(self, company_id: uuid.UUID, active_only: bool = True) -> list[TravelZone]:
        c = t.travel_zones.c
        stmt = sa.select(TravelZone).where(c.company_id == company_id).order_by(c.name)
        if active_only:
            stmt = stmt.where(c.active.is_(True))
        return list((await self._s.scalars(stmt)).all())


class SqlTravelBudgetRateRepository(_Repo):
    async def add(self, rate: TravelBudgetRate) -> None:
        self._s.add(rate)

    async def get(self, rate_id: uuid.UUID) -> TravelBudgetRate | None:
        return await self._s.get(TravelBudgetRate, rate_id)

    async def list_for_company(self, company_id: uuid.UUID, zone_id: uuid.UUID | None = None) -> list[TravelBudgetRate]:
        c = t.travel_budget_rates.c
        stmt = (
            sa.select(TravelBudgetRate)
            .where(c.company_id == company_id, c.active.is_(True))
            .order_by(c.zone_id, c.staff_type, c.category_code, c.valid_from)
        )
        if zone_id is not None:
            stmt = stmt.where(c.zone_id == zone_id)
        return list((await self._s.scalars(stmt)).all())

    async def applicable(
        self, company_id: uuid.UUID, zone_id: uuid.UUID, staff_type: StaffType, day: date
    ) -> list[TravelBudgetRate]:
        c = t.travel_budget_rates.c
        stmt = sa.select(TravelBudgetRate).where(
            c.company_id == company_id,
            c.zone_id == zone_id,
            c.staff_type == staff_type,
            c.active.is_(True),
            c.valid_from <= day,
            sa.or_(c.valid_to.is_(None), c.valid_to >= day),
        )
        return list((await self._s.scalars(stmt)).all())


class SqlPolicyRuleRepository(_Repo):
    async def add(self, rule: PolicyRuleConfig) -> None:
        self._s.add(rule)

    async def list_for_company(self, company_id: uuid.UUID) -> list[PolicyRuleConfig]:
        c = t.policy_rules.c
        stmt = sa.select(PolicyRuleConfig).where(c.company_id == company_id).order_by(c.rule_type)
        return list((await self._s.scalars(stmt)).all())


class SqlExtractionAttemptRepository(_Repo):
    async def add(self, attempt: ExtractionAttempt) -> None:
        self._s.add(attempt)

    async def list_for_expense(self, expense_id: uuid.UUID) -> list[ExtractionAttempt]:
        c = t.extraction_attempts.c
        stmt = sa.select(ExtractionAttempt).where(c.expense_id == expense_id).order_by(c.created_at)
        return list((await self._s.scalars(stmt)).all())


class SqlAuditRepository(_Repo):
    async def add(self, entry: AuditEntry) -> None:
        self._s.add(entry)

    async def find(self, flt: AuditFilter, page: Page) -> Paged[AuditEntry]:
        c = t.audit_log.c
        stmt = sa.select(AuditEntry).order_by(c.created_at.desc(), c.id)
        if flt.entity_type:
            stmt = stmt.where(c.entity_type == flt.entity_type)
        if flt.entity_id:
            stmt = stmt.where(c.entity_id == flt.entity_id)
        if flt.actor_id:
            stmt = stmt.where(c.actor_id == flt.actor_id)
        if flt.action:
            stmt = stmt.where(c.action == flt.action)
        if flt.since:
            stmt = stmt.where(c.created_at >= flt.since)
        if flt.until:
            stmt = stmt.where(c.created_at < flt.until)
        return await self._paged(stmt, page)


class SqlInboundMessageRepository(_Repo):
    async def register(self, wa_message_id: str) -> bool:
        stmt = (
            pg_insert(t.inbound_messages)
            .values(wa_message_id=wa_message_id, received_at=sa.func.now())
            .on_conflict_do_nothing()
            .returning(t.inbound_messages.c.wa_message_id)
        )
        return (await self._s.scalar(stmt)) is not None


class SqlSystemSettingRepository(_Repo):
    async def all(self) -> list[SystemSetting]:
        return list((await self._s.scalars(sa.select(SystemSetting).order_by(t.system_settings.c.key))).all())

    async def get(self, key: str) -> SystemSetting | None:
        return await self._s.get(SystemSetting, key)


class SqlExchangeRateRepository(_Repo):
    async def upsert(self, rates: list[ExchangeRate]) -> int:
        if not rates:
            return 0
        rows = [
            {"day": r.day, "base": r.base, "quote": r.quote, "rate": r.rate, "source": r.source, "fetched_at": r.fetched_at}
            for r in rates
        ]
        stmt = pg_insert(t.exchange_rates).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["day", "base", "quote"],
            set_={"rate": stmt.excluded.rate, "source": stmt.excluded.source, "fetched_at": stmt.excluded.fetched_at},
        )
        await self._s.execute(stmt)
        return len(rows)

    async def latest(self, base: str, quote: str, day: date, oldest: date) -> ExchangeRate | None:
        c = t.exchange_rates.c
        stmt = (
            sa.select(ExchangeRate)
            .where(c.base == base, c.quote == quote, c.day <= day, c.day >= oldest)
            .order_by(c.day.desc())
            .limit(1)
        )
        return (await self._s.scalars(stmt)).first()


class SqlWhatsAppSessionRepository(_Repo):
    async def get(self, employee_id: uuid.UUID) -> WhatsAppSession | None:
        return await self._s.get(WhatsAppSession, employee_id)

    async def open(self, employee_id: uuid.UUID, now: datetime) -> tuple[WhatsAppSession, bool]:
        # Dos mensajes simultáneos del mismo usuario: el INSERT ... ON CONFLICT crea la fila una sola
        # vez y el FOR UPDATE ordena a los dos.
        c = t.whatsapp_sessions.c
        inserted = await self._s.execute(
            pg_insert(t.whatsapp_sessions)
            .values(employee_id=employee_id, last_inbound_at=now, started_at=now)
            .on_conflict_do_nothing()
            .returning(c.employee_id)
        )
        created = inserted.first() is not None
        stmt = (
            sa.select(WhatsAppSession)
            .where(c.employee_id == employee_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return (await self._s.scalars(stmt)).one(), created

    async def list_idle(self, before: datetime, limit: int) -> list[WhatsAppSession]:
        c = t.whatsapp_sessions.c
        stmt = (
            sa.select(WhatsAppSession)
            .where(c.closed_at.is_(None), c.last_inbound_at < before)
            .order_by(c.last_inbound_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        return list((await self._s.scalars(stmt)).all())


class SqlHeldNoticeRepository(_Repo):
    def add(self, notice: HeldNotice) -> None:
        self._s.add(notice)

    async def take_for(self, employee_id: uuid.UUID) -> list[HeldNotice]:
        # DELETE ... RETURNING: si llegan dos mensajes a la vez, cada aviso lo saca uno solo.
        c = t.whatsapp_held_notices.c
        stmt = sa.delete(HeldNotice).where(c.employee_id == employee_id).returning(HeldNotice)
        return sorted((await self._s.scalars(stmt)).all(), key=lambda n: n.created_at)

    async def purge(self, before: datetime) -> int:
        result = await self._s.execute(sa.delete(t.whatsapp_held_notices).where(t.whatsapp_held_notices.c.created_at < before))
        return int(result.rowcount)  # type: ignore[attr-defined]


class SqlDelegationRepository(_Repo):
    async def add(self, delegation: ApproverDelegation) -> None:
        self._s.add(delegation)

    async def get(self, delegation_id: uuid.UUID) -> ApproverDelegation | None:
        return await self._s.get(ApproverDelegation, delegation_id)

    async def list_for_approver(self, approver_id: uuid.UUID) -> list[ApproverDelegation]:
        c = t.approver_delegations.c
        stmt = sa.select(ApproverDelegation).where(c.approver_id == approver_id).order_by(c.starts_at.desc())
        return list((await self._s.scalars(stmt)).all())

    async def delegators_of(self, delegate_id: uuid.UUID, now: datetime) -> list[uuid.UUID]:
        c = t.approver_delegations.c
        stmt = sa.select(c.approver_id).where(
            c.delegate_id == delegate_id, c.revoked_at.is_(None), c.starts_at <= now, c.ends_at > now
        )
        return list((await self._s.scalars(stmt)).all())


class SqlStatementRepository(_Repo):
    async def add(self, statement: BankStatement) -> None:
        self._s.add(statement)

    async def add_movement(self, movement: StatementMovement) -> None:
        self._s.add(movement)

    async def get(self, statement_id: uuid.UUID) -> BankStatement | None:
        return await self._s.get(BankStatement, statement_id)

    async def list_for_advance(self, advance_id: uuid.UUID) -> list[BankStatement]:
        c = t.bank_statements.c
        stmt = sa.select(BankStatement).where(c.advance_id == advance_id).order_by(c.uploaded_at)
        return list((await self._s.scalars(stmt)).all())

    async def movements_of(self, statement_ids: list[uuid.UUID]) -> list[StatementMovement]:
        if not statement_ids:
            return []
        c = t.statement_movements.c
        stmt = sa.select(StatementMovement).where(c.statement_id.in_(statement_ids)).order_by(c.statement_id, c.row)
        return list((await self._s.scalars(stmt)).all())

    async def file_exists(self, company_id: uuid.UUID, sha256: str) -> bool:
        c = t.bank_statements.c
        stmt = sa.select(sa.exists().where(c.company_id == company_id, c.file_sha256 == sha256))
        return bool(await self._s.scalar(stmt))

    async def matched_elsewhere(self, statement_id: uuid.UUID, expense_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        if not expense_ids:
            return set()
        c = t.statement_movements.c
        stmt = sa.select(c.expense_id).where(c.statement_id != statement_id, c.expense_id.in_(expense_ids))
        return {e for e in (await self._s.scalars(stmt)).all() if e is not None}


class SqlExampleRepository(_Repo):
    async def add(self, example: ClassificationExample) -> None:
        self._s.add(example)

    async def get(self, example_id: uuid.UUID) -> ClassificationExample | None:
        return await self._s.get(ClassificationExample, example_id)

    async def by_key(
        self, kind: ExampleKind, key_text: str, scope: ExampleScope, company_id: uuid.UUID | None
    ) -> ClassificationExample | None:
        c = t.classification_examples.c
        owner = c.company_id.is_(None) if scope == ExampleScope.GROUP else c.company_id == company_id
        stmt = sa.select(ClassificationExample).where(c.kind == kind, c.key_text == key_text, c.scope == scope, owner)
        return (await self._s.scalars(stmt)).first()

    def _visible_to(self, company_id: uuid.UUID | None) -> sa.ColumnElement[bool]:
        c = t.classification_examples.c
        group = c.scope == ExampleScope.GROUP
        return sa.or_(group, c.company_id == company_id) if company_id is not None else group

    async def memory(
        self, kind: ExampleKind, key_texts: list[str], company_id: uuid.UUID | None
    ) -> dict[str, ClassificationExample]:
        if not key_texts:
            return {}
        c = t.classification_examples.c
        stmt = (
            sa.select(ClassificationExample)
            .where(c.kind == kind, c.status == ExampleStatus.ACTIVE, c.key_text.in_(key_texts), self._visible_to(company_id))
            # Los de grupo primero: los de la compañía los sobrescriben en el diccionario.
            .order_by(sa.case((c.scope == ExampleScope.GROUP, 0), else_=1))
        )
        return {example.key_text: example for example in (await self._s.scalars(stmt)).all()}

    async def similar(self, company_id: uuid.UUID | None, text: str, threshold: float) -> SimilarExample | None:
        c = t.classification_examples.c
        score = sa.func.similarity(c.key_text, text)
        stmt = (
            sa.select(ClassificationExample, score)
            .where(
                c.kind == ExampleKind.LINE_CONCEPT,
                c.status == ExampleStatus.ACTIVE,
                c.label != NO_CONCEPT,
                self._visible_to(company_id),
                c.key_text.op("%")(text),  # usa el índice de trigramas antes de calcular el puntaje
                score >= threshold,
            )
            .order_by(score.desc())
            .limit(1)
        )
        row = (await self._s.execute(stmt)).first()
        return SimilarExample(row[0], float(row[1])) if row else None

    async def recent(self, company_id: uuid.UUID | None, limit: int) -> list[ClassificationExample]:
        c = t.classification_examples.c
        stmt = (
            sa.select(ClassificationExample)
            .where(c.kind == ExampleKind.LINE_CONCEPT, c.status == ExampleStatus.ACTIVE, self._visible_to(company_id))
            .order_by(c.updated_at.desc())
            .limit(limit)
        )
        return list((await self._s.scalars(stmt)).all())

    async def pending_from(self, expense_ids: list[uuid.UUID]) -> list[ClassificationExample]:
        if not expense_ids:
            return []
        c = t.classification_examples.c
        stmt = sa.select(ClassificationExample).where(c.status == ExampleStatus.PENDING, c.source_expense_id.in_(expense_ids))
        return list((await self._s.scalars(stmt)).all())

    async def find(self, flt: ExampleFilter, page: Page) -> Paged[ClassificationExample]:
        c = t.classification_examples.c
        stmt = sa.select(ClassificationExample).order_by(c.updated_at.desc(), c.id)
        if flt.company_ids is not None:
            stmt = stmt.where(sa.or_(c.scope == ExampleScope.GROUP, c.company_id.in_(flt.company_ids)))
        if flt.kind is not None:
            stmt = stmt.where(c.kind == flt.kind)
        if flt.status is not None:
            stmt = stmt.where(c.status == flt.status)
        if flt.conflicted is not None:
            stmt = stmt.where(c.conflicted.is_(flt.conflicted))
        if flt.created_by is not None:
            stmt = stmt.where(c.created_by == flt.created_by)
        if flt.creators is not None:
            stmt = stmt.where(c.created_by.in_(flt.creators))
        return await self._paged(stmt, page)

    async def add_history(self, entry: ExampleHistory) -> None:
        self._s.add(entry)

    async def history(self, example_id: uuid.UUID) -> list[ExampleHistory]:
        c = t.classification_example_history.c
        stmt = sa.select(ExampleHistory).where(c.example_id == example_id).order_by(c.created_at)
        return list((await self._s.scalars(stmt)).all())
