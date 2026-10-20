from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.adapters.outbound.persistence.mapping import start_mappers
from app.adapters.outbound.persistence.reports import SqlReportRepository
from app.adapters.outbound.persistence.repositories import (
    SqlAdvanceRepository,
    SqlAuditRepository,
    SqlBlockedConceptRepository,
    SqlCategoryRepository,
    SqlCompanyRepository,
    SqlDelegationRepository,
    SqlEmployeeRepository,
    SqlExampleRepository,
    SqlExchangeRateRepository,
    SqlExpenseLineRepository,
    SqlExpenseRepository,
    SqlExtractionAttemptRepository,
    SqlHeldNoticeRepository,
    SqlInboundMessageRepository,
    SqlLinkCodeRepository,
    SqlPolicyRuleRepository,
    SqlRefreshTokenRepository,
    SqlStatementRepository,
    SqlSystemSettingRepository,
    SqlTravelBudgetRateRepository,
    SqlTravelZoneRepository,
    SqlWhatsAppSessionRepository,
)
from app.domain import ports
from app.domain.errors import ConflictError


def create_engine(database_url: str, pool_size: int = 10) -> AsyncEngine:
    start_mappers()
    return create_async_engine(database_url, pool_size=pool_size, max_overflow=pool_size, pool_pre_ping=True)


class SqlAlchemyUnitOfWork:
    """Una transacción por caso de uso. Salir del bloque sin commit() hace rollback."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> SqlAlchemyUnitOfWork:
        self._session = s = self._session_factory()
        self.companies: ports.CompanyRepository = SqlCompanyRepository(s)
        self.employees: ports.EmployeeRepository = SqlEmployeeRepository(s)
        self.refresh_tokens: ports.RefreshTokenRepository = SqlRefreshTokenRepository(s)
        self.link_codes: ports.LinkCodeRepository = SqlLinkCodeRepository(s)
        self.advances: ports.AdvanceRepository = SqlAdvanceRepository(s)
        self.expenses: ports.ExpenseRepository = SqlExpenseRepository(s)
        self.lines: ports.ExpenseLineRepository = SqlExpenseLineRepository(s)
        self.concepts: ports.BlockedConceptRepository = SqlBlockedConceptRepository(s)
        self.categories: ports.CategoryRepository = SqlCategoryRepository(s)
        self.travel_zones: ports.TravelZoneRepository = SqlTravelZoneRepository(s)
        self.budget_rates: ports.TravelBudgetRateRepository = SqlTravelBudgetRateRepository(s)
        self.policy_rules: ports.PolicyRuleRepository = SqlPolicyRuleRepository(s)
        self.attempts: ports.ExtractionAttemptRepository = SqlExtractionAttemptRepository(s)
        self.audit: ports.AuditRepository = SqlAuditRepository(s)
        self.inbound: ports.InboundMessageRepository = SqlInboundMessageRepository(s)
        self.settings: ports.SystemSettingRepository = SqlSystemSettingRepository(s)
        self.exchange_rates: ports.ExchangeRateRepository = SqlExchangeRateRepository(s)
        self.delegations: ports.DelegationRepository = SqlDelegationRepository(s)
        self.whatsapp_sessions: ports.WhatsAppSessionRepository = SqlWhatsAppSessionRepository(s)
        self.held_notices: ports.HeldNoticeRepository = SqlHeldNoticeRepository(s)
        self.reports: ports.ReportRepository = SqlReportRepository(s)
        self.examples: ports.ExampleRepository = SqlExampleRepository(s)
        self.statements: ports.StatementRepository = SqlStatementRepository(s)
        return self

    async def __aexit__(self, *exc: object) -> None:
        assert self._session is not None
        try:
            # Primero se desvinculan: un rollback expiraría las entidades cargadas y los casos de uso
            # las siguen usando (dataclasses planas sin relaciones lazy) después de la transacción.
            self._session.expunge_all()
            await self._session.rollback()
        finally:
            await self._session.close()
            self._session = None

    async def commit(self) -> None:
        assert self._session is not None
        try:
            await self._session.commit()
        except IntegrityError as exc:
            # Las restricciones únicas son la última defensa contra carreras; los servicios también validan antes.
            await self._session.rollback()
            constraint = getattr(getattr(exc.orig, "__cause__", None), "constraint_name", None)
            raise ConflictError(f"Duplicate value ({constraint or 'unique constraint'})", code="duplicate_value") from exc

    async def flush(self) -> None:
        assert self._session is not None
        await self._session.flush()

    async def rollback(self) -> None:
        assert self._session is not None
        await self._session.rollback()


class UnitOfWorkFactory:
    def __init__(self, engine: AsyncEngine) -> None:
        self._sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=True)

    def __call__(self) -> SqlAlchemyUnitOfWork:
        return SqlAlchemyUnitOfWork(self._sessions)
