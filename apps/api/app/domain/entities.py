"""Entidades del dominio (POO plana, sin dependencias de framework ni de BD).

Las reglas de negocio viven en los métodos de las entidades: los casos de uso orquestan, las entidades
deciden. La persistencia mapea estas clases de forma imperativa (ver adapters/outbound/persistence),
así SQLAlchemy nunca se filtra aquí."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from app.domain.enums import (
    AdvanceKind,
    AdvanceStatus,
    ApprovalLevel,
    BankStatus,
    BudgetUnit,
    Channel,
    ChargeDecision,
    Deductibility,
    DisbursementMethod,
    DocumentType,
    ErpStatus,
    ExampleKind,
    ExampleScope,
    ExampleStatus,
    ExchangeRatePolicy,
    ExchangeRateSource,
    ExpenseSource,
    ExpenseStatus,
    Legibility,
    MatchStatus,
    PaymentMethod,
    PolicyAction,
    ReviewDecision,
    ReviewStatus,
    Role,
    SettlementMethod,
    SettlementStatus,
    StaffType,
    StepStatus,
    UnreadableReason,
    WhatsAppLinkStatus,
)
from app.domain.errors import InvalidOperationError, JustificationRequiredError, PermissionDeniedError, PolicyBlockedError
from app.domain.values import InvoiceData, WhatsAppAddress


def utcnow() -> datetime:
    return datetime.now(UTC)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal | date | time | uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    return value


@dataclass(eq=False)
class Company:
    name: str
    country: str  # ISO-3166 alpha-2: CO, PA, MX
    currency: str  # moneda funcional ISO-4217: COP, USD, MXN
    tax_id: str | None = None
    is_test: bool = False  # compañía de QA en producción: se excluye de consumo, reportes y presupuestos
    generic_tax_id: str | None = None  # tercero genérico para recibos sin NIT
    # Deducibilidad sugerida por tipo de documento; se copia de defaults.deductibility al crearla.
    deductibility: dict[str, str] = field(default_factory=dict)
    legal_name: str | None = None  # razón social, la que debe ir en las facturas
    timezone: str = "UTC"  # IANA; las fechas de negocio (mes, fin del viaje) se calculan en esta zona
    exchange_rate_policy: ExchangeRatePolicy = ExchangeRatePolicy.DAILY
    # Tope del anticipo en efectivo en moneda extranjera, p. ej. {"amount": "200", "currency": "USD"}.
    cash_international_cap: dict[str, str] | None = None
    # Escalamiento al jefe directivo (decisiones 4.1 y 4.2); lo configura contabilidad.
    approval_tolerance_pct: Decimal = Decimal(10)  # sobre el presupuesto calculado
    approval_thresholds: dict[str, str] = field(default_factory=dict)  # moneda -> monto total que escala
    active: bool = True
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        self.country = self.country.upper()
        self.currency = self.currency.upper()

    def deductibility_for(self, document_type: DocumentType | str | None) -> Deductibility:
        """Deducibilidad sugerida por tipo de documento (o por "foreign_invoice"); contabilidad puede
        cambiarla en cada gasto."""
        value = (self.deductibility or {}).get(document_type or DocumentType.OTHER, "")
        return Deductibility(value) if value in Deductibility._value2member_map_ else Deductibility.NON_DEDUCTIBLE


@dataclass(eq=False)
class Category:
    """Categoría de gasto de una compañía (hospedaje, alimentación...). La IA sugiere una de estas."""

    company_id: uuid.UUID
    code: str
    name: str
    emoji: str | None = None
    accounting_account: str | None = None  # cuenta contable para el Excel
    position: int = 0
    active: bool = True
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)


def categories_from(company_id: uuid.UUID, defaults: list[dict[str, Any]]) -> list[Category]:
    """Copia a una compañía nueva las categorías por defecto (llave defaults.categories)."""
    return [
        Category(company_id, item["code"], item["name"], item.get("emoji"), item.get("accounting_account"), position)
        for position, item in enumerate(defaults)
    ]


@dataclass(eq=False)
class BlockedConcept:
    """Concepto que la compañía no reembolsa (licor, minibar...). La IA clasifica cada línea de la
    factura contra estos por significado, no por palabras clave."""

    company_id: uuid.UUID
    code: str
    name: str
    description: str | None = None
    examples: list[str] = field(default_factory=list)
    active: bool = True
    deductible: bool = False  # si se acepta completo, ¿la línea es deducible para la compañía?
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)


def blocked_concepts_from(company_id: uuid.UUID, defaults: list[dict[str, Any]]) -> list[BlockedConcept]:
    """Copia a una compañía nueva los conceptos bloqueados por defecto (llave defaults.blocked_concepts)."""
    return [
        BlockedConcept(
            company_id,
            item["code"],
            item["name"],
            item.get("description"),
            list(item.get("examples", [])),
            deductible=bool(item.get("deductible", False)),
        )
        for item in defaults
    ]


@dataclass(eq=False)
class TravelZone:
    """Zona de viaje de una compañía (p. ej. "Ciudades principales") con las ciudades o países que la
    forman; el destino del anticipo se resuelve contra estos lugares."""

    company_id: uuid.UUID
    name: str
    places: list[str] = field(default_factory=list)
    active: bool = True
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)


@dataclass(eq=False)
class TravelBudgetRate:
    """Tarifa de viaje: zona x tipo de personal x categoría, con su unidad y vigencia."""

    company_id: uuid.UUID
    zone_id: uuid.UUID
    staff_type: StaffType
    category_code: str
    amount: Decimal
    currency: str
    unit: BudgetUnit
    valid_from: date
    valid_to: date | None = None
    active: bool = True
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def is_valid_on(self, day: date) -> bool:
        return self.active and self.valid_from <= day and (self.valid_to is None or day <= self.valid_to)


@dataclass(eq=False)
class PolicyRuleConfig:
    """Configuración por compañía de un tipo de regla: parámetros, acción y encendido/apagado.
    Los *tipos* de regla viven en código (domain/policies.py); su configuración es dato."""

    company_id: uuid.UUID
    rule_type: str
    action: PolicyAction
    params: dict[str, Any] = field(default_factory=dict)
    active: bool = True
    updated_by: uuid.UUID | None = None
    updated_at: datetime = field(default_factory=utcnow)
    id: uuid.UUID = field(default_factory=uuid.uuid4)


@dataclass(eq=False)
class Employee:
    full_name: str
    email: str
    role: Role = Role.EMPLOYEE
    phone: str | None = None  # wa_id: dígitos con indicativo de país (573001234567)
    staff_type: StaffType | None = None  # define la tarifa de su presupuesto de viaje
    company_ids: list[uuid.UUID] = field(default_factory=list)
    approver_id: uuid.UUID | None = None
    password_hash: str | None = None
    must_change_password: bool = False
    token_version: int = 0
    failed_logins: int = 0
    locked_until: datetime | None = None
    # Doble factor (TOTP). El secreto se guarda cifrado; los códigos de recuperación, como hash.
    mfa_secret: str | None = None
    mfa_enabled: bool = False
    mfa_recovery_codes: list[str] = field(default_factory=list)
    mfa_last_code_hash: str | None = None  # evita reusar el mismo código dentro de su ventana de 30 s
    # Identidad de WhatsApp (ver README: BSUID)
    wa_user_id: str | None = None  # BSUID confirmado
    wa_pending_user_id: str | None = None  # BSUID capturado de la bienvenida, pendiente de confirmar
    wa_link_status: WhatsAppLinkStatus = WhatsAppLinkStatus.NONE
    wa_username: str | None = None  # solo para mostrar, nunca se usa como identidad
    wa_profile_name: str | None = None
    wa_welcome_message_id: str | None = None
    privacy_accepted_at: datetime | None = None
    active: bool = True
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        self.email = self.email.strip().lower()

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN

    @property
    def first_name(self) -> str:
        return self.full_name.split()[0] if self.full_name.strip() else ""

    @property
    def primary_company_id(self) -> uuid.UUID | None:
        return self.company_ids[0] if self.company_ids else None

    @property
    def whatsapp_address(self) -> WhatsAppAddress | None:
        if not self.phone and not self.wa_user_id:
            return None
        return WhatsAppAddress(phone=self.phone, user_id=self.wa_user_id)

    def works_for(self, company_id: uuid.UUID | None) -> bool:
        return company_id is not None and company_id in self.company_ids

    def shares_company_with(self, other: Employee) -> bool:
        return bool(set(self.company_ids) & set(other.company_ids))

    def can_approve_for(self, other: Employee, delegated_from: frozenset[uuid.UUID] = frozenset()) -> bool:
        """El aprobador aprueba a sus reportes directos (y a los de quien lo dejó de suplente);
        contadores y admins, dentro de su alcance. Nadie se aprueba a sí mismo (segregación de funciones)."""
        if other.id == self.id:
            return False
        if self.role == Role.ADMIN:
            return True
        if self.role == Role.ACCOUNTANT:
            return self.shares_company_with(other)
        return self.role == Role.APPROVER and (other.approver_id == self.id or other.approver_id in delegated_from)

    def is_locked(self, now: datetime) -> bool:
        return self.locked_until is not None and self.locked_until > now

    def register_failed_login(self, now: datetime, max_attempts: int, base_lock: timedelta) -> None:
        """Bloqueo progresivo: desde `max_attempts` fallos, el bloqueo se duplica con cada fallo nuevo."""
        self.failed_logins += 1
        if self.failed_logins >= max_attempts:
            factor = 2 ** (self.failed_logins - max_attempts)
            self.locked_until = now + base_lock * min(factor, 32)

    def register_successful_login(self) -> None:
        self.failed_logins = 0
        self.locked_until = None

    def change_password(self, password_hash: str, *, temporary: bool = False) -> None:
        self.password_hash = password_hash
        self.must_change_password = temporary
        self.revoke_sessions()

    def start_mfa_setup(self, encrypted_secret: str) -> None:
        if self.mfa_enabled:
            raise InvalidOperationError("MFA already enabled", code="mfa_already_enabled")
        self.mfa_secret = encrypted_secret

    def enable_mfa(self, recovery_code_hashes: list[str]) -> None:
        if self.mfa_secret is None:
            raise InvalidOperationError("MFA setup not started", code="mfa_setup_not_started")
        self.mfa_enabled = True
        self.mfa_recovery_codes = recovery_code_hashes
        self.revoke_sessions()

    def reset_mfa(self) -> None:
        self.mfa_secret = None
        self.mfa_enabled = False
        self.mfa_recovery_codes = []
        self.mfa_last_code_hash = None
        self.revoke_sessions()

    def use_recovery_code(self, code_hash: str) -> bool:
        if code_hash not in self.mfa_recovery_codes:
            return False
        self.mfa_recovery_codes = [c for c in self.mfa_recovery_codes if c != code_hash]
        return True

    def revoke_sessions(self) -> None:
        """Invalida todos los access tokens emitidos (llevan el token_version)."""
        self.token_version += 1

    def deactivate(self) -> None:
        self.active = False
        self.revoke_sessions()

    def activate(self) -> None:
        self.active = True
        self.failed_logins = 0
        self.locked_until = None

    def set_phone(self, phone: str | None) -> None:
        if phone != self.phone:
            self.phone = phone
            # Un teléfono nuevo puede ser de otra persona: el vínculo de WhatsApp anterior ya no aplica.
            self.unlink_whatsapp()

    def record_welcome(self, message_id: str) -> None:
        self.wa_welcome_message_id = message_id

    def capture_pending_whatsapp_id(self, user_id: str) -> None:
        if self.wa_link_status != WhatsAppLinkStatus.ACTIVE:
            self.wa_pending_user_id = user_id
            self.wa_link_status = WhatsAppLinkStatus.PENDING

    def link_whatsapp(self, user_id: str, now: datetime, *, accepted_privacy: bool = False) -> None:
        self.wa_user_id = user_id
        self.wa_pending_user_id = None
        self.wa_link_status = WhatsAppLinkStatus.ACTIVE
        if accepted_privacy and self.privacy_accepted_at is None:
            self.privacy_accepted_at = now

    def unlink_whatsapp(self) -> None:
        self.wa_user_id = None
        self.wa_pending_user_id = None
        self.wa_link_status = WhatsAppLinkStatus.NONE

    def forget_contact(self) -> None:
        """Supresión (habeas data) de los datos de contacto de un usuario retirado. Sus gastos son
        soporte contable y se conservan."""
        self.phone = None
        self.unlink_whatsapp()
        self.wa_username = self.wa_profile_name = self.wa_welcome_message_id = None

    def update_whatsapp_profile(self, username: str | None, profile_name: str | None) -> None:
        self.wa_username = username or self.wa_username
        self.wa_profile_name = profile_name or self.wa_profile_name


@dataclass(eq=False)
class RefreshToken:
    """Refresh token opaco, guardado con hash. Los tokens de un mismo login forman una familia: si
    reutilizan uno ya rotado es porque lo robaron, así que se revoca toda la familia."""

    employee_id: uuid.UUID
    token_hash: str
    family_id: uuid.UUID
    expires_at: datetime
    revoked_at: datetime | None = None
    rotated_at: datetime | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def is_usable(self, now: datetime) -> bool:
        return self.revoked_at is None and self.rotated_at is None and self.expires_at > now


@dataclass(eq=False)
class WhatsAppLinkCode:
    """Código de un solo uso de 6 dígitos que el empleado envía por WhatsApp ("VINCULAR 123456") para
    vincular su BSUID cuando Meta no comparte su teléfono."""

    employee_id: uuid.UUID
    code_hash: str
    expires_at: datetime
    attempts: int = 0
    used_at: datetime | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def is_usable(self, now: datetime, max_attempts: int) -> bool:
        return self.used_at is None and self.expires_at > now and self.attempts < max_attempts


def advance_for_date(advances: list[Advance], day: date | None, days_before: int, days_after: int) -> Advance | None:
    """El anticipo al que corresponde una factura por su fecha: con uno solo abierto, ese; con varios,
    el único cuyo viaje cubre la fecha (primero exacta, luego con la tolerancia). Si hay empate, ninguno."""
    if len(advances) == 1:
        return advances[0]
    if day is None:
        return None
    dated = [a for a in advances if a.start_date and a.end_date]
    for before, after in sorted({(0, 0), (days_before, days_after)}):
        matches = [a for a in dated if a.covers(day, before, after)]
        if matches:
            return matches[0] if len(matches) == 1 else None
    return None


# Meta solo permite mensajes libres hasta 24 h después del último mensaje del usuario; después, plantilla.
SERVICE_WINDOW = timedelta(hours=24)


@dataclass(eq=False)
class WhatsAppSession:
    """Conversación de WhatsApp de un empleado: define cuándo saludar de nuevo y si la ventana de
    24 h de Meta sigue abierta para escribirle sin plantilla."""

    employee_id: uuid.UUID
    last_inbound_at: datetime
    started_at: datetime
    closed_at: datetime | None = None
    reminder_sent_at: datetime | None = None

    def register_inbound(self, now: datetime, ttl: timedelta) -> bool:
        """Registra un mensaje del usuario; devuelve True si con él empieza una conversación nueva."""
        new = self.closed_at is not None or now - self.last_inbound_at > ttl
        if new:
            self.started_at, self.closed_at, self.reminder_sent_at = now, None, None
        self.last_inbound_at = now
        return new

    def window_open(self, now: datetime) -> bool:
        return now - self.last_inbound_at < SERVICE_WINDOW

    def close(self, now: datetime) -> None:
        self.closed_at = self.closed_at or now


@dataclass(eq=False)
class ApproverDelegation:
    """Suplencia: mientras esté vigente, `delegate_id` aprueba por `approver_id` (vacaciones, viajes)."""

    approver_id: uuid.UUID
    delegate_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    created_by: uuid.UUID
    revoked_at: datetime | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def is_active(self, now: datetime) -> bool:
        return self.revoked_at is None and self.starts_at <= now < self.ends_at


@dataclass(frozen=True)
class AdvanceBalance:
    currency: str
    amount: Decimal  # valor aprobado
    applied: Decimal  # cubierto por gastos confirmados
    expenses_count: int
    disbursed: Decimal = Decimal(0)  # lo que tesorería ya entregó

    @property
    def pending(self) -> Decimal:
        """Lo que falta por legalizar. Negativo = el empleado gastó más de lo que recibió."""
        return self.amount - self.applied


@dataclass(eq=False)
class Advance:
    employee_id: uuid.UUID
    company_id: uuid.UUID
    kind: AdvanceKind
    currency: str
    amount: Decimal
    purpose: str
    destination: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: AdvanceStatus = AdvanceStatus.REQUESTED
    # Presupuesto calculado con las tarifas de viaje (solo para calcular el valor, no son topes).
    budget_zone_id: uuid.UUID | None = None
    budget_amount: Decimal | None = None
    budget_breakdown: list[dict[str, Any]] = field(default_factory=list)
    budget_justification: str | None = None  # por qué se pidió un valor distinto al calculado (o por qué escala)
    # Tramos de un viaje con varios destinos (domain/budgets.TripLeg.as_dict). Vacío si tuvo uno solo;
    # destination, start_date y end_date resumen el viaje completo.
    legs: list[dict[str, Any]] = field(default_factory=list)
    # Siesa (decisión 8.1): el anticipo se crea al aprobarse; la legalización, cuando contabilidad la envía.
    erp_advance_status: ErpStatus | None = None
    erp_advance_ref: str | None = None
    erp_legalization_status: ErpStatus | None = None
    erp_legalization_ref: str | None = None
    erp_error: str | None = None  # el último error del envío, para mostrarlo y reintentar
    # Ruta de aprobación (domain/approvals.py): pasos con nivel, aprobador y estado. Vacía en solicitudes
    # anteriores a la ruta, que conservan la regla de entonces (el aprobador del empleado).
    approval_steps: list[dict[str, Any]] = field(default_factory=list)
    escalation_reasons: list[dict[str, Any]] = field(default_factory=list)
    decided_by: uuid.UUID | None = None
    decided_at: datetime | None = None
    decision_note: str | None = None
    # Fechas de cada paso (decided_* solo guarda la última decisión).
    approved_at: datetime | None = None
    approved_by: uuid.UUID | None = None
    submitted_at: datetime | None = None
    returned_at: datetime | None = None
    closed_at: datetime | None = None
    closed_by: uuid.UUID | None = None
    # Tesorería
    disbursed_at: datetime | None = None
    disbursed_by: uuid.UUID | None = None
    disbursement_method: DisbursementMethod | None = None
    disbursement_ref: str | None = None
    settlement_status: SettlementStatus | None = None  # se fija al cerrar
    settled_at: datetime | None = None
    settled_by: uuid.UUID | None = None
    settlement_method: SettlementMethod | None = None
    settlement_ref: str | None = None
    reminders_sent: list[int] = field(default_factory=list)  # días tras el viaje ya recordados
    legalization_due: date | None = None  # plazo para legalizar: se fija al aprobarse (decisión 2.5)
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        if self.amount < 0:
            raise InvalidOperationError("Negative advance amount", code="negative_amount")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise InvalidOperationError("End date before start date", code="end_before_start")
        self.currency = self.currency.upper()

    def is_overdue(self, today: date) -> bool:
        """Aprobado y sin enviar la legalización después del plazo."""
        return self.status == AdvanceStatus.APPROVED and self.legalization_due is not None and today > self.legalization_due

    @property
    def accepts_expenses(self) -> bool:
        return self.status == AdvanceStatus.APPROVED

    @property
    def label(self) -> str:
        if self.destination and self.start_date and self.end_date:
            return f"{self.destination} {self.start_date:%d/%m}–{self.end_date:%d/%m}"
        return self.destination or self.purpose

    def covers(self, day: date | None, days_before: int = 0, days_after: int = 0) -> bool:
        """Decisión 2.1: las facturas van desde el día de salida hasta 1 día después del regreso."""
        if day is None or self.start_date is None or self.end_date is None:
            return True
        return self.start_date - timedelta(days=days_before) <= day <= self.end_date + timedelta(days=days_after)

    def approve(self, approver: Employee, requester: Employee, delegated_from: frozenset[uuid.UUID] = frozenset()) -> bool:
        """Aprueba el paso que le toca; devuelve True si con eso la solicitud quedó aprobada. Si aprueba un
        nivel superior (directivo o gerencia), los pasos anteriores pendientes ya no hacen falta (4.4)."""
        self._require(AdvanceStatus.REQUESTED, "approve")
        if not self.approval_steps:
            self._check_decider(approver, requester, delegated_from)
            self._finish_approval(approver.id)
            return True
        steps, index = self._my_step(approver, requester, delegated_from)
        now = utcnow()
        steps[index].update(status=StepStatus.APPROVED.value, decided_by=str(approver.id), decided_at=now.isoformat())
        if steps[index]["level"] != ApprovalLevel.BOSS:
            for earlier in steps[:index]:
                if earlier["status"] == StepStatus.PENDING:
                    earlier.update(status=StepStatus.SKIPPED.value, decided_at=now.isoformat())
        self.approval_steps = steps
        if all(s["status"] in (StepStatus.APPROVED, StepStatus.SKIPPED) for s in steps):
            self._finish_approval(approver.id)
            return True
        self.decided_by, self.decided_at = approver.id, now
        return False

    def reject(
        self, approver: Employee, requester: Employee, note: str | None, delegated_from: frozenset[uuid.UUID] = frozenset()
    ) -> None:
        self._require(AdvanceStatus.REQUESTED, "reject")
        if self.approval_steps:
            steps, index = self._my_step(approver, requester, delegated_from)
            steps[index].update(
                status=StepStatus.REJECTED.value, decided_by=str(approver.id), decided_at=utcnow().isoformat(), note=note
            )
            self.approval_steps = steps
        else:
            self._check_decider(approver, requester, delegated_from)
        self._decide(AdvanceStatus.REJECTED, approver.id, note)

    def decidable_steps(self) -> list[dict[str, Any]]:
        """El turno normal y, si hay, el nivel superior pendiente (que puede decidir sin esperar)."""
        if self.status != AdvanceStatus.REQUESTED:
            return []
        pending = [s for s in self.approval_steps if s["status"] == StepStatus.PENDING]
        if not pending:
            return []
        superior = next((s for s in pending if s["level"] != ApprovalLevel.BOSS), None)
        return [pending[0]] if superior is None or superior is pending[0] else [pending[0], superior]

    def can_decide(self, actor: Employee, delegated_from: frozenset[uuid.UUID] = frozenset()) -> bool:
        return actor.id != self.employee_id and any(self._decides(s, actor, delegated_from) for s in self.decidable_steps())

    def involves(self, actor: Employee, delegated_from: frozenset[uuid.UUID] = frozenset()) -> bool:
        """Está (o estuvo) en la ruta: puede ver la solicitud aunque el empleado no le reporte directo."""
        return any(self._decides(s, actor, delegated_from) for s in self.approval_steps)

    def _decides(self, step: dict[str, Any], actor: Employee, delegated_from: frozenset[uuid.UUID]) -> bool:
        if step["level"] == ApprovalLevel.MANAGEMENT and step["approver_id"] is None:
            return actor.role == Role.MANAGEMENT and actor.works_for(self.company_id)
        approver_id = uuid.UUID(step["approver_id"]) if step["approver_id"] else None
        return approver_id is not None and (approver_id == actor.id or approver_id in delegated_from)

    def _my_step(
        self, approver: Employee, requester: Employee, delegated_from: frozenset[uuid.UUID]
    ) -> tuple[list[dict[str, Any]], int]:
        if approver.id == requester.id:
            raise PermissionDeniedError("Nobody can decide on their own advance", code="self_decision")
        mine = [s for s in self.decidable_steps() if self._decides(s, approver, delegated_from)]
        if not mine:
            raise PermissionDeniedError("Not the approver of this step", code="not_your_approver")
        # Si la misma persona está en dos pasos, decide en el más alto. Se copian los pasos para que el
        # ORM note el cambio de la columna JSON.
        index = self.approval_steps.index(mine[-1])
        return [dict(s) for s in self.approval_steps], index

    def _finish_approval(self, approver_id: uuid.UUID) -> None:
        self._decide(AdvanceStatus.APPROVED, approver_id, None)
        self.approved_at, self.approved_by = self.decided_at, approver_id

    def submit_for_review(self, now: datetime) -> None:
        self._require(AdvanceStatus.APPROVED, "submit")
        self.status = AdvanceStatus.IN_REVIEW
        self.submitted_at = now

    def close(
        self, approver: Employee, requester: Employee, pending: Decimal, delegated_from: frozenset[uuid.UUID] = frozenset()
    ) -> None:
        """Al cerrar queda definido qué pasa con la diferencia: reintegro, pago al empleado o nada."""
        self._require(AdvanceStatus.IN_REVIEW, "close")
        self._check_decider(approver, requester, delegated_from)
        self._decide(AdvanceStatus.CLOSED, approver.id, None)
        self.closed_at, self.closed_by = self.decided_at, approver.id
        if pending > 0:
            self.settlement_status = SettlementStatus.REFUND_PENDING
        elif pending < 0:
            self.settlement_status = SettlementStatus.PAYMENT_PENDING
        else:
            self.settlement_status = SettlementStatus.NONE

    def return_for_changes(
        self, approver: Employee, requester: Employee, note: str | None, delegated_from: frozenset[uuid.UUID] = frozenset()
    ) -> None:
        self._require(AdvanceStatus.IN_REVIEW, "return")
        self._check_decider(approver, requester, delegated_from)
        self._decide(AdvanceStatus.APPROVED, approver.id, note)
        self.returned_at = self.decided_at

    def cancel(self, now: datetime) -> None:
        """Retirar una solicitud que todavía no se aprobó (no se entregó dinero)."""
        self._require(AdvanceStatus.REQUESTED, "cancel")
        self.status = AdvanceStatus.CANCELLED
        self.decided_at = now

    def void(self, actor_id: uuid.UUID, note: str, applied: Decimal, now: datetime) -> None:
        """Anular un anticipo aprobado (viaje cancelado, aprobado por error). Si ya tiene gastos
        aplicados no se anula: se legaliza y se cierra, y la diferencia se reintegra."""
        self._require(AdvanceStatus.APPROVED, "void")
        if applied != 0:
            raise InvalidOperationError("The advance already has expenses", code="advance_has_expenses")
        self.status = AdvanceStatus.VOIDED
        self.decided_by, self.decided_at, self.decision_note = actor_id, now, note

    def reopen(self, actor_id: uuid.UUID, note: str, now: datetime) -> None:
        """Una legalización cerrada por error vuelve a revisión, si aún no se liquidó la diferencia."""
        self._require(AdvanceStatus.CLOSED, "reopen")
        if self.settlement_status in (SettlementStatus.REFUNDED, SettlementStatus.PAYROLL_DEDUCTED, SettlementStatus.PAID):
            raise InvalidOperationError("The advance was already settled", code="advance_already_settled")
        self.status = AdvanceStatus.IN_REVIEW
        self.settlement_status = None
        self.closed_at = self.closed_by = None
        self.decided_by, self.decided_at, self.decision_note = actor_id, now, note

    def disburse(self, actor_id: uuid.UUID, method: DisbursementMethod, reference: str | None, when: datetime) -> None:
        self._require(AdvanceStatus.APPROVED, "disburse")
        if self.disbursed_at is not None:
            raise InvalidOperationError("Already disbursed", code="advance_already_disbursed")
        self.disbursed_at, self.disbursed_by = when, actor_id
        self.disbursement_method, self.disbursement_ref = method, reference

    def settle(self, actor_id: uuid.UUID, method: SettlementMethod, reference: str | None, when: datetime) -> None:
        allowed = {
            SettlementStatus.REFUND_PENDING: {
                SettlementMethod.REFUND: SettlementStatus.REFUNDED,
                SettlementMethod.PAYROLL_DEDUCTION: SettlementStatus.PAYROLL_DEDUCTED,
            },
            SettlementStatus.PAYMENT_PENDING: {SettlementMethod.PAYMENT: SettlementStatus.PAID},
        }
        options = allowed.get(self.settlement_status) if self.settlement_status else None
        if options is None or method not in options:
            raise InvalidOperationError(
                "Nothing to settle with that method",
                code="invalid_settlement",
                status=(self.settlement_status or SettlementStatus.NONE).value,
            )
        self.settlement_status = options[method]
        self.settled_at, self.settled_by = when, actor_id
        self.settlement_method, self.settlement_ref = method, reference

    def balance(self, expenses: list[Expense]) -> AdvanceBalance:
        counted = [e for e in expenses if e.counts_against(self.id)]
        applied = sum((e.applied_net for e in counted), Decimal(0))
        disbursed = self.amount if self.disbursed_at is not None else Decimal(0)
        return AdvanceBalance(self.currency, self.amount, applied, len(counted), disbursed)

    def _require(self, status: AdvanceStatus, action: str) -> None:
        if self.status != status:
            raise InvalidOperationError(
                f"Cannot {action} an advance in status {self.status}",
                code="invalid_advance_transition",
                action=action,
                status=self.status.value,
            )

    @staticmethod
    def _check_decider(approver: Employee, requester: Employee, delegated_from: frozenset[uuid.UUID]) -> None:
        if approver.id == requester.id:
            raise PermissionDeniedError("Nobody can decide on their own advance", code="self_decision")
        if not approver.can_approve_for(requester, delegated_from):
            raise PermissionDeniedError("Not the approver of this employee", code="not_your_approver")

    def _decide(self, status: AdvanceStatus, approver_id: uuid.UUID, note: str | None) -> None:
        self.status = status
        self.decided_by = approver_id
        self.decided_at = utcnow()
        self.decision_note = note


EDITABLE_INVOICE_FIELDS = (
    "document_type",
    "vendor_name",
    "vendor_tax_id",
    "invoice_number",
    "invoice_date",
    "invoice_time",
    "currency",
    "subtotal",
    "tax_amount",
    "tip_amount",
    "total",
    "fiscal_id",
    "buyer_tax_id",
    "country",
    "category",
    "description",
    "taxes",
)
# Lo que el usuario puede corregir: los datos de la factura y cómo la pagó.
EDITABLE_FIELDS = (*EDITABLE_INVOICE_FIELDS, "payment_method")


@dataclass(eq=False)
class Expense:
    """Cada gasto corresponde a un solo documento fiscal."""

    employee_id: uuid.UUID
    source: ExpenseSource
    company_id: uuid.UUID | None = None
    status: ExpenseStatus = ExpenseStatus.RECEIVED
    advance_id: uuid.UUID | None = None
    file_key: str | None = None
    mime_type: str | None = None
    file_sha256: str | None = None
    document_index: int = 0  # posición dentro de una foto/PDF con varias facturas
    parent_id: uuid.UUID | None = None  # primer gasto creado a partir del mismo archivo
    wa_message_id: str | None = None  # llave de idempotencia de Meta (solo en el primer gasto del archivo)
    wa_media_id: str | None = None
    client_ref: str | None = None  # llave de idempotencia de la app (cola offline)
    sent_at: datetime | None = None
    document_type: DocumentType | None = None
    vendor_name: str | None = None
    vendor_tax_id: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    invoice_time: time | None = None
    currency: str | None = None
    subtotal: Decimal | None = None
    tax_amount: Decimal | None = None
    tip_amount: Decimal | None = None
    total: Decimal | None = None
    fiscal_id: str | None = None
    buyer_tax_id: str | None = None
    country: str | None = None
    category: str | None = None
    description: str | None = None
    taxes: list[dict[str, Any]] = field(default_factory=list)  # [{type, rate, base, amount}]
    itemized: bool = False
    legibility: Legibility | None = None
    unreadable_reason: UnreadableReason | None = None
    ai_confidence: float | None = None
    ai_snapshot: dict[str, Any] | None = None  # lo que leyó la IA, separado de las ediciones del usuario
    field_sources: dict[str, str] = field(default_factory=dict)
    amount_applied: Decimal | None = None  # valor en la moneda del anticipo
    exchange_rate: Decimal | None = None  # 1 unidad de la moneda del gasto = esta cantidad en la del anticipo
    exchange_rate_source: ExchangeRateSource | None = None
    exchange_rate_date: date | None = None
    warnings: list[str] = field(default_factory=list)  # alertas de lectura (calidad de la IA)
    policy_findings: list[dict[str, Any]] = field(default_factory=list)
    justification: str | None = None
    deductibility: Deductibility | None = None
    deductibility_set_by: uuid.UUID | None = None  # contabilidad la fijó a mano: la reevaluación no la pisa
    suggested_non_reimbursable: Decimal | None = None  # líneas bloqueadas + impuesto proporcional (moneda del gasto)
    non_reimbursable_amount: Decimal | None = None  # lo decide la revisión (moneda del anticipo)
    review_status: ReviewStatus = ReviewStatus.NOT_REQUIRED
    reviewed_by: uuid.UUID | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    attempts: int = 0
    last_error: str | None = None
    processing_started_at: datetime | None = None
    processed_at: datetime | None = None
    confirmed_at: datetime | None = None
    confirmed_by: uuid.UUID | None = None
    thumbnail_key: str | None = None  # miniatura JPEG en R2 para las listas
    return_note: str | None = None  # marca del aprobador al devolver la legalización
    return_resolved_at: datetime | None = None
    notified_at: datetime | None = None
    notification_batch_id: uuid.UUID | None = None
    duplicate_of_id: uuid.UUID | None = None  # el mismo empleado ya la había registrado: se descarta sola
    receipt_signed: bool = False  # recibo de caja: el empleado declara que lo firmó quien vendió (decisión 5.6)
    payment_method: PaymentMethod | None = None  # None = se asume por el tipo de anticipo al confirmar
    # Conciliación: con el cargo del extracto, el gasto se legaliza por lo que cobró el banco (decisión 7.8).
    bank_status: BankStatus | None = None
    bank_amount: Decimal | None = None  # valor cobrado, en la moneda del extracto
    bank_currency: str | None = None
    amount_before_bank: Decimal | None = None  # valor por la factura, para volver a él si se deshace el cruce
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)
    updated_at: datetime = field(default_factory=utcnow)

    @property
    def is_editable(self) -> bool:
        return self.status in (ExpenseStatus.EXTRACTED, ExpenseStatus.FAILED, ExpenseStatus.CONFIRMED)

    @property
    def reported_at(self) -> datetime:
        """Cuándo lo envió el usuario: la hora del mensaje de WhatsApp o la que manda la app (si el
        celular estaba sin señal, es la hora en que se recuperó la conexión)."""
        return self.sent_at or self.created_at

    @property
    def applied_net(self) -> Decimal:
        """Lo que finalmente se descuenta del anticipo tras la revisión del aprobador."""
        if self.review_status == ReviewStatus.REJECTED:
            return Decimal(0)
        return (self.amount_applied or Decimal(0)) - (self.non_reimbursable_amount or Decimal(0))

    def counts_against(self, advance_id: uuid.UUID) -> bool:
        return (
            self.status == ExpenseStatus.CONFIRMED
            and self.advance_id == advance_id
            and self.review_status != ReviewStatus.REJECTED
        )

    @property
    def invoice_amount(self) -> Decimal | None:
        """Lo que vale la factura en la moneda del anticipo, sin el ajuste del banco."""
        return self.amount_before_bank if self.bank_status == BankStatus.MATCHED else self.amount_applied

    def apply_bank_charge(self, charged: Decimal, currency: str, in_advance_currency: Decimal, now: datetime) -> None:
        """Se legaliza por lo cobrado en el extracto. Si contabilidad dejó líneas como no reembolsables,
        su parte se recalcula sobre el valor nuevo."""
        if self.bank_status != BankStatus.MATCHED:
            self.amount_before_bank = self.amount_applied
        self.bank_status, self.bank_amount, self.bank_currency = BankStatus.MATCHED, charged, currency.upper()
        self.amount_applied = in_advance_currency
        if self.review_status == ReviewStatus.ACCEPTED_PARTIAL:
            self.non_reimbursable_amount = self._non_reimbursable_in_advance_currency()
        self.touch(now)

    def mark_bank_status(self, status: BankStatus | None, now: datetime) -> None:
        """Sin cruce (o sin cargo): vuelve al valor de la factura."""
        if self.bank_status == BankStatus.MATCHED:
            self.amount_applied = self.amount_before_bank
            self.amount_before_bank = self.bank_amount = self.bank_currency = None
            if self.review_status == ReviewStatus.ACCEPTED_PARTIAL:
                self.non_reimbursable_amount = self._non_reimbursable_in_advance_currency()
        if status == BankStatus.MATCHED:
            raise InvalidOperationError("Use apply_bank_charge to match an expense", code="invalid_bank_status")
        if self.bank_status != status:
            self.bank_status = status
            self.touch(now)

    def findings_with(self, action: PolicyAction) -> list[dict[str, Any]]:
        return [f for f in self.policy_findings if f.get("action") == action]

    def start_processing(self, now: datetime) -> None:
        if self.status not in (ExpenseStatus.RECEIVED, ExpenseStatus.PROCESSING):
            raise InvalidOperationError(f"Expense cannot be processed in status {self.status}", code="expense_not_processable")
        self.status = ExpenseStatus.PROCESSING
        self.attempts += 1
        self.processing_started_at = now
        self.touch(now)

    def attach_file(self, key: str, mime_type: str, sha256: str) -> None:
        self.file_key, self.mime_type, self.file_sha256 = key, mime_type, sha256

    def apply_reading(self, doc: InvoiceData, warnings: list[str], legibility: Legibility, now: datetime) -> None:
        for name in EDITABLE_INVOICE_FIELDS:
            if name != "taxes":
                setattr(self, name, getattr(doc, name))
        self.taxes = [tax.as_dict() for tax in doc.taxes]
        if self.currency:
            self.currency = self.currency.upper()
        self.itemized = doc.itemized
        self.ai_confidence = doc.confidence
        self.legibility = legibility
        self.field_sources = dict(doc.field_sources)
        self.ai_snapshot = _jsonable(asdict(doc))
        self.warnings = sorted(set(warnings))
        self.status = ExpenseStatus.EXTRACTED
        self.last_error = None
        self.processed_at = now
        self.touch(now)

    def mark_unreadable(self, now: datetime, reason: UnreadableReason = UnreadableReason.UNREADABLE) -> None:
        self.legibility = Legibility.UNREADABLE
        self.unreadable_reason = reason
        self.status = ExpenseStatus.UNREADABLE
        self.processed_at = now
        self.touch(now)

    def register_failure(self, error: str, max_attempts: int, now: datetime) -> None:
        """Vuelve a la cola para otro intento, o queda FAILED (aún se puede completar a mano)."""
        self.last_error = error[:500]
        self.status = ExpenseStatus.FAILED if self.attempts >= max_attempts else ExpenseStatus.RECEIVED
        self.touch(now)

    def set_policy_result(
        self, findings: list[dict[str, Any]], deductibility: Deductibility | None, suggested_non_reimbursable: Decimal | None
    ) -> None:
        if self.review_status in (ReviewStatus.ACCEPTED, ReviewStatus.ACCEPTED_PARTIAL):
            # El aprobador ya levantó los bloqueos: una reevaluación no debe revivirlos.
            findings = [{**f, "action": PolicyAction.WARN} if f.get("action") == PolicyAction.BLOCK else f for f in findings]
        self.policy_findings = _jsonable(findings)
        if self.deductibility_set_by is None:
            self.deductibility = deductibility
        self.suggested_non_reimbursable = suggested_non_reimbursable
        if self.review_status in (ReviewStatus.NOT_REQUIRED, ReviewStatus.PENDING):
            relevant = [f for f in findings if f.get("action") != PolicyAction.WARN]
            self.review_status = ReviewStatus.PENDING if relevant else ReviewStatus.NOT_REQUIRED

    def spawn_sibling(self, document_index: int) -> Expense:
        """Una foto con varias facturas genera un gasto por factura, todos con el mismo archivo."""
        return Expense(
            employee_id=self.employee_id,
            source=self.source,
            company_id=self.company_id,
            status=ExpenseStatus.PROCESSING,
            advance_id=self.advance_id,
            file_key=self.file_key,
            mime_type=self.mime_type,
            file_sha256=self.file_sha256,
            thumbnail_key=self.thumbnail_key,
            document_index=document_index,
            parent_id=self.id,
            sent_at=self.sent_at,
            attempts=self.attempts,
        )

    def correct(self, changes: dict[str, Any], now: datetime) -> None:
        if not self.is_editable:
            raise InvalidOperationError(
                f"Expense cannot be edited in status {self.status}", code="expense_not_editable", status=self.status.value
            )
        unknown = set(changes) - set(EDITABLE_FIELDS)
        if unknown:
            raise InvalidOperationError("Fields not editable", code="fields_not_editable", fields=", ".join(sorted(unknown)))
        for name, value in changes.items():
            setattr(self, name, value)
        if "taxes" in changes:
            self.taxes = _jsonable(self.taxes or [])
        if "taxes" in changes and "tax_amount" not in changes:
            # El total de impuestos siempre es la suma del desglose.
            self.tax_amount = sum((Decimal(str(t["amount"])) for t in self.taxes), Decimal(0)) if self.taxes else None
        if self.currency:
            self.currency = self.currency.upper()
        if self.status == ExpenseStatus.FAILED:
            self.status = ExpenseStatus.EXTRACTED
        self.touch(now)

    def assign_to(self, advance: Advance | None) -> None:
        if advance is not None:
            if not advance.accepts_expenses:
                raise InvalidOperationError("The advance is not receiving expenses", code="advance_not_open")
            if advance.employee_id != self.employee_id:
                raise InvalidOperationError("The advance belongs to someone else", code="advance_of_other")
            self.company_id = advance.company_id
        self.advance_id = advance.id if advance else None

    def confirm(
        self,
        advance: Advance | None,
        now: datetime,
        amount_applied: Decimal | None = None,
        justification: str | None = None,
    ) -> None:
        """Misma moneda: el total completo se descuenta del anticipo; en otra moneda el usuario debe
        mandar el valor convertido. Los hallazgos de política pueden exigir justificación o bloquearlo."""
        if not self.is_editable:
            raise InvalidOperationError(
                f"Expense cannot be confirmed in status {self.status}", code="expense_not_confirmable", status=self.status.value
            )
        if self.total is None or not self.currency:
            raise InvalidOperationError("Total and currency are required", code="missing_total_currency")
        if self.findings_with(PolicyAction.BLOCK):
            raise PolicyBlockedError("A policy rule blocks this expense")
        if justification:
            self.justification = justification.strip()[:1000]
        if self.findings_with(PolicyAction.REQUIRE_JUSTIFICATION) and not self.justification:
            raise JustificationRequiredError("This expense needs a justification")
        self.assign_to(advance)
        # Confirmar de nuevo (p. ej. tras una devolución) vuelve al valor de la factura; la conciliación
        # lo cruza otra vez cuando el empleado reenvía la legalización.
        self.amount_before_bank = self.bank_amount = self.bank_currency = self.bank_status = None
        if self.payment_method is None and advance is not None:
            card = advance.kind in (AdvanceKind.RELOADABLE_CARD, AdvanceKind.CORPORATE_CARD)
            self.payment_method = PaymentMethod.CARD if card else PaymentMethod.CASH
        if advance is None:
            self.amount_applied = None
            self.clear_conversion()
        elif amount_applied is not None:
            self.amount_applied = amount_applied
            if self.currency != advance.currency:
                self.exchange_rate = (amount_applied / self.total).quantize(Decimal("0.00000001"))
                self.exchange_rate_source, self.exchange_rate_date = ExchangeRateSource.MANUAL, now.date()
            else:
                self.clear_conversion()
        elif self.currency == advance.currency:
            self.amount_applied = self.total
            self.clear_conversion()
        elif self.exchange_rate is None:
            raise InvalidOperationError(
                "Converted amount required",
                code="converted_amount_required",
                expense_currency=self.currency,
                advance_currency=advance.currency,
            )
        else:
            self.amount_applied = (self.total * self.exchange_rate).quantize(Decimal("0.01"))
        self.status = ExpenseStatus.CONFIRMED
        self.confirmed_at = now
        self.touch(now)

    def mark_for_return(self, note: str, now: datetime) -> None:
        self.return_note = note.strip()[:1000]
        self.return_resolved_at = None
        self.touch(now)

    def resolve_return_mark(self, now: datetime) -> None:
        """Cualquier cambio del empleado sobre un gasto marcado resuelve la marca."""
        if self.return_note and self.return_resolved_at is None:
            self.return_resolved_at = now

    def apply_conversion(self, rate: Decimal, source: ExchangeRateSource, rate_date: date) -> None:
        """Tasa automática hacia la moneda del anticipo; el valor convertido se fija al confirmar."""
        self.exchange_rate, self.exchange_rate_source, self.exchange_rate_date = rate, source, rate_date

    def clear_conversion(self) -> None:
        self.exchange_rate = self.exchange_rate_source = self.exchange_rate_date = None

    def review(self, decision: ReviewDecision, reviewer_id: uuid.UUID, note: str | None, now: datetime) -> None:
        """El aprobador decide sobre los hallazgos. 'Aceptar sin bloqueados' deja las líneas bloqueadas
        (más su impuesto proporcional) como no reembolsables, en la moneda del anticipo."""
        if self.status != ExpenseStatus.CONFIRMED and not self.findings_with(PolicyAction.BLOCK):
            raise InvalidOperationError("Expense not reviewable", code="expense_not_reviewable")
        if decision == ReviewDecision.ACCEPT_FULL and not (note and note.strip()):
            raise InvalidOperationError("Accepting a policy exception needs a note", code="exception_note_required")
        self.non_reimbursable_amount = None
        if decision == ReviewDecision.REJECT:
            self.review_status = ReviewStatus.REJECTED
        elif decision == ReviewDecision.ACCEPT_WITHOUT_BLOCKED:
            self.review_status = ReviewStatus.ACCEPTED_PARTIAL
            self.non_reimbursable_amount = self._non_reimbursable_in_advance_currency()
        else:
            self.review_status = ReviewStatus.ACCEPTED
        # Un gasto bloqueado ya revisado se puede volver a confirmar: el aprobador levantó el bloqueo.
        self.policy_findings = [
            {**f, "action": PolicyAction.WARN} if f.get("action") == PolicyAction.BLOCK else f for f in self.policy_findings
        ]
        self.reviewed_by, self.reviewed_at, self.review_note = reviewer_id, now, note
        self.touch(now)

    def _non_reimbursable_in_advance_currency(self) -> Decimal | None:
        if not self.suggested_non_reimbursable or not self.total:
            return None
        # Sobre lo que se legaliza: el valor del banco si el gasto ya se cruzó con el extracto.
        base = self.amount_applied if self.amount_applied is not None else self.total
        # Conversión proporcional: sirve esté o no el gasto en la moneda del anticipo.
        return (base * self.suggested_non_reimbursable / self.total).quantize(Decimal("0.01"))

    def discard_as_duplicate(self, original_id: uuid.UUID, now: datetime) -> None:
        self.duplicate_of_id = original_id
        self.discard(now)
        self.processed_at = self.processed_at or now

    def discard(self, now: datetime) -> None:
        if self.status == ExpenseStatus.DISCARDED:
            return
        self.status = ExpenseStatus.DISCARDED
        self.amount_applied = None
        self.touch(now)

    def touch(self, now: datetime) -> None:
        self.updated_at = now


@dataclass(eq=False)
class ExpenseLine:
    """Un ítem impreso de la factura. La IA sugiere el concepto; un revisor lo puede corregir."""

    expense_id: uuid.UUID
    position: int
    description: str
    normalized_text: str
    amount: Decimal | None = None
    quantity: Decimal | None = None
    ai_concept_code: str | None = None
    ai_concept_confidence: float | None = None
    final_concept_code: str | None = None
    corrected_by: uuid.UUID | None = None
    corrected_at: datetime | None = None
    memory_example_id: uuid.UUID | None = None  # el concepto salió de una corrección aprendida
    similar_concept_code: str | None = None  # parecida a una línea que se corrigió como bloqueada
    similar_text: str | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)

    @property
    def is_blocked(self) -> bool:
        return self.final_concept_code is not None

    def correct_concept(self, concept_code: str | None, actor_id: uuid.UUID, now: datetime) -> None:
        self.final_concept_code = concept_code or None
        self.corrected_by = actor_id
        self.corrected_at = now


NO_CONCEPT = "none"  # etiqueta de un ejemplo negativo: la línea es un ítem permitido


@dataclass(eq=False)
class ClassificationExample:
    """Lo que la plataforma aprende de las correcciones: el texto normalizado de una línea (o el NIT
    de un proveedor) y su etiqueta. Nunca se borra: se desactiva y queda su historial."""

    kind: ExampleKind
    key_text: str
    original_text: str
    label: str
    created_by: uuid.UUID
    company_id: uuid.UUID | None = None  # None en los de grupo
    scope: ExampleScope = ExampleScope.COMPANY
    status: ExampleStatus = ExampleStatus.ACTIVE
    conflicted: bool = False  # alguien lo corrigió con otra etiqueta: contabilidad debe revisarlo
    source_expense_id: uuid.UUID | None = None
    updated_by: uuid.UUID | None = None
    updated_at: datetime = field(default_factory=utcnow)
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def snapshot(self) -> dict[str, Any]:
        return {"label": self.label, "scope": self.scope.value, "status": self.status.value, "conflicted": self.conflicted}

    def relabel(self, label: str, actor_id: uuid.UUID, now: datetime) -> None:
        if label != self.label:
            self.conflicted = True
            self.label = label
        self.updated_by, self.updated_at = actor_id, now


@dataclass(eq=False)
class ExampleHistory:
    example_id: uuid.UUID
    action: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    actor_id: uuid.UUID | None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)


@dataclass(eq=False)
class ExtractionAttempt:
    """Una llamada al proveedor de IA: se guarda para auditoría y seguimiento de precisión y costo."""

    expense_id: uuid.UUID
    attempt_no: int
    tier: str  # primary | escalation | budget
    model_requested: str
    prompt_version: str
    model_used: str | None = None
    raw_response: str | None = None
    parsed: dict[str, Any] | None = None
    validation_errors: list[str] = field(default_factory=list)
    escalation_reason: str | None = None
    confidence: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cached_tokens: int | None = None
    cost_usd: Decimal | None = None
    latency_ms: int | None = None
    timings: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)


@dataclass(eq=False)
class ExchangeRate:
    """1 unidad de `base` = `rate` unidades de `quote`, vigente en `day`."""

    day: date
    base: str
    quote: str
    rate: Decimal
    source: ExchangeRateSource
    fetched_at: datetime = field(default_factory=utcnow)


@dataclass(eq=False)
class BankStatement:
    """Extracto bancario de la tarjeta con que se pagaron los gastos de un anticipo. Lo carga tesorería
    cuando la legalización ya está en revisión (decisión 7.1)."""

    advance_id: uuid.UUID
    company_id: uuid.UUID
    employee_id: uuid.UUID  # titular de la tarjeta
    currency: str
    file_name: str
    file_sha256: str
    file_key: str
    profile: dict[str, Any]  # cómo se leyó (reconciliation.StatementProfile); el PDF lo lee la IA
    uploaded_by: uuid.UUID
    card_last4: str | None = None
    # Lectura con IA de un PDF: se suma al costo de la IA del mes.
    ai_model: str | None = None
    ai_prompt_tokens: int | None = None
    ai_completion_tokens: int | None = None
    ai_cached_tokens: int | None = None
    ai_cost_usd: Decimal | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    uploaded_at: datetime = field(default_factory=utcnow)


@dataclass(eq=False)
class StatementMovement:
    """Un movimiento del extracto. Un cargo se cruza con un gasto o, si no tiene factura, contabilidad
    decide si lo asume la empresa o se le descuenta al empleado."""

    statement_id: uuid.UUID
    row: int
    day: date
    description: str
    amount: Decimal  # siempre positivo, en la moneda del extracto
    is_charge: bool
    in_trip: bool  # dentro de las fechas del viaje (con margen); los demás no son de esta legalización
    reference: str | None = None
    expense_id: uuid.UUID | None = None
    match_status: MatchStatus | None = None
    match_score: Decimal | None = None
    matched_by: uuid.UUID | None = None
    matched_at: datetime | None = None
    rejected_expense_ids: list[str] = field(default_factory=list)  # pares que contabilidad descartó
    charge_decision: ChargeDecision | None = None
    absorbed_expense_id: uuid.UUID | None = None  # gasto que representa el cargo que asume la empresa
    decided_by: uuid.UUID | None = None
    decided_at: datetime | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)

    @property
    def is_fixed(self) -> bool:
        """Lo decidió contabilidad: el recálculo no lo toca."""
        return self.match_status in (MatchStatus.CONFIRMED, MatchStatus.MANUAL)

    @property
    def applies(self) -> bool:
        """El cruce cuenta para legalizar por el valor del banco (una sugerencia todavía no)."""
        return self.expense_id is not None and self.match_status != MatchStatus.SUGGESTED

    @property
    def needs_decision(self) -> bool:
        """Lo que contabilidad debe resolver antes de cerrar: una sugerencia o un cargo del viaje sin factura."""
        if self.match_status == MatchStatus.SUGGESTED:
            return True
        return self.is_charge and self.in_trip and self.expense_id is None and self.charge_decision is None

    def propose(self, expense_id: uuid.UUID, score: Decimal, automatic: bool) -> None:
        self.expense_id, self.match_score = expense_id, score
        self.match_status = MatchStatus.AUTO if automatic else MatchStatus.SUGGESTED
        self.matched_by = self.matched_at = None
        self._clear_decision()

    def unmatch(self) -> None:
        self.expense_id = self.match_status = self.match_score = self.matched_by = self.matched_at = None

    def confirm(self, actor_id: uuid.UUID, now: datetime) -> None:
        if self.expense_id is None:
            raise InvalidOperationError("Nothing to confirm", code="movement_not_matched")
        self.match_status = MatchStatus.MANUAL if self.match_status == MatchStatus.MANUAL else MatchStatus.CONFIRMED
        self.matched_by, self.matched_at = actor_id, now

    def reject(self) -> uuid.UUID:
        """Deshace el cruce y el sistema no vuelve a proponer ese par. Devuelve el gasto que se soltó."""
        if self.expense_id is None:
            raise InvalidOperationError("Nothing to reject", code="movement_not_matched")
        released = self.expense_id
        self.rejected_expense_ids = [*self.rejected_expense_ids, str(released)]
        self.unmatch()
        return released

    def link(self, expense_id: uuid.UUID, actor_id: uuid.UUID, now: datetime) -> None:
        if not self.is_charge:
            raise InvalidOperationError("Only charges are matched", code="movement_not_charge")
        if self.is_fixed:
            raise InvalidOperationError("Already matched", code="movement_already_matched")
        self.expense_id, self.match_status, self.match_score = expense_id, MatchStatus.MANUAL, None
        self.matched_by, self.matched_at = actor_id, now
        self.rejected_expense_ids = [e for e in self.rejected_expense_ids if e != str(expense_id)]
        self._clear_decision()

    def decide(self, decision: ChargeDecision, actor_id: uuid.UUID, now: datetime) -> None:
        if not self.is_charge or self.expense_id is not None:
            raise InvalidOperationError("Only charges without an invoice are decided", code="movement_not_decidable")
        self.charge_decision, self.decided_by, self.decided_at = decision, actor_id, now

    def _clear_decision(self) -> None:
        self.charge_decision = self.decided_by = self.decided_at = None


@dataclass(eq=False)
class AuditEntry:
    action: str
    entity_type: str
    entity_id: str | None
    actor_id: uuid.UUID | None = None
    channel: Channel = Channel.API
    data: dict[str, Any] = field(default_factory=dict)
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=utcnow)

    def __post_init__(self) -> None:
        self.data = _jsonable(self.data)


@dataclass(eq=False)
class InboundMessage:
    """Registro de idempotencia: cada id de mensaje de WhatsApp que ya se procesó."""

    wa_message_id: str
    received_at: datetime = field(default_factory=utcnow)
