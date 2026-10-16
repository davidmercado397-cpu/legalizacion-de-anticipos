"""Composition root en Python plano, sin framework de DI.

Los tests pasan `Overrides` para cambiar los adaptadores externos (IA, WhatsApp, almacenamiento) por
fakes sin dejar de usar el PostgreSQL real."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

import httpx
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine

from app.adapters.outbound.documents import PillowDocumentPreparer, ZxingQrDecoder
from app.adapters.outbound.excel import OpenpyxlWriter
from app.adapters.outbound.exchange_rates import EcbProvider, TrmProvider
from app.adapters.outbound.infra import AsyncTaskRunner, LimitsRateLimiter, RedisCacheVersions, RedisLock, SystemClock
from app.adapters.outbound.openrouter import OpenRouterInvoiceExtractor
from app.adapters.outbound.persistence.uow import UnitOfWorkFactory, create_engine
from app.adapters.outbound.security.mfa import FernetCipher, PyotpTotp
from app.adapters.outbound.security.passwords import Argon2PasswordHasher
from app.adapters.outbound.security.tokens import JwtTokenService
from app.adapters.outbound.storage import R2Storage
from app.adapters.outbound.unconfigured import UnconfiguredService
from app.adapters.outbound.whatsapp import GraphWhatsAppClient
from app.application.access import AccessPolicy
from app.application.advances import AdvanceEvents, AdvanceEventType, AdvanceService
from app.application.approvals import AdvanceApprovalNotifier
from app.application.audit import AuditService
from app.application.auth import AuthConfig, AuthService
from app.application.budgets import TravelBudgetService
from app.application.companies import CompanyService
from app.application.employees import EmployeeService
from app.application.erp import ErpService
from app.application.exchange import ExchangeRateService
from app.application.expenses import ExpenseService
from app.application.exports import LegalizationExporter
from app.application.jobs import Job, PeriodicJobs
from app.application.learning import LearningService
from app.application.legalization import LegalizationService
from app.application.mfa import MfaService
from app.application.notifications import ExpenseNotifier
from app.application.policies import CompanyContextProvider, PolicyConfigService, PolicyEvaluator
from app.application.processing import ExpenseProcessor
from app.application.reading import ConfigProvider, DocumentReader, ReadingConfig
from app.application.reminders import LegalizationReminders
from app.application.reports import ReportService
from app.application.settings import SettingsService
from app.application.status_notices import EMPLOYEE_EVENTS, StatusNotices
from app.application.sweeper import ExpenseSweeper
from app.application.treasury import TreasuryService
from app.application.whatsapp_bot import (
    BotLimits,
    MediaHandler,
    ReplyHandler,
    WhatsAppBot,
)
from app.application.whatsapp_flows import FlowHandler, FlowLauncher
from app.application.whatsapp_identity import WhatsAppIdentityService
from app.application.whatsapp_menu import MenuHandler
from app.application.whatsapp_notifier import WhatsAppNotifier, WhatsAppSessions
from app.config import Settings
from app.domain.ports import (
    Clock,
    DocumentPreparer,
    ErpGateway,
    ExchangeRateProvider,
    FileStorage,
    InvoiceExtractor,
    MediaSource,
    MessageSender,
    QrDecoder,
    RateLimiter,
)
from app.domain.verification import InvoiceVerifier

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts" / "invoice_extraction"


@dataclass
class Overrides:
    storage: FileStorage | None = None
    sender: MessageSender | None = None
    media: MediaSource | None = None
    extractor: InvoiceExtractor | None = None
    preparer: DocumentPreparer | None = None
    qr: QrDecoder | None = None
    clock: Clock | None = None
    rate_limiter: RateLimiter | None = None
    redis: Redis | None = None
    rate_providers: list[ExchangeRateProvider] | None = None
    erp: ErpGateway | None = None


@dataclass
class Container:
    settings: Settings
    engine: AsyncEngine
    http: httpx.AsyncClient
    redis: Redis
    uow: UnitOfWorkFactory
    clock: Clock
    rate_limiter: RateLimiter
    tasks: AsyncTaskRunner
    auth: AuthService
    companies: CompanyService
    employees: EmployeeService
    advances: AdvanceService
    expenses: ExpenseService
    identity: WhatsAppIdentityService
    processor: ExpenseProcessor
    reader: DocumentReader
    bot: WhatsAppBot
    sweeper: ExpenseSweeper
    jobs: PeriodicJobs
    rates: ExchangeRateService
    budgets: TravelBudgetService
    legalization: LegalizationService
    treasury: TreasuryService
    contexts: CompanyContextProvider
    reports: ReportService
    learning: LearningService
    policies: PolicyConfigService
    exporter: LegalizationExporter
    runtime: SettingsService
    mfa: MfaService
    audit: AuditService
    erp: ErpService
    extras: dict[str, object] = field(default_factory=dict)

    async def close(self) -> None:
        await self.tasks.drain(max_wait=10)
        await self.http.aclose()
        await self.redis.aclose()
        await self.engine.dispose()


def build_reader(
    extractor: InvoiceExtractor,
    config: ConfigProvider,
    preparer: DocumentPreparer | None = None,
    qr: QrDecoder | None = None,
) -> DocumentReader:
    return DocumentReader(preparer or PillowDocumentPreparer(), qr or ZxingQrDecoder(), extractor, InvoiceVerifier(), config)


def build_extractor(settings: Settings, http: httpx.AsyncClient) -> InvoiceExtractor:
    if not settings.openrouter_configured:
        return cast(InvoiceExtractor, UnconfiguredService("openrouter"))
    return OpenRouterInvoiceExtractor(
        http, settings.OPENROUTER_BASE_URL, settings.OPENROUTER_API_KEY, PROMPT_DIR, settings.OPENROUTER_TIMEOUT_SECONDS
    )


def build_container(settings: Settings, overrides: Overrides | None = None) -> Container:
    o = overrides or Overrides()
    engine = create_engine(settings.DATABASE_URL, settings.DB_POOL_SIZE)
    # Un solo cliente HTTP compartido: keep-alive y HTTP/2 evitan un handshake TLS por cada llamada a Meta/OpenRouter.
    http = httpx.AsyncClient(http2=True, timeout=30.0, limits=httpx.Limits(max_connections=50, max_keepalive_connections=20))
    uow = UnitOfWorkFactory(engine)
    clock = o.clock or SystemClock()
    redis = o.redis or Redis.from_url(settings.REDIS_URL)
    versions = RedisCacheVersions(redis)
    limiter = o.rate_limiter or LimitsRateLimiter(f"async+{settings.REDIS_URL}")
    tasks = AsyncTaskRunner(settings.EXPENSE_PROCESSING_CONCURRENCY)
    hasher = Argon2PasswordHasher()
    tokens = JwtTokenService(
        settings.JWT_SECRET,
        settings.ACCESS_TOKEN_TTL_SECONDS,
        settings.MFA_CHALLENGE_TTL_SECONDS,
        settings.FLOW_TOKEN_TTL_MINUTES * 60,
    )
    totp = PyotpTotp(settings.MFA_ISSUER)
    cipher = FernetCipher(settings.MFA_ENCRYPTION_KEY)
    access = AccessPolicy(clock)
    runtime = SettingsService(uow, access, clock, versions)

    storage: FileStorage
    if o.storage is not None:
        storage = o.storage
    elif settings.r2_configured:
        storage = R2Storage(
            settings.R2_ENDPOINT_URL,
            settings.R2_BUCKET,
            settings.R2_ACCESS_KEY_ID,
            settings.R2_SECRET_ACCESS_KEY,
            settings.R2_REGION,
            settings.R2_PUBLIC_ENDPOINT_URL or None,
        )
    else:
        storage = cast(FileStorage, UnconfiguredService("r2"))

    graph = (
        GraphWhatsAppClient(
            http,
            f"https://graph.facebook.com/{settings.GRAPH_API_VERSION}",
            settings.WHATSAPP_PHONE_NUMBER_ID,
            settings.WHATSAPP_ACCESS_TOKEN,
        )
        if settings.whatsapp_configured
        else None
    )
    unconfigured_whatsapp = UnconfiguredService("whatsapp")
    sender: MessageSender = o.sender or graph or cast(MessageSender, unconfigured_whatsapp)
    media: MediaSource = o.media or graph or cast(MediaSource, unconfigured_whatsapp)
    extractor = o.extractor or build_extractor(settings, http)

    async def reading_config() -> ReadingConfig:
        return ReadingConfig.from_settings(await runtime.current())

    reader = build_reader(extractor, reading_config, o.preparer, o.qr)

    auth = AuthService(
        uow,
        hasher,
        tokens,
        clock,
        AuthConfig(
            settings.REFRESH_TOKEN_TTL_DAYS,
            settings.PASSWORD_MIN_LENGTH,
            settings.LOGIN_MAX_ATTEMPTS,
            settings.LOGIN_LOCK_MINUTES,
        ),
        versions,
        totp,
        cipher,
    )
    mfa = MfaService(uow, access, auth, totp, cipher, tokens, clock, settings.MFA_RECOVERY_CODES)
    companies = CompanyService(uow, access, runtime)
    employees = EmployeeService(uow, access, hasher, auth, clock)
    providers: list[ExchangeRateProvider] = [TrmProvider(http, settings.TRM_API_URL), EcbProvider(http, settings.ECB_API_URL)]
    if o.rate_providers is not None:
        providers = o.rate_providers
    rates = ExchangeRateService(uow, providers, runtime, clock, access)
    budgets = TravelBudgetService(uow, access, runtime, rates, clock)
    evaluator = PolicyEvaluator(runtime)
    contexts = CompanyContextProvider(uow, versions, runtime)
    learning = LearningService(uow, access, clock, runtime, evaluator, contexts)
    events = AdvanceEvents()
    advances = AdvanceService(uow, access, runtime, rates, budgets, clock, learning, events)
    policies = PolicyConfigService(uow, access, contexts, clock, runtime)
    expenses = ExpenseService(
        uow,
        access,
        storage,
        clock,
        settings.MAX_UPLOAD_BYTES,
        settings.SIGNED_URL_TTL_SECONDS,
        evaluator,
        runtime,
        rates,
        learning,
    )
    exporter = LegalizationExporter(uow, advances, OpenpyxlWriter())
    identity = WhatsAppIdentityService(
        uow,
        sender,
        tokens,
        clock,
        runtime,
        settings.LINK_CODE_TTL_MINUTES,
    )
    notifier = ExpenseNotifier(uow, sender, clock, runtime, contexts)
    sessions = WhatsAppSessions(uow, runtime, clock, sender)
    wa_notifier = WhatsAppNotifier(sender, sessions, runtime)
    reminders = LegalizationReminders(uow, wa_notifier, runtime, clock)
    flows = FlowLauncher(uow, sender, tokens, runtime, expenses, notifier, clock)
    processor = ExpenseProcessor(
        uow,
        storage,
        media,
        reader,
        notifier,
        clock,
        settings.EXPENSE_MAX_ATTEMPTS,
        runtime,
        contexts,
        evaluator,
        rates,
        learning,
    )
    approvals = AdvanceApprovalNotifier(uow, sender, runtime)

    def schedule(expense_id) -> None:  # type: ignore[no-untyped-def]
        tasks.spawn(lambda: processor.process(expense_id))

    expenses.set_scheduler(schedule)
    employees.on_created(lambda employee_id: _spawn(tasks, identity.send_welcome(employee_id)))
    notices = StatusNotices(uow, wa_notifier, runtime)
    events.on([AdvanceEventType.REQUESTED], lambda e: _spawn(tasks, approvals.advance_requested(e.advance_id)))
    # Mientras no haya adaptador de Siesa, el envío queda pendiente con un aviso claro (ver CLAUDE.md, stubs).
    erp = ErpService(uow, access, o.erp or cast(ErpGateway, UnconfiguredService("siesa")))
    events.on([AdvanceEventType.APPROVED], lambda e: _spawn(tasks, erp.advance_approved(e.advance_id)))
    events.on(EMPLOYEE_EVENTS, lambda e: _spawn(tasks, notices.handle(e)))

    bot = WhatsAppBot(
        uow,
        identity,
        sender,
        limiter,
        BotLimits(
            settings.RATE_LIMIT_WA_MEDIA,
            settings.RATE_LIMIT_WA_MESSAGES,
            settings.RATE_LIMIT_LINK_CODE,
            settings.RATE_LIMIT_WA_UNKNOWN,
            settings.RATE_LIMIT_WA_NOTICE,
        ),
        [
            MediaHandler(expenses, notifier),
            FlowHandler(flows, advances, expenses, tokens, sender),
            ReplyHandler(expenses, advances, identity, uow, sender),
            MenuHandler(advances, expenses, notifier, sessions, sender, runtime, flows),
        ],
        sessions,
    )
    sweeper = ExpenseSweeper(uow, schedule, clock, settings.SWEEPER_STALE_SECONDS)
    jobs = PeriodicJobs(
        [
            Job("expense_retries", settings.SWEEPER_INTERVAL_SECONDS, sweeper.run_once),
            Job("exchange_rates", settings.EXCHANGE_RATES_SYNC_SECONDS, rates.sync),
            Job("legalization_reminders", settings.LEGALIZATION_REMINDERS_SECONDS, reminders.run),
            Job("whatsapp_sessions", settings.WHATSAPP_SESSIONS_SWEEP_SECONDS, sessions.close_idle),
        ],
        RedisLock(redis),
    )
    return Container(
        settings,
        engine,
        http,
        redis,
        uow,
        clock,
        limiter,
        tasks,
        auth,
        companies,
        employees,
        advances,
        expenses,
        identity,
        processor,
        reader,
        bot,
        sweeper,
        jobs,
        rates,
        budgets,
        LegalizationService(uow, advances, expenses),
        TreasuryService(uow, access, clock, events),
        contexts,
        ReportService(uow, access, runtime, clock),
        learning,
        policies,
        exporter,
        runtime,
        mfa,
        AuditService(uow, access),
        erp,
        {"storage": storage, "sender": sender, "reminders": reminders, "sessions": sessions, "tokens": tokens},
    )


async def _spawn(tasks: AsyncTaskRunner, coro) -> None:  # type: ignore[no-untyped-def]
    """Los hooks corren en background: la respuesta HTTP nunca espera a WhatsApp."""
    tasks.spawn(lambda: coro)
