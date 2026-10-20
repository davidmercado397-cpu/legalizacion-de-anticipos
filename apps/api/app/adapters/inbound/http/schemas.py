"""Contrato de la API REST con el frontend: cambiar un modelo aquí es cambiar el contrato."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.application.messages import COLOMBIAN, escalation_text
from app.application.whatsapp_presenter import finding_text
from app.domain.budgets import TripLeg
from app.domain.entities import Advance, AdvanceBalance, ApproverDelegation, CashWithdrawal, Company, Employee, Expense
from app.domain.enums import (
    AdvanceKind,
    AdvanceStatus,
    ApprovalLevel,
    BankStatus,
    BudgetUnit,
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
    TaxType,
    UnreadableReason,
    WhatsAppLinkStatus,
)
from app.domain.ports import Page, Paged


class Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=512)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    must_change_password: bool


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class LinkCodeOut(BaseModel):
    code: str
    expires_in_minutes: int
    instructions: str


class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    country: str = Field(min_length=2, max_length=2)
    currency: str = Field(min_length=3, max_length=3)
    tax_id: str | None = Field(default=None, max_length=40)
    is_test: bool = False
    legal_name: str | None = Field(default=None, max_length=200, description="Razón social que debe ir en las facturas")
    timezone: str | None = Field(default=None, max_length=64, description="IANA; vacío = la del país")


class CashCapIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)


class CompanyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_id: str | None = Field(default=None, max_length=40)
    is_test: bool | None = None
    active: bool | None = None
    generic_tax_id: str | None = Field(default=None, max_length=40)
    deductibility: dict[DocumentType, Deductibility] | None = None
    legal_name: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)
    exchange_rate_policy: ExchangeRatePolicy | None = Field(
        default=None, description="daily = tasa del día de la factura; previous_month_close = cierre del mes anterior"
    )
    cash_international_cap: CashCapIn | None = Field(
        default=None, description="Tope del anticipo en efectivo en moneda extranjera; null lo elimina"
    )


class CompanyOut(Model):
    id: uuid.UUID
    name: str
    legal_name: str | None
    country: str
    currency: str
    timezone: str
    exchange_rate_policy: ExchangeRatePolicy
    cash_international_cap: dict[str, str] | None
    approval_tolerance_pct: Decimal
    approval_thresholds: dict[str, str]
    tax_id: str | None
    is_test: bool
    active: bool
    generic_tax_id: str | None
    deductibility: dict[str, str]


class CategoryIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    emoji: str | None = Field(default=None, max_length=16)
    accounting_account: str | None = Field(default=None, max_length=40)
    position: int = Field(default=0, ge=0, le=1000)
    active: bool = True


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    emoji: str | None = Field(default=None, max_length=16)
    accounting_account: str | None = Field(default=None, max_length=40)
    position: int | None = Field(default=None, ge=0, le=1000)
    active: bool | None = None


class CategoryOut(Model):
    id: uuid.UUID
    company_id: uuid.UUID
    code: str
    name: str
    emoji: str | None
    accounting_account: str | None
    position: int
    active: bool


class TaxIn(BaseModel):
    type: TaxType
    amount: Decimal = Field(ge=0, max_digits=16, decimal_places=2)
    rate: Decimal | None = Field(default=None, ge=0, le=100, max_digits=6, decimal_places=3)
    base: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)


class EmployeeIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    role: Role = Role.EMPLOYEE
    company_ids: list[uuid.UUID] = Field(min_length=1)
    phone: str | None = Field(default=None, max_length=20)
    approver_id: uuid.UUID | None = None
    password: str | None = Field(default=None, max_length=256)
    staff_type: StaffType | None = Field(default=None, description="Define la tarifa del presupuesto de viaje")


class EmployeePatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    email: EmailStr | None = None
    role: Role | None = None
    company_ids: list[uuid.UUID] | None = Field(default=None, min_length=1)
    phone: str | None = Field(default=None, max_length=20)
    approver_id: uuid.UUID | None = None
    staff_type: StaffType | None = None


class PasswordResetIn(BaseModel):
    password: str | None = Field(default=None, max_length=256)


class EmployeeOut(Model):
    id: uuid.UUID
    full_name: str
    email: str
    role: Role
    phone: str | None
    company_ids: list[uuid.UUID]
    approver_id: uuid.UUID | None
    staff_type: StaffType | None
    active: bool
    must_change_password: bool
    mfa_enabled: bool
    wa_link_status: WhatsAppLinkStatus
    wa_username: str | None
    wa_profile_name: str | None
    privacy_accepted_at: datetime | None
    created_at: datetime


class MeOut(EmployeeOut):
    mfa_setup_required: bool = Field(description="Su rol exige verificación en dos pasos y todavía no la activa")
    supported_currencies: list[str] = Field(description="Monedas que se pueden usar en anticipos y gastos")


class EmployeeCreatedOut(EmployeeOut):
    temporary_password: str


class TripLegIn(BaseModel):
    destination: str = Field(min_length=2, max_length=120)
    start_date: date
    end_date: date

    def to_domain(self) -> TripLeg:
        return TripLeg(self.destination.strip(), self.start_date, self.end_date)


class TripLegOut(BaseModel):
    destination: str
    start_date: date
    end_date: date


class AdvanceIn(BaseModel):
    company_id: uuid.UUID
    kind: AdvanceKind
    currency: str = Field(min_length=3, max_length=3)
    amount: Decimal | None = Field(
        default=None, ge=0, max_digits=16, decimal_places=2, description="Vacío = el valor calculado con las tarifas de viaje"
    )
    purpose: str = Field(min_length=3, max_length=500)
    destination: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    travel_zone_id: uuid.UUID | None = Field(default=None, description="Vacío = se busca la zona por el destino")
    justification: str | None = Field(
        default=None, max_length=1000, description="Obligatoria si el valor es distinto del presupuesto calculado"
    )
    legs: list[TripLegIn] = Field(
        default_factory=list,
        max_length=10,
        description="Viaje con varios destinos; si viene, reemplaza destination, start_date y end_date",
    )


class TripIn(BaseModel):
    company_id: uuid.UUID
    destination: str | None = Field(default=None, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    travel_zone_id: uuid.UUID | None = None
    legs: list[TripLegIn] = Field(default_factory=list, max_length=10, description="Varios destinos, en lugar de uno")


class BudgetLineOut(BaseModel):
    category: str
    unit: BudgetUnit
    units: int
    rate: Decimal
    amount: Decimal
    destination: str | None = Field(default=None, description="Tramo al que pertenece, si el viaje tiene varios")


class BudgetOut(BaseModel):
    zone_id: uuid.UUID
    currency: str
    total: Decimal
    lines: list[BudgetLineOut]


class TravelZoneIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    places: list[str] = Field(default_factory=list, max_length=500, description="Ciudades o países (código ISO) de la zona")


class TravelZonePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    places: list[str] | None = Field(default=None, max_length=500)
    active: bool | None = None


class TravelZoneOut(Model):
    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    places: list[str]
    active: bool


class TravelRateIn(BaseModel):
    zone_id: uuid.UUID
    staff_type: StaffType
    category_code: str = Field(min_length=2, max_length=40)
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    unit: BudgetUnit
    valid_from: date
    valid_to: date | None = None


class TravelRateOut(Model):
    id: uuid.UUID
    zone_id: uuid.UUID
    staff_type: StaffType
    category_code: str
    amount: Decimal
    currency: str
    unit: BudgetUnit
    valid_from: date
    valid_to: date | None


class ImportOut(BaseModel):
    imported: int


class NoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class FunctionalBalanceOut(Model):
    currency: str
    rate: Decimal
    rate_date: date
    amount: Decimal
    applied: Decimal
    pending: Decimal


class BalanceOut(BaseModel):
    currency: str
    amount: Decimal = Field(description="Valor aprobado")
    disbursed: Decimal = Field(description="Lo que tesorería ya entregó")
    applied: Decimal
    pending: Decimal
    expenses_count: int
    functional: FunctionalBalanceOut | None = Field(
        default=None, description="El mismo saldo en la moneda de la compañía, si el anticipo está en otra moneda"
    )

    @classmethod
    def of(cls, balance: AdvanceBalance, functional: object | None = None) -> BalanceOut:
        return cls(
            currency=balance.currency,
            amount=balance.amount,
            disbursed=balance.disbursed,
            applied=balance.applied,
            pending=balance.pending,
            expenses_count=balance.expenses_count,
            functional=FunctionalBalanceOut.model_validate(functional) if functional is not None else None,
        )


class ConversionOut(BaseModel):
    source: str
    target: str
    rate: Decimal = Field(description="1 unidad de `source` = `rate` unidades de `target`")
    rate_date: date
    origin: ExchangeRateSource


class SyncOut(BaseModel):
    stored: int


class ApprovalStepOut(BaseModel):
    level: ApprovalLevel
    approver_id: uuid.UUID | None = Field(description="None en gerencia: decide cualquier usuario de gerencia")
    approver_name: str | None
    status: StepStatus
    decided_by: uuid.UUID | None
    decided_at: datetime | None
    note: str | None


class EscalationReasonOut(BaseModel):
    code: str
    message: str


class ApprovalRulesIO(BaseModel):
    tolerance_pct: Decimal = Field(ge=0, le=100, description="Sobre el presupuesto calculado, antes de escalar")
    thresholds: dict[str, Decimal] = Field(
        default_factory=dict, description="Moneda -> monto total por encima del cual escala al jefe directivo"
    )


class AdvanceOut(Model):
    id: uuid.UUID
    employee_id: uuid.UUID
    company_id: uuid.UUID
    kind: AdvanceKind
    currency: str
    amount: Decimal
    purpose: str
    destination: str | None
    start_date: date | None
    end_date: date | None
    status: AdvanceStatus
    budget_zone_id: uuid.UUID | None
    budget_amount: Decimal | None
    budget_breakdown: list[dict[str, Any]]
    budget_justification: str | None
    legs: list[TripLegOut] = Field(description="Tramos del viaje; vacío si tuvo un solo destino")
    erp_advance_status: ErpStatus | None = Field(description="Siesa: el anticipo (se crea al aprobarse)")
    erp_advance_ref: str | None
    erp_legalization_status: ErpStatus | None = Field(description="Siesa: la legalización (la envía contabilidad)")
    erp_legalization_ref: str | None
    erp_error: str | None = Field(description="Último error al enviar a Siesa")
    approval_steps: list[ApprovalStepOut] = Field(description="Ruta de aprobación; vacía en solicitudes anteriores")
    legalization_due: date | None = Field(description="Plazo para enviar la legalización")
    overdue: bool = Field(description="Aprobado y sin enviar la legalización después del plazo")
    escalation_reasons: list[EscalationReasonOut] = Field(description="Por qué necesita al jefe directivo")
    decided_by: uuid.UUID | None
    decided_at: datetime | None
    decision_note: str | None
    approved_at: datetime | None
    approved_by: uuid.UUID | None
    submitted_at: datetime | None
    returned_at: datetime | None
    closed_at: datetime | None
    closed_by: uuid.UUID | None
    disbursed_at: datetime | None
    disbursed_by: uuid.UUID | None
    disbursement_method: DisbursementMethod | None
    disbursement_ref: str | None
    settlement_currency: str | None = Field(
        description="Moneda en que se entrega y se legaliza si el anticipo se calculó en otra (la de la compañía)"
    )
    settlement_amount: Decimal | None = Field(description="Lo entregado en `settlement_currency` (estimado hasta desembolsar)")
    settlement_rate: Decimal | None
    settlement_rate_date: date | None
    settlement_status: SettlementStatus | None
    settled_at: datetime | None
    settled_by: uuid.UUID | None
    settlement_method: SettlementMethod | None
    settlement_ref: str | None
    created_at: datetime


class AdvanceListItemOut(AdvanceOut):
    employee_name: str


class FileOut(BaseModel):
    url: str
    mime_type: str | None
    expires_at: datetime
    thumbnail_url: str | None


class CashDrawOut(BaseModel):
    withdrawal_id: uuid.UUID
    amount: Decimal
    rate: Decimal


class ExpenseOut(Model):
    id: uuid.UUID
    employee_id: uuid.UUID
    company_id: uuid.UUID | None
    advance_id: uuid.UUID | None
    source: ExpenseSource
    status: ExpenseStatus
    document_index: int
    parent_id: uuid.UUID | None
    document_type: DocumentType | None
    vendor_name: str | None
    vendor_tax_id: str | None
    invoice_number: str | None
    invoice_date: date | None
    invoice_time: time | None
    currency: str | None
    subtotal: Decimal | None
    tax_amount: Decimal | None
    taxes: list[dict[str, Any]]
    tip_amount: Decimal | None
    discount_amount: Decimal | None
    total: Decimal | None
    fiscal_id: str | None
    buyer_tax_id: str | None
    country: str | None
    category: str | None
    description: str | None
    itemized: bool
    legibility: Legibility | None
    unreadable_reason: UnreadableReason | None
    ai_confidence: float | None
    field_sources: dict[str, str]
    amount_applied: Decimal | None
    exchange_rate: Decimal | None
    exchange_rate_source: ExchangeRateSource | None
    exchange_rate_date: date | None
    warnings: list[str]
    policy_findings: list[dict[str, Any]] = Field(
        description="Hallazgos de política: rule, action (warn | require_justification | block), code, detail y message"
    )
    justification: str | None
    deductibility: Deductibility | None
    suggested_non_reimbursable: Decimal | None
    non_reimbursable_amount: Decimal | None
    review_status: ReviewStatus
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    last_error: str | None
    client_ref: str | None
    sent_at: datetime | None
    reported_at: datetime = Field(description="Cuándo lo envió el usuario (hora del mensaje de WhatsApp o de la app)")
    created_at: datetime = Field(description="Cuándo llegó al servidor")
    processed_at: datetime | None
    updated_at: datetime
    confirmed_at: datetime | None
    confirmed_by: uuid.UUID | None
    return_note: str | None = Field(description="Marca del aprobador al devolver la legalización")
    return_resolved_at: datetime | None
    duplicate_of_id: uuid.UUID | None = Field(
        description="El empleado ya había registrado esta factura: se descartó sola y este es el gasto original"
    )
    receipt_signed: bool = Field(description="Recibo de caja: el empleado declaró que lo firmó quien vendió")
    payment_method: PaymentMethod | None
    bank_status: BankStatus | None = Field(
        description="matched: se legaliza por lo que cobró el banco; no_charge: pagado con tarjeta y sin cargo en el extracto"
    )
    bank_amount: Decimal | None = Field(description="Valor cobrado por el banco, en `bank_currency`")
    bank_currency: str | None
    cash_allocations: list[CashDrawOut] = Field(description="Pagado en efectivo: qué parte salió de cada retiro y a qué tasa")
    cash_uncovered: Decimal | None = Field(description="Parte en efectivo que ningún retiro cubre (va con la tasa del día)")
    amount_before_bank: Decimal | None = Field(description="Valor por la factura antes del ajuste del banco")
    file: FileOut | None = Field(default=None, description="URLs firmadas de corta duración del original y la miniatura")


class OwnerOut(Model):
    id: uuid.UUID
    full_name: str
    email: str


class ExpenseDetailOut(ExpenseOut):
    lines: list[ExpenseLineOut]


class AdvanceDetailOut(AdvanceOut):
    balance: BalanceOut
    company_timezone: str = Field(description="Las fechas vienen con el offset de esta zona")
    employee: OwnerOut
    expenses: list[ExpenseDetailOut]
    withdrawals: list[WithdrawalOut] = Field(description="Retiros de efectivo en otra moneda (bolsas FIFO)")


class TimelineEventOut(BaseModel):
    action: str
    label: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    channel: str
    at: datetime
    note: str | None


class ReturnSuggestionOut(BaseModel):
    expense_id: uuid.UUID
    note: str


class ReturnItemIn(BaseModel):
    expense_id: uuid.UUID
    note: str = Field(min_length=3, max_length=1000)


class ReturnIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    items: list[ReturnItemIn] = Field(default_factory=list, max_length=200, description="Gastos marcados (opcional)")


class RequiredNoteIn(BaseModel):
    note: str = Field(min_length=3, max_length=1000)


class DisburseIn(BaseModel):
    method: DisbursementMethod
    reference: str | None = Field(default=None, max_length=120)
    disbursed_at: datetime | None = Field(default=None, description="Vacío = ahora")
    amount: Decimal | None = Field(
        default=None,
        gt=0,
        max_digits=16,
        decimal_places=2,
        description="Calculado en otra moneda: lo entregado en la de la compañía. Vacío = con la tasa del día",
    )


class WithdrawalIn(BaseModel):
    withdrawn_on: date
    currency: str = Field(min_length=3, max_length=3)
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2, description="Lo retirado, en `currency`")
    debited_amount: Decimal | None = Field(
        default=None, gt=0, max_digits=16, decimal_places=2, description="Lo que debitó el banco, en la moneda de legalización"
    )
    fee_amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2, description="Comisión del retiro")
    note: str | None = Field(default=None, max_length=300)


class WithdrawalPatch(BaseModel):
    """Solo cambia lo que viene. Tesorería solo puede cambiar lo debitado, la comisión y la nota."""

    withdrawn_on: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=16, decimal_places=2)
    debited_amount: Decimal | None = Field(default=None, gt=0, max_digits=16, decimal_places=2)
    fee_amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    note: str | None = Field(default=None, max_length=300)


class WithdrawalOut(BaseModel):
    id: uuid.UUID
    withdrawn_on: date
    currency: str
    amount: Decimal
    official_rate: Decimal | None = Field(description="Tasa oficial del día del retiro hacia la moneda de legalización")
    official_rate_date: date | None
    official_source: ExchangeRateSource | None
    debited_amount: Decimal | None
    fee_amount: Decimal | None
    rate: Decimal | None = Field(description="La que se usa: la del banco si se conoce, si no la oficial")
    value: Decimal | None = Field(description="Lo que costó el retiro en la moneda de legalización")
    remaining: Decimal | None = Field(description="Lo que queda sin gastar, en `currency`")
    note: str | None
    updated_at: datetime

    @classmethod
    def of(cls, w: CashWithdrawal, remaining: Decimal | None = None) -> WithdrawalOut:
        data = {f: getattr(w, f) for f in cls.model_fields if f != "remaining"}
        return cls.model_validate({**data, "remaining": remaining})


class SettleIn(BaseModel):
    method: SettlementMethod
    reference: str | None = Field(default=None, max_length=120)
    settled_at: datetime | None = Field(default=None, description="Vacío = ahora")


class DelegationIn(BaseModel):
    delegate_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime


class DelegationOut(Model):
    id: uuid.UUID
    approver_id: uuid.UUID
    delegate_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    created_by: uuid.UUID
    revoked_at: datetime | None


class OpenBalanceOut(BaseModel):
    advance: AdvanceOut
    balance: BalanceOut


class ExpensePatch(BaseModel):
    document_type: DocumentType | None = None
    vendor_name: str | None = Field(default=None, max_length=300)
    vendor_tax_id: str | None = Field(default=None, max_length=40)
    invoice_number: str | None = Field(default=None, max_length=80)
    invoice_date: date | None = None
    invoice_time: time | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    subtotal: Decimal | None = Field(default=None, max_digits=16, decimal_places=2)
    tax_amount: Decimal | None = Field(default=None, max_digits=16, decimal_places=2)
    taxes: list[TaxIn] | None = Field(default=None, max_length=10, description="Desglose; el total de impuestos se recalcula")
    tip_amount: Decimal | None = Field(default=None, max_digits=16, decimal_places=2)
    discount_amount: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=2)
    total: Decimal | None = Field(default=None, gt=0, max_digits=16, decimal_places=2)
    fiscal_id: str | None = Field(default=None, max_length=120)
    buyer_tax_id: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    category: str | None = Field(default=None, max_length=40, description="Código de una categoría activa de la compañía")
    description: str | None = Field(default=None, max_length=1000)
    payment_method: PaymentMethod | None = Field(default=None, description="Solo los pagos con tarjeta se cruzan con el extracto")

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True, mode="python")


class ConfirmIn(BaseModel):
    receipt_signed: bool | None = Field(default=None, description="Recibo de caja: lo firmó quien vendió")
    advance_id: uuid.UUID | None = None
    amount_applied: Decimal | None = Field(default=None, gt=0, max_digits=16, decimal_places=2)
    justification: str | None = Field(default=None, max_length=1000)


class ExpenseLineOut(Model):
    id: uuid.UUID
    position: int
    description: str
    amount: Decimal | None
    quantity: Decimal | None
    ai_concept_code: str | None
    ai_concept_confidence: float | None
    final_concept_code: str | None
    corrected_by: uuid.UUID | None
    corrected_at: datetime | None
    memory_example_id: uuid.UUID | None = Field(description="El concepto salió de una corrección aprendida")
    similar_concept_code: str | None = Field(description="Se parece a una línea corregida como bloqueada")
    similar_text: str | None


class LinePatch(BaseModel):
    concept_code: str | None = Field(default=None, max_length=40, description="null = the item is allowed")


class ReviewIn(BaseModel):
    decision: ReviewDecision
    note: str | None = Field(default=None, max_length=1000)


class DeductibilityIn(BaseModel):
    deductibility: Deductibility


class PolicyRuleOut(BaseModel):
    rule_type: str
    action: PolicyAction
    params: dict[str, Any]
    active: bool
    description: str
    customized: bool


class PolicyRuleIn(BaseModel):
    rule_type: str = Field(max_length=40)
    action: PolicyAction
    params: dict[str, Any] = Field(default_factory=dict)
    active: bool = True


class BlockedConceptIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    examples: list[str] = Field(default_factory=list, max_length=50)
    active: bool = True
    deductible: bool = Field(default=False, description="Si el aprobador lo acepta completo, ¿es deducible?")


class BlockedConceptPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    examples: list[str] | None = Field(default=None, max_length=50)
    active: bool | None = None
    deductible: bool | None = None


class BlockedConceptOut(Model):
    id: uuid.UUID
    company_id: uuid.UUID
    code: str
    name: str
    description: str | None
    examples: list[str]
    active: bool
    deductible: bool


class DeductibilityOut(BaseModel):
    """Sugerencia calculada: el criterio tributario lo define contabilidad."""

    deductible_base: Decimal
    non_deductible_base: Decimal
    employee_assumed: Decimal
    vat_creditable: Decimal
    vat_non_creditable: Decimal
    consumption_tax: Decimal
    other_taxes: Decimal
    tip: Decimal


class AuditOut(Model):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    channel: str
    data: dict[str, Any]
    created_at: datetime


def delegation_out(d: ApproverDelegation) -> DelegationOut:
    return DelegationOut.model_validate(d)


def localize[M: BaseModel](model: M, timezone: str) -> M:
    """Las fechas se guardan en UTC; las lecturas de anticipos y gastos las devuelven con el offset de
    la zona de la compañía (mismo instante, más fácil de leer). Es el único lugar donde se convierte."""
    zone = ZoneInfo(timezone)

    def convert(value: Any) -> Any:
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(zone)
        if isinstance(value, BaseModel):
            return localize(value, timezone)
        if isinstance(value, list):
            return [convert(item) for item in value]
        return value

    return model.model_copy(update={name: convert(getattr(model, name)) for name in type(model).model_fields})


def employee_out(e: Employee) -> EmployeeOut:
    return EmployeeOut.model_validate(e)


def company_out(c: Company) -> CompanyOut:
    return CompanyOut.model_validate(c)


def advance_out(a: Advance) -> AdvanceOut:
    reasons = [EscalationReasonOut(code=r["code"], message=escalation_text(r, a.currency)) for r in a.escalation_reasons]
    data = {f: getattr(a, f) for f in AdvanceOut.model_fields if f not in ("escalation_reasons", "overdue")}
    overdue = a.is_overdue(datetime.now(UTC).date())
    return AdvanceOut.model_validate({**data, "escalation_reasons": reasons, "overdue": overdue})


def expense_out(e: Expense) -> ExpenseOut:
    out = ExpenseOut.model_validate(e)
    # Cada hallazgo trae el mismo texto que ve el empleado en WhatsApp (una sola fuente de los mensajes).
    findings = [{**f, "message": finding_text(f, COLOMBIAN)} for f in out.policy_findings]
    return out.model_copy(update={"policy_findings": findings})


class PaginationOut(BaseModel):
    limit: int
    offset: int
    total: int


class ListOut[T](BaseModel):
    data: list[T]


class PageOut[T](BaseModel):
    data: list[T]
    pagination: PaginationOut


def page_out[S, T](paged: Paged[S], page: Page, convert: Callable[[S], T]) -> PageOut[T]:
    return PageOut[T](
        data=[convert(item) for item in paged.items],
        pagination=PaginationOut(limit=page.limit, offset=page.offset, total=paged.total),
    )


class SettingOut(Model):
    key: str
    value: Any
    value_type: str
    constraints: dict[str, Any]
    description: str
    updated_by: uuid.UUID | None
    updated_at: datetime


class SettingsPatch(BaseModel):
    values: dict[str, Any] = Field(
        min_length=1, description="Llave -> valor nuevo; se validan contra el tipo y rango de cada llave"
    )


class LoginOut(BaseModel):
    """Si el usuario tiene MFA, el login no entrega tokens: entrega `mfa_token` para POST /auth/mfa."""

    mfa_required: bool = False
    mfa_token: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int
    must_change_password: bool = False


class MfaVerifyIn(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=2000)
    code: str = Field(min_length=6, max_length=20, description="Código de 6 dígitos de la app o un código de recuperación")


class MfaSetupOut(BaseModel):
    secret: str
    provisioning_uri: str = Field(description="otpauth://… para mostrar como QR")


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str] = Field(description="Se muestran una sola vez; guárdalos en un lugar seguro")


class PendingBalanceOut(BaseModel):
    advance_id: uuid.UUID
    employee_name: str
    company_id: uuid.UUID
    company_name: str
    destination: str | None
    status: AdvanceStatus
    currency: str
    amount: Decimal
    applied: Decimal
    pending: Decimal
    end_date: date | None
    days: int | None = Field(description="Días desde el fin del viaje (o la aprobación si no tiene fechas)")
    bucket: str = Field(description="Tramo de antigüedad, p. ej. 0-15, 16-30, +30")


class SpendOut(BaseModel):
    company_name: str
    category: str | None
    country: str | None
    currency: str | None
    expenses: int
    total: Decimal


class BudgetComplianceOut(BaseModel):
    advance_id: uuid.UUID
    employee_name: str
    company_name: str
    currency: str
    category: str
    budget: Decimal
    spent: Decimal
    difference: Decimal


class IntercompanyOut(BaseModel):
    expense_id: uuid.UUID
    company_name: str
    billed_to: str | None
    employee_name: str
    vendor_name: str | None
    invoice_date: date | None
    currency: str | None
    total: Decimal | None


class UsageCompanyOut(BaseModel):
    company_id: uuid.UUID
    company_name: str
    documents: int
    attempts: int
    escalated: int
    cost_usd: Decimal
    avg_latency_ms: int | None


class UsageOut(BaseModel):
    month: str
    documents: int
    included_documents: int
    extra_documents: int
    extra_price: Decimal
    extra_amount: Decimal
    price_currency: str
    cost_usd: Decimal
    companies: list[UsageCompanyOut]


class AiCostTotalsOut(BaseModel):
    calls: int = Field(description="Llamadas al modelo (incluye escalamientos y respaldos)")
    prompt_tokens: int
    completion_tokens: int
    cached_tokens: int
    cost_usd: Decimal


class AiCostCompanyOut(AiCostTotalsOut):
    company_id: uuid.UUID | None = Field(description="None: lectura de un gasto aún sin compañía")
    company_name: str | None
    is_test: bool


class AiCostModelOut(BaseModel):
    model: str
    totals: AiCostTotalsOut
    companies: list[AiCostCompanyOut]


class AiCostMonthOut(BaseModel):
    month: str
    totals: AiCostTotalsOut
    models: list[AiCostModelOut]


class AiCostsOut(BaseModel):
    from_month: str
    to_month: str
    totals: AiCostTotalsOut
    months: list[AiCostMonthOut] = Field(description="Del más reciente al más antiguo, incluidos los meses sin lecturas")


class AccuracyOut(BaseModel):
    month: str
    lines: int
    lines_matched: int
    memory_hits: int = Field(description="Líneas cuyo concepto salió de una corrección aprendida")
    documents: int
    fields: dict[str, float] = Field(description="Fracción de documentos en que la IA acertó cada campo")
    corrected_before_confirm: int = Field(description="Documentos en que el usuario corrigió algo antes de confirmar")


class ExampleOut(Model):
    id: uuid.UUID
    kind: ExampleKind
    key_text: str
    original_text: str
    label: str = Field(description='Código de concepto o de categoría; "none" = ítem permitido')
    scope: ExampleScope
    company_id: uuid.UUID | None
    status: ExampleStatus
    conflicted: bool
    created_by: uuid.UUID
    source_expense_id: uuid.UUID | None
    updated_by: uuid.UUID | None
    updated_at: datetime
    created_at: datetime


class ExamplePatch(BaseModel):
    label: str | None = Field(default=None, max_length=40)
    scope: ExampleScope | None = None
    active: bool | None = None


class ExampleHistoryOut(Model):
    action: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    actor_id: uuid.UUID | None
    created_at: datetime


class StatementProfileIO(BaseModel):
    """Cómo leer el extracto: columnas desde 0 y la fila de títulos desde 1 (0 = sin títulos)."""

    header_row: int = Field(ge=0, le=50)
    date_col: int = Field(ge=0, le=100)
    description_col: int = Field(ge=0, le=100)
    currency: str = Field(min_length=3, max_length=3)
    amount_col: int | None = Field(default=None, ge=0, le=100)
    debit_col: int | None = Field(default=None, ge=0, le=100)
    credit_col: int | None = Field(default=None, ge=0, le=100)
    reference_col: int | None = Field(default=None, ge=0, le=100)
    date_format: str = "DD/MM/YYYY"
    decimal_separator: str = Field(default=",", pattern=r"^[,.]$")
    charges_negative: bool = True


class SkippedRowOut(BaseModel):
    row: int
    reason: str


class StatementPreviewOut(BaseModel):
    rows: list[list[str]] = Field(description="Primeras filas del archivo, tal cual")
    total_rows: int
    profile: StatementProfileIO
    confident: bool = Field(description="False: revise el mapeo de columnas antes de cargar")
    charges: int
    credits: int
    skipped: list[SkippedRowOut]


class MovementOut(Model):
    id: uuid.UUID
    row: int
    day: date
    description: str
    reference: str | None
    amount: Decimal
    is_charge: bool
    in_trip: bool = Field(description="Dentro de las fechas del viaje (con margen); los demás no son de esta legalización")
    expense_id: uuid.UUID | None
    match_status: MatchStatus | None
    match_score: Decimal | None
    charge_decision: ChargeDecision | None
    needs_decision: bool = Field(description="Contabilidad debe resolverlo antes de cerrar")


class StatementOut(BaseModel):
    id: uuid.UUID
    advance_id: uuid.UUID
    currency: str
    card_last4: str | None
    file_name: str
    uploaded_at: datetime
    profile: dict[str, Any]
    movements: list[MovementOut]


class LinkIn(BaseModel):
    expense_id: uuid.UUID


class ChargeDecisionIn(BaseModel):
    decision: ChargeDecision
