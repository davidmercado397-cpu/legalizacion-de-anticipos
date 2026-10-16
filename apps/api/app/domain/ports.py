"""Puertos (arquitectura hexagonal): los casos de uso dependen de estos protocolos y los adaptadores
los implementan.

Los repositorios se usan a través de una Unit of Work para que cada caso de uso controle su propia
transacción y nunca la deje abierta mientras llama servicios externos lentos."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Protocol

from app.domain.entities import (
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
    Deductibility,
    ExampleKind,
    ExampleScope,
    ExampleStatus,
    ExpenseStatus,
    Legibility,
    Role,
    StaffType,
)
from app.domain.settings import SystemSetting
from app.domain.values import InvoiceData, WhatsAppAddress


@dataclass(frozen=True)
class Page:
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True)
class Paged[T]:
    items: list[T]
    total: int


@dataclass(frozen=True)
class EmployeeFilter:
    company_id: uuid.UUID | None = None
    role: Role | None = None
    active: bool | None = None
    search: str | None = None
    company_ids_any: list[uuid.UUID] | None = None  # alcance de visibilidad (contadores)


@dataclass(frozen=True)
class ScopeFilter:
    """Alcance de visibilidad que resuelve la política de acceso. Todo en None = sin restricción (admin)."""

    employee_ids: list[uuid.UUID] | None = None
    company_ids: list[uuid.UUID] | None = None


@dataclass(frozen=True)
class AdvanceFilter:
    scope: ScopeFilter = field(default_factory=ScopeFilter)
    status: AdvanceStatus | None = None
    employee_id: uuid.UUID | None = None
    disbursed: bool | None = None
    settlement_pending: bool | None = None  # reintegros o pagos al empleado por gestionar


@dataclass(frozen=True)
class ExpenseFilter:
    scope: ScopeFilter = field(default_factory=ScopeFilter)
    status: ExpenseStatus | None = None
    advance_id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    updated_since: datetime | None = None
    deductibility: Deductibility | None = None


class CompanyRepository(Protocol):
    async def get(self, company_id: uuid.UUID) -> Company | None: ...
    async def add(self, company: Company) -> None: ...
    async def find(self, ids: list[uuid.UUID] | None = None) -> list[Company]: ...


class EmployeeRepository(Protocol):
    async def get(self, employee_id: uuid.UUID) -> Employee | None: ...
    async def get_by_email(self, email: str) -> Employee | None: ...
    async def get_by_phone(self, phone: str) -> Employee | None: ...
    async def get_by_wa_user_id(self, user_id: str) -> Employee | None: ...
    async def get_by_welcome_message_id(self, message_id: str) -> Employee | None: ...
    async def add(self, employee: Employee) -> None: ...
    async def find(self, flt: EmployeeFilter, page: Page) -> Paged[Employee]: ...
    async def list_reports_of(self, approver_id: uuid.UUID) -> list[uuid.UUID]: ...


class DelegationRepository(Protocol):
    async def add(self, delegation: ApproverDelegation) -> None: ...
    async def get(self, delegation_id: uuid.UUID) -> ApproverDelegation | None: ...
    async def list_for_approver(self, approver_id: uuid.UUID) -> list[ApproverDelegation]: ...
    async def delegators_of(self, delegate_id: uuid.UUID, now: datetime) -> list[uuid.UUID]:
        """Aprobadores que hoy tienen a `delegate_id` de suplente."""
        ...


class RefreshTokenRepository(Protocol):
    async def add(self, token: RefreshToken) -> None: ...
    async def get_by_hash(self, token_hash: str) -> RefreshToken | None: ...
    async def revoke_family(self, family_id: uuid.UUID, now: datetime) -> None: ...
    async def revoke_all_for(self, employee_id: uuid.UUID, now: datetime) -> None: ...


class LinkCodeRepository(Protocol):
    async def add(self, code: WhatsAppLinkCode) -> None: ...
    async def get_by_hash(self, code_hash: str) -> WhatsAppLinkCode | None: ...
    async def invalidate_for(self, employee_id: uuid.UUID, now: datetime) -> None: ...


class AdvanceRepository(Protocol):
    async def get(self, advance_id: uuid.UUID) -> Advance | None: ...
    async def add(self, advance: Advance) -> None: ...
    async def find(self, flt: AdvanceFilter, page: Page) -> Paged[Advance]: ...
    async def list_open_for(self, employee_id: uuid.UUID) -> list[Advance]: ...
    async def list_ended(self, until: date) -> list[Advance]:
        """Anticipos abiertos cuyo viaje terminó a más tardar ese día (para recordar la legalización)."""
        ...


class ExpenseRepository(Protocol):
    async def get(self, expense_id: uuid.UUID) -> Expense | None: ...
    async def get_for_processing(self, expense_id: uuid.UUID) -> Expense | None: ...
    async def add(self, expense: Expense) -> None: ...
    async def get_by_wa_message_id(self, wa_message_id: str) -> Expense | None: ...
    async def get_by_client_ref(self, employee_id: uuid.UUID, client_ref: str) -> Expense | None: ...
    async def find(self, flt: ExpenseFilter, page: Page) -> Paged[Expense]: ...
    async def list_for_advance(self, advance_id: uuid.UUID) -> list[Expense]: ...
    async def list_for_advances(self, advance_ids: list[uuid.UUID]) -> list[Expense]: ...
    async def list_retryable(self, stale_before: datetime, limit: int) -> list[uuid.UUID]: ...
    async def count_pending_for(self, employee_id: uuid.UUID) -> int: ...
    async def claim_unnotified(self, employee_id: uuid.UUID, batch_id: uuid.UUID, now: datetime) -> list[Expense]: ...
    async def list_by_batch(self, batch_id: uuid.UUID) -> list[Expense]: ...
    async def list_by_status_for(self, employee_id: uuid.UUID, status: ExpenseStatus) -> list[Expense]: ...
    async def find_own_duplicate(self, expense: Expense, sha256: str | None = None) -> Expense | None:
        """La misma foto (sha256) o la misma factura (CUFE) ya registrada por el mismo empleado."""
        ...

    async def has_duplicate(self, expense: Expense) -> bool: ...
    async def sum_non_fiscal(
        self, employee_id: uuid.UUID, currency: str, since: datetime, exclude_ids: list[uuid.UUID]
    ) -> Decimal: ...


class ExpenseLineRepository(Protocol):
    async def add(self, line: ExpenseLine) -> None: ...
    async def list_unconfirmed_by_text(self, company_id: uuid.UUID | None, key_text: str) -> list[ExpenseLine]:
        """Líneas con ese texto en gastos aún sin confirmar (se recalculan si cambia lo aprendido)."""
        ...

    async def get(self, line_id: uuid.UUID) -> ExpenseLine | None: ...
    async def list_for_expense(self, expense_id: uuid.UUID) -> list[ExpenseLine]: ...
    async def list_for_expenses(self, expense_ids: list[uuid.UUID]) -> list[ExpenseLine]: ...


class BlockedConceptRepository(Protocol):
    async def add(self, concept: BlockedConcept) -> None: ...
    async def get(self, concept_id: uuid.UUID) -> BlockedConcept | None: ...
    async def list_for_company(self, company_id: uuid.UUID, active_only: bool = True) -> list[BlockedConcept]: ...


class CategoryRepository(Protocol):
    async def add(self, category: Category) -> None: ...
    async def get(self, category_id: uuid.UUID) -> Category | None: ...
    async def list_for_company(self, company_id: uuid.UUID, active_only: bool = True) -> list[Category]: ...


class TravelZoneRepository(Protocol):
    async def add(self, zone: TravelZone) -> None: ...
    async def get(self, zone_id: uuid.UUID) -> TravelZone | None: ...
    async def list_for_company(self, company_id: uuid.UUID, active_only: bool = True) -> list[TravelZone]: ...


class TravelBudgetRateRepository(Protocol):
    async def add(self, rate: TravelBudgetRate) -> None: ...
    async def get(self, rate_id: uuid.UUID) -> TravelBudgetRate | None: ...
    async def list_for_company(self, company_id: uuid.UUID, zone_id: uuid.UUID | None = None) -> list[TravelBudgetRate]: ...
    async def applicable(
        self, company_id: uuid.UUID, zone_id: uuid.UUID, staff_type: StaffType, day: date
    ) -> list[TravelBudgetRate]: ...


@dataclass(frozen=True)
class ExampleFilter:
    company_ids: list[uuid.UUID] | None = None  # None = todas (admin); los de grupo se ven siempre
    kind: ExampleKind | None = None
    status: ExampleStatus | None = None
    conflicted: bool | None = None
    created_by: uuid.UUID | None = None
    creators: list[uuid.UUID] | None = None  # alcance de un aprobador: él y su equipo


@dataclass(frozen=True)
class SimilarExample:
    example: ClassificationExample
    similarity: float


class ExampleRepository(Protocol):
    async def add(self, example: ClassificationExample) -> None: ...
    async def get(self, example_id: uuid.UUID) -> ClassificationExample | None: ...
    async def by_key(
        self, kind: ExampleKind, key_text: str, scope: ExampleScope, company_id: uuid.UUID | None
    ) -> ClassificationExample | None: ...
    async def memory(
        self, kind: ExampleKind, key_texts: list[str], company_id: uuid.UUID | None
    ) -> dict[str, ClassificationExample]:
        """Ejemplos activos por texto; el de la compañía gana sobre el de grupo."""
        ...

    async def similar(self, company_id: uuid.UUID | None, text: str, threshold: float) -> SimilarExample | None:
        """La línea bloqueada aprendida más parecida (trigramas de PostgreSQL), si pasa el umbral."""
        ...

    async def recent(self, company_id: uuid.UUID | None, limit: int) -> list[ClassificationExample]: ...
    async def pending_from(self, expense_ids: list[uuid.UUID]) -> list[ClassificationExample]: ...
    async def find(self, flt: ExampleFilter, page: Page) -> Paged[ClassificationExample]: ...
    async def add_history(self, entry: ExampleHistory) -> None: ...
    async def history(self, example_id: uuid.UUID) -> list[ExampleHistory]: ...


class PolicyRuleRepository(Protocol):
    async def add(self, rule: PolicyRuleConfig) -> None: ...
    async def list_for_company(self, company_id: uuid.UUID) -> list[PolicyRuleConfig]: ...


class ExtractionAttemptRepository(Protocol):
    async def add(self, attempt: ExtractionAttempt) -> None: ...
    async def list_for_expense(self, expense_id: uuid.UUID) -> list[ExtractionAttempt]: ...


@dataclass(frozen=True)
class AuditFilter:
    entity_type: str | None = None
    entity_id: str | None = None
    actor_id: uuid.UUID | None = None
    action: str | None = None
    since: datetime | None = None
    until: datetime | None = None


class AuditRepository(Protocol):
    async def add(self, entry: AuditEntry) -> None: ...
    async def find(self, flt: AuditFilter, page: Page) -> Paged[AuditEntry]: ...


class ExchangeRateRepository(Protocol):
    async def upsert(self, rates: list[ExchangeRate]) -> int: ...
    async def latest(self, base: str, quote: str, day: date, oldest: date) -> ExchangeRate | None:
        """La tasa más reciente con fecha <= `day` y >= `oldest` (fines de semana y festivos no tienen tasa)."""
        ...


@dataclass(frozen=True)
class PendingBalanceRow:
    advance_id: uuid.UUID
    employee_name: str
    company_id: uuid.UUID
    company_name: str
    destination: str | None
    status: AdvanceStatus
    currency: str
    amount: Decimal
    applied: Decimal
    end_date: date | None
    approved_at: datetime | None

    @property
    def pending(self) -> Decimal:
        return self.amount - self.applied


@dataclass(frozen=True)
class SpendRow:
    company_name: str
    category: str | None
    country: str | None
    currency: str | None
    expenses: int
    total: Decimal


@dataclass(frozen=True)
class BudgetRow:
    advance_id: uuid.UUID
    employee_name: str
    company_name: str
    currency: str
    category: str
    budget: Decimal
    spent: Decimal


@dataclass(frozen=True)
class IntercompanyRow:
    expense_id: uuid.UUID
    company_name: str
    billed_to: str | None
    employee_name: str
    vendor_name: str | None
    invoice_date: date | None
    currency: str | None
    total: Decimal | None


@dataclass(frozen=True)
class UsageRow:
    company_id: uuid.UUID
    company_name: str
    documents: int
    attempts: int
    escalated: int
    cost_usd: Decimal
    avg_latency_ms: int | None


@dataclass(frozen=True)
class AiCostRow:
    month: str  # "2026-10", en UTC
    model: str
    company_id: uuid.UUID | None  # None: lectura sin compañía asignada todavía
    company_name: str | None
    is_test: bool
    calls: int
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int
    cost_usd: Decimal


@dataclass(frozen=True)
class AccuracySample:
    """Lo que leyó la IA (ai_snapshot) frente a lo que quedó al confirmar."""

    ai: dict[str, Any]
    final: dict[str, Any]


class ReportRepository(Protocol):
    """Consultas de tableros con SQLAlchemy Core: agregan en la BD, nunca cargan entidades una por una.
    `company_ids` None = todas; las compañías de prueba (is_test) siempre se excluyen salvo en el uso."""

    async def pending_balances(self, company_ids: list[uuid.UUID] | None) -> list[PendingBalanceRow]: ...
    async def spend(self, company_ids: list[uuid.UUID] | None, start: date, end: date) -> list[SpendRow]: ...
    async def budget_compliance(self, company_ids: list[uuid.UUID] | None, start: date, end: date) -> list[BudgetRow]: ...
    async def intercompany(self, company_ids: list[uuid.UUID] | None, start: date, end: date) -> list[IntercompanyRow]: ...
    async def usage(self, start: datetime, end: datetime, include_test: bool) -> list[UsageRow]: ...
    async def ai_costs(self, start: datetime, end: datetime) -> list[AiCostRow]: ...
    async def line_accuracy(self, company_id: uuid.UUID, start: datetime, end: datetime) -> tuple[int, int, int]:
        """(líneas confirmadas, en las que la IA acertó el concepto, resueltas por la memoria aprendida)."""
        ...

    async def header_samples(self, company_id: uuid.UUID, start: datetime, end: datetime) -> list[AccuracySample]: ...


class SystemSettingRepository(Protocol):
    async def all(self) -> list[SystemSetting]: ...
    async def get(self, key: str) -> SystemSetting | None: ...


class WhatsAppSessionRepository(Protocol):
    async def get(self, employee_id: uuid.UUID) -> WhatsAppSession | None: ...
    async def open(self, employee_id: uuid.UUID, now: datetime) -> tuple[WhatsAppSession, bool]:
        """La sesión del empleado, bloqueada para actualizarla; True si se acaba de crear."""
        ...

    async def list_idle(self, before: datetime, limit: int) -> list[WhatsAppSession]:
        """Conversaciones abiertas sin mensajes del usuario desde `before` (se bloquean para cerrarlas)."""
        ...


class InboundMessageRepository(Protocol):
    async def register(self, wa_message_id: str) -> bool:
        """Devuelve False si el id del mensaje ya se procesó (Meta reintenta)."""
        ...


class StatementRepository(Protocol):
    async def add(self, statement: BankStatement) -> None: ...
    async def add_movement(self, movement: StatementMovement) -> None: ...
    async def get(self, statement_id: uuid.UUID) -> BankStatement | None: ...
    async def list_for_advance(self, advance_id: uuid.UUID) -> list[BankStatement]: ...
    async def movements_of(self, statement_ids: list[uuid.UUID]) -> list[StatementMovement]: ...
    async def file_exists(self, company_id: uuid.UUID, sha256: str) -> bool: ...
    async def matched_elsewhere(self, statement_id: uuid.UUID, expense_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        """Gastos ya cruzados en otro extracto (un gasto se paga una sola vez)."""
        ...


class UnitOfWork(Protocol):
    companies: CompanyRepository
    employees: EmployeeRepository
    refresh_tokens: RefreshTokenRepository
    link_codes: LinkCodeRepository
    advances: AdvanceRepository
    expenses: ExpenseRepository
    lines: ExpenseLineRepository
    concepts: BlockedConceptRepository
    categories: CategoryRepository
    travel_zones: TravelZoneRepository
    budget_rates: TravelBudgetRateRepository
    policy_rules: PolicyRuleRepository
    attempts: ExtractionAttemptRepository
    audit: AuditRepository
    inbound: InboundMessageRepository
    settings: SystemSettingRepository
    exchange_rates: ExchangeRateRepository
    delegations: DelegationRepository
    whatsapp_sessions: WhatsAppSessionRepository
    reports: ReportRepository
    examples: ExampleRepository
    statements: StatementRepository

    async def __aenter__(self) -> UnitOfWork: ...
    async def __aexit__(self, *exc: object) -> None: ...
    async def commit(self) -> None: ...
    async def rollback(self) -> None: ...
    async def flush(self) -> None: ...


UnitOfWorkFactory = Callable[[], UnitOfWork]


class FileStorage(Protocol):
    async def save(self, key: str, data: bytes, content_type: str) -> None: ...
    async def read(self, key: str) -> bytes: ...
    async def signed_url(self, key: str, ttl_seconds: int) -> str: ...


@dataclass(frozen=True)
class PreparedDocument:
    mime_type: str
    llm_content: bytes  # copia redimensionada que se envía a la IA
    llm_mime_type: str
    hires_content: bytes  # copia en mayor resolución para cuando se escala
    qr_variants: tuple[Any, ...] = ()  # imágenes sobre las que se intenta leer el QR (tipo propio del adaptador)
    blur_score: float | None = None
    is_blurry: bool = False
    pdf_text: str | None = None
    thumbnail: bytes | None = None  # JPEG pequeño para las listas del frontend (None en PDF)
    timings: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class ImageOptions:
    max_side_px: int
    hires_max_side_px: int
    blur_threshold: float
    thumbnail_side_px: int


class DocumentPreparer(Protocol):
    def prepare(self, content: bytes, mime_type: str, options: ImageOptions) -> PreparedDocument:
        """Pesado en CPU: quien lo llama lo corre en un hilo aparte."""
        ...


class QrDecoder(Protocol):
    def decode(self, document: PreparedDocument) -> list[str]:
        """Pesado en CPU: devuelve el texto de cada QR encontrado."""
        ...


@dataclass(frozen=True)
class ConceptHint:
    code: str
    name: str
    description: str | None = None
    examples: tuple[str, ...] = ()


@dataclass(frozen=True)
class CategoryHint:
    code: str
    name: str
    emoji: str | None = None


@dataclass(frozen=True)
class LearnedExample:
    text: str
    concept_code: str | None  # None = ítem permitido


@dataclass(frozen=True)
class ExtractionContext:
    """Contexto fijo por compañía que va al inicio del prompt (para aprovechar el caché)."""

    company_name: str | None = None
    country: str | None = None
    currency: str | None = None
    blocked_concepts: tuple[ConceptHint, ...] = ()
    categories: tuple[CategoryHint, ...] = ()
    timezone: str | None = None
    learned: tuple[LearnedExample, ...] = ()  # correcciones recientes, como ejemplos para la IA

    @property
    def category_codes(self) -> set[str]:
        return {c.code for c in self.categories}


@dataclass(frozen=True)
class ExtractionOptions:
    prompt_version: str
    max_tokens: int
    reasoning_off: str  # esfuerzo de razonamiento en lecturas normales
    reasoning_on: str  # esfuerzo al escalar
    zero_data_retention: bool
    availability_fallbacks: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExtractionRequest:
    content: bytes
    mime_type: str
    model: str
    options: ExtractionOptions
    reasoning: bool = False
    context: ExtractionContext = field(default_factory=ExtractionContext)
    known_values: dict[str, str] = field(default_factory=dict)  # p. ej. valores leídos del QR


@dataclass(frozen=True)
class ExtractionResponse:
    legibility: Legibility
    documents: list[InvoiceData]
    prompt_version: str
    model_used: str | None = None
    raw_text: str | None = None
    parsed: dict[str, Any] | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cached_tokens: int | None = None
    cost_usd: Decimal | None = None
    latency_ms: int | None = None


@dataclass(frozen=True)
class StatementTable:
    """Un extracto en PDF leído por la IA, ya como tabla con columnas fijas: fecha ISO, descripción,
    referencia y valor con punto decimal, los cargos en negativo."""

    rows: list[list[str]]
    currency: str | None = None
    card_last4: str | None = None


class TableReader(Protocol):
    def read(self, content: bytes, file_name: str) -> list[list[str]]:
        """Filas de un CSV o Excel como texto. Lanza ValidationError si el formato no se puede leer."""
        ...


class StatementExtractor(Protocol):
    async def extract(self, content: bytes, model: str, options: ExtractionOptions) -> StatementTable:
        """Lanza ExternalServiceError si el proveedor falla o responde algo inservible."""
        ...


class InvoiceExtractor(Protocol):
    async def extract(self, request: ExtractionRequest) -> ExtractionResponse:
        """Lanza ExternalServiceError si el proveedor falla o responde algo inservible."""
        ...


@dataclass(frozen=True)
class Button:
    id: str
    title: str


@dataclass(frozen=True)
class ListRow:
    id: str
    title: str
    description: str | None = None


@dataclass(frozen=True)
class FlowMessage:
    """Un WhatsApp Flow publicado, abierto en `screen` con `data` precargada. El `token` vuelve en la
    respuesta del usuario y es lo único que la identifica."""

    flow_id: str
    text: str
    cta: str
    token: str
    screen: str
    data: dict[str, Any]


class MessageSender(Protocol):
    async def send_text(self, to: WhatsAppAddress, text: str) -> str | None: ...
    async def send_buttons(self, to: WhatsAppAddress, text: str, buttons: list[Button]) -> str | None: ...
    async def send_list(self, to: WhatsAppAddress, text: str, button_label: str, rows: list[ListRow]) -> str | None: ...
    async def send_template(
        self, to: WhatsAppAddress, name: str, language: str, body_params: list[str], button_payloads: list[str]
    ) -> str | None: ...
    async def send_flow(self, to: WhatsAppAddress, flow: FlowMessage) -> str | None: ...
    async def request_contact_info(self, to: WhatsAppAddress, text: str) -> str | None: ...
    async def react(self, to: WhatsAppAddress, message_id: str, emoji: str) -> None: ...
    async def mark_read(self, message_id: str, typing: bool = True) -> None: ...


class MediaSource(Protocol):
    async def download(self, media_id: str) -> tuple[bytes, str]:
        """Devuelve (bytes, mime type) de un archivo recibido por WhatsApp."""
        ...


class PasswordHasher(Protocol):
    def hash(self, password: str) -> str: ...
    def verify(self, password_hash: str, password: str) -> bool: ...


@dataclass(frozen=True)
class AccessClaims:
    employee_id: uuid.UUID
    role: Role
    token_version: int


@dataclass(frozen=True)
class FlowClaims:
    employee_id: uuid.UUID
    purpose: str
    entity_id: str | None


class TokenService(Protocol):
    def issue_access_token(self, employee: Employee) -> tuple[str, int]:
        """Devuelve (token, expires_in en segundos)."""
        ...

    def decode_access_token(self, token: str) -> AccessClaims: ...
    def issue_mfa_challenge(self, employee: Employee) -> tuple[str, int]:
        """Token corto que solo sirve para completar el segundo factor del login."""
        ...

    def decode_mfa_challenge(self, token: str) -> AccessClaims: ...
    def issue_flow_token(self, employee_id: uuid.UUID, purpose: str, entity_id: str | None) -> str:
        """Token firmado y corto para un WhatsApp Flow: quién lo abrió, para qué y sobre qué registro."""
        ...

    def decode_flow_token(self, token: str) -> FlowClaims: ...
    def new_opaque_token(self) -> str: ...
    def hash_opaque_token(self, token: str) -> str: ...


class TotpService(Protocol):
    def new_secret(self) -> str: ...
    def provisioning_uri(self, secret: str, account: str) -> str: ...
    def verify(self, secret: str, code: str) -> bool: ...


class SecretCipher(Protocol):
    """Cifrado simétrico para secretos guardados en la BD (p. ej. la semilla del MFA)."""

    def encrypt(self, plain: str) -> str: ...
    def decrypt(self, token: str) -> str: ...


class RateLimiter(Protocol):
    async def hit(self, scope: str, key: str, limit: str) -> int | None:
        """Consume una unidad; devuelve None si se permite o los segundos de espera si está limitado."""
        ...


class CacheVersions(Protocol):
    """Versión por espacio de nombres compartida entre workers (Redis). None = no disponible."""

    async def current(self, namespace: str) -> int | None: ...
    async def bump(self, namespace: str) -> None: ...


class ExchangeRateProvider(Protocol):
    async def fetch(self, start: date, end: date, quotes: list[str]) -> list[ExchangeRate]:
        """Tasas publicadas entre `start` y `end` (USD contra cada moneda de `quotes` que cubra la fuente)."""
        ...


class DistributedLock(Protocol):
    async def acquire(self, name: str, ttl_seconds: float) -> bool:
        """True si este proceso obtuvo el candado (o si no hay cómo saberlo: falla abierto)."""
        ...


class Clock(Protocol):
    def now(self) -> datetime: ...


@dataclass(frozen=True)
class ReportTable:
    title: str
    header_rows: list[tuple[str, str]]  # bloque (etiqueta, valor) encima de la tabla
    columns: list[str]
    rows: list[list[Any]]


class SpreadsheetWriter(Protocol):
    def write(self, table: ReportTable) -> bytes: ...
